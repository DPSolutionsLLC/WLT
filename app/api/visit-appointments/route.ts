import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getHousehold } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAppointment, listAppointments } from "@/lib/visits/appointments";
import {
  createAppointmentSchema,
  listAppointmentsQuerySchema,
} from "@/lib/validation/visit";
import type { Role } from "@/types/domain";

// Appointments — visits ARRANGED, before they happen.
//
// NO NEW PERMISSION. Booking an appointment and logging a visit are the same authority:
// `visits.create` to write, `visits.view` to read. Adding a permission for this would have made
// the ward configure an answer to a question nobody asked.
//
// THIS FILE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT — see the header of
// app/api/visits/route.ts.
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
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

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
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

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

    const appointment = await createAppointment(
      user.wardId,
      bishopricAuthor ? null : user.orgId,
      user.id,
      input,
      supabase,
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
        },
      },
      supabase,
    );

    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/visit-appointments",
      fallbackMessage: "Could not save that appointment. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
