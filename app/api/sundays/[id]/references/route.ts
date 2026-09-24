import { NextResponse } from "next/server";
import { z } from "zod";
import { speakerDisplayName } from "@/components/assignments/SpeakerLine";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { referencesDecisionOf } from "@/lib/calendar/queries";
import { unfinalizeReferencesIfNeeded } from "@/lib/references/finalize";
import {
  addReference,
  listReferencesForAssignments,
  loadSundayTalks,
} from "@/lib/references/queries";
import { getMember } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTopic } from "@/lib/topics/queries";
import { addReferenceSchema } from "@/lib/validation/references";
import type { ReferencesTalk, SundayReferences } from "@/types/domain";

// THE REFERENCES MODAL'S DATA, AND ADDING ONE — p4-sacrament-c, migration 079.
//
// READ AND WRITE BOTH ON `talks.plan`, which is the bishopric — the bishop and both counselors,
// whoever is conducting. Migration 080 narrowed the read to match, on the user's decision that
// "there should be no reason a music coordinator sees the references" (defect 074-D2). RLS would
// refuse anyway (rule 2); the route check turns that into a 403 with a sentence.
//
// ---------------------------------------------------------------------------
// THE TALK IS CHECKED AGAINST THIS SUNDAY BEFORE ANYTHING IS WRITTEN
// ---------------------------------------------------------------------------
// `assignmentId` arrives in the request body. The composite foreign key proves it is in this
// WARD; it does not prove it is on this SUNDAY, and a reference filed under the wrong Sunday would
// quietly move another Sunday's pill. So the POST resolves the Sunday's own talks and refuses
// anything else with a 400 (CLAUDE.md §7, "an author is not a subject").
//
// NO CITATION IN THE AUDIT DETAIL OR ANY LOG LINE — a manual reference is free text.

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";
const NOT_ON_THIS_SUNDAY = "That talk is not on this Sunday.";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.plan", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);

    const loaded = await loadSundayTalks(user.wardId, sundayId, supabase);
    if (!loaded) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    const { sunday, talksWithTopics } = loaded;

    const topicIds = [...new Set(talksWithTopics.map((talk) => talk.topicId as string))];
    const memberIds = [
      ...new Set(
        talksWithTopics
          .map((talk) => talk.memberId)
          .filter((memberId): memberId is string => memberId !== null),
      ),
    ];

    // Per id rather than the whole library or the whole roster: a Sunday has three or four talks,
    // and an archived topic still assigned to a slot must keep its title here.
    const [topics, members, references] = await Promise.all([
      Promise.all(topicIds.map((topicId) => getTopic(user.wardId, topicId, supabase))),
      Promise.all(memberIds.map((memberId) => getMember(user.wardId, memberId, supabase))),
      listReferencesForAssignments(
        user.wardId,
        talksWithTopics.map((talk) => talk.id),
        supabase,
      ),
    ]);

    const topicsById = new Map(
      topics.flatMap((topic) => (topic === null ? [] : [[topic.id, topic] as const])),
    );
    const memberNames = Object.fromEntries(
      members.flatMap((member) =>
        member === null
          ? []
          : [[member.id, `${member.firstName} ${member.lastName}`.trim()] as const],
      ),
    );

    const talks: ReferencesTalk[] = talksWithTopics.map((talk) => {
      const topic = topicsById.get(talk.topicId as string);
      return {
        assignmentId: talk.id,
        slotNumber: talk.slotNumber,
        topicTitle: topic?.title ?? "A topic that is no longer available",
        speakerName: speakerDisplayName(talk, memberNames),
        suggestedScriptures: topic?.suggestedScriptures ?? [],
      };
    });

    const payload: SundayReferences = {
      decision: referencesDecisionOf(sunday),
      talks,
      references,
    };

    return NextResponse.json(payload);
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/sundays/[id]/references",
      fallbackMessage: "Could not load this Sunday's references. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.plan", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);
    const input = addReferenceSchema.parse(await readJsonBody(request));

    const loaded = await loadSundayTalks(user.wardId, sundayId, supabase);
    if (!loaded) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    const isThisSundaysTalk = loaded.talksWithTopics.some(
      (talk) => talk.id === input.assignmentId,
    );
    if (!isThisSundaysTalk) {
      return NextResponse.json({ error: NOT_ON_THIS_SUNDAY }, { status: 400 });
    }

    const reference = await addReference(
      user.wardId,
      {
        assignmentId: input.assignmentId,
        kind: input.kind,
        citation: input.citation,
        documentId: input.documentId ?? null,
        source: input.source,
      },
      supabase,
    );

    // An add clears a skip as well as a finalize (lib/references/finalize.ts says why).
    const sunday =
      (await unfinalizeReferencesIfNeeded(
        user.wardId,
        sundayId,
        { clearSkip: true },
        supabase,
      )) ?? loaded.sunday;

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "talk_reference_added",
        module: "talks",
        detail: {
          sundayId,
          assignmentId: input.assignmentId,
          referenceId: reference.id,
          kind: reference.kind,
          source: reference.source,
        },
      },
      supabase,
    );

    return NextResponse.json(
      { reference, decision: referencesDecisionOf(sunday) },
      { status: 201 },
    );
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/sundays/[id]/references",
      fallbackMessage: "Could not add that reference. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
