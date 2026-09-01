import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  BISHOPRIC_ROLES,
  assertCan,
  resolveRoleAccess,
} from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assignAttendeeSchema } from "@/lib/validation/youth";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import { addAttendee, removeAttendee } from "@/lib/youth/attendees";
import { getActivityEvent, getActivityProfile } from "@/lib/youth/queries";

// Asking somebody else to go, and withdrawing the ask.
//
// ---------------------------------------------------------------------------
// BISHOPRIC ONLY
// ---------------------------------------------------------------------------
// 08-youth-activities.md §Step 4, and a decision taken with the user before planning. Putting
// YOURSELF down needs only `youth_activities.view` and lives in the sibling attend/ route;
// putting SOMEBODY ELSE down is an ask, and an ask is the bishopric's to make.
//
// TWO CHECKS, IN THIS ORDER, AND BOTH ARE LOAD-BEARING:
//   assertCan(…manage)   so a ward whose role_access override REMOVED the module refuses before
//                        the role check has a chance to allow it.
//   BISHOPRIC_ROLES      because `manage` is also held by org presidents and ward council
//                        members, and the permission alone would not express "the bishopric".
//
// Bishop and counselor are identical here, as everywhere (CLAUDE.md §7): the check reads the
// shared BISHOPRIC_ROLES list rather than naming a role, so it is not possible to build one that
// grants the bishop something a counselor lacks.
//
// ---------------------------------------------------------------------------
// `youth_event_uncovered` IS NOT EMITTED HERE OR ANYWHERE
// ---------------------------------------------------------------------------
// It is one of the things that fires from nothing, and it belongs to Phase 11's single decision
// about a mechanism, alongside `visit_overdue`, `refresh_goal_status()`, the Monday away-digest
// and ICS re-sync. That is FIVE, CLAUDE.md counts them, and inventing a trigger here would make a
// sixth in the place least likely to be found again.

const eventIdSchema = z.uuid("That event id is not valid.");
const userIdSchema = z.uuid("That person is not valid.");

const EVENT_NOT_FOUND = "That event is not in your ward.";

const NOT_BISHOPRIC =
  "Asking somebody else to attend is a bishopric decision. You can add yourself to any event.";

const USER_NOT_FOUND = "That person is not an active account in your ward.";

const ALREADY_ASSIGNED = "They are already down for this one.";

const REMOVE_REFUSED =
  "They are not down for that event, or it could not be changed. Reload and try again.";

const ASSIGN_TRIGGER_KEY = "youth_support_assigned";

function isBishopric(role: string): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

// The ward's zone, not the reader's: this string is stored in a notification row that a different
// person opens later, so there is no reader in scope to format for. The school and the ward are
// in the same place, which is what makes the ward's zone the right answer here — the same
// reasoning the import preview's header records.
function formatWhen(instant: string, timeZone: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "a time this app could not read";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    if (!isBishopric(user.role)) {
      return NextResponse.json({ error: NOT_BISHOPRIC }, { status: 403 });
    }

    const { id } = await params;
    const eventId = eventIdSchema.parse(id);
    const input = assignAttendeeSchema.parse(await readJsonBody(request));

    const event = await getActivityEvent(user.wardId, eventId, supabase);

    if (!event) {
      return NextResponse.json({ error: EVENT_NOT_FOUND }, { status: 404 });
    }

    // Resolved through the CALLER'S OWN CLIENT, so a user in another ward simply is not there —
    // migration 020's ward-scoped `users` select policy is what makes that true, rather than a
    // filter here. Checked before the insert for the reason the event is: a composite foreign key
    // violation is not a sentence anybody can act on.
    const { data: assignee, error: assigneeError } = await supabase
      .from("users")
      .select("id, first_name, last_name")
      .eq("ward_id", user.wardId)
      .eq("id", input.userId)
      .eq("is_active", true)
      .maybeSingle();

    if (assigneeError) {
      throw new Error(`Could not read that account: ${assigneeError.message}`);
    }

    if (!assignee) {
      return NextResponse.json({ error: USER_NOT_FOUND }, { status: 404 });
    }

    const attendee = await addAttendee(
      user.wardId,
      // `assignedBy: user.id` is what makes the card read "asked by …" rather than reading as a
      // volunteer. No policy compares against this column (migration 056c); it is a record.
      { eventId, userId: input.userId, assignedBy: user.id },
      supabase,
    );

    if (attendee === null) {
      return NextResponse.json({ notice: ALREADY_ASSIGNED }, { status: 200 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_assigned",
        module: "youth_activities",
        detail: {
          eventId,
          profileId: event.profileId,
          assignedUserId: input.userId,
          eventDate: event.eventDate,
        },
      },
      supabase,
    );

    // The profile is read for the NOTIFICATION TEXT alone, and after the write rather than
    // before: a failure to name the activity must not stop the assignment being recorded.
    const profile =
      event.profileId === null
        ? null
        : await getActivityProfile(user.wardId, event.profileId, supabase);

    const timeZone = await readWardTimezone(user.wardId, supabase);

    // "Assigned" WITH NO SUBJECT IS A NOTIFICATION THAT COSTS A TAP TO UNDERSTAND, so the body
    // names the youth, the activity, the event and when.
    const subject =
      profile === null
        ? event.title
        : `${event.title} — ${profile.activityName}`;

    // EXPLICIT RECIPIENTS, not the trigger's default_roles. The seeded default for
    // `youth_support_assigned` reaches every org president, counselor and secretary in the ward
    // (supabase/seed/notification_triggers.sql), and this concerns exactly one person.
    // notifyOrgLeadership's header records the same reasoning for a neighbouring case.
    await emitNotification({
      wardId: user.wardId,
      triggerKey: ASSIGN_TRIGGER_KEY,
      title: "You have been asked to attend a youth activity",
      body: `${subject}, ${formatWhen(event.eventDate, timeZone)}${
        event.location === null ? "" : ` at ${event.location}`
      }.`,
      recipientUserIds: [input.userId],
    });

    return NextResponse.json({ attendee }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/youth/events/[id]/assign",
      fallbackMessage: "Could not ask that person to attend. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// WITHDRAWING AN ASK, and it takes `?userId=` rather than a body because a DELETE with a body is
// awkward for every client that sends one. It is bishopric-only for the same reason the POST is:
// a person removes themselves through the attend/ route, and nobody else removes them.
//
// NO NOTIFICATION. Being un-asked is not news the way being asked is, and one per withdrawal
// would make the ones that matter easier to ignore.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    if (!isBishopric(user.role)) {
      return NextResponse.json({ error: NOT_BISHOPRIC }, { status: 403 });
    }

    const { id } = await params;
    const eventId = eventIdSchema.parse(id);

    const url = new URL(request.url);
    const assignedUserId = userIdSchema.parse(url.searchParams.get("userId") ?? undefined);

    const event = await getActivityEvent(user.wardId, eventId, supabase);

    if (!event) {
      return NextResponse.json({ error: EVENT_NOT_FOUND }, { status: 404 });
    }

    const removed = await removeAttendee(user.wardId, eventId, assignedUserId, supabase);

    if (!removed) {
      return NextResponse.json({ error: REMOVE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_unassigned",
        module: "youth_activities",
        detail: {
          eventId,
          profileId: event.profileId,
          assignedUserId,
          eventDate: event.eventDate,
        },
      },
      supabase,
    );

    return NextResponse.json({ removed: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/youth/events/[id]/assign",
      fallbackMessage: "Could not withdraw that request. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
