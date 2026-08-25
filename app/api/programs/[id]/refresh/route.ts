import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { assembleDraft } from "@/lib/program/assembleDraft";
import { diffDrafts } from "@/lib/program/diff";
import { gatherProgramSources } from "@/lib/program/gather";
import { getProgram, upsertProgramDraft } from "@/lib/program/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { programIdSchema, refreshProgramSchema } from "@/lib/validation/program";
import { PROGRAM_STATUS_LABELS, holdsSacramentMeeting } from "@/types/domain";

// What has moved upstream since the draft was written, and — only on a second call — taking it.
//
// THIS ROUTE IS THE ENTIRE REASON THE SNAPSHOT RULE IS SAFE TO KEEP. A draft that stopped
// tracking its sources is only trustworthy if there is an explicit, honest way to see what has
// changed since. It must not be skippable from the UI, and `apply: false` must never write.
//
// The two calls are deliberate. A refresh that applied as it reported would turn the diff into a
// receipt for something already done, which is the opposite of the choice this exists to offer.

const NOT_FOUND = "That program is not in your ward.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { id } = await params;
    const programId = programIdSchema.parse(id);
    const input = refreshProgramSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "program.build", roleAccess);

    const program = await getProgram(user.wardId, programId, supabase);
    if (!program) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // Refused for the same reason POST /api/programs refuses a save: an approved program that
    // silently absorbed an upstream change is the trust problem the whole snapshot rule exists to
    // prevent. Reopening it as a draft is a decision somebody makes on purpose.
    //
    // Note this refuses the READ as well as the write, including `apply: false`. Showing a
    // bishopric a diff they are not allowed to take would be an invitation with no door.
    if (program.status === "approved" || program.status === "distributed") {
      return NextResponse.json(
        {
          error: `This program is ${PROGRAM_STATUS_LABELS[program.status].toLowerCase()}. Reopen it as a draft before refreshing it.`,
        },
        { status: 409 },
      );
    }

    if (program.sundayId === null) {
      return NextResponse.json(
        { error: "That program is not attached to a Sunday, so there is nothing to refresh." },
        { status: 409 },
      );
    }

    if (!program.draft) {
      return NextResponse.json(
        {
          error:
            program.draftError ??
            "That program has no draft yet. Build it before refreshing it.",
        },
        { status: 409 },
      );
    }

    const sources = await gatherProgramSources(user.wardId, program.sundayId, supabase);
    if (!sources) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    if (!holdsSacramentMeeting(sources.sunday.type)) {
      return NextResponse.json(
        {
          error: `There is no longer a sacrament meeting on ${sources.sunday.date}, so there is nothing to refresh from.`,
        },
        { status: 422 },
      );
    }

    const next = assembleDraft(sources);
    const changes = diffDrafts(program.draft, next);

    // WRITES NOTHING. An empty `changes` array means nothing upstream has moved, which program-b
    // shows as a sentence rather than as an empty panel.
    if (!input.apply) {
      return NextResponse.json({ program, changes, applied: false });
    }

    const saved = await upsertProgramDraft(
      user.wardId,
      program.sundayId,
      next,
      user.id,
      supabase,
    );

    if (!saved) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "program_draft_refreshed",
        module: "program",
        detail: {
          programId,
          sundayId: saved.sundayId,
          // The FIELD NAMES that changed, not their values. An audit row is bishopric-readable
          // and records who did what; the values are in the draft itself.
          changedFields: changes.map((change) => change.field),
          missingCount: next.missing.length,
        },
      },
      supabase,
    );

    return NextResponse.json({ program: saved, changes, applied: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/programs/[id]/refresh",
      fallbackMessage: "Could not refresh that program. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
