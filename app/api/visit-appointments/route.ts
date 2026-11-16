import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { getHousehold } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  createAppointment,
  deleteNewAppointment,
  listAppointments,
} from "@/lib/visits/appointments";
import { getAssignment } from "@/lib/visits/assignments";
import { VISIT_INVITE_TITLE, visitInviteBody } from "@/lib/visits/companionText";
import { assertCompanionsAllowed, inviteCompanions } from "@/lib/visits/companions";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import {
  createAppointmentSchema,
  listAppointmentsQuerySchema,
} from "@/lib/validation/visit";
import type { Role, VisitCompanion } from "@/types/domain";

// Appointments — visits ARRANGED, before they happen.
//
// NO NEW PERMISSION. Booking an appointment and logging a visit are the same authority:
// `visits.create` to write, `visits.view` to read. Adding a permission for this would have made
// the ward configure an answer to a question nobody asked.
//
// THIS FILE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT — see the header of
// app/api/visits/route.ts.
//
// COMPANIONS (ITER-055 bv6). A leader is INVITED and a roster member or a typed name is RECORDED
// (lib/visits/companions.ts). The appointment is inserted through the caller's own client, then its
// companions in ONE insert on the service role; if that fails the appointment is deleted again and
// the response says so, so nobody is left holding half an invite (visits-d's pitfall). Each invited
// leader gets a `visit_companion_invited` bell notification. The audit row carries COUNTS, never
// names — a companion's name is a person's movements.
//
// FROM A VISIT TO-DO (P11). `assignmentId` books the visit for a bishopric assignment, so it appears
// once on My Appointments rather than as a scheduled to-do as well. Only a bishopric author, and only
// for an open assignment of the same household.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "visits.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;

    // Read here EXACTLY as the client sends it. A name this handler does not read gets no
    // error, just a silently ignored filter (plans/retros/roster-b-picker-and-orgs.md).
    const filter = listAppointmentsQuerySchema.parse({
      householdId: searchParams.get("householdId") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      status: searchParams.get("status") ?? undefined,
    });

    // The clock enters HERE and is passed down, so `missed` is a statement about one moment
    // rather than a fresh `new Date()` inside a loop. Every row in one response is judged
    // against the same instant.
    const appointments = await listAppointments(user.wardId, filter, new Date(), supabase);

    return NextResponse.json({ appointments });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/visit-appointments",
      fallbackMessage: "Could not load the appointments. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    // An org secretary holds `visits.create` and therefore books appointments. Checked against
    // lib/auth/permissions.ts rather than assumed; the matrix is not always the intuitive answer.
    assertCan(user, "visits.create", roleAccess);

    const input = createAppointmentSchema.parse(await readJsonBody(request));

    // `household_id` carries a composite foreign key to (id, ward_id), so a household from
    // another ward would be refused by the database with a constraint violation — a 500
    // reporting the server's own fault for the caller's bad id. Checked here so the answer is a
    // sentence instead.
    const household = await getHousehold(user.wardId, input.householdId, supabase);

    if (!household) {
      return NextResponse.json({ error: "That household is not in your ward." }, { status: 404 });
    }

    // `org_id` and `made_by` are stamped from the SESSION, never from the body — exactly as
    // POST /api/visits does it. A request that could name its own organization could put an
    // appointment on another organization's board.
    const bishopricAuthor = isBishopric(user.role);

    if (!bishopricAuthor && user.orgId === null) {
      return NextResponse.json(
        {
          error:
            "Your account is not attached to an organization, so an appointment booked under " +
            "it would be invisible to everyone. Ask a member of the bishopric to set your " +
            "organization.",
        },
        { status: 409 },
      );
    }

    if (input.assignmentId !== undefined) {
      if (!bishopricAuthor) {
        return NextResponse.json(
          { error: "Only the bishopric books a visit for a household it has assigned." },
          { status: 403 },
        );
      }

      const assignment = await getAssignment(user.wardId, input.assignmentId, supabase);

      if (assignment === null) {
        return NextResponse.json({ error: "That assignment is not in your ward." }, { status: 404 });
      }

      if (assignment.endedAt !== null || assignment.householdId !== input.householdId) {
        return NextResponse.json(
          {
            error:
              "That household is no longer assigned this way. Reload the page and schedule it " +
              "from the household instead.",
          },
          { status: 409 },
        );
      }
    }

    const service = createServiceSupabaseClient();

    await assertCompanionsAllowed(
      { wardId: user.wardId, bookerUserId: user.id, companions: input.companions },
      supabase,
      service,
    );

    const appointment = await createAppointment(
      user.wardId,
      bishopricAuthor ? null : user.orgId,
      user.id,
      input,
      supabase,
    );

    let companions: VisitCompanion[];
    try {
      companions = await inviteCompanions(
        { wardId: user.wardId, appointmentId: appointment.id, companions: input.companions },
        service,
      );
    } catch (companionError) {
      try {
        await deleteNewAppointment(user.wardId, appointment.id, supabase);
      } catch (undoError) {
        console.error("A visit appointment was saved without its companions and not undone", {
          wardId: user.wardId,
          appointmentId: appointment.id,
          companionError,
          undoError,
        });
        return NextResponse.json(
          {
            error:
              "The appointment was booked, but who is going along was not saved. Open " +
              "Appointments, cancel it, and book it again.",
          },
          { status: 500 },
        );
      }
      throw companionError;
    }

    const invitedUserIds = companions.flatMap((companion) =>
      companion.userId === null ? [] : [companion.userId],
    );

    // No `notes` text in the detail. The note on an appointment is ordinary shared text rather
    // than a private note, but an audit row is not where it belongs either — the rule is to pass
    // ids and short descriptions, not content.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "appointment_booked",
        module: "visits",
        detail: {
          appointmentId: appointment.id,
          orgId: appointment.orgId,
          householdId: appointment.householdId,
          scheduledFor: appointment.scheduledFor,
          assignmentId: appointment.assignmentId,
          invitedCount: invitedUserIds.length,
          recordedCompanionCount: companions.length - invitedUserIds.length,
        },
      },
      supabase,
    );

    if (invitedUserIds.length > 0) {
      const wardZone = await readWardTimezone(user.wardId, supabase);
      await emitNotification({
        wardId: user.wardId,
        triggerKey: "visit_companion_invited",
        title: VISIT_INVITE_TITLE,
        body: visitInviteBody({
          bookerName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || null,
          familyName: household.familyName,
          scheduledFor: appointment.scheduledFor,
          wardZone,
        }),
        recipientUserIds: invitedUserIds,
      });
    }

    return NextResponse.json({ appointment, companions }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/visit-appointments",
      fallbackMessage: "Could not save that appointment. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
