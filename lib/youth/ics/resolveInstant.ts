// A wall clock plus a zone name becomes a UTC instant. That is all this module does, and it does
// it WITHOUT ASKING THE PROCESS WHAT ZONE IT IS IN.
//
// ---------------------------------------------------------------------------
// WHY ICAL.Time.toJSDate() IS NEVER CALLED ANYWHERE IN THIS SLICE
// ---------------------------------------------------------------------------
// `toJSDate()` resolves a floating time — and any TZID that has not been registered — against the
// PROCESS'S OWN local zone. On the dev machine that is America/Denver and the answer looks right;
// on Vercel the server clock is UTC and the same file imports seven hours out. That is a bug
// which passes every test locally and ships wrong, and it is the exact failure
// 08-youth-activities.md names: "A game showing at the wrong hour makes the whole feature
// useless."
//
// So parseIcs.ts carries the wall clock and the zone NAME separately, and this is the single
// place the two become an instant.
//
// ---------------------------------------------------------------------------
// NO ical.js IMPORT AND NO ARGUMENT-LESS new Date()
// ---------------------------------------------------------------------------
// Everything here is drivable from a unit test with nothing but literals, which is what makes
// tests/lib/icsTimezone.test.ts able to assert EXACT UTC instants. An exact-instant assertion is
// itself the proof of server-zone independence: there is no zone the process could be in that
// would make one of them pass and another fail.
//
// This is the same principle lib/youth/eventInstant.ts states for the manual-entry form — it
// never converts a wall clock either, it appends the offset in force at that moment. Different
// mechanism, one rule.

// MONTH IS 1-BASED. `Date`'s is not, and every bug in this file would be an off-by-one month if
// the two were confused. ICAL.Time is 1-based too, which is why this shape matches it.
export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type IcsZone =
  | { kind: "utc" }
  | { kind: "named"; tzid: string }
  | { kind: "floating" };

export type ResolvedInstant = {
  instant: Date;
  // True when the ward's own zone had to stand in — because the file gave no zone at all, or gave
  // one this system cannot resolve. The caller raises a problem from this rather than the
  // resolution being silent (Decision 2).
  usedWardZone: boolean;
};

function isUsableTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Reads the wall clock that `instant` shows in `timeZone`. `hourCycle: "h23"` rather than
// `hour12: false` because the latter still renders midnight as "24" in some ICU versions, which
// silently adds a day.
function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const read = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number(part.value);
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function asUtcMilliseconds(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

// How many minutes ahead of UTC `timeZone` was AT THAT INSTANT. Asking about the instant rather
// than about today is the whole DST story: a January game and a July game in America/Denver are
// an hour apart.
//
// The standard dependency-free technique, and the reason this slice adds no date library: format
// the instant in the target zone, read the digits back as though they were UTC, and subtract.
export function offsetMinutesFor(instant: Date, timeZone: string): number {
  const asWall = asUtcMilliseconds(wallClockIn(instant, timeZone));
  return Math.round((asWall - instant.getTime()) / 60_000);
}

// The inverse, and the one that needs care.
//
// TWO CORRECTION PASSES, NOT ONE. The first guess treats the wall clock as though it were UTC and
// subtracts the offset in force at that guess — but the guess may be an hour off, and an hour is
// exactly the distance a DST boundary moves. So the offset is recomputed at the corrected instant
// and applied again. A single pass is wrong for one hour twice a year, in both directions, which
// is precisely the kind of bug that survives a demo and shows up on the first Sunday in November.
//
// A WALL CLOCK THAT DOES NOT EXIST has no correct answer. 2:30am on a spring-forward morning is
// simply not a time in Denver, and the fixed point above settles one hour EARLIER — 1:30am MST,
// a real instant on the right morning. That is left as it is rather than special-cased towards
// 3:30am: both are one hour from a time that never happened, the choice is arbitrary, and a
// branch here would be a rule nobody could state a reason for. What matters, and what
// tests/lib/icsTimezone.test.ts asserts, is that it is finite and on the correct day rather than
// NaN or yesterday.
export function wallClockToInstant(wall: WallClock, timeZone: string): Date {
  const target = asUtcMilliseconds(wall);

  const firstGuess = new Date(target - offsetMinutesFor(new Date(target), timeZone) * 60_000);
  const secondGuess = new Date(target - offsetMinutesFor(firstGuess, timeZone) * 60_000);

  return secondGuess;
}

// The one function the parser calls per occurrence.
//
// `utc` goes through Date.UTC rather than `new Date(someString)`: string parsing is where a
// stray "Z" or a missing one changes the answer, and there is no string here to get wrong.
export function resolveOccurrenceInstant(
  wall: WallClock,
  zone: IcsZone,
  wardTimeZone: string,
): ResolvedInstant {
  if (zone.kind === "utc") {
    return { instant: new Date(asUtcMilliseconds(wall)), usedWardZone: false };
  }

  if (zone.kind === "named") {
    // Decision 2: an unresolvable TZID falls back to the ward's zone AND is reported. Treating it
    // as UTC would be the wrong hour with no trace, which is worse than a wrong hour somebody was
    // shown before they confirmed.
    if (!isUsableTimeZone(zone.tzid)) {
      return { instant: wallClockToInstant(wall, wardTimeZone), usedWardZone: true };
    }

    return { instant: wallClockToInstant(wall, zone.tzid), usedWardZone: false };
  }

  // Decision 1: a floating time is read in the ward's zone. School feeds publish these routinely,
  // and refusing them would leave manual entry as the only path for the wards most likely to use
  // this feature.
  return { instant: wallClockToInstant(wall, wardTimeZone), usedWardZone: true };
}

// Ward midnight for an all-day entry. Kept here rather than in the parser so that "what instant
// does a date-only entry mean" has one answer, and so the all-day case is testable from literals
// alongside every other case.
export function allDayInstant(wall: WallClock, wardTimeZone: string): Date {
  return wallClockToInstant(
    { year: wall.year, month: wall.month, day: wall.day, hour: 0, minute: 0, second: 0 },
    wardTimeZone,
  );
}
