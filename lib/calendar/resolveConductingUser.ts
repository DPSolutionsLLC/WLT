import {
  addDaysUtc,
  firstSundayOnOrAfter,
  lastDayOfMonth,
  monthOf,
  monthStart,
  type DateOnly,
} from "@/lib/calendar/dates";
import type { MeetingSundayEntry } from "@/lib/calendar/meetingSeries";
import {
  ROTATION_POSITIONS,
  type RotationCadence,
  type RotationPosition,
} from "@/types/domain";

// Who conducts a given Sunday, from a versioned rotation.
//
// The answer is computed ONCE and STORED on the Sunday row, never recomputed at read time.
// A computed-at-read value rewrites history the moment the rotation changes: last March's
// program would silently start naming whoever conducts today. 03-calendar.md Step 3 is explicit
// about this, and it is why sundays.conducting_user_id is a column at all. The same rule governs
// sunday_org_conducting, which stores an organization's conductor per Sunday for the same reason.
//
// A rotation advances at one of TWO cadences (migration 024, Part 1):
//   weekly   one step per Sunday — 03-calendar.md Step 3's rule, and still the default
//   monthly  one step per calendar month, so one person takes every Sunday in a month
// The cadence is read off the ACTIVE SET rather than passed in, so a caller cannot hand this
// function a cadence that disagrees with the rows it is resolving against.
//
// Signature deviation from 03-calendar.md, deliberate: the parameters are DateOnly strings rather
// than Date objects (lib/calendar/dates.ts explains why), and the return is nullable because a
// ward that has not configured a rotation must render a calendar rather than throw.

export type RotationEntry = {
  position: RotationPosition;
  userId: string | null;
  effectiveFrom: DateOnly;
  cadence: RotationCadence;
};

// The set of three rows in force on a date: the latest effective_from that is not in the future.
// A rotation change inserts a whole new set rather than updating the old one (migration 023),
// which is what makes "applies forward only" true by construction — and it is what makes a
// CADENCE change forward-only too, at no extra cost (migration 024, Part 1).
//
// YYYY-MM-DD strings compare lexicographically in the same order they compare chronologically,
// so a string comparison here is a date comparison — no parsing, and no local-time round trip.
export function activeRotation(
  entries: RotationEntry[],
  onDate: DateOnly,
): RotationEntry[] {
  const inForce = entries.filter((entry) => entry.effectiveFrom <= onDate);
  if (inForce.length === 0) return [];

  const latest = inForce.reduce(
    (newest, entry) => (entry.effectiveFrom > newest ? entry.effectiveFrom : newest),
    inForce[0].effectiveFrom,
  );

  return inForce
    .filter((entry) => entry.effectiveFrom === latest)
    .sort((left, right) => left.position - right.position);
}

// `anchorDate` is the active set's own effectiveFrom. Anchoring on the set rather than on a fixed
// epoch is what makes a rotation change restart cleanly at position 1 on the date it takes effect.
//
// Monthly anchors on the MONTH CONTAINING effectiveFrom, not on the next whole month: a rotation
// effective 2026-03-15 makes March position 1's month, governing 03-15, 03-22 and 03-29, and
// April position 2. Starting at the next whole month would leave a fortnight with no rule.
//
// `series` is the meeting history between the anchor and the target — REQUIRED, not optional and
// not defaulted. A caller that forgets it must be a type error, exactly as `roleAccess` is on
// can() (plans/retros/role-access-overrides.md): a defaulted parameter is precisely how 25 call
// sites came to silently ignore a ward's configuration, and this one decides who conducts.
//
// A Sunday that holds no sacrament meeting COSTS NOBODY A TURN. The person the old cycle would
// have spent on a general conference weekend conducts the next real meeting instead.
export function resolveConductingUser(
  sundayDate: DateOnly,
  rotation: RotationEntry[],
  anchorDate: DateOnly,
  series: MeetingSundayEntry[],
): string | null {
  const active = activeRotation(rotation, sundayDate);
  if (active.length === 0) return null;

  assertSeriesCovers(series, anchorDate, sundayDate);

  // The target itself holds no meeting, so nobody conducts it — and it is not merely that the
  // answer is unknown: there is no meeting to conduct. Checked before any counting so the two
  // cadences cannot disagree about it.
  const target = series.find((entry) => entry.date === sundayDate);
  if (target && !target.holdsMeeting) return null;

  // The three rows of one set always agree on cadence — lib/calendar/queries.ts writes them
  // together and nothing exposes a per-row cadence write (migration 024, Part 1).
  const isMonthly = active[0].cadence === "monthly";

  // Before the anchor. Tested directly rather than by a negative offset: the offsets below are
  // counts, which are never negative, so the old `offset < 0` guard became unreachable. The
  // reason it existed is unchanged — a negative modulo in JavaScript is negative, and indexing
  // backwards from the end would hand back position 3, a wrong answer wearing the shape of a
  // right one.
  const startsBeforeAnchor = isMonthly
    ? monthStart(sundayDate) < monthStart(anchorDate)
    : sundayDate < firstSundayOnOrAfter(anchorDate);
  if (startsBeforeAnchor) return null;

  const offset = isMonthly
    ? countMeetingMonths(series, anchorDate, sundayDate)
    : countMeetingSundays(series, anchorDate, sundayDate);

  const position = ROTATION_POSITIONS[offset % ROTATION_POSITIONS.length];

  // An unfilled position returns null rather than falling through to the next one. Skipping would
  // quietly give one counselor twice the turns and nobody would see why.
  return active.find((entry) => entry.position === position)?.userId ?? null;
}

// Weekly: how many meeting-holding Sundays fall between the anchor and the target. A cancelled
// Sunday is simply not counted, so it does not advance the cycle.
function countMeetingSundays(
  series: MeetingSundayEntry[],
  anchorDate: DateOnly,
  sundayDate: DateOnly,
): number {
  const first = firstSundayOnOrAfter(anchorDate);

  return series.filter(
    (entry) => entry.holdsMeeting && entry.date >= first && entry.date < sundayDate,
  ).length;
}

// Monthly: how many whole months between the anchor and the target contain AT LEAST ONE
// meeting-holding Sunday.
//
// A month spends a turn unless EVERY Sunday in it is cancelled. One cancelled Sunday inside a
// month changes nothing, because under a monthly cadence one person already holds the whole
// month — there is no turn to skip. The wholly-dead month is near-impossible in practice; it is
// defined anyway, because leaving it undefined by omission is how one list came to answer two
// questions in the first place.
function countMeetingMonths(
  series: MeetingSundayEntry[],
  anchorDate: DateOnly,
  sundayDate: DateOnly,
): number {
  const fromMonth = monthOf(anchorDate);
  const toMonth = monthOf(sundayDate);

  const live = new Set<string>();
  for (const entry of series) {
    if (!entry.holdsMeeting) continue;

    const month = monthOf(entry.date);
    if (month >= fromMonth && month < toMonth) live.add(month);
  }

  return live.size;
}

// The series must cover the anchor's month through the end of the target's month. Monthly
// cadence needs WHOLE months to decide whether a month is wholly dead, and a series that stops
// short would produce a plausible wrong number rather than a failure — the same reasoning that
// makes countSundaysBetween refuse two dates that are not Sundays.
function assertSeriesCovers(
  series: MeetingSundayEntry[],
  anchorDate: DateOnly,
  sundayDate: DateOnly,
): void {
  const requiredFrom = monthStart(anchorDate);
  const requiredTo = lastDayOfMonth(sundayDate);

  if (series.length === 0) {
    throw new Error(
      `resolveConductingUser needs a meeting series covering ${requiredFrom} to ${requiredTo}; got an empty one.`,
    );
  }

  const covers =
    series[0].date <= firstSundayOnOrAfter(requiredFrom) &&
    series[series.length - 1].date >= lastMeetingSundayOnOrBefore(requiredTo);

  if (!covers) {
    throw new Error(
      `resolveConductingUser needs a meeting series covering ${requiredFrom} to ${requiredTo}; ` +
        `got ${series[0].date} to ${series[series.length - 1].date}.`,
    );
  }
}

// The last Sunday on or before a date, without constructing a range. `to` is a month end, so the
// Sunday the series must reach is at most six days earlier.
function lastMeetingSundayOnOrBefore(to: DateOnly): DateOnly {
  const firstAfter = firstSundayOnOrAfter(to);

  return firstAfter === to ? to : addDaysUtc(firstAfter, -7);
}
