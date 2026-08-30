import { wallClockToInstant } from "@/lib/youth/ics/resolveInstant";

// The day an event falls on IN THE WARD'S ZONE, as a pair of instants.
//
// ---------------------------------------------------------------------------
// THE WARD'S ZONE HERE, AND THE READER'S ZONE EVERYWHERE ELSE. BOTH ARE RIGHT.
// ---------------------------------------------------------------------------
// ActivityCalendar's header is emphatic that a card is bucketed into a day in the READER'S own
// zone, so that the day a card sits under always matches the time printed on it. That rule is
// about RENDERING and it is not being reversed here.
//
// This is a QUERY BOUND: it decides which events the "this is the same game as…" picker is
// allowed to OFFER. It must be the same set of candidates for every reader, or two leaders
// looking at the same game would be shown different options and one of them would be unable to
// record what the other could. A ward has one zone; a reader's laptop does not.
//
// This is exactly the kind of distinction a later reader "corrects" in one direction or the
// other, which is why both halves are written down rather than only the one this file uses.
//
// A PURE MODULE ON PURPOSE — no server imports, so it stays testable from literals and cannot
// pull next/headers into anything. lib/ward/wardTimezone.ts is what READS the zone name; this is
// what does arithmetic with it.

const DAY_PARTS = new Map<string, Intl.DateTimeFormat>();

// Cached per zone because a page resolves one bound per render and constructing a formatter is
// the expensive half. `en-CA` gives YYYY-MM-DD, which is locale-independent — the same reason
// ActivityCalendar builds its day keys from it rather than from toISOString(), which is UTC.
function partsFor(timeZone: string): Intl.DateTimeFormat {
  const existing = DAY_PARTS.get(timeZone);
  if (existing !== undefined) return existing;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  DAY_PARTS.set(timeZone, formatter);
  return formatter;
}

export type DayBounds = {
  // Offset-bearing ISO instants, because that is what listActivityEvents' `from` and `to` take
  // and what listActivityEventsQuerySchema refuses a floating value in favour of.
  from: string;
  to: string;
};

// Returns null for an instant nothing can read, rather than throwing or inventing a day. The
// caller renders an empty picker with a sentence, which is the honest answer: there is no day to
// look for candidates on.
export function wardDayBounds(instant: string, timeZone: string): DayBounds | null {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return null;

  const [year, month, day] = partsFor(timeZone)
    .format(parsed)
    .split("-")
    .map((part) => Number(part));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const start = wallClockToInstant(
    { year, month, day, hour: 0, minute: 0, second: 0 },
    timeZone,
  );

  // THE NEXT DAY'S MIDNIGHT, computed as a wall clock rather than as `start + 86_400_000`. A day
  // is not always 24 hours long: on a spring-forward Sunday it is 23, and adding a fixed number
  // of milliseconds would silently include an hour of the following day twice a year. The same
  // two-pass DST correction wallClockToInstant carries is what makes this right.
  //
  // Month and day may overflow (32 January, month 13); Date.UTC normalises both, which is what
  // wallClockToInstant runs on.
  const end = wallClockToInstant(
    { year, month, day: day + 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );

  return { from: start.toISOString(), to: end.toISOString() };
}
