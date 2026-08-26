import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getAppointment,
  updateAppointment,
  type AppointmentPatch,
} from "@/lib/visits/appointments";
import { getVisitLog } from "@/lib/visits/queries";
import { updateAppointmentSchema } from "@/lib/validation/visit";

// Keeping, cancelling and rescheduling an appointment.
//
// THREE ACTIONS, THREE AUDIT ROWS. A discriminated union on `action` rather than a patch of
// optional fields, following updateGoalSchema: these are three different events a ward would
// want to tell apart afterwards, and "cancelled" must not be reachable as a side effect of
// rescheduling.
//
// `params` is a Promise in Next 16.

const WRITE_REFUSED = "That appointment could not be saved. Reload and try again.";

// 404, NEVER 403, for an appointment outside the caller's scope — the same reasoning the
// private-note route uses. A 403 confirms the row exists; another organization's appointment
// with a named household is not a fact this app confirms to somebody who cannot read it.
const NOT_IN_SCOPE = "That appointment is not in your ward.";

const appointmentIdSchema = z.uuid("That appointment id is not valid.");

const AUDIT_ACTIONS = {
  keep: "appointment_kept",
  cancel: "appointment_cancelled",
  reschedule: "appointment_rescheduled",
} as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.create", roleAccess);

    const { id } = await params;
    const appointmentId = appointmentIdSchema.parse(id);
    const input = updateAppointmentSchema.parse(await readJsonBody(request));

    const existing = await getAppointment(user.wardId, appointmentId, supabase);

    if (!existing) {
      return NextResponse.json({ error: NOT_IN_SCOPE }, { status: 404 });
    }

    let patch: AppointmentPatch;

    if (input.action === "keep") {
      // The visit has to be one this caller can actually see, and it has to be for the same
      // household. An appointment with the Andersens is not evidence of a visit to the Bryants,
      // and linking them would put a visit under a household it was never made to.
      const visit = await getVisitLog(user.wardId, input.visitLogId, supabase);

      if (!visit) {
        return NextResponse.json({ error: "That visit is not in your ward." }, { status: 404 });
      }

      if (visit.householdId !== existing.householdId) {
        return NextResponse.json(
          { error: "That visit was to a different household." },
          { status: 400 },
        );
      }

      patch = { status: "kept", visitLogId: visit.id };
    } else if (input.action === "cancel") {
      // CANCELLING DOES NOT DELETE THE ROW. That an appointment was made and then called off is
      // part of the record of how a ward has tried to reach a household; deleting it would leave
      // the household looking simply unvisited.
      patch = { status: "cancelled" };
    } else {
      // Rescheduling leaves the status alone. A rescheduled appointment is still scheduled — and
      // if the new time is already past, it reads as missed, computed rather than stored.
      patch = { scheduledFor: input.scheduledFor };
    }

    const appointment = await updateAppointment(user.wardId, appointmentId, patch, supabase);

    // Null is a zero-row UPDATE, which is what an RLS refusal looks like — not an error
    // (plans/retros/foundation-c-services.md). Cross-org visibility widens READS only, so a
    // leader who could see this appointment a moment ago may still be refused the write.
    if (!appointment) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: AUDIT_ACTIONS[input.action],
        module: "visits",
        detail: {
          appointmentId,
          orgId: appointment.orgId,
          householdId: appointment.householdId,
          scheduledFor: appointment.scheduledFor,
          visitLogId: appointment.visitLogId,
        },
      },
      supabase,
    );

    return NextResponse.json({ appointment });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/visit-appointments/[id]",
      fallbackMessage: "Could not save that appointment. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
