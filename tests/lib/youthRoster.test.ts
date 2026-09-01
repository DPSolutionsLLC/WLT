import { describe, expect, it } from "vitest";
import {
  eventYouthAttendance,
  expectedNames,
  memberIsExpectedAt,
  rosterInWindow,
  youthAttendedForEvent,
  type EventParticipation,
  type RosterMember,
} from "@/lib/youth/roster";

// THE WINDOW RULE AND THE LOUD/QUIET SPLIT — the highest-value file in youth-j.
//
// Two things are asserted here that no other test can reach:
//
//   1. A DAY AND AN INSTANT ARE COMPARED IN THE WARD'S ZONE. `started_on` and `ended_on` are
//      `date` columns; `event_date` is a timestamptz. Comparing `eventDate.slice(0, 10)` to a date
//      string is UTC, and it puts a 7:30pm Friday game on Saturday — the bug c24d52b fixed across
//      seven files. The boundary cases below are chosen so that a slice-based implementation
//      FAILS them.
//
//   2. AN EMPTY ROSTER IS LOUD. It lands on `expected` with an empty list, so a freshly imported
//      season keeps its ordinary coverage badge. That is the branch a future tidy-up will invert,
//      and the test says so in as many words.

// America/Denver. West of UTC, so a 7:30pm game on the 15th is already the 16th in UTC — which is
// the whole point of choosing it.
const WARD_ZONE = "America/Denver";

function membership(overrides: Partial<RosterMember> = {}): RosterMember {
  return {
    rosterId: "roster-1",
    profileId: "profile-basketball",
    memberId: "member-ethan",
    memberName: "Ethan Brooks",
    startedOn: null,
    endedOn: null,
    ...overrides,
  };
}

// 7:30pm on 15 January 2027 in the ward's zone. In UTC that is 02:30 on the SIXTEENTH.
const EVENING_OF_THE_15TH = "2027-01-16T02:30:00.000Z";

describe("memberIsExpectedAt — the one window function", () => {
  it("counts every event when both dates are absent", () => {
    expect(
      memberIsExpectedAt(membership(), null, EVENING_OF_THE_15TH, WARD_ZONE),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // THE TWO CASES A `slice(0, 10)` COMPARISON GETS WRONG
  // ---------------------------------------------------------------------------
  // `EVENING_OF_THE_15TH.slice(0, 10)` is "2027-01-16", because the instant is 02:30 UTC. So a
  // naive implementation would read this game as being on the SIXTEENTH and would answer both of
  // the following backwards. They are the reason wardDayStartMs() exists.
  it("counts a 7:30pm game on the day the youth JOINED, in the ward's zone", () => {
    expect(
      memberIsExpectedAt(
        membership({ startedOn: "2027-01-15" }),
        null,
        EVENING_OF_THE_15TH,
        WARD_ZONE,
      ),
    ).toBe(true);
  });

  it("counts a 7:30pm game on the day the youth LEFT, in the ward's zone", () => {
    expect(
      memberIsExpectedAt(
        membership({ endedOn: "2027-01-15" }),
        null,
        EVENING_OF_THE_15TH,
        WARD_ZONE,
      ),
    ).toBe(true);
  });

  // The inverse of the pair above, so "inclusive" is proved to have a boundary rather than being
  // vacuously true.
  it("excludes a game the day BEFORE the youth joined", () => {
    expect(
      memberIsExpectedAt(
        membership({ startedOn: "2027-01-16" }),
        null,
        EVENING_OF_THE_15TH,
        WARD_ZONE,
      ),
    ).toBe(false);
  });

  it("excludes a game the day AFTER the youth left", () => {
    expect(
      memberIsExpectedAt(
        membership({ endedOn: "2027-01-14" }),
        null,
        EVENING_OF_THE_15TH,
        WARD_ZONE,
      ),
    ).toBe(false);
  });

  // THE SAME RULE AT A THIRD SCALE. A closed season is not a fourth kind of exclusion — it is the
  // same predicate, which is what closes the ActivityCalendar leak by construction.
  it("excludes a game AFTER the season was closed out", () => {
    expect(
      memberIsExpectedAt(
        membership(),
        "2027-01-10T00:00:00.000Z",
        EVENING_OF_THE_15TH,
        WARD_ZONE,
      ),
    ).toBe(false);
  });

  it("counts a game BEFORE the season was closed out", () => {
    expect(
      memberIsExpectedAt(
        membership(),
        "2027-02-01T00:00:00.000Z",
        EVENING_OF_THE_15TH,
        WARD_ZONE,
      ),
    ).toBe(true);
  });

  // WHICHEVER BOUNDARY IS NEARER WINS, because they are three clauses of one conjunction rather
  // than three rules competing. A youth who left in January is out of a season that closed in
  // March, and a season that closed in January excludes a youth who was on it until March.
  it("excludes when `endedOn` is nearer than `closedAt`", () => {
    expect(
      memberIsExpectedAt(
        membership({ endedOn: "2027-01-10" }),
        "2027-03-01T00:00:00.000Z",
        EVENING_OF_THE_15TH,
        WARD_ZONE,
      ),
    ).toBe(false);
  });

  it("excludes when `closedAt` is nearer than `endedOn`", () => {
    expect(
      memberIsExpectedAt(
        membership({ endedOn: "2027-03-01" }),
        "2027-01-10T00:00:00.000Z",
        EVENING_OF_THE_15TH,
        WARD_ZONE,
      ),
    ).toBe(false);
  });

  // EXCLUDED RATHER THAN THROWN, matching eventCoverage() and isFollowUpWritable(), which both
  // drop one rather than taking a page down. A row nothing can read cannot be acted on.
  it.each([
    ["an unreadable event date", membership(), null, "not a date"],
    ["an unreadable startedOn", membership({ startedOn: "15/01/2027" }), null, EVENING_OF_THE_15TH],
    ["an unreadable endedOn", membership({ endedOn: "" }), null, EVENING_OF_THE_15TH],
  ] as const)("returns false for %s", (_label, member, closedAt, eventDate) => {
    expect(memberIsExpectedAt(member, closedAt, eventDate, WARD_ZONE)).toBe(false);
  });

  it("returns false for an unreadable closedAt", () => {
    expect(
      memberIsExpectedAt(membership(), "not an instant", EVENING_OF_THE_15TH, WARD_ZONE),
    ).toBe(false);
  });
});

const ETHAN = membership({ rosterId: "r-ethan", memberId: "m-ethan", memberName: "Ethan Brooks" });
const JOSH = membership({ rosterId: "r-josh", memberId: "m-josh", memberName: "Josh Kim" });
const MAYA = membership({ rosterId: "r-maya", memberId: "m-maya", memberName: "Maya Alvarez" });

const EVENT = { eventDate: EVENING_OF_THE_15TH };

function absent(memberId: string): EventParticipation {
  return { memberId, takingPart: false };
}

describe("eventYouthAttendance — the branch order IS the rule", () => {
  // ---------------------------------------------------------------------------
  // THE BRANCH A FUTURE TIDY-UP WILL INVERT. DO NOT "FIX" IT.
  // ---------------------------------------------------------------------------
  // A team with nobody assigned yet produces zero expected young people, which LOOKS like "nobody
  // is expected here" — and answering it that way would silently remove every game of a freshly
  // imported season from the coverage model, with no badge anywhere saying so and nobody asked to
  // attend any of them.
  //
  // It is `classifyLocation.ts`'s "an unmatched location is `tbd`, never `away`" for a fourth
  // time: AN ABSENCE OF EVIDENCE IS NOT EVIDENCE. Nobody being on the roster is not the same fact
  // as nobody being expected, and ITER-033's own flow — import once, then assign — means every
  // ward passes through this state on every schedule they import.
  it("an EMPTY roster is `expected` with an empty list — LOUD, never no_expectation", () => {
    const result = eventYouthAttendance(EVENT, [], [], null, WARD_ZONE);

    expect(result.kind).toBe("expected");
    expect(result.kind === "expected" && result.expected).toEqual([]);
    // And it maps to `null`, which falls through to the ordinary coverage arithmetic — so the
    // game keeps its uncovered badge rather than going quiet.
    expect(youthAttendedForEvent(result)).toBeNull();
  });

  it("marks nobody absent when nobody has said", () => {
    const result = eventYouthAttendance(EVENT, [ETHAN, JOSH], [], null, WARD_ZONE);

    expect(result.kind).toBe("expected");
    expect(expectedNames(result)).toEqual(["Ethan Brooks", "Josh Kim"]);
    expect(result.absent).toEqual([]);
  });

  // ONE OF THREE ABSENT IS STILL AN EXPECTATION. This is the case that was impossible before
  // youth-j: marking Ethan out must not touch Josh or Maya at the same game.
  it("separates the absent from the expected, carrying WHOLE RosterMember objects", () => {
    const result = eventYouthAttendance(
      EVENT,
      [ETHAN, JOSH, MAYA],
      [absent("m-ethan")],
      null,
      WARD_ZONE,
    );

    expect(result.kind).toBe("expected");
    expect(expectedNames(result)).toEqual(["Josh Kim", "Maya Alvarez"]);

    // A WHOLE OBJECT, NOT AN ID. youth-e's lesson as a signature: the chip needs the name, the
    // write needs the id, and both must come off the value the decision was made on.
    expect(result.absent).toEqual([ETHAN]);
    expect(result.absent[0].memberName).toBe("Ethan Brooks");

    // Still an expectation, so the game keeps its ordinary coverage.
    expect(youthAttendedForEvent(result)).toBeNull();
  });

  it("goes QUIET when EVERY young person in the window is marked absent", () => {
    const result = eventYouthAttendance(
      EVENT,
      [ETHAN, JOSH],
      [absent("m-ethan"), absent("m-josh")],
      null,
      WARD_ZONE,
    );

    expect(result.kind).toBe("no_expectation");
    expect(result.kind === "no_expectation" && result.reason).toBe("all_absent");
    expect(result.absent).toEqual([ETHAN, JOSH]);
    expect(youthAttendedForEvent(result)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // THE ITER-033 LEAK, CLOSED — AND IT IS TESTED FIRST BECAUSE IT IS TESTED FIRST
  // ---------------------------------------------------------------------------
  // The roster is non-empty and NOBODY IS MARKED, so every other branch would return `expected`.
  // The season being closed is what makes it quiet, and it is decided before any of them.
  //
  // Before youth-j, ActivityCalendar.tsx and calendar/page.tsx contained no reference to
  // `closedAt` at all, so a closed team's future games went on raising "Nobody going" for ever.
  it("goes QUIET for an event after `closedAt`, even with a full roster and nobody marked", () => {
    const result = eventYouthAttendance(
      EVENT,
      [ETHAN, JOSH],
      [],
      "2027-01-10T00:00:00.000Z",
      WARD_ZONE,
    );

    expect(result.kind).toBe("no_expectation");
    expect(result.kind === "no_expectation" && result.reason).toBe("season_closed");
    expect(youthAttendedForEvent(result)).toBe(false);
  });

  it("stays LOUD for an event BEFORE `closedAt`", () => {
    const result = eventYouthAttendance(
      EVENT,
      [ETHAN, JOSH],
      [],
      "2027-03-01T00:00:00.000Z",
      WARD_ZONE,
    );

    expect(result.kind).toBe("expected");
    expect(expectedNames(result)).toEqual(["Ethan Brooks", "Josh Kim"]);
  });

  // A YOUNG PERSON OUT OF WINDOW IS NOT ABSENT, THEY ARE ABSENT FROM THE QUESTION. Josh left in
  // December, so a January game is not his and he appears nowhere on it — neither expected nor
  // chipped. Getting this wrong would put a "not taking part" chip on every game after somebody
  // left the team, which reads as a decision they made rather than a season that ended.
  it("leaves a youth who is out of window off BOTH lists", () => {
    const result = eventYouthAttendance(
      EVENT,
      [ETHAN, membership({ ...JOSH, endedOn: "2026-12-20" })],
      [absent("m-josh")],
      null,
      WARD_ZONE,
    );

    expect(result.kind).toBe("expected");
    expect(expectedNames(result)).toEqual(["Ethan Brooks"]);
    expect(result.absent).toEqual([]);
  });

  // `all_absent` MUST NOT FIRE VACUOUSLY. An empty in-window list has "every member marked" as a
  // vacuous truth, and without the `inWindow.length > 0` guard the empty roster would land in the
  // quiet branch — which is the exact inversion the first test in this block forbids.
  it("does not read an empty window as `all_absent`", () => {
    const result = eventYouthAttendance(
      EVENT,
      [membership({ ...ETHAN, endedOn: "2026-12-20" })],
      [absent("m-ethan")],
      null,
      WARD_ZONE,
    );

    expect(result.kind).toBe("expected");
  });
});

describe("rosterInWindow", () => {
  // A CONTROL HAS TO OFFER BOTH, or a young person marked absent by mistake could never be
  // unmarked — the one-way door migration 060a's reversibility rule exists to prevent.
  it("returns the expected AND the absent, expected first", () => {
    const result = eventYouthAttendance(
      EVENT,
      [ETHAN, JOSH, MAYA],
      [absent("m-josh")],
      null,
      WARD_ZONE,
    );

    expect(rosterInWindow(result).map((member) => member.memberName)).toEqual([
      "Ethan Brooks",
      "Maya Alvarez",
      "Josh Kim",
    ]);
  });

  it("returns the absent on a quiet result, so they can still be unmarked", () => {
    const result = eventYouthAttendance(EVENT, [ETHAN], [absent("m-ethan")], null, WARD_ZONE);

    expect(rosterInWindow(result)).toEqual([ETHAN]);
  });

  // A CLOSED SEASON OFFERS NOBODY. There is nothing to record about a game that fell outside the
  // season, and the control renders nothing at all there.
  it("returns nobody for a closed season", () => {
    const result = eventYouthAttendance(
      EVENT,
      [ETHAN, JOSH],
      [],
      "2027-01-10T00:00:00.000Z",
      WARD_ZONE,
    );

    expect(rosterInWindow(result)).toEqual([]);
  });
});

describe("youthAttendedForEvent — the one adapter into eventCoverage()", () => {
  it("maps `no_expectation` to false and `expected` to null", () => {
    const quiet = eventYouthAttendance(EVENT, [ETHAN], [absent("m-ethan")], null, WARD_ZONE);
    const loud = eventYouthAttendance(EVENT, [ETHAN], [], null, WARD_ZONE);

    expect(youthAttendedForEvent(quiet)).toBe(false);
    expect(youthAttendedForEvent(loud)).toBeNull();
  });
});
