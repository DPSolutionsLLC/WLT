import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PROFILE_MEMBER_CATEGORIES, addRosterMemberSchema } from "@/lib/validation/youth";
import { getActivityProfile } from "@/lib/youth/queries";
import { addRosterMember } from "@/lib/youth/rosterQueries";

// PUTTING A YOUNG PERSON ON A TEAM — the single action ITER-033 is about.
//
// ---------------------------------------------------------------------------
// ONE ROUTE, TWO ENTRY POINTS
// ---------------------------------------------------------------------------
// The user asked for youth-first — "someone simply has to go through each individual youth in the
// app and assign them to an activity" — and that is AddToActivity on an expanded /youth card.
// Team-first is RosterPanel on /youth/profiles, which is needed anyway because that is where a
// roster is read. Both POST here. Two implementations of one decision is how the two come to
// disagree about what "already on the roster" means (visits-b, visits-f).
//
// ---------------------------------------------------------------------------
// `youth_activities.manage`, AND NOTHING NARROWER
// ---------------------------------------------------------------------------
// `activity_roster` carries ward-wide policies on all four verbs (migration 062f), matching
// `activity_events`, `activity_calendars` and `activity_occasions` — the organization is answered
// ONCE, on the profile (054d), and a roster row hangs off a profile that already carries it.
//
// So there is no ownership mirror to apply here and NONE SHOULD BE ADDED.
// lib/youth/activityOwnership.ts says deliberately that there is no `canManageActivityEvent()`,
// because a helper would either restate `true` or invent a rule the database does not enforce —
// and hiding a control the API allows is the mirror of youth-a-D1, just as wrong and quieter.
// Narrowing this needs a migration FIRST and a helper after.
//
// ---------------------------------------------------------------------------
// NO NOTIFICATION
// ---------------------------------------------------------------------------
// Adding a young person to a team is a SETUP action. This module's notifications are about
// coverage and follow-up — things somebody must act on — and a new trigger key costs three files
// kept in step (plans/retros/notification-trigger-drift.md) to tell people something they are
// about to see on the screen they are already looking at.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const profileIdSchema = z.uuid("That activity id is not valid.");

const PROFILE_NOT_FOUND = "That activity is not in your ward.";

// ONE SENTENCE FOR BOTH "not in your ward" AND "not a young person", deliberately. Telling a
// caller which of the two it was would confirm the existence of a member id they may not be
// entitled to know about, and neither answer changes what they can do next.
const MEMBER_NOT_FOUND = "That young person is not on your ward's roster.";

const ALREADY_ON_ROSTER = "They are already on this activity.";

const WRITE_REFUSED = "That activity could not be changed. Reload and try again.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    const { id } = await params;
    const profileId = profileIdSchema.parse(id);
    const input = addRosterMemberSchema.parse(await readJsonBody(request));

    const profile = await getActivityProfile(user.wardId, profileId, supabase);

    if (!profile) {
      return NextResponse.json({ error: PROFILE_NOT_FOUND }, { status: 404 });
    }

    // CHECKED AGAINST THE LIVE ROSTER, BEFORE THE INSERT, for migration 054's reason: the
    // composite foreign key would otherwise answer a foreign member id with a constraint
    // violation, which is not a sentence anybody can act on (CLAUDE.md rule 7).
    //
    // RESOLVED THROUGH THE CALLER'S OWN CLIENT, so a member in another ward simply is not there —
    // the ward-scoped `members` select policy is what makes that true, rather than a filter here.
    //
    // THE CATEGORY IS CHECKED TOO, and PROFILE_MEMBER_CATEGORIES is where the answer lives —
    // never a literal `"youth"` here. ActivityProfileForm's MemberPicker filters on the same
    // constant, and a picker that offers a name the route then refuses is the two-places-
    // disagreeing failure this project keeps a rule about. Until youth-j the constant had only
    // ONE reader, the picker, so the route was the half that could not refuse; this closes it.
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, first_name, last_name")
      .eq("ward_id", user.wardId)
      .eq("id", input.memberId)
      .in("category", [...PROFILE_MEMBER_CATEGORIES])
      .maybeSingle();

    if (memberError) {
      throw new Error(`Could not read that young person: ${memberError.message}`);
    }

    if (!member) {
      return NextResponse.json({ error: MEMBER_NOT_FOUND }, { status: 404 });
    }

    const memberName = `${member.first_name} ${member.last_name}`.trim();

    const result = await addRosterMember(
      user.wardId,
      {
        profileId,
        memberId: input.memberId,
        startedOn: input.startedOn ?? null,
        // FROM THE SESSION, never from the body — the rule lib/validation/youth.ts's header
        // states for `wardId` and `enteredBy`. A body that could name its own author can forge one.
        addedBy: user.id,
      },
      supabase,
    );

    if (!result.ok) {
      // 409 RATHER THAN A SILENT SUCCESS. Migration 062a's unique index is what stops a double tap
      // doubling this young person in every denominator on /youth, and "they are already on this
      // activity" is a fact the caller can act on.
      if (result.reason === "already_on_roster") {
        return NextResponse.json({ error: ALREADY_ON_ROSTER }, { status: 409 });
      }

      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_roster_added",
        module: "youth_activities",
        // THE NAMES BESIDE THE IDS, because "who was added to what?" should be answerable from
        // the log without two more lookups against rows that may since have been deleted.
        detail: {
          profileId,
          activityName: profile.activityName,
          memberId: input.memberId,
          memberName,
          startedOn: result.member.startedOn,
        },
      },
      supabase,
    );

    return NextResponse.json({ member: result.member }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/youth/profiles/[id]/roster",
      fallbackMessage: "Could not add them to that activity. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
