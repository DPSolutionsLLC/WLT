import { wallClockToInstant } from "@/lib/youth/ics/resolveInstant";

// Who is on a team, and which of a team's events each of them is expected at.
//
// ---------------------------------------------------------------------------
// PURE AND CLIENT-IMPORTABLE — KEEP IT THAT WAY
// ---------------------------------------------------------------------------
// YouthOverview, EventList and ActivityCalendar all render this in the browser. ONE import of
// lib/youth/queries.ts or lib/youth/rosterQueries.ts would pull next/headers into the client
// bundle and break the page — youth-c recorded that `npm run build` caught exactly that where
// lint, typecheck and 2982 tests did not. This file imports lib/youth/ics/resolveInstant.ts,
// which is pure arithmetic over a zone name, and nothing else.
//
// The server half is lib/youth/rosterQueries.ts, and the split is the whole reason there are two
// files. Same standing instruction lib/youth/coverage.ts and lib/youth/profileNeed.ts carry.
//
// ---------------------------------------------------------------------------
// `asOf` NEVER ENTERS HERE
// ---------------------------------------------------------------------------
// Nothing below reads a clock. `memberIsExpectedAt` compares an event's own instant against a
// window, and `eventYouthAttendance` compares it against a closing instant; both are facts about
// the event rather than about now. The clock belongs to eventCoverage() and profileNeed(), which
// take it as a parameter for the reason those files state.

// One young person's membership of one team, as every screen reads it.
//
// WHOLE OBJECTS COME BACK FROM THE FUNCTIONS BELOW, NEVER IDS AND NEVER A COUNT. That is youth-e
// written into a signature: `ProfileNeed` once carried a state and a date but not the COUNT, and
// every covered card read "Covered · 0" above an event card reading "Covered · 1". The chip, the
// "+N others" line, the expected list and the sort must all read the value the decision was made
// on, so there is nothing left for a second lookup to disagree with.
export type RosterMember = {
  rosterId: string;
  profileId: string;
  memberId: string;
  memberName: string;
  // `date` columns, "YYYY-MM-DD". NULL MEANS THE WHOLE SCHEDULE at that end — migration 062a's
  // absent-means-default idiom, with no sentinel date meaning "from the start".
  startedOn: string | null;
  endedOn: string | null;
};

// One answer about one (young person, event). The ABSENCE of an entry is the third state —
// nobody has said — which is migration 062d's rule and why `takingPart` is not nullable here.
export type EventParticipation = {
  memberId: string;
  takingPart: boolean;
};

// ---------------------------------------------------------------------------
// AN EMPTY ROSTER STAYS LOUD; A CLOSED SEASON GOES QUIET
// ---------------------------------------------------------------------------
// Both produce "zero young people expected at this game", and THEY MUST NOT BE ANSWERED THE SAME
// WAY. This discriminated result is what keeps them apart, so a caller cannot collapse them by
// accident — it has to name a branch.
export type EventYouthAttendance =
  | {
      kind: "expected";
      // In the window and not marked absent. MAY BE EMPTY, and an empty list here is the loud
      // case — see branch 5 of eventYouthAttendance().
      expected: RosterMember[];
      absent: RosterMember[];
    }
  | {
      kind: "no_expectation";
      reason: "season_closed" | "all_absent";
      absent: RosterMember[];
    };

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The instant a ward-day BEGINS, from a `date` string.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT wardDayBounds()
// ---------------------------------------------------------------------------
// lib/youth/occasionDay.ts answers "what instants does this ward-day span", which is the same
// question — but it takes an INSTANT and formats it into a day first, because its caller has an
// event and wants that event's day. Here the input is ALREADY a day, and the only way to hand it
// to that function would be to turn "2027-01-15" into an instant first.
//
// THAT ROUND TRIP IS THE BUG THIS WHOLE FILE EXISTS TO AVOID. `new Date("2027-01-15")` is UTC
// midnight, which in America/Denver is 5pm on the FOURTEENTH — so wardDayBounds() would return
// the wrong day's bounds for every ward west of UTC. The same shape as comparing
// `eventDate.slice(0, 10)` to a date string, which is the bug c24d52b fixed across seven files.
//
// So the day goes straight to wallClockToInstant(), which carries the two-pass DST correction one
// pass gets wrong for an hour twice a year, and never becomes a string in between.
//
// Returns null for anything unreadable rather than throwing — lib/calendar/dates.ts's
// parseDateOnly() throws by design, and this is on a render path where one bad row must not take
// a page down. eventCoverage() and isFollowUpWritable() both exclude one rather than throwing.
function wardDayStartMs(dateOnly: string, timeZone: string, dayOffset = 0): number | null {
  if (!DATE_ONLY_PATTERN.test(dateOnly)) return null;

  const year = Number(dateOnly.slice(0, 4));
  const month = Number(dateOnly.slice(5, 7));
  const day = Number(dateOnly.slice(8, 10));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  // Month and day may overflow (32 January, month 13) when `dayOffset` pushes past a month end.
  // Date.UTC normalises both, which is what wallClockToInstant runs on — the same overflow
  // occasionDay.ts relies on for its next-midnight bound.
  const instant = wallClockToInstant(
    { year, month, day: day + dayOffset, hour: 0, minute: 0, second: 0 },
    timeZone,
  );

  const ms = instant.getTime();
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// THE ONE WINDOW FUNCTION. THE SINGLE MOST IMPORTANT THING IN THIS SLICE.
// ---------------------------------------------------------------------------
// "The youth LEFT the team", "the youth JOINED late" and "the season was CLOSED OUT" are ONE RULE
// AT ONE SCALE:
//
//     eventDate >= (startedOn ?? -∞)  ∧  eventDate <= (endedOn ?? +∞)  ∧  eventDate <= (closedAt ?? +∞)
//
// That is what fixes the ActivityCalendar leak BY CONSTRUCTION rather than by remembering to add
// a `closedAt` check to a fourth screen. ITER-033 records that leak, and it was verified before
// this was written: ActivityCalendar.tsx and calendar/page.tsx contained no reference to
// `closedAt` at all, so a closed team's future games went on raising "Nobody going" for ever.
// Every screen that asks "is this young person expected here?" now asks it here, and gets the
// closed-season answer whether or not it knew to want one.
//
// ---------------------------------------------------------------------------
// A DAY AND AN INSTANT MEET HERE, AND NOWHERE ELSE
// ---------------------------------------------------------------------------
// `startedOn` and `endedOn` are `date` columns — days. `eventDate` and `profileClosedAt` are
// `timestamptz` — instants. They are reconciled IN THE WARD'S ZONE, which is
// lib/youth/ics/resolveInstant.ts's rule in a second place and CLAUDE.md §9's zone decision
// applied to a comparison rather than to a formatter.
//
// BOTH BOUNDARIES ARE INCLUSIVE, ON THEIR OWN DAY:
//   `startedOn` counts from the START of that ward-day — a game at 7:30pm on the day she joined
//   is hers.
//   `endedOn` counts to the END of that ward-day — A YOUTH WHO LEFT "ON THE 15TH" IS COUNTED FOR
//   A GAME ON THE 15TH, because they were still on the team that day.
// tests/lib/youthRoster.test.ts asserts both boundaries explicitly, including a 7:30pm game in a
// zone west of UTC, which is the case a `slice(0, 10)` comparison gets wrong.
//
// `profileClosedAt` IS AN INSTANT AND COMPARES DIRECTLY — no day arithmetic, because closing a
// season is a moment somebody chose rather than a day. A game AFTER the closing instant is out;
// one before it is in. That is exactly what /youth/history/[member_id] already does with
// `activitySupport(profile, events, new Date(closedAt))`, expressed once instead of twice.
//
// AN UNREADABLE DATE ON EITHER SIDE RETURNS false, matching eventCoverage() and
// isFollowUpWritable(), which both exclude one rather than throwing. A row nothing can read
// cannot be acted on, and taking a page down over it helps nobody.
export function memberIsExpectedAt(
  membership: Pick<RosterMember, "startedOn" | "endedOn">,
  profileClosedAt: string | null,
  eventDate: string,
  wardTimeZone: string,
): boolean {
  const eventMs = new Date(eventDate).getTime();
  if (!Number.isFinite(eventMs)) return false;

  if (membership.startedOn !== null) {
    const startMs = wardDayStartMs(membership.startedOn, wardTimeZone);
    if (startMs === null) return false;
    if (eventMs < startMs) return false;
  }

  if (membership.endedOn !== null) {
    // THE NEXT DAY'S MIDNIGHT, so the leaving day itself is included. Computed as a wall clock
    // rather than as `start + 86_400_000`, because a day is 23 hours on a spring-forward Sunday
    // and adding a fixed number of milliseconds would silently drop an hour twice a year —
    // occasionDay.ts's reasoning for the same bound.
    const endExclusiveMs = wardDayStartMs(membership.endedOn, wardTimeZone, 1);
    if (endExclusiveMs === null) return false;
    if (eventMs >= endExclusiveMs) return false;
  }

  if (profileClosedAt !== null) {
    const closedMs = new Date(profileClosedAt).getTime();
    if (!Number.isFinite(closedMs)) return false;
    if (eventMs > closedMs) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// THE LOUD/QUIET SPLIT. THE ORDER OF THE BRANCHES *IS* THE RULE.
// ---------------------------------------------------------------------------
// eventCoverage() states the same thing about its own branch order, and for the same reason: an
// answer that depends on which test ran first is an answer nobody can reason about later.
export function eventYouthAttendance(
  event: { eventDate: string },
  memberships: readonly RosterMember[],
  participation: readonly EventParticipation[],
  profileClosedAt: string | null,
  wardTimeZone: string,
): EventYouthAttendance {
  // 1. THE SEASON IS OVER. QUIET. This is the ActivityCalendar leak, closed — and closed here
  //    rather than on the calendar, so every screen inherits it without knowing to ask.
  if (profileClosedAt !== null) {
    const closedMs = new Date(profileClosedAt).getTime();
    const eventMs = new Date(event.eventDate).getTime();

    if (Number.isFinite(closedMs) && Number.isFinite(eventMs) && eventMs > closedMs) {
      return { kind: "no_expectation", reason: "season_closed", absent: [] };
    }
  }

  // 2. Who was on this team when this game happened.
  const inWindow = memberships.filter((membership) =>
    memberIsExpectedAt(membership, profileClosedAt, event.eventDate, wardTimeZone),
  );

  // 3. Of those, who somebody has said is NOT taking part. `=== false` explicitly: an absent
  //    entry means nobody has said, and `true` is the ordinary case.
  const notTakingPart = new Set(
    participation
      .filter((entry) => entry.takingPart === false)
      .map((entry) => entry.memberId),
  );

  const absent = inWindow.filter((membership) => notTakingPart.has(membership.memberId));

  // 4. EVERY young person on this team is marked absent. QUIET — there is genuinely nobody this
  //    game could have been a chance to support. `inWindow.length > 0` guards the empty case,
  //    which would otherwise land here vacuously and become branch 5's opposite.
  if (inWindow.length > 0 && absent.length === inWindow.length) {
    return { kind: "no_expectation", reason: "all_absent", absent };
  }

  // 5. ---------------------------------------------------------------------------
  //    AN EMPTY ROSTER LANDS HERE, WITH AN EMPTY `expected`, AND THAT IS LOAD-BEARING
  //    ---------------------------------------------------------------------------
  //    A team with nobody assigned to it yet is a NORMAL state in ITER-033's own flow — the user's
  //    model is "import once, then assign", so every ward passes through it on every schedule they
  //    import. Answering it "no expectation" would silently remove every game of a freshly
  //    imported season from the coverage model: no badge, no count, nothing on any screen saying
  //    so, and nobody asked to attend any of them.
  //
  //    That is lib/youth/classifyLocation.ts's "an unmatched location is `tbd`, never `away`" for
  //    a FOURTH time. An absence of evidence is not evidence: nobody being on the roster is not
  //    the same fact as nobody being expected. The calendar renders ordinary coverage for these,
  //    so a freshly imported season reads "Nobody going" — loud — until somebody assigns the
  //    players, and /youth/profiles says the same thing in a sentence.
  //
  //    THIS IS THE BRANCH A FUTURE TIDY-UP WILL INVERT. tests/lib/youthRoster.test.ts asserts it
  //    explicitly and says why in the test itself.
  return {
    kind: "expected",
    expected: inWindow.filter((membership) => !notTakingPart.has(membership.memberId)),
    absent,
  };
}

// THE ADAPTER INTO lib/youth/coverage.ts's UNCHANGED `EventCoverageInput`.
//
// ONE FUNCTION, SO NO SCREEN INVENTS ITS OWN MAPPING. `eventCoverage()` is not modified by this
// slice at all — its `youthAttended === false` branch still sits before the clock, for the reason
// it is there — and what changed is only the SOURCE of that field: a participation row for this
// (youth, event) rather than a column on the event.
//
// `no_expectation` → `false`, which is the input that resolves to `not_expected` at every
// distance from the clock. `expected` → `null`, which is "nobody has said" and falls through to
// the ordinary arithmetic, INCLUDING when the expected list is empty. Branch 5 above is why.
export function youthAttendedForEvent(attendance: EventYouthAttendance): boolean | null {
  return attendance.kind === "no_expectation" ? false : null;
}

// EVERYBODY ON THE TEAM WHOSE WINDOW COVERS THIS EVENT — the expected and the absent together.
//
// The two are separate on the result because the CONSEQUENCES differ: only the expected are
// listed as who is coming, and only the absent get a chip. But a CONTROL has to offer both, or a
// young person marked absent by mistake could never be unmarked — the one-way door migration
// 060a's reversibility rule exists to prevent.
//
// EXPECTED FIRST, THEN ABSENT, and both in `memberships` order, so the list is stable across
// renders and a name does not jump when somebody is marked.
export function rosterInWindow(attendance: EventYouthAttendance): RosterMember[] {
  return attendance.kind === "expected"
    ? [...attendance.expected, ...attendance.absent]
    : [...attendance.absent];
}

// The names of the young people expected at this event, for the line under a card. Empty for a
// team nobody is on yet and for one whose season has closed — in both cases there is nobody to
// name, and the DIFFERENCE between those two is carried by the coverage badge rather than here.
export function expectedNames(attendance: EventYouthAttendance): string[] {
  return attendance.kind === "expected"
    ? attendance.expected.map((member) => member.memberName)
    : [];
}
