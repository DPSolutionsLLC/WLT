import { addMonths, formatDateOnly, type DateOnly } from "@/lib/calendar/dates";
import type { AssignmentHistoryOutcome } from "@/types/domain";

// The four pattern flags of 04-talks-pipeline.md §Step 8, as a pure function over one member's
// speaker history.
//
// CLIENT-IMPORTABLE, and deliberately so. lib/assignments/queries.ts imports
// createServerSupabaseClient, which imports next/headers, and a client component that touches it
// fails `npm run build` while passing both lint and typecheck
// (plans/retros/roster-b-picker-and-orgs.md). MemberPicker renders these flags, so the rule that
// computes them cannot live next to the query that feeds them.
//
// `asOf` is a PARAMETER, never a `new Date()` inside. A function that reads the clock cannot be
// tested at a boundary, and every one of these four flags IS a boundary.
//
// These are informational. Nothing here blocks an assignment, nothing here leaves the bishopric
// view, and every label in components/roster/ReliabilityFlag.tsx is worded for a bishop reading
// it aloud. This is pastoral data about real people.

export const RELIABILITY_FLAG_KINDS = [
  "frequent_decliner",
  "late_canceller",
  "not_asked_recently",
  "not_spoken_recently",
] as const;

export type ReliabilityFlagKind = (typeof RELIABILITY_FLAG_KINDS)[number];

// `outcome` and `sundayDate` are both nullable, which the phase plan's signature did not
// anticipate. Migration 005 declares `outcome` with a CHECK and no NOT NULL, and
// `assignment_id` is `on delete set null` — so a history row can legitimately name no outcome
// and can outlive the assignment that gave it a date. Typing them non-null would mean inventing
// a value at the mapping layer to satisfy the type, which is how a flag gets computed from a
// date nobody recorded.
export type SpeakerHistoryEntry = {
  outcome: AssignmentHistoryOutcome | null;
  cancellationDaysNotice: number | null;
  sundayDate: DateOnly | null;
};

// Named rather than inlined so the rule and the test cannot drift apart. Each is the phase
// plan's number, unchanged.
export const FREQUENT_DECLINE_COUNT = 2;
export const LATE_CANCELLATION_DAYS = 7;
export const NOT_ASKED_MONTHS = 18;
export const NOT_SPOKEN_MONTHS = 24;

// The most recent date in a set of history entries, or null when none of them carries one.
// String comparison, because a YYYY-MM-DD string sorts identically to the date it names — no
// Date is constructed, which is the defence lib/calendar/dates.ts exists to provide.
function mostRecentDate(entries: readonly SpeakerHistoryEntry[]): DateOnly | null {
  return entries.reduce<DateOnly | null>((latest, entry) => {
    if (entry.sundayDate === null) return latest;
    return latest === null || entry.sundayDate > latest ? entry.sundayDate : latest;
  }, null);
}

// "N or more months have passed" expressed through addMonths() rather than a month subtraction of
// its own. addMonths clamps rather than rolling over, so this is exact on the day: 18 months after
// 2025-01-05 is 2026-07-05, and 2026-07-04 is not yet 18 months.
function monthsHavePassed(since: DateOnly, months: number, today: DateOnly): boolean {
  return addMonths(since, months) <= today;
}

export function reliabilityFlags(
  history: readonly SpeakerHistoryEntry[],
  asOf: Date,
): readonly ReliabilityFlagKind[] {
  // No history is NOT four flags. A member nobody has ever asked is a member with no history,
  // and reading "not asked in over a year" off an empty table invents a pattern from an absence.
  if (history.length === 0) return [];

  const today = formatDateOnly(asOf);
  const flags: ReliabilityFlagKind[] = [];

  const declines = history.filter((entry) => entry.outcome === "declined").length;

  if (declines >= FREQUENT_DECLINE_COUNT) {
    flags.push("frequent_decliner");
  }

  // `<=` on the notice: a cancellation with exactly seven days' notice is the boundary case the
  // flag names, and one with eight days is not. A cancellation that recorded no notice at all
  // does not fire it — an unrecorded number is not a short one.
  const cancelledLate = history.some(
    (entry) =>
      entry.outcome === "cancelled" &&
      entry.cancellationDaysNotice !== null &&
      entry.cancellationDaysNotice <= LATE_CANCELLATION_DAYS,
  );

  if (cancelledLate) {
    flags.push("late_canceller");
  }

  const lastAsked = mostRecentDate(history);

  if (lastAsked !== null && monthsHavePassed(lastAsked, NOT_ASKED_MONTHS, today)) {
    flags.push("not_asked_recently");
  }

  // Measured from the last COMPLETED talk, and it needs there to have been one. A member who has
  // been asked twice and declined twice has not "not spoken in two years" — they have declined
  // twice, which is a different flag saying a truer thing.
  const lastSpoke = mostRecentDate(
    history.filter((entry) => entry.outcome === "completed"),
  );

  if (lastSpoke !== null && monthsHavePassed(lastSpoke, NOT_SPOKEN_MONTHS, today)) {
    flags.push("not_spoken_recently");
  }

  return flags;
}
