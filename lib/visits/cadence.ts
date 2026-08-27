import { addDaysUtc, addMonths, type DateOnly } from "@/lib/calendar/dates";
import { CADENCE_UNIT_LABELS, type CadenceUnit } from "@/types/domain";

// What "every 3 weeks" means, and the only place that decides.
//
// CLIENT-IMPORTABLE, for the same reason lib/visits/householdStatus.ts is: VisitProgressTable
// renders and sorts by what this produces, and ONE import of a server-only module would pull
// next/headers into the client bundle and break the table
// (plans/retros/roster-b-picker-and-orgs.md). This file imports lib/calendar/dates.ts and
// types/domain.ts, and nothing else — keep it that way.
//
// The parameter names avoid visit vocabulary where it costs nothing. Phase 8's youth-activity
// coverage has the same due/overdue-against-an-interval shape and should import this rather
// than write a second meaning of "overdue" (plans/visits-b-progress-dashboard.md §Integration).

// An amount and a unit, together. Never two loose columns passed side by side: half a cadence —
// an amount with no unit — is unrepresentable in this type, and migration 050's
// `visit_goals_cadence_complete` CHECK enforces the same thing in the database.
export type Cadence = { amount: number; unit: CadenceUnit };

// A fixed date to project both cadences forward from in compareCadences().
//
// IT EXISTS SO THE COMPARISON TAKES NO CLOCK READING. `new Date()` here would make validation
// non-deterministic — "is 2 months longer than 60 days?" genuinely answers differently in
// February than in July, so a goal a ward saved in one month would be refused in another.
//
// THE PARTICULAR DATE IS NOT ARBITRARY, and 2000-01-01 is specifically WRONG for it: January
// plus a leap February is 31 + 29 = exactly 60 days, so "every 2 months" and "every 60 days"
// would compare EQUAL there and a 2-month warning window on a 60-day cadence would be accepted.
//
// 2000-07-01 opens the year's longest run of 31-day months (July, August), so an interval
// expressed in MONTHS is measured at its most generous. That is the conservative direction for
// the one question this function is asked — "is the warning window shorter than the cadence?" —
// because a borderline pair is refused rather than accepted, and a refused goal is a message
// somebody can act on where an accepted one is a dashboard that has quietly stopped saying
// anything.
//
// It is not conservative in EVERY direction: a months-expressed cadence is also measured
// generously, so a 61-day warning against a 2-month cadence passes here and would swallow the
// interval in February. That residual case is what the clamp in lib/visits/householdStatus.ts
// catches at render time, against the household's real dates.
export const CADENCE_COMPARISON_ANCHOR: DateOnly = "2000-07-01";

// A `year` is TWELVE MONTHS, not 365 days, so "every year" from 29 February behaves the way
// addMonths() already decided a month-clamping calendar should: 2024-02-29 + 1 year is
// 2025-02-28, not 2025-03-01.
export function addCadence(from: DateOnly, cadence: Cadence): DateOnly {
  switch (cadence.unit) {
    case "day":
      return addDaysUtc(from, cadence.amount);
    case "week":
      return addDaysUtc(from, cadence.amount * 7);
    case "month":
      return addMonths(from, cadence.amount);
    case "year":
      return addMonths(from, cadence.amount * 12);
  }
}

// addCadence with the amount negated. Both underlying helpers accept negatives, so there is no
// second implementation here to drift from the one above.
//
// NOT an exact inverse of addCadence at every date, and it cannot be: addMonths() clamps, so
// 2026-01-31 + 1 month is 2026-02-28 and 2026-02-28 - 1 month is 2026-01-28. The clamp is the
// behaviour lib/calendar/dates.ts chose on purpose, and tests/lib/visitCadence.test.ts asserts
// the asymmetric cases explicitly rather than leaving them assumed.
export function subtractCadence(from: DateOnly, cadence: Cadence): DateOnly {
  return addCadence(from, { amount: -cadence.amount, unit: cadence.unit });
}

// Negative when `left` is the shorter interval, 0 when they are the same length, positive when
// `left` is longer.
//
// Both are projected forward from the SAME anchor and the resulting YYYY-MM-DD strings are
// compared, which is exact: it never converts a month to an approximate number of days, so
// "2 months" and "60 days" come out different — which they are — and "1 year" and "12 months"
// come out equal — which they are.
export function compareCadences(left: Cadence, right: Cadence): number {
  const leftEnd = addCadence(CADENCE_COMPARISON_ANCHOR, left);
  const rightEnd = addCadence(CADENCE_COMPARISON_ANCHOR, right);

  return leftEnd < rightEnd ? -1 : leftEnd > rightEnd ? 1 : 0;
}

// "Every year", "Every 3 weeks", "Every 2 years", "Every day".
//
// Uniform, with no special cases: an amount of 1 drops the number and reads the singular label,
// and nothing else changes. A phrase assembled per unit is a phrase that eventually disagrees
// with itself.
export function describeCadence(cadence: Cadence): string {
  const labels = CADENCE_UNIT_LABELS[cadence.unit];

  return cadence.amount === 1
    ? `Every ${labels.one}`
    : `Every ${cadence.amount} ${labels.many}`;
}

// "3 weeks", "a month", "6 months" — the DURATION on its own, with no "Every" in front.
//
// HOW LONG IS NOT HOW OFTEN, AND THE TWO PHRASES ARE NOT INTERCHANGEABLE. describeCadence()
// answers "how often", and its output survives having "Every " stripped only while the amount is
// above one: "Every 6 months" becomes "6 months", but "Every month" becomes a bare "month".
//
// That is exactly the defect walked in scenario 047 — the visit banner assembled its warning
// window that way and rendered "Warning month ahead.", missing the number, for every goal with a
// one-unit notice window. A goal with a two-month window read correctly, which is why it went
// unnoticed from ITER-018 until a fixture happened to use 1.
//
// An amount of one takes the ARTICLE rather than the digit, because "Warning a month ahead" is
// what somebody would say and "Warning 1 month ahead" is what a form would say.
export function describeDuration(cadence: Cadence): string {
  const labels = CADENCE_UNIT_LABELS[cadence.unit];

  return cadence.amount === 1
    ? `a ${labels.one}`
    : `${cadence.amount} ${labels.many}`;
}
