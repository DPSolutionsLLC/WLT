import type { AppointmentStatus, AppointmentViewState } from "@/types/domain";

// "Missed" is computed, never stored.
//
// `visit_appointments.status` holds only what a HUMAN did: scheduled, kept, cancelled. A missed
// appointment is `scheduled` with a time in the past — it becomes missed because the clock moved,
// not because anybody wrote a row. A stored `missed` would go stale the moment nobody refreshed
// it, and this project has no pg_cron and no triggers to do that. Same reasoning as
// lib/goals/goalStatus.ts, and the same shape.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN FILE
// ---------------------------------------------------------------------------
// It sits apart from lib/visits/appointments.ts for exactly the reason goalStatus.ts sits apart
// from lib/goals/queries.ts: AppointmentPanel is a client component and renders this, and one
// import of the queries module would pull next/headers into a client bundle. The plan for this
// slice said to keep it beside the queries "only if it stays free of the server client"; it
// cannot, so it is split, and this paragraph is the "say so".
//
// `asOf` is a PARAMETER, never `new Date()` inside. That is what makes the boundary testable in
// both directions — a test cannot pin a clock it does not pass in.

export type AppointmentViewStateInput = {
  status: AppointmentStatus;
  scheduledFor: string;
};

// A `kept` or `cancelled` appointment in the past is NOT missed. Somebody answered the question
// already, and time does not un-answer it.
export function appointmentViewState(
  appointment: AppointmentViewStateInput,
  asOf: Date,
): AppointmentViewState {
  if (appointment.status !== "scheduled") return appointment.status;

  return Date.parse(appointment.scheduledFor) < asOf.getTime() ? "missed" : "scheduled";
}
