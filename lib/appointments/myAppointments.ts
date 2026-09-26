import { wardDateOnly } from "@/lib/ward/wardDate";
import type { AppointmentViewState, TodoAskSource } from "@/types/domain";

// My Appointments — everything a leader has said they will be at, in ONE list (P5 slice c).
//
// ---------------------------------------------------------------------------
// ONE COMPUTATION, AND THE NEXT SOURCE JOINS IT RATHER THAN FORKING IT
// ---------------------------------------------------------------------------
// P6 adds role-addressed meeting invites as a fourth kind — `{ kind: "meeting_invite" }` — here,
// and P6's soft conflict check must call THIS function rather than assembling its own list. The
// prototype forked the aggregation once and had to fold it back (P5 stub, "One computation, not
// two"); two lists of the same commitments are two answers to "am I free at 7pm Thursday".
//
// Every source belongs to a PERSON, never a role (the plan's first trap) — the reads in
// lib/appointments/queries.ts filter each to the caller.
//
// ---------------------------------------------------------------------------
// NOTHING IS DROPPED
// ---------------------------------------------------------------------------
// A past item moves to `past`; it is never filtered out. The input's length is always
// upcoming + past. What was cancelled is excluded by the READS, because a cancelled commitment is
// not one — that is a fact somebody stated, not something the clock decided.
//
// ---------------------------------------------------------------------------
// NOTHING IS PAST UNTIL ITS WARD DAY HAS ENDED
// ---------------------------------------------------------------------------
// The user's rule, walking scenario 077: an item stays with today's list until the whole day is
// over, and once its time has passed it is only GREYED (`hasStarted`). It moves to the past the
// next morning. So "past" compares the WARD's date of the start with the WARD's date of `asOf` —
// never a UTC date, which after 6pm Mountain is already tomorrow. An all-day event (stored at ward
// midnight, migration 055) follows the same rule and is never greyed on its own day.
//
// ---------------------------------------------------------------------------
// GROUPED BY THE WARD'S DAY
// ---------------------------------------------------------------------------
// groupByWardDay() splits an already-ordered list into days, keeping the order it was given, so
// the upcoming list reads soonest-first and the past most-recent-first with one function.
//
// Pure: `asOf` and the zone are parameters, and there are no server imports.

type AppointmentBase = {
  id: string;
  startsAt: string;
  title: string;
  // A second, quieter line — who it is with, or which activity. Null when there is nothing to say.
  detail: string | null;
  href: string;
};

export type MyAppointmentSource =
  | (AppointmentBase & { kind: "visit"; allDay: false; viewState: AppointmentViewState })
  // `ask` is set on a talk's ask (Sacrament slice f1): its topic and contact details, and whether
  // it still waits for an answer, which the row can record.
  | (AppointmentBase & { kind: "todo"; allDay: false; completed: boolean; ask: TodoAskSource | null })
  | (AppointmentBase & { kind: "youth"; allDay: boolean });

export type MyAppointmentKind = MyAppointmentSource["kind"];

export type MyAppointments = {
  upcoming: MyAppointmentSource[];
  past: MyAppointmentSource[];
};

export function appointmentWardDay(source: MyAppointmentSource, wardZone: string): string {
  return wardDateOnly(new Date(source.startsAt), wardZone);
}

export function isPastAppointment(
  source: MyAppointmentSource,
  asOf: Date,
  wardZone: string,
): boolean {
  return appointmentWardDay(source, wardZone) < wardDateOnly(asOf, wardZone);
}

// Still on today's list, but its time has gone by — rendered greyed. An all-day item never is.
export function hasStarted(source: MyAppointmentSource, asOf: Date): boolean {
  return !source.allDay && Date.parse(source.startsAt) <= asOf.getTime();
}

export type AppointmentDay = { day: string; items: MyAppointmentSource[] };

export function groupByWardDay(
  sources: readonly MyAppointmentSource[],
  wardZone: string,
): AppointmentDay[] {
  const days: AppointmentDay[] = [];

  for (const source of sources) {
    const day = appointmentWardDay(source, wardZone);
    const last = days[days.length - 1];
    if (last !== undefined && last.day === day) {
      last.items.push(source);
    } else {
      days.push({ day, items: [source] });
    }
  }

  return days;
}

function byStart(a: MyAppointmentSource, b: MyAppointmentSource): number {
  const difference = Date.parse(a.startsAt) - Date.parse(b.startsAt);
  if (difference !== 0) return difference;
  // A stable order for two things at the same minute, so the list does not reshuffle on refresh.
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildMyAppointments(
  sources: readonly MyAppointmentSource[],
  asOf: Date,
  wardZone: string,
): MyAppointments {
  const upcoming: MyAppointmentSource[] = [];
  const past: MyAppointmentSource[] = [];

  for (const source of sources) {
    (isPastAppointment(source, asOf, wardZone) ? past : upcoming).push(source);
  }

  upcoming.sort(byStart);
  // Most recent first: the past is read backwards from today.
  past.sort((a, b) => byStart(b, a));

  return { upcoming, past };
}
