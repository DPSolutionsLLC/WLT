import {
  countMonthsBetween,
  countSundaysBetween,
  firstSundayOnOrAfter,
  monthStart,
  type DateOnly,
} from "@/lib/calendar/dates";
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
export function resolveConductingUser(
  sundayDate: DateOnly,
  rotation: RotationEntry[],
  anchorDate: DateOnly,
): string | null {
  const active = activeRotation(rotation, sundayDate);
  if (active.length === 0) return null;

  // The three rows of one set always agree on cadence — lib/calendar/queries.ts writes them
  // together and nothing exposes a per-row cadence write (migration 024, Part 1).
  const offset =
    active[0].cadence === "monthly"
      ? countMonthsBetween(monthStart(anchorDate), monthStart(sundayDate))
      : countSundaysBetween(firstSundayOnOrAfter(anchorDate), sundayDate);

  // Before the anchor. A negative modulo in JavaScript is negative, and indexing backwards from
  // the end would hand back position 3 — a wrong answer wearing the shape of a right one.
  if (offset < 0) return null;

  const position = ROTATION_POSITIONS[offset % ROTATION_POSITIONS.length];

  // An unfilled position returns null rather than falling through to the next one. Skipping would
  // quietly give one counselor twice the turns and nobody would see why.
  return active.find((entry) => entry.position === position)?.userId ?? null;
}
