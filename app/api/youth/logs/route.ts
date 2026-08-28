import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { notifyOrgLeadership } from "@/lib/notifications/notifyOrgLeadership";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createActivityLogSchema, listActivityEventsQuerySchema } from "@/lib/validation/youth";
import { createActivityLog, listOwnLogsForEvents } from "@/lib/youth/activityLogs";
import { setConfirmedAttendance } from "@/lib/youth/attendees";
import { getActivityEvent, getActivityProfile, listActivityEvents } from "@/lib/youth/queries";

// Filing a follow-up: what happened at a game that has already been played.
//
// THIS FILE DOES NOT IMPORT lib/youth/privateNotes.ts, AND MUST NOT. A private note is written
// through its own endpoint, in its own request, so the wire format carries CLAUDE.md rule 5's
// boundary too — the same arrangement app/api/visits/route.ts describes.
//
// ---------------------------------------------------------------------------
// ANY `youth_activities.log` HOLDER MAY FILE THEIR OWN FOLLOW-UP
// ---------------------------------------------------------------------------
// Being a recorded ATTENDEE is not required. 08-youth-activities.md §Step 5 says attendees get the
// PROMPT; it does not say only attendees may write. A leader who turned up without putting
// themselves down beforehand is exactly the person whose account is worth having, and refusing it
// would be a workflow rule enforced in a route pretending to be a boundary (CLAUDE.md rule 2).
//
// What attendance decides is only whether the FORM shows the confirm-attendance control: no
// attendee row, no such question to answer, and `attended` absent means the attendee row is left
// exactly as it is.
//
// The real boundary is migration 057c's INSERT policy — `logged_by = auth.uid()` and the event
// must be in the caller's organization (or they must be bishopric). Nothing below restates it.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

// 404, not 403, for an event the caller cannot see. A 403 would confirm that the event exists,
// which tells an org leader something about another organization's work that they may not have.
const NOT_FOUND = "That event is not in your ward.";

// A SENTENCE THAT NAMES THE ALTERNATIVE, not a 500. addAttendee's unique violation becomes a quiet
// 200 because being already down for an event is the state the caller wanted; a SECOND follow-up
// is not — they meant to change the one they wrote. So this one says so.
const ALREADY_LOGGED =
  "You have already recorded a follow-up for this event. Open it to change what you wrote.";

// THE POLICY REFUSED THE WRITE, AND THAT IS A SENTENCE RATHER THAN A 500.
//
// `activity_events` keeps its ward-wide SELECT (migration 057 does not touch it), so the caller
// CAN see this event and still may not write a follow-up against it — the visits-d parent-scope
// rule in its second module. The 404 above would be a lie here: the event is in their ward and
// they are looking at it. Naming the organization boundary leaks nothing they could not already
// see, and it is the only version of this message a leader could act on.
const NOT_YOUR_ORGANIZATION =
  "That event belongs to another organization. You can record a follow-up on your own " +
  "organization's activities, and on ward-wide ones.";

// THE CALLER'S OWN follow-ups, for every event on the screen, in one request.
//
// It resolves its own event set rather than taking a list of ids, and reads the SAME query schema
// GET /api/youth/events and GET /api/youth/attendees read — so the three describe one screen. A
// list narrowed one way beside a count answering a different question is the roster-b defect
// whichever half moved.
//
// OWN ONLY, and that is a FILTER rather than a permission. Migration 057 lets a leader read other
// people's follow-ups too; the panel on /youth is about what THIS reader still owes, and somebody
// else's account answers nothing about that. The whole feed is /api/youth/feed.
//
// The response is an OBJECT keyed by event id rather than the Map lib/youth/activityLogs.ts
// returns, because a Map does not survive JSON. Events with no follow-up from this reader are
// simply absent, and the client reads a missing key as "nothing written yet".
export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // `.view`, not `.log`: this is a read, and it answers "have I written one?" for a screen
    // anybody with `youth_activities.view` can see. Writing is gated on `.log` below.
    assertCan(user, "youth_activities.view", roleAccess);

    const url = new URL(request.url);
    const query = listActivityEventsQuerySchema.parse({
      profileId: url.searchParams.get("profileId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      includePast: url.searchParams.get("includePast") ?? undefined,
    });

    // The clock enters ONCE and is handed down, so this response and the events response taken a
    // moment apart describe the same window rather than two.
    const events = await listActivityEvents(
      user.wardId,
      { ...query, asOf: new Date() },
      supabase,
    );

    const byEvent = await listOwnLogsForEvents(
      user.wardId,
      user.id,
      events.map((event) => event.id),
      supabase,
    );

    return NextResponse.json({ logs: Object.fromEntries(byEvent) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/youth/logs",
      fallbackMessage: "Could not load your follow-ups. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.log", roleAccess);

    const input = createActivityLogSchema.parse(await readJsonBody(request));

    // Resolved through the CALLER'S OWN client, so an event in another ward simply is not there.
    // Checked before the insert because the composite foreign key would otherwise answer with a
    // constraint violation, and "insert or update on table violates foreign key constraint" is
    // not a sentence anybody can act on. The sibling routes do the same, word for word.
    const event = await getActivityEvent(user.wardId, input.eventId, supabase);

    if (!event) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // The activity, for the notification's two labels and for the organization to address it to.
    // A ward-wide event has no profile at all, and that is a legitimate state (migration 054a).
    const profile =
      event.profileId === null
        ? null
        : await getActivityProfile(user.wardId, event.profileId, supabase);

    const result = await createActivityLog(user.wardId, user.id, input, supabase);

    if (result.status === "duplicate") {
      return NextResponse.json({ error: ALREADY_LOGGED }, { status: 409 });
    }

    // 403 rather than 404, and the difference from the check above is deliberate: THAT one is
    // about an event the caller cannot see, and a 403 there would confirm it exists. This one is
    // about an event they CAN see, so there is nothing left to conceal and a 404 would only be
    // confusing.
    if (result.status === "refused") {
      return NextResponse.json({ error: NOT_YOUR_ORGANIZATION }, { status: 403 });
    }

    const log = result.log;

    // ONLY AFTER THE LOG IS KNOWN TO HAVE BEEN WRITTEN, mirroring how PATCH /api/visits/[id]
    // replaces participants only once the visit itself is known writable. `attended` absent means
    // the caller said nothing about attendance and the attendee row is untouched — a distinction
    // the schema draws deliberately.
    //
    // A `false` return here is a caller with no attendee row, or one migration 056c refused. It is
    // not worth failing the follow-up over: the account itself is the thing being recorded, and
    // the audit row below says whether the attendance write was even attempted.
    let attendanceRecorded: boolean | null = null;
    if (input.attended !== undefined) {
      attendanceRecorded = await setConfirmedAttendance(
        user.wardId,
        event.id,
        user.id,
        input.attended,
        supabase,
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_followup_logged",
        module: "youth_activities",
        detail: {
          activityLogId: log.id,
          eventId: event.id,
          profileId: event.profileId,
          orgId: profile?.orgId ?? null,
          // The KEYS that changed, never their values. `sharedNotes` in this list records that
          // notes were written; the notes themselves belong in the row, not in the log.
          // writeAuditLog runs redactSensitive() over `detail`, but relying on a denylist to catch
          // a field nobody added to it is not the rule — the rule is never to pass the text
          // (plans/retros/program-e, ITER-017).
          changed: Object.keys(input),
          attended: input.attended ?? null,
          attendanceRecorded,
        },
      },
      supabase,
    );

    // A WARD-WIDE ACTIVITY HAS NO ORG LEADERSHIP TO NOTIFY, and the emit is skipped rather than
    // called with a null orgId — notifyOrgLeadership resolves recipients by `org_id`, so a null
    // would match every user whose organization was never set and send them somebody else's news.
    // Widening an audience quietly is the wrong way to take a product decision
    // (lib/notifications/notifyWardCouncilFlag.ts makes the same refusal in the other direction).
    //
    // THE DESCRIPTION CARRIES THE ACTIVITY AND THE EVENT AND NO NOTE TEXT. The recipients here CAN
    // read the follow-up — they are the owning organization's presidency — but a notification body
    // is still the wrong place for it: it renders in a bell menu with no permission check of its
    // own, and Phase 11 may put it in a digest email.
    if (profile?.orgId != null) {
      await notifyOrgLeadership({
        wardId: user.wardId,
        orgId: profile.orgId,
        actingUserId: user.id,
        triggerKey: "youth_followup_submitted",
        title: "A youth activity follow-up was recorded",
        description: `${profile.activityName} — ${event.title}`,
      });
    }

    return NextResponse.json({ log }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/youth/logs",
      fallbackMessage: "Could not save that follow-up. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
