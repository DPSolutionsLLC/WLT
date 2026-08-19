import { FAST_SUNDAY_DISPLACING_TYPES, type SundayType } from "@/types/domain";
import type { DateOnly } from "@/lib/calendar/dates";

// Fast Sunday is a RESOLUTION RULE, not a generation-time constant.
//
// It is not "whatever was written when the month was generated". It re-runs whenever any Sunday
// in the month changes type, and it runs in BOTH directions: adding a stake conference to the
// first Sunday moves Fast Sunday forward to the second, and clearing that conference moves it
// back to the first. The backwards direction is the one 03-calendar.md warns is easiest to
// forget, and the one tests/lib/fastSunday.test.ts spends the most assertions on.
//
// Pure and id-only: it decides WHICH Sunday, and lib/calendar/queries.ts applies it through
// apply_fast_sunday() so the clear and the set land in one transaction.

export type FastSundayCandidate = {
  // Opaque to this function — it is returned, never parsed. generateSundays() calls this before
  // any row exists and passes the date string as the id, which is correct rather than a bug: the
  // caller only needs to identify a candidate it already holds.
  id: string;
  date: DateOnly;
  type: SundayType;
  fastSundayPinned: boolean;
};

export function resolveFastSunday(monthSundays: FastSundayCandidate[]): string | null {
  // A copy. Sorting the argument in place would reorder a caller's array underneath it, and
  // generateSundays() relies on its own ordering after this returns.
  const byDate = [...monthSundays].sort((left, right) => left.date.localeCompare(right.date));

  // A pin outranks the rule until a human clears it. More than one pin in a month is prevented
  // by the data layer; if a stale one survives anyway, the earliest wins and nothing throws — a
  // bad pin must not take a calendar page down with it.
  const pinned = byDate.find((candidate) => candidate.fastSundayPinned);
  if (pinned) return pinned.id;

  // A candidate already typed `fast_sunday` is not displacing, so it stays chosen. That is what
  // makes re-resolution idempotent: running this over an already-resolved month returns the same
  // id rather than walking Fast Sunday forward one week per run.
  const winner = byDate.find(
    (candidate) => !FAST_SUNDAY_DISPLACING_TYPES.includes(candidate.type),
  );

  // Every Sunday in the month is displaced. A month with no Fast Sunday is a real state — a
  // stake conference weekend followed by general conference — not an error.
  return winner?.id ?? null;
}
