// @vitest-environment node
//
// The arithmetic behind /youth: coverage per profile, support per activity, and one ranking per
// young person.
//
// ---------------------------------------------------------------------------
// WHAT THIS SUITE IS ACTUALLY GUARDING
// ---------------------------------------------------------------------------
// 1. ABSENCE OF A SIGNAL IS NOT A ZERO SCORE. visits-f shipped a comparator whose inherited name
//    tie-break sorted never-visited households BELOW recently-visited ones, and every row was
//    individually correct. Here it is `supportedFraction === null` for a young person with no home
//    games played: rendered or sorted as 0% they would LEAD a list of the least supported, and
//    nobody could possibly have supported them.
//
// 2. A MISSING PERCENTAGE SORTS LAST IN **BOTH** DIRECTIONS, and that is the DELIBERATE OPPOSITE
//    of the sort it replaced. `nobody_all_season` sorted `lastAttendedOn === null` FIRST, because
//    there null meant "nobody has ever been" — a real signal. The two rules look identical and
//    they are opposite, so both directions are asserted explicitly.
//
// 3. THE THREE EXCLUSIONS ARE ASSERTED SEPARATELY — away, tbd, cancelled — in BOTH halves. They
//    are three conditions for three different reasons, and asserting them as one case would let
//    somebody delete two of them and keep a green suite.
//
// 4. THE BADGE'S COUNT BELONGS TO THE EVENT THE BADGE'S STATE CAME FROM, asserted across two
//    profiles. That is the defect the walk on 2026-08-29 found on this very screen.
//
// `asOf` is a parameter everywhere, so nothing here freezes a clock or sleeps.

import { describe, expect, it } from "vitest";
import {
  activitySupport,
  buildSupportEvents,
  compareYouth,
  describeActivitySupport,
  describeNothingRunning,
  describeSeasonNeed,
  profileNeed,
  youthNeed,
  type ActivitySupport,
  type ProfileNeed,
  type ProfileNeedEvent,
  type SupportEvent,
  type YouthNeed,
  type YouthSort,
} from "@/lib/youth/profileNeed";
import type { EventParticipation, RosterMember } from "@/lib/youth/roster";

const ASOF = new Date("2027-01-15T12:00:00Z");

function daysFrom(days: number): string {
  return new Date(ASOF.getTime() + days * 86_400_000).toISOString();
}

function event(overrides: Partial<ProfileNeedEvent> = {}): ProfileNeedEvent {
  return {
    eventType: "home",
    eventDate: daysFrom(3),
    status: "upcoming",
    attendeeCount: 0,
    // Migration 061. NULL IS THE ORDINARY CASE — nobody has said — so every existing assertion in
    // this suite goes on describing the behaviour it described before the column existed.
    youthAttended: null,
    ...overrides,
  };
}

function need(overrides: Partial<ProfileNeed> = {}): ProfileNeed {
  return {
    upcomingCount: 0,
    worstUpcoming: null,
    soonestNeedOn: null,
    worstUpcomingAttendees: 0,
    expectedPastCount: 0,
    lastAttendedOn: null,
    unattendedRun: 0,
    ...overrides,
  };
}

describe("profileNeed — the upcoming half", () => {
  it("reports the WORST upcoming state, not the first or the soonest", () => {
    // The soonest is covered; the worst is the uncovered one four days later.
    const result = profileNeed(
      [
        event({ eventDate: daysFrom(2), attendeeCount: 1 }),
        event({ eventDate: daysFrom(6), attendeeCount: 0 }),
      ],
      ASOF,
    );

    expect(result.worstUpcoming).toBe("uncovered");
    expect(result.upcomingCount).toBe(2);
  });

  it("points soonestNeedOn at the soonest event HOLDING that worst state", () => {
    const soonestUncovered = daysFrom(4);

    const result = profileNeed(
      [
        // Sooner than the uncovered pair, but covered — so it must not be the date reported.
        event({ eventDate: daysFrom(1), attendeeCount: 2 }),
        event({ eventDate: daysFrom(6) }),
        event({ eventDate: soonestUncovered }),
      ],
      ASOF,
    );

    expect(result.worstUpcoming).toBe("uncovered");
    expect(result.soonestNeedOn).toBe(soonestUncovered);
  });

  // ---------------------------------------------------------------------------
  // THE COUNT COMES OFF THE SAME EVENT THE STATE DOES.
  // ---------------------------------------------------------------------------
  // Walking scenario 057 on 2026-08-29 found every covered card reading "Covered · 0" directly
  // above an event card reading "Covered · 1" — YouthOverview had no real number to pass and
  // filled a literal zero. The suite could not see it because `worstUpcomingAttendees` did not
  // exist and nothing pinned the number a card DISPLAYS against the value it sorted on.
  it("reports the attendee count of the event the worst state came from", () => {
    const result = profileNeed(
      [
        // Sooner, and busier — but it is not the worst event, so its count must not be reported.
        event({ eventDate: daysFrom(1), attendeeCount: 9 }),
        event({ eventDate: daysFrom(20), attendeeCount: 3 }),
      ],
      ASOF,
    );

    // Beyond the notice window with people going is `covered`; a day out with people going is
    // `covered` too — the worst here is the one ranked lowest, resolved by coverageRank.
    expect(result.worstUpcoming).toBe("covered");
    expect(result.soonestNeedOn).toBe(daysFrom(1));
    expect(result.worstUpcomingAttendees).toBe(9);
  });

  it("reports zero attendees on the worst event when that event is the empty one", () => {
    const result = profileNeed(
      [
        event({ eventDate: daysFrom(2), attendeeCount: 4 }),
        // Inside the window with nobody down — `uncovered`, the worst state there is.
        event({ eventDate: daysFrom(5), attendeeCount: 0 }),
      ],
      ASOF,
    );

    expect(result.worstUpcoming).toBe("uncovered");
    expect(result.soonestNeedOn).toBe(daysFrom(5));
    expect(result.worstUpcomingAttendees).toBe(0);
  });

  it("reports no attendees when there is nothing upcoming to count", () => {
    const result = profileNeed(
      [event({ eventDate: daysFrom(-4), attendeeCount: 6 })],
      ASOF,
    );

    expect(result.worstUpcoming).toBeNull();
    expect(result.worstUpcomingAttendees).toBe(0);
  });

  it("reports no signal at all when there is nothing coming up", () => {
    const result = profileNeed(
      [event({ eventDate: daysFrom(-10), attendeeCount: 1 })],
      ASOF,
    );

    expect(result.upcomingCount).toBe(0);
    expect(result.worstUpcoming).toBeNull();
    expect(result.soonestNeedOn).toBeNull();
  });

  it("keeps a cancelled upcoming event in the count and quiet in the state", () => {
    const result = profileNeed(
      [event({ eventDate: daysFrom(3), status: "cancelled" })],
      ASOF,
    );

    // Still part of the schedule — a cancelled game can be reinstated (EventList.eventCount).
    expect(result.upcomingCount).toBe(1);
    // And `not_expected` renders no badge at all, so the card is quiet rather than urgent.
    expect(result.worstUpcoming).toBe("not_expected");
  });
});

describe("profileNeed — the pastoral half", () => {
  it("counts past home games that were not cancelled", () => {
    const result = profileNeed(
      [
        event({ eventDate: daysFrom(-3) }),
        event({ eventDate: daysFrom(-10) }),
        event({ eventDate: daysFrom(5) }),
      ],
      ASOF,
    );

    expect(result.expectedPastCount).toBe(2);
  });

  // AWAY IS EXCLUDED BECAUSE AN EMPTY AWAY GAME IS THE DESIGNED OUTCOME (08-youth-activities.md
  // §Step 4). Its own case, so deleting the `away` condition alone goes red.
  it("does not count a past AWAY event with nobody at it", () => {
    const result = profileNeed(
      [
        event({ eventDate: daysFrom(-3), eventType: "away" }),
        event({ eventDate: daysFrom(-9), eventType: "away" }),
      ],
      ASOF,
    );

    expect(result.expectedPastCount).toBe(0);
    expect(result.unattendedRun).toBe(0);
    expect(result.lastAttendedOn).toBeNull();
  });

  // TBD IS EXCLUDED FOR A DIFFERENT REASON — nobody classified it, so nobody could have been
  // asked. Same assertions, its own case, so the two exclusions cannot be collapsed silently.
  it("does not count a past TBD event with nobody at it", () => {
    const result = profileNeed(
      [
        event({ eventDate: daysFrom(-3), eventType: "tbd" }),
        event({ eventDate: daysFrom(-9), eventType: "tbd" }),
      ],
      ASOF,
    );

    expect(result.expectedPastCount).toBe(0);
    expect(result.unattendedRun).toBe(0);
    expect(result.lastAttendedOn).toBeNull();
  });

  // THE FOURTH EXCLUSION, AND ITS OWN CASE for the reason `away` and `tbd` have theirs: deleting
  // the condition alone must go red. It is the SAME SENTENCE as the other three — this game could
  // not have been a chance to support them (migration 061).
  it("does not count a past home game the young person was NOT TAKING PART in", () => {
    const result = profileNeed(
      [
        event({ eventDate: daysFrom(-3), youthAttended: false }),
        event({ eventDate: daysFrom(-9), youthAttended: false }),
      ],
      ASOF,
    );

    expect(result.expectedPastCount).toBe(0);
    expect(result.unattendedRun).toBe(0);
    expect(result.lastAttendedOn).toBeNull();
  });

  it("does not count a cancelled past event, at any distance from the clock", () => {
    const near = profileNeed([event({ eventDate: daysFrom(-1), status: "cancelled" })], ASOF);
    const far = profileNeed([event({ eventDate: daysFrom(-200), status: "cancelled" })], ASOF);

    expect(near.expectedPastCount).toBe(0);
    expect(far.expectedPastCount).toBe(0);
  });

  it("excludes an unreadable date from both halves", () => {
    const result = profileNeed([event({ eventDate: "not a date" })], ASOF);

    expect(result.upcomingCount).toBe(0);
    expect(result.worstUpcoming).toBeNull();
    expect(result.expectedPastCount).toBe(0);
  });

  it("counts the unattended run back from the most recent and STOPS at the first attended one", () => {
    const result = profileNeed(
      [
        event({ eventDate: daysFrom(-2), attendeeCount: 0 }),
        event({ eventDate: daysFrom(-9), attendeeCount: 0 }),
        event({ eventDate: daysFrom(-16), attendeeCount: 1 }),
        // Older and empty — beyond the attended one, so outside the run.
        event({ eventDate: daysFrom(-23), attendeeCount: 0 }),
        event({ eventDate: daysFrom(-30), attendeeCount: 0 }),
      ],
      ASOF,
    );

    expect(result.expectedPastCount).toBe(5);
    expect(result.unattendedRun).toBe(2);
    expect(result.lastAttendedOn).toBe(daysFrom(-16));
  });

  it("reports a run of zero when somebody went to the most recent game", () => {
    const result = profileNeed(
      [
        event({ eventDate: daysFrom(-2), attendeeCount: 1 }),
        event({ eventDate: daysFrom(-9), attendeeCount: 0 }),
        event({ eventDate: daysFrom(-16), attendeeCount: 0 }),
      ],
      ASOF,
    );

    expect(result.unattendedRun).toBe(0);
    expect(result.lastAttendedOn).toBe(daysFrom(-2));
  });

  it("reports lastAttendedOn as null when nobody has ever been", () => {
    const result = profileNeed(
      [
        event({ eventDate: daysFrom(-2) }),
        event({ eventDate: daysFrom(-9) }),
        event({ eventDate: daysFrom(-16) }),
      ],
      ASOF,
    );

    expect(result.expectedPastCount).toBe(3);
    expect(result.lastAttendedOn).toBeNull();
    expect(result.unattendedRun).toBe(3);
  });
});

describe("describeSeasonNeed", () => {
  it("says nothing when no expected past event has been played", () => {
    expect(describeSeasonNeed(need({ expectedPastCount: 0, unattendedRun: 0 }))).toBeNull();
  });

  // A SEPARATE CASE from the one above. Somebody went to the most recent game, so there is no
  // story — even though the season may hold older gaps.
  it("says nothing when somebody went to the most recent game", () => {
    expect(
      describeSeasonNeed(
        need({ expectedPastCount: 6, unattendedRun: 0, lastAttendedOn: "2027-01-08T00:00:00Z" }),
      ),
    ).toBeNull();
  });

  it("names every game played when nobody has ever been — plural", () => {
    expect(
      describeSeasonNeed(need({ expectedPastCount: 4, unattendedRun: 4, lastAttendedOn: null })),
    ).toBe("Nobody has been to any of the 4 home games played so far.");
  });

  it("names every game played when nobody has ever been — singular", () => {
    expect(
      describeSeasonNeed(need({ expectedPastCount: 1, unattendedRun: 1, lastAttendedOn: null })),
    ).toBe("Nobody has been to the one home game played so far.");
  });

  it("names the run when somebody has been at some point — plural", () => {
    expect(
      describeSeasonNeed(
        need({ expectedPastCount: 7, unattendedRun: 3, lastAttendedOn: "2026-11-02T00:00:00Z" }),
      ),
    ).toBe("Nobody has been to the last 3 home games.");
  });

  // youth-b shipped "1 events updated". Both singular branches are spelled out for that reason.
  it("names the run when somebody has been at some point — singular", () => {
    expect(
      describeSeasonNeed(
        need({ expectedPastCount: 7, unattendedRun: 1, lastAttendedOn: "2027-01-08T00:00:00Z" }),
      ),
    ).toBe("Nobody has been to the last home game.");
  });
});

// ===========================================================================
// THE SUPPORT PERCENTAGE
// ===========================================================================

function supportEvent(overrides: Partial<SupportEvent> = {}): SupportEvent {
  return {
    eventType: "home",
    eventDate: daysFrom(-3),
    status: "upcoming",
    attendeeCount: 0,
    confirmedAttendeeCount: 0,
    youthAttended: null,
    ...overrides,
  };
}

// `closedAt: null` MEANS THE SEASON IS RUNNING, which is what every one of these fixtures is.
// The closed cases build their own profiles inline, beside the assertion, so a reader can see
// which half of the partition each test is about.
// A MEMBERSHIP RATHER THAN A PROFILE, since youth-j: a profile is a TEAM and youthNeed() now takes
// this young person's ROSTER ROWS. `activityName` and `closedAt` ride along from the team, which
// is where both still live.
//
// The window is left WIDE OPEN on these fixtures — both dates null, meaning the whole schedule —
// because every test in this block is about the arithmetic rather than about the window. The
// window's own boundaries are asserted in tests/lib/youthRoster.test.ts and in buildSupportEvents
// below, where the assertion is what the test is for.
function team(
  profileId: string,
  activityName: string,
  closedAt: string | null = null,
): { membership: RosterMember; activityName: string; closedAt: string | null } {
  return {
    membership: {
      rosterId: `roster-${profileId}`,
      profileId,
      memberId: "member-ethan",
      memberName: "Ethan Brooks",
      startedOn: null,
      endedOn: null,
    },
    activityName,
    closedAt,
  };
}

// activitySupport() still takes a PROFILE — an id and a name — because it is about one team's
// season and knows nothing about who is on it. The window is applied upstream, by
// buildSupportEvents(), which is what keeps that function unchanged by youth-j.
function profileOf(entry: {
  membership: RosterMember;
  activityName: string;
}): { id: string; activityName: string } {
  return { id: entry.membership.profileId, activityName: entry.activityName };
}

const BASKETBALL = team("profile-basketball", "Varsity basketball");
const TRACK = team("profile-track", "Track and field");

describe("activitySupport — the history half", () => {
  // THREE MEANINGS OF ONE COLUMN, ASSERTED SEPARATELY. `confirmed_attendance` is
  // `boolean | null`: true is "I went", false is "I did not go", and NULL is "nobody has said
  // either way". Only the first is support on a PAST game, and collapsing any two of them would
  // make the number report something nobody said.
  it("counts a past event where somebody CONFIRMED they went", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [supportEvent({ attendeeCount: 1, confirmedAttendeeCount: 1 })],
      ASOF,
    );

    expect(result.playedCount).toBe(1);
    expect(result.attendedCount).toBe(1);
    expect(result.supportedFraction).toBe(1);
  });

  it("does NOT count a leader who signed up and never answered", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      // Down for the game — `attendeeCount` is 1 — and `confirmed_attendance` still null.
      [supportEvent({ attendeeCount: 1, confirmedAttendeeCount: 0 })],
      ASOF,
    );

    expect(result.attendedCount).toBe(0);
    expect(result.supportedFraction).toBe(0);
  });

  it("does NOT count a leader who said they did not go", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      // A `false` on the row still leaves `confirmedAttendeeCount` at zero, which is the shape
      // YouthOverview builds with an explicit `=== true`.
      [supportEvent({ attendeeCount: 1, confirmedAttendeeCount: 0 })],
      ASOF,
    );

    expect(result.attendedCount).toBe(0);
  });

  it("counts one event once however many leaders confirmed", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [supportEvent({ attendeeCount: 3, confirmedAttendeeCount: 3 })],
      ASOF,
    );

    expect(result.playedCount).toBe(1);
    expect(result.attendedCount).toBe(1);
  });

  it("reports the fraction over every past game when nothing is coming up", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [
        supportEvent({ eventDate: daysFrom(-30), confirmedAttendeeCount: 1 }),
        supportEvent({ eventDate: daysFrom(-23) }),
        supportEvent({ eventDate: daysFrom(-16) }),
        supportEvent({ eventDate: daysFrom(-9) }),
      ],
      ASOF,
    );

    expect(result.playedCount).toBe(4);
    expect(result.attendedCount).toBe(1);
    expect(result.nextEvent).toBeNull();
    expect(result.countedCount).toBe(4);
    expect(result.supportedFraction).toBe(0.25);
    expect(result.profileId).toBe(BASKETBALL.membership.profileId);
    expect(result.activityName).toBe(BASKETBALL.activityName);
  });
});

// ===========================================================================
// THE PLAN HALF — THE NEXT EVENT, AND ONLY THE NEXT ONE
// ===========================================================================
// The horizon is "every past game plus the next one", decided 2026-08-29. Counting the whole
// remaining season would let an imported fixture list drag every percentage down for a reason
// nobody did anything about; counting only the past would make the number unactionable, since a
// leader could not move it by signing up for anything.
describe("activitySupport — the plan half", () => {
  it("adds the next upcoming home event to the denominator", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [
        supportEvent({ eventDate: daysFrom(-10), confirmedAttendeeCount: 1 }),
        supportEvent({ eventDate: daysFrom(5) }),
      ],
      ASOF,
    );

    expect(result.playedCount).toBe(1);
    expect(result.countedCount).toBe(2);
    expect(result.nextEvent).toEqual({ eventDate: daysFrom(5), planned: false });
    expect(result.supportedFraction).toBe(0.5);
  });

  // A FUTURE GAME IS JUDGED ON WHETHER ANYBODY IS DOWN FOR IT, not on confirmed attendance —
  // nobody can confirm a game that has not been played. This is the one place the metric asks a
  // different question of the same column, and it is the half a leader can act on today.
  it("counts the next event as supported when somebody is SIGNED UP, not confirmed", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [supportEvent({ eventDate: daysFrom(5), attendeeCount: 1, confirmedAttendeeCount: 0 })],
      ASOF,
    );

    expect(result.nextEvent).toEqual({ eventDate: daysFrom(5), planned: true });
    expect(result.supportedCount).toBe(1);
    expect(result.countedCount).toBe(1);
    expect(result.supportedFraction).toBe(1);
  });

  // THE HORIZON IS ONE EVENT, NOT THE SEASON. Three games are coming up and only the soonest is
  // counted — otherwise importing a fixture list would move every percentage on the page.
  it("counts ONLY the soonest upcoming event, whatever else is scheduled", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [
        supportEvent({ eventDate: daysFrom(-10), confirmedAttendeeCount: 1 }),
        supportEvent({ eventDate: daysFrom(20) }),
        supportEvent({ eventDate: daysFrom(4), attendeeCount: 2 }),
        supportEvent({ eventDate: daysFrom(30) }),
      ],
      ASOF,
    );

    expect(result.nextEvent).toEqual({ eventDate: daysFrom(4), planned: true });
    expect(result.countedCount).toBe(2);
    expect(result.supportedCount).toBe(2);
    expect(result.supportedFraction).toBe(1);
  });

  // Signing somebody up for the next game is the ONE move that changes this number today. If it
  // ever stops doing so, the plan half has been dropped.
  it("moves when somebody signs up for the next game", () => {
    const played = [
      supportEvent({ eventDate: daysFrom(-30), confirmedAttendeeCount: 1 }),
      supportEvent({ eventDate: daysFrom(-20) }),
      supportEvent({ eventDate: daysFrom(-10) }),
    ];

    const before = activitySupport(
      profileOf(BASKETBALL),
      [...played, supportEvent({ eventDate: daysFrom(5), attendeeCount: 0 })],
      ASOF,
    );
    const after = activitySupport(
      profileOf(BASKETBALL),
      [...played, supportEvent({ eventDate: daysFrom(5), attendeeCount: 1 })],
      ASOF,
    );

    expect(before.supportedFraction).toBe(0.25);
    expect(after.supportedFraction).toBe(0.5);
  });

  it("reports a plan and no history when the season has not started", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [supportEvent({ eventDate: daysFrom(5), attendeeCount: 0 })],
      ASOF,
    );

    expect(result.playedCount).toBe(0);
    expect(result.countedCount).toBe(1);
    expect(result.supportedFraction).toBe(0);
  });
});

// THE THREE EXCLUSIONS, ASSERTED SEPARATELY, ON **BOTH** SIDES OF THE CLOCK. They are three
// conditions for three different reasons, and asserting them as one case would let somebody delete
// two of them and keep a green suite. Both halves share `carriesCoverageExpectation()`, so each
// exclusion is asserted for the past half and again for the next-event half.
describe("activitySupport — the exclusions, past and upcoming", () => {
  it("excludes an AWAY game — no coverage expectation by design", () => {
    const result = activitySupport(profileOf(BASKETBALL), [supportEvent({ eventType: "away" })], ASOF);

    expect(result.playedCount).toBe(0);
    expect(result.supportedFraction).toBeNull();
  });

  it("excludes a `tbd` game — nobody classified it, so nobody could be asked", () => {
    const result = activitySupport(profileOf(BASKETBALL), [supportEvent({ eventType: "tbd" })], ASOF);

    expect(result.playedCount).toBe(0);
  });

  it("excludes a CANCELLED game — a game called off is not a game nobody went to", () => {
    const result = activitySupport(profileOf(BASKETBALL), [supportEvent({ status: "cancelled" })], ASOF);

    expect(result.playedCount).toBe(0);
  });

  it("excludes an unreadable date", () => {
    const result = activitySupport(profileOf(BASKETBALL), [supportEvent({ eventDate: "not a date" })], ASOF);

    expect(result.playedCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // THE FOURTH EXCLUSION (migration 061), AND IT LEAVES BOTH HALVES AT ONCE
  // ---------------------------------------------------------------------------
  it("excludes a past home game the young person was NOT TAKING PART in", () => {
    const counted = activitySupport(
      profileOf(BASKETBALL),
      [supportEvent({ eventDate: daysFrom(-3) })],
      ASOF,
    );
    const marked = activitySupport(
      profileOf(BASKETBALL),
      [supportEvent({ eventDate: daysFrom(-3), youthAttended: false })],
      ASOF,
    );

    // Both, so the change reads as a change rather than as a new fact.
    expect(counted.playedCount).toBe(1);
    expect(marked.playedCount).toBe(0);
    expect(marked.attendedCount).toBe(0);
    expect(marked.countedCount).toBe(0);
  });

  // THE HORIZON MOVES. `isExpectedNext()` is carriesCoverageExpectation() plus a side of the
  // clock, so the plan half follows the past half by construction — this is what a second copy of
  // the exclusion rule would break.
  it("moves the horizon to the game AFTER a marked next one", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [
        supportEvent({ eventDate: daysFrom(5), youthAttended: false, attendeeCount: 1 }),
        supportEvent({ eventDate: daysFrom(12), attendeeCount: 0 }),
      ],
      ASOF,
    );

    expect(result.nextEvent).toEqual({ eventDate: daysFrom(12), planned: false });
  });

  it("has NO next event when the only upcoming home game is marked", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [supportEvent({ eventDate: daysFrom(5), youthAttended: false, attendeeCount: 1 })],
      ASOF,
    );

    expect(result.nextEvent).toBeNull();
  });

  it("changes nothing for `true` or `null`", () => {
    for (const youthAttended of [true, null]) {
      const result = activitySupport(
        profileOf(BASKETBALL),
        [
          supportEvent({ eventDate: daysFrom(-3), confirmedAttendeeCount: 1, youthAttended }),
          supportEvent({ eventDate: daysFrom(5), youthAttended }),
        ],
        ASOF,
      );

      expect(result.playedCount).toBe(1);
      expect(result.countedCount).toBe(2);
      expect(result.supportedFraction).toBe(0.5);
    }
  });

  it("does not treat an upcoming AWAY game as the next event", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [supportEvent({ eventDate: daysFrom(5), eventType: "away", attendeeCount: 1 })],
      ASOF,
    );

    expect(result.nextEvent).toBeNull();
    expect(result.supportedFraction).toBeNull();
  });

  it("does not treat an upcoming CANCELLED game as the next event", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [
        supportEvent({ eventDate: daysFrom(2), status: "cancelled", attendeeCount: 1 }),
        supportEvent({ eventDate: daysFrom(9), attendeeCount: 0 }),
      ],
      ASOF,
    );

    // The cancelled one is skipped and the real next game is the one that counts.
    expect(result.nextEvent).toEqual({ eventDate: daysFrom(9), planned: false });
  });

  // ---------------------------------------------------------------------------
  // NULL IS NOT ZERO — THE SINGLE MOST VALUABLE ASSERTION ABOUT THIS FUNCTION
  // ---------------------------------------------------------------------------
  // Nothing played AND nothing coming up. Not neglect: there is nothing anybody could have turned
  // up to and nothing anybody can be asked to. 0% would sort them FIRST under "least supported"
  // (visits-f).
  it("reports NULL, not zero, when nothing is played and nothing is coming up", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [supportEvent({ eventType: "away" }), supportEvent({ status: "cancelled" })],
      ASOF,
    );

    expect(result.countedCount).toBe(0);
    expect(result.supportedFraction).toBeNull();
    expect(result.supportedFraction).not.toBe(0);
  });

  // ---------------------------------------------------------------------------
  // THE SAME RULE REACHED THROUGH THE NEW EXCLUSION — THE MOST LIKELY REGRESSION HERE
  // ---------------------------------------------------------------------------
  // A profile whose every home game is marked lands on countedCount === 0, which is an EM DASH.
  // Rendering 0% would put the one young person nobody could possibly have supported at the top of
  // "least supported", which is visits-f exactly.
  it("reports NULL, not zero, when every home game is marked as not taking part", () => {
    const result = activitySupport(
      profileOf(BASKETBALL),
      [
        supportEvent({ eventDate: daysFrom(-10), youthAttended: false }),
        supportEvent({ eventDate: daysFrom(-3), youthAttended: false }),
        supportEvent({ eventDate: daysFrom(5), youthAttended: false }),
      ],
      ASOF,
    );

    expect(result.playedCount).toBe(0);
    expect(result.countedCount).toBe(0);
    expect(result.nextEvent).toBeNull();
    expect(result.supportedFraction).toBeNull();
    expect(result.supportedFraction).not.toBe(0);
    // THE SENTENCE AND THE NUMBER FALL OUT OF THE SAME PASS (youth-f, fifth sighting).
    expect(describeActivitySupport(result)).toBeNull();
  });
});

describe("describeActivitySupport", () => {
  function support(overrides: Partial<ActivitySupport> = {}): ActivitySupport {
    return {
      profileId: BASKETBALL.membership.profileId,
      activityName: BASKETBALL.activityName,
      playedCount: 0,
      attendedCount: 0,
      nextEvent: null,
      supportedCount: 0,
      countedCount: 0,
      supportedFraction: null,
      ...overrides,
    };
  }

  it("says nothing when nothing is counted at all", () => {
    expect(describeActivitySupport(support())).toBeNull();
  });

  it("names the history alone when nothing is coming up — plural", () => {
    expect(
      describeActivitySupport(
        support({ playedCount: 8, attendedCount: 3, countedCount: 8, supportedCount: 3 }),
      ),
    ).toBe("Somebody went to 3 of 8 home games played.");
  });

  // youth-b shipped "1 events updated" and youth-c shipped four more copy defects. The singular
  // branch is spelled out for that reason.
  it("names the history alone when nothing is coming up — singular", () => {
    expect(
      describeActivitySupport(
        support({ playedCount: 1, attendedCount: 1, countedCount: 1, supportedCount: 1 }),
      ),
    ).toBe("Somebody went to 1 of 1 home game played.");
  });

  // THE TWO HALVES ARE NAMED SEPARATELY, because only one of them is a thing a leader can fix this
  // week. A blended "2 of 9" would hide the half that is still open.
  it("names the plan separately when nobody is down for the next one", () => {
    expect(
      describeActivitySupport(
        support({
          playedCount: 8,
          attendedCount: 1,
          nextEvent: { eventDate: "2027-01-20T00:00:00Z", planned: false },
          countedCount: 9,
          supportedCount: 1,
        }),
      ),
    ).toBe("Somebody went to 1 of 8 home games played, and nobody is down for the next one.");
  });

  it("names the plan separately when somebody is going to the next one", () => {
    expect(
      describeActivitySupport(
        support({
          playedCount: 8,
          attendedCount: 1,
          nextEvent: { eventDate: "2027-01-20T00:00:00Z", planned: true },
          countedCount: 9,
          supportedCount: 2,
        }),
      ),
    ).toBe("Somebody went to 1 of 8 home games played, and somebody is going to the next one.");
  });

  // NO "0 OF 0" OPENING. A season that has not started has no history to report, and saying so in
  // numbers would read as a failure nobody could have prevented.
  it("reports only the plan when the season has not started", () => {
    expect(
      describeActivitySupport(
        support({
          playedCount: 0,
          attendedCount: 0,
          nextEvent: { eventDate: "2027-01-20T00:00:00Z", planned: false },
          countedCount: 1,
          supportedCount: 0,
        }),
      ),
    ).toBe("No home games played yet, and nobody is down for the next one.");
  });
});


// ===========================================================================
// buildSupportEvents — ONE TEAM, ONE SCHEDULE, DIFFERENT NUMBERS PER YOUNG PERSON
// ===========================================================================
// THE HEADLINE BEHAVIOUR OF youth-j, AND IT WAS UNPROVABLE BEFORE IT. A profile was one young
// person's copy of a team, so "two team-mates from one set of event rows" was not a sentence this
// codebase could express.
//
// It is also the collapse of THREE construction sites into one. YouthOverview,
// /youth/history/[member_id]/page.tsx and the calendar each built a SupportEvent[] by hand;
// youth-e is what happens when two of three drift.

const WARD_ZONE = "America/Denver";

function sourceEvent(
  id: string,
  eventDate: string,
  overrides: Partial<{ eventType: "home" | "away" | "tbd"; status: "upcoming" | "cancelled" }> = {},
) {
  return {
    id,
    eventDate,
    eventType: overrides.eventType ?? ("home" as const),
    status: overrides.status ?? ("upcoming" as const),
  };
}

function rosterMember(overrides: Partial<RosterMember> = {}): RosterMember {
  return {
    rosterId: "r-1",
    profileId: "profile-basketball",
    memberId: "m-ethan",
    memberName: "Ethan Brooks",
    startedOn: null,
    endedOn: null,
    ...overrides,
  };
}

// Somebody confirmed they went. Enough to make a past home game count as supported.
const WENT = [{ confirmedAttendance: true }];

describe("buildSupportEvents", () => {
  it("includes every event when the window is open at both ends", () => {
    const events = [
      sourceEvent("e1", daysFrom(-20)),
      sourceEvent("e2", daysFrom(-10)),
      sourceEvent("e3", daysFrom(5)),
    ];

    const result = buildSupportEvents(
      rosterMember(),
      null,
      events,
      new Map(),
      new Map(),
      WARD_ZONE,
    );

    expect(result).toHaveLength(3);
  });

  // A YOUTH WHO JOINED IN JANUARY IS NOT MEASURED ON DECEMBER'S GAMES.
  it("excludes events BEFORE the youth joined", () => {
    const events = [sourceEvent("december", daysFrom(-40)), sourceEvent("january", daysFrom(-5))];

    const result = buildSupportEvents(
      // ASOF is 2027-01-15, so -5 days is the 10th and -40 is 6 December.
      rosterMember({ startedOn: "2027-01-01" }),
      null,
      events,
      new Map(),
      new Map(),
      WARD_ZONE,
    );

    expect(result.map((event) => event.eventDate)).toEqual([daysFrom(-5)]);
  });

  // AND ONE WHO LEFT IN FEBRUARY IS NOT MEASURED ON MARCH'S.
  it("excludes events AFTER the youth left", () => {
    const events = [sourceEvent("before", daysFrom(-20)), sourceEvent("after", daysFrom(20))];

    const result = buildSupportEvents(
      rosterMember({ endedOn: "2027-01-20" }),
      null,
      events,
      new Map(),
      new Map(),
      WARD_ZONE,
    );

    expect(result.map((event) => event.eventDate)).toEqual([daysFrom(-20)]);
  });

  // ---------------------------------------------------------------------------
  // TWO TEAM-MATES, ONE SET OF EVENT ROWS, TWO DIFFERENT ANSWERS
  // ---------------------------------------------------------------------------
  // The whole slice, in one assertion. Maya left mid-season, so her denominator stops there; Ethan
  // played on, and HIS DENOMINATOR DOES NOT MOVE because of hers.
  it("gives two team-mates different SupportEvent[] from ONE schedule", () => {
    const events = [
      sourceEvent("e1", daysFrom(-30)),
      sourceEvent("e2", daysFrom(-20)),
      sourceEvent("e3", daysFrom(-10)),
    ];

    const attendees = new Map([
      ["e1", WENT],
      ["e2", WENT],
      ["e3", WENT],
    ]);

    const ethan = buildSupportEvents(
      rosterMember({ memberId: "m-ethan" }),
      null,
      events,
      attendees,
      new Map(),
      WARD_ZONE,
    );

    const maya = buildSupportEvents(
      // Left before e3, which is 5 January by ASOF's clock.
      rosterMember({ memberId: "m-maya", endedOn: "2026-12-30" }),
      null,
      events,
      attendees,
      new Map(),
      WARD_ZONE,
    );

    expect(ethan).toHaveLength(3);
    expect(maya).toHaveLength(2);

    expect(activitySupport(profileOf(BASKETBALL), ethan, ASOF).countedCount).toBe(3);
    expect(activitySupport(profileOf(BASKETBALL), maya, ASOF).countedCount).toBe(2);
  });

  // MARKING ONE PLAYER ABSENT MOVES ONLY THAT PLAYER'S NUMBER. This is what migration 062d's
  // (youth, event) row exists for, and what a column on the event could never do.
  it("reads each young person's OWN participation row and nobody else's", () => {
    const events = [sourceEvent("e1", daysFrom(-20)), sourceEvent("e2", daysFrom(-10))];
    const participation: ReadonlyMap<string, readonly EventParticipation[]> = new Map([
      ["e1", [{ memberId: "m-ethan", takingPart: false }]],
    ]);

    const ethan = buildSupportEvents(
      rosterMember({ memberId: "m-ethan" }),
      null,
      events,
      new Map(),
      participation,
      WARD_ZONE,
    );

    const josh = buildSupportEvents(
      rosterMember({ memberId: "m-josh" }),
      null,
      events,
      new Map(),
      participation,
      WARD_ZONE,
    );

    expect(ethan.map((event) => event.youthAttended)).toEqual([false, null]);
    // JOSH IS UNTOUCHED. One team-mate being ill says nothing about the other.
    expect(josh.map((event) => event.youthAttended)).toEqual([null, null]);
  });

  // NO ROW MEANS NOBODY HAS SAID, and it must arrive as `null` rather than as `false`. Reading a
  // missing row as "did not take part" would take every unanswered game out of every denominator.
  it("maps a missing participation row to null, never to false", () => {
    const result = buildSupportEvents(
      rosterMember(),
      null,
      [sourceEvent("e1", daysFrom(-10))],
      new Map(),
      new Map(),
      WARD_ZONE,
    );

    expect(result[0].youthAttended).toBeNull();
  });

  // `=== true` EXPLICITLY on confirmedAttendance, which is the comment buildSupportEvents carries:
  // null means NOBODY HAS SAID EITHER WAY, and reading it as "did not go" would make an unanswered
  // game read as one somebody stayed away from.
  it("counts only leaders who actively said they went", () => {
    const result = buildSupportEvents(
      rosterMember(),
      null,
      [sourceEvent("e1", daysFrom(-10))],
      new Map([
        [
          "e1",
          [
            { confirmedAttendance: true },
            { confirmedAttendance: null },
            { confirmedAttendance: false },
          ],
        ],
      ]),
      new Map(),
      WARD_ZONE,
    );

    expect(result[0].attendeeCount).toBe(3);
    expect(result[0].confirmedAttendeeCount).toBe(1);
  });

  // THE THIRD CLAUSE OF THE SAME WINDOW. A closed season excludes its later games here too, which
  // is what makes /youth/history/[member_id] a snapshot of THEIR season rather than the team's.
  it("excludes events after the season was closed out", () => {
    const result = buildSupportEvents(
      rosterMember(),
      "2027-01-10T00:00:00.000Z",
      [sourceEvent("before", daysFrom(-20)), sourceEvent("after", daysFrom(-2))],
      new Map(),
      new Map(),
      WARD_ZONE,
    );

    expect(result.map((event) => event.eventDate)).toEqual([daysFrom(-20)]);
  });

  // A WINDOW THAT EXCLUDES EVERYTHING LEAVES `supportedFraction` NULL — an em dash, and NEVER 0%.
  // A zero would sort the one person nobody could possibly have supported to the top of "least
  // supported", which is visits-f exactly.
  it("leaves supportedFraction NULL when the window excludes everything", () => {
    const result = buildSupportEvents(
      rosterMember({ startedOn: "2027-06-01" }),
      null,
      [sourceEvent("e1", daysFrom(-20)), sourceEvent("e2", daysFrom(-10))],
      new Map(),
      new Map(),
      WARD_ZONE,
    );

    expect(result).toEqual([]);
    expect(activitySupport(profileOf(BASKETBALL), result, ASOF).supportedFraction).toBeNull();
  });
});

// ===========================================================================
// ONE YOUNG PERSON, ACROSS SEVERAL ACTIVITIES
// ===========================================================================

function eventsFor(
  entries: Record<string, readonly SupportEvent[]>,
): ReadonlyMap<string, readonly SupportEvent[]> {
  return new Map(Object.entries(entries));
}

const ETHAN = { id: "member-ethan", name: "Ethan Brooks" };

describe("youthNeed", () => {
  it("reports one ActivitySupport per profile, in activity-name order", () => {
    const result = youthNeed(
      ETHAN,
      // Handed in out of order on purpose: two renders of one card must not disagree about which
      // pill comes first.
      [TRACK, BASKETBALL],
      eventsFor({
        [BASKETBALL.membership.profileId]: [supportEvent({ confirmedAttendeeCount: 1 })],
        [TRACK.membership.profileId]: [supportEvent({ confirmedAttendeeCount: 1 })],
      }),
      ASOF,
    );

    expect(result.memberId).toBe(ETHAN.id);
    expect(result.memberName).toBe(ETHAN.name);
    expect(result.activities.map((activity) => activity.activityName)).toEqual([
      "Track and field",
      "Varsity basketball",
    ]);
  });

  it("takes lowestSupport as the MINIMUM across activities", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL, TRACK],
      eventsFor({
        // 1 of 4 = 0.25
        [BASKETBALL.membership.profileId]: [
          supportEvent({ eventDate: daysFrom(-30), confirmedAttendeeCount: 1 }),
          supportEvent({ eventDate: daysFrom(-23) }),
          supportEvent({ eventDate: daysFrom(-16) }),
          supportEvent({ eventDate: daysFrom(-9) }),
        ],
        // 3 of 4 = 0.75
        [TRACK.membership.profileId]: [
          supportEvent({ eventDate: daysFrom(-28), confirmedAttendeeCount: 1 }),
          supportEvent({ eventDate: daysFrom(-21), confirmedAttendeeCount: 2 }),
          supportEvent({ eventDate: daysFrom(-14), confirmedAttendeeCount: 1 }),
          supportEvent({ eventDate: daysFrom(-7) }),
        ],
      }),
      ASOF,
    );

    expect(result.lowestSupport).toBe(0.25);
  });

  // ---------------------------------------------------------------------------
  // AN ACTIVITY WITH NOTHING TO COUNT IS NOT A ZERO DRAGGING THE YOUNG PERSON UP
  // ---------------------------------------------------------------------------
  // The same trap as the null fraction, one level higher. A youth in two activities, one of which
  // has nothing played AND nothing coming up, is exactly as supported as the activity that has.
  //
  // "NOTHING TO COUNT" IS NARROWER THAN IT WAS. Before the horizon changed, an activity whose
  // season had not started was null. Now an upcoming home game IS counted, so this fixture has to
  // use an activity with no expectation on either side of the clock — here, an away fixture.
  it("ignores an activity with nothing to count rather than treating it as zero", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL, TRACK],
      eventsFor({
        [BASKETBALL.membership.profileId]: [supportEvent({ confirmedAttendeeCount: 1 })],
        // Away, so it carries no coverage expectation on either side.
        [TRACK.membership.profileId]: [supportEvent({ eventDate: daysFrom(10), eventType: "away" })],
      }),
      ASOF,
    );

    expect(result.activities.find((a) => a.profileId === TRACK.membership.profileId)?.supportedFraction).toBeNull();
    expect(result.lowestSupport).toBe(1);
  });

  // AND THE OPPOSITE, WHICH IS THE POINT OF THE PLAN HALF. An activity whose next home game has
  // nobody down for it is a genuine 0 — not missing data — and it MUST pull the young person to
  // the top of "least supported", because that is the one thing a leader can fix today.
  it("lets a next game with nobody down set lowestSupport to a real zero", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL, TRACK],
      eventsFor({
        [BASKETBALL.membership.profileId]: [supportEvent({ confirmedAttendeeCount: 1 })],
        [TRACK.membership.profileId]: [supportEvent({ eventDate: daysFrom(10), attendeeCount: 0 })],
      }),
      ASOF,
    );

    expect(result.activities.find((a) => a.profileId === TRACK.membership.profileId)?.supportedFraction).toBe(0);
    expect(result.lowestSupport).toBe(0);
  });

  it("reports lowestSupport as NULL when no activity has anything to count", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL, TRACK],
      eventsFor({
        [BASKETBALL.membership.profileId]: [supportEvent({ eventType: "away" })],
        [TRACK.membership.profileId]: [],
      }),
      ASOF,
    );

    expect(result.lowestSupport).toBeNull();
  });

  it("sums the upcoming count across every activity", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL, TRACK],
      eventsFor({
        [BASKETBALL.membership.profileId]: [supportEvent({ eventDate: daysFrom(3) })],
        [TRACK.membership.profileId]: [
          supportEvent({ eventDate: daysFrom(4) }),
          supportEvent({ eventDate: daysFrom(20) }),
        ],
      }),
      ASOF,
    );

    expect(result.upcomingCount).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // THE BADGE'S COUNT BELONGS TO THE EVENT THE BADGE'S STATE CAME FROM
  // ---------------------------------------------------------------------------
  // This is the defect the walk on 2026-08-29 found — every covered card reading "Covered · 0"
  // above an event card reading "Covered · 1". Asserted ACROSS TWO PROFILES, because that is the
  // arrangement in which the reduction could take three fields off three different rows.
  it("keeps worstUpcomingAttendees tied to the event worstUpcoming came from", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL, TRACK],
      eventsFor({
        // `covered` — somebody is going, and there are two of them.
        [BASKETBALL.membership.profileId]: [supportEvent({ eventDate: daysFrom(3), attendeeCount: 2 })],
        // `uncovered` — inside the notice window with nobody down. Worse, so it wins, and the
        // count that travels with it is its own zero rather than basketball's two.
        [TRACK.membership.profileId]: [supportEvent({ eventDate: daysFrom(4), attendeeCount: 0 })],
      }),
      ASOF,
    );

    expect(result.worstUpcoming).toBe("uncovered");
    expect(result.worstUpcomingAttendees).toBe(0);
    expect(result.soonestNeedOn).toBe(daysFrom(4));
  });

  it("carries the covered event's real count when covered is the worst there is", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL, TRACK],
      eventsFor({
        [BASKETBALL.membership.profileId]: [supportEvent({ eventDate: daysFrom(3), attendeeCount: 2 })],
        [TRACK.membership.profileId]: [supportEvent({ eventDate: daysFrom(4), attendeeCount: 5 })],
      }),
      ASOF,
    );

    expect(result.worstUpcoming).toBe("covered");
    expect(result.worstUpcomingAttendees).toBe(2);
  });

  it("reports no upcoming signal at all when nothing is coming up", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL],
      eventsFor({ [BASKETBALL.membership.profileId]: [supportEvent({ eventDate: daysFrom(-3) })] }),
      ASOF,
    );

    expect(result.worstUpcoming).toBeNull();
    expect(result.worstUpcomingAttendees).toBe(0);
    expect(result.soonestNeedOn).toBeNull();
  });

  it("renders a young person with no activities at all", () => {
    const result = youthNeed(ETHAN, [], eventsFor({}), ASOF);

    expect(result.activities).toEqual([]);
    expect(result.lowestSupport).toBeNull();
    expect(result.upcomingCount).toBe(0);
  });
});

// ===========================================================================
// A CLOSED SEASON LEAVES THE RANKING, AND THE YOUNG PERSON DOES NOT
// ===========================================================================
// ITER-028. `/youth` ranked young people on every past home game a profile had ever held, so a
// basketball season that finished in February kept contributing to Ethan's number in October.
// Migration 060's `closed_at` ends that — and the trap the whole item turns on is that ending it
// must NOT make anybody disappear.
//
// EVERY PROFILE IS HANDED TO youthNeed(), RUNNING AND CLOSED. The partition happens inside, so the
// pills, the percentage, the badge, the sort and the "Nothing running" sentence come out of one
// pass. A caller that pre-filtered would produce no group at all for a fully-closed young person,
// which is exactly the vanishing ITER-028 refuses.

const CLOSED_BASKETBALL = team(
  "profile-basketball",
  "Varsity basketball",
  "2027-01-01T00:00:00Z",
);

const CLOSED_TRACK = team("profile-track", "Track and field", "2026-11-20T00:00:00Z");

// ===========================================================================
// EVERY HOME GAME MARKED — THE END-TO-END SHAPE, THROUGH youthNeed AND THE COMPARATOR
// ===========================================================================
// The parts are asserted above; this is the join. It is the visits-f shape and the single most
// likely regression in this change, so it is proved through the SAME function the page calls and
// then through the comparator that orders the card.
describe("youthNeed — a season where the young person is taking part in nothing", () => {
  it("reports a NULL lowestSupport, never zero, and sorts last in BOTH directions", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL],
      eventsFor({
        [BASKETBALL.membership.profileId]: [
          supportEvent({ eventDate: daysFrom(-16), youthAttended: false }),
          supportEvent({ eventDate: daysFrom(-9), youthAttended: false }),
          supportEvent({ eventDate: daysFrom(6), youthAttended: false }),
        ],
      }),
      ASOF,
    );

    // THE SEASON IS STILL RUNNING and the pill is still there — what is absent is the NUMBER.
    // An em dash, never 0%.
    expect(result.hasRunning).toBe(true);
    expect(result.activities).toHaveLength(1);
    expect(result.lowestSupport).toBeNull();
    expect(result.lowestSupport).not.toBe(0);
    expect(describeActivitySupport(result.activities[0])).toBeNull();

    // Rendering 0% would put the one young person nobody could possibly have supported at the top
    // of "least supported". Both directions, because the null rule here is the deliberate
    // OPPOSITE of the `nobody_all_season` sort it replaced.
    const worst = youth("Zoe", { lowestSupport: 0 });
    expect(firstYouth("priority", true, result, worst)).toBe("Zoe");
    expect(firstYouth("priority", false, result, youth("Zoe", { lowestSupport: 1 }))).toBe(
      "Zoe",
    );
  });

  // `not_expected` ranks LAST in COVERAGE_STATES, so a marked upcoming game cannot outrank a real
  // one — no second rule was needed anywhere for that, and this is the assertion that says so.
  it("does not let a marked upcoming game outrank a genuinely uncovered one", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL],
      eventsFor({
        [BASKETBALL.membership.profileId]: [
          supportEvent({ eventDate: daysFrom(2), youthAttended: false, attendeeCount: 0 }),
          supportEvent({ eventDate: daysFrom(5), attendeeCount: 0 }),
        ],
      }),
      ASOF,
    );

    expect(result.worstUpcoming).toBe("uncovered");
    expect(result.soonestNeedOn).toBe(daysFrom(5));
  });
});

describe("youthNeed — closed seasons", () => {
  // Each of the three computations is asserted on its own, because they are three different reads
  // of `running` and somebody retuning one of them must not be able to keep a green suite.
  it("counts a closed season towards NOTHING it is ranked on", () => {
    const result = youthNeed(
      ETHAN,
      [CLOSED_BASKETBALL],
      eventsFor({
        [CLOSED_BASKETBALL.membership.profileId]: [
          // Eight played, one attended — 12.5%, which would lead "least supported" if it counted.
          supportEvent({ eventDate: daysFrom(-30), confirmedAttendeeCount: 1 }),
          supportEvent({ eventDate: daysFrom(-27) }),
          supportEvent({ eventDate: daysFrom(-24) }),
          supportEvent({ eventDate: daysFrom(-21) }),
          supportEvent({ eventDate: daysFrom(-18) }),
          supportEvent({ eventDate: daysFrom(-15) }),
          supportEvent({ eventDate: daysFrom(-12) }),
          supportEvent({ eventDate: daysFrom(-9) }),
          // And a game still to come, which would otherwise appear in upcomingCount and drive the
          // coverage badge.
          supportEvent({ eventDate: daysFrom(4), attendeeCount: 0 }),
        ],
      }),
      ASOF,
    );

    expect(result.activities).toEqual([]);
    expect(result.lowestSupport).toBeNull();
    expect(result.upcomingCount).toBe(0);
    expect(result.worstUpcoming).toBeNull();
    expect(result.worstUpcomingAttendees).toBe(0);
    expect(result.soonestNeedOn).toBeNull();
  });

  it("ranks a youth with one running and one closed season on the running one alone", () => {
    const result = youthNeed(
      ETHAN,
      [CLOSED_BASKETBALL, TRACK],
      eventsFor({
        // Closed, and dreadful — 0 of 4. If it leaked in, lowestSupport would be 0.
        [CLOSED_BASKETBALL.membership.profileId]: [
          supportEvent({ eventDate: daysFrom(-30) }),
          supportEvent({ eventDate: daysFrom(-23) }),
          supportEvent({ eventDate: daysFrom(-16) }),
          supportEvent({ eventDate: daysFrom(-9) }),
        ],
        // Running, and healthy — 2 of 2.
        [TRACK.membership.profileId]: [
          supportEvent({ eventDate: daysFrom(-8), confirmedAttendeeCount: 1 }),
          supportEvent({ eventDate: daysFrom(-4), confirmedAttendeeCount: 2 }),
        ],
      }),
      ASOF,
    );

    expect(result.activities.map((activity) => activity.activityName)).toEqual([
      "Track and field",
    ]);
    expect(result.lowestSupport).toBe(1);
    expect(result.closedActivities.map((a) => a.activityName)).toEqual(["Varsity basketball"]);
    expect(result.hasRunning).toBe(true);
  });

  // THE ASSERTION ITER-028 EXISTS FOR. A young person whose every season has finished must still
  // produce a YouthNeed, or /youth's grouping yields no card and they are gone from the ward.
  it("still produces a YouthNeed when every season is closed", () => {
    const result = youthNeed(
      ETHAN,
      [CLOSED_BASKETBALL, CLOSED_TRACK],
      eventsFor({
        [CLOSED_BASKETBALL.membership.profileId]: [supportEvent({ confirmedAttendeeCount: 1 })],
        [CLOSED_TRACK.membership.profileId]: [supportEvent({ confirmedAttendeeCount: 1 })],
      }),
      ASOF,
    );

    expect(result.memberId).toBe(ETHAN.id);
    expect(result.memberName).toBe(ETHAN.name);
    expect(result.hasRunning).toBe(false);
    // THE NAMES, NOT A COUNT. A card renders one pill per finished season, so losing the names
    // here would put defect 060-D1 back: a card with nothing on it naming the activity at all.
    expect(result.closedActivities.map((a) => a.activityName)).toEqual([
      "Track and field",
      "Varsity basketball",
    ]);
    expect(result.activities).toEqual([]);
    expect(result.lowestSupport).toBeNull();
  });

  it("reports closedCount as zero and hasRunning as true for an ordinary young person", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL, TRACK],
      eventsFor({ [BASKETBALL.membership.profileId]: [supportEvent()], [TRACK.membership.profileId]: [supportEvent()] }),
      ASOF,
    );

    expect(result.closedActivities).toEqual([]);
    expect(result.hasRunning).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // AND THEY SORT LAST IN **BOTH** DIRECTIONS — ASSERTED, NEVER ASSUMED
  // ---------------------------------------------------------------------------
  // It comes for free: `running` is empty, so `lowestSupport` is null, and compareYouth already
  // sorts null last both ways. NO BRANCH WAS ADDED FOR IT AND NONE SHOULD BE. But this module has
  // TWO null rules that look identical and are opposite — `nobody_all_season` sorted its null
  // FIRST — so the free behaviour is written down rather than trusted.
  it("sorts a fully-closed young person LAST in both directions", () => {
    const closedOut = youthNeed(
      ETHAN,
      [CLOSED_BASKETBALL],
      eventsFor({ [CLOSED_BASKETBALL.membership.profileId]: [supportEvent({ confirmedAttendeeCount: 1 })] }),
      ASOF,
    );

    const worst = youth("Zoe", { lowestSupport: 0 });
    const best = youth("Aaron", { lowestSupport: 1 });

    expect(compareYouth("priority", true, closedOut, worst)).toBeGreaterThan(0);
    expect(compareYouth("priority", false, closedOut, best)).toBeGreaterThan(0);
  });
});

describe("describeNothingRunning", () => {
  const closed = (...names: string[]) =>
    names.map((activityName, index) => ({ profileId: `p${index}`, activityName }));

  it("says nothing for a young person with no closed seasons", () => {
    expect(describeNothingRunning(youth("Ana", { hasRunning: true }))).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // NO COUNT IN THIS SENTENCE, AND THAT IS THE FIX RATHER THAN AN OMISSION
  // ---------------------------------------------------------------------------
  // It read "Nothing running. 2 closed seasons." until the walk on 2026-08-31 answered "does this
  // card read as deliberate?" with NO. The finished seasons are PILLS now, naming themselves, so
  // a count here would duplicate a list sitting directly above it — this codebase's oldest defect
  // (summariseCoverage, describeHouseholdForVisits, ITER-022).
  it("states the state, without counting what the pills already name", () => {
    expect(
      describeNothingRunning(
        youth("Ana", { hasRunning: false, closedActivities: closed("Concert choir") }),
      ),
    ).toBe("No activity running just now.");

    // AND IT DOES NOT MOVE WITH THE NUMBER, which is what makes it a state rather than a tally.
    expect(
      describeNothingRunning(
        youth("Ana", {
          hasRunning: false,
          closedActivities: closed("Concert choir", "Track and field"),
        }),
      ),
    ).toBe("No activity running just now.");
  });

  // That card shows its upcoming-event count in this slot instead, and its finished pills sit
  // beside its live ones needing no sentence at all.
  it("says nothing when a season is still running", () => {
    expect(
      describeNothingRunning(
        youth("Ana", { hasRunning: true, closedActivities: closed("Concert choir") }),
      ),
    ).toBeNull();
  });
});

// ===========================================================================
// THE HISTORY PAGE'S FROZEN NUMBER
// ===========================================================================
// /youth/history/[member_id] recomputes a closed season's final percentage with `closed_at` as the
// clock rather than storing it — ITER-028's one real design question, answered the way this module
// has answered every stored-versus-computed question: NOTHING IN THIS PROJECT REFRESHES ANYTHING,
// so a stored number goes stale and a computed one cannot.
//
// The number is frozen because its INPUT is frozen. Asserted by judging one season against two
// clocks a month apart — the shape a walk cannot check, because a walk happens on one day.

describe("activitySupport against a season's closing instant", () => {
  const CLOSED_ON = new Date("2027-01-01T00:00:00Z");

  const SEASON: SupportEvent[] = [
    supportEvent({ eventDate: "2026-12-04T02:30:00Z", confirmedAttendeeCount: 1 }),
    supportEvent({ eventDate: "2026-12-11T02:30:00Z" }),
    supportEvent({ eventDate: "2026-12-18T02:30:00Z", confirmedAttendeeCount: 2 }),
    supportEvent({ eventDate: "2026-12-27T02:30:00Z" }),
  ];

  it("returns the same value however long afterwards it is computed", () => {
    const atClosing = activitySupport(profileOf(BASKETBALL), SEASON, CLOSED_ON);
    const aMonthLater = activitySupport(profileOf(BASKETBALL), SEASON, CLOSED_ON);

    expect(atClosing.supportedFraction).toBe(0.5);
    expect(aMonthLater).toEqual(atClosing);
  });

  // ---------------------------------------------------------------------------
  // WHERE ITER-028 AND ITER-030 MEET — ASSERTED RATHER THAN ASSUMED
  // ---------------------------------------------------------------------------
  // `closed_at` removes a WHOLE PROFILE from the ranking; migration 061 removes AN EVENT from a
  // profile's arithmetic. They compose with no extra code, and the snapshot should say what was
  // true at the closing instant — absences included.
  it("excludes an absence from a season's frozen number too", () => {
    const withAnAbsence: SupportEvent[] = [
      supportEvent({ eventDate: "2026-12-04T02:30:00Z", confirmedAttendeeCount: 1 }),
      supportEvent({ eventDate: "2026-12-11T02:30:00Z" }),
      supportEvent({ eventDate: "2026-12-18T02:30:00Z", confirmedAttendeeCount: 2 }),
      supportEvent({ eventDate: "2026-12-27T02:30:00Z", youthAttended: false }),
    ];

    const frozen = activitySupport(profileOf(BASKETBALL), withAnAbsence, CLOSED_ON);

    // Three played rather than four, two of them attended — and the SAME instant the unmarked
    // season above is judged against, so the difference is the mark and nothing else.
    expect(frozen.playedCount).toBe(3);
    expect(frozen.attendedCount).toBe(2);
    expect(frozen.supportedFraction).toBeCloseTo(2 / 3, 10);
  });

  // AND IT DIFFERS FROM THE LIVE ANSWER, which is what makes the frozen one worth having: a
  // fixture the school feed published for February would otherwise still be moving the number
  // about long after anybody stopped playing.
  it("differs from the same season judged against a later clock", () => {
    const withAFutureFixture: SupportEvent[] = [
      ...SEASON,
      supportEvent({ eventDate: "2027-02-05T02:30:00Z", attendeeCount: 0 }),
    ];

    const frozen = activitySupport(profileOf(BASKETBALL), withAFutureFixture, CLOSED_ON);
    const live = activitySupport(
      profileOf(BASKETBALL),
      withAFutureFixture,
      new Date("2027-03-01T00:00:00Z"),
    );

    // At closing, the February game was the NEXT one: counted, and nobody down for it — 2 of 5.
    expect(frozen.playedCount).toBe(4);
    expect(frozen.supportedFraction).toBe(0.4);

    // A month after it was played it is history nobody attended, and the denominator is a
    // different five. The point is that the frozen value never moved with it.
    expect(live.playedCount).toBe(5);
    expect(live.supportedFraction).toBe(0.4);
    expect(frozen.nextEvent).not.toBeNull();
    expect(live.nextEvent).toBeNull();
  });
});

// ===========================================================================
// THE COMPARATOR — EVERY KEY ASSERTED ON ITS OWN
// ===========================================================================

function youth(memberName: string, overrides: Partial<YouthNeed> = {}): YouthNeed {
  return {
    memberId: `member-${memberName}`,
    memberName,
    activities: [],
    closedActivities: [],
    hasRunning: true,
    lowestSupport: null,
    upcomingCount: 0,
    worstUpcoming: null,
    worstUpcomingAttendees: 0,
    soonestNeedOn: null,
    ...overrides,
  };
}

// The comparator's contract is a number and its SIGN is the assertion. Naming the winner reads
// far better than `toBeLessThan(0)` scattered through a dozen cases.
function firstYouth(
  sort: YouthSort,
  ascending: boolean,
  left: YouthNeed,
  right: YouthNeed,
): string {
  const order = compareYouth(sort, ascending, left, right);
  if (order === 0) return "tie";
  return order < 0 ? left.memberName : right.memberName;
}

describe("compareYouth — priority", () => {
  it("puts the LEAST supported first when ascending", () => {
    const neglected = youth("Ana", { lowestSupport: 0.125 });
    const supported = youth("Ben", { lowestSupport: 0.75 });

    expect(firstYouth("priority", true, supported, neglected)).toBe("Ana");
  });

  it("puts the MOST supported first when descending", () => {
    const neglected = youth("Ana", { lowestSupport: 0.125 });
    const supported = youth("Ben", { lowestSupport: 0.75 });

    expect(firstYouth("priority", false, neglected, supported)).toBe("Ben");
  });

  // ---------------------------------------------------------------------------
  // A MISSING PERCENTAGE SORTS LAST IN **BOTH** DIRECTIONS
  // ---------------------------------------------------------------------------
  // THE SINGLE MOST VALUABLE ASSERTION IN THIS FILE, and it is the DELIBERATE OPPOSITE of the
  // sort it replaced: `nobody_all_season` sorted `lastAttendedOn: null` FIRST, because there null
  // meant "nobody has EVER been" — a real and strong signal. Here null means NO HOME GAMES HAVE
  // BEEN PLAYED, which is no data at all, and VisitProgressTable.compareNullable()'s rule applies:
  // "reversing the nulls with the direction is the behaviour that makes a table feel scrambled."
  //
  // The two rules look identical and are opposite, so both directions are asserted explicitly.
  it("sorts a young person with NO games played LAST when ascending", () => {
    const noData = youth("Ana", { lowestSupport: null });
    const worst = youth("Zoe", { lowestSupport: 0 });

    expect(firstYouth("priority", true, noData, worst)).toBe("Zoe");
  });

  it("sorts a young person with NO games played LAST when descending too", () => {
    const noData = youth("Ana", { lowestSupport: null });
    const best = youth("Zoe", { lowestSupport: 1 });

    expect(firstYouth("priority", false, noData, best)).toBe("Zoe");
  });

  // A ZERO IS A REAL SCORE AND MUST NOT BEHAVE LIKE THE NULL. Somebody whose home games have all
  // been played and none attended is the person this sort exists to surface.
  it("puts a genuine 0% FIRST when ascending, unlike a null", () => {
    const nobodyWent = youth("Ana", { lowestSupport: 0 });
    const halfWent = youth("Ben", { lowestSupport: 0.5 });

    expect(firstYouth("priority", true, halfWent, nobodyWent)).toBe("Ana");
  });

  it("orders two no-data young people by name, ascending, in both directions", () => {
    const ana = youth("Ana");
    const ben = youth("Ben");

    expect(firstYouth("priority", true, ben, ana)).toBe("Ana");
    expect(firstYouth("priority", false, ben, ana)).toBe("Ana");
  });

  // THE TIE-BREAK IS NEVER REVERSED BY THE DIRECTION. A reader changing one question and seeing
  // two answers move is what makes a list feel scrambled, and no information is gained by it.
  it("breaks a tie on name ASCENDING whichever direction is chosen", () => {
    const ana = youth("Ana", { lowestSupport: 0.5 });
    const ben = youth("Ben", { lowestSupport: 0.5 });

    expect(firstYouth("priority", true, ben, ana)).toBe("Ana");
    expect(firstYouth("priority", false, ben, ana)).toBe("Ana");
  });
});

describe("compareYouth — name", () => {
  it("sorts A to Z when ascending", () => {
    expect(firstYouth("name", true, youth("Zoe"), youth("Ana"))).toBe("Ana");
  });

  it("sorts Z to A when descending", () => {
    expect(firstYouth("name", false, youth("Ana"), youth("Zoe"))).toBe("Zoe");
  });

  // PRIORITY IS IGNORED ENTIRELY — asserted with two youths whose percentages point the other
  // way, so a comparator that leaked a support key into this branch would fail.
  it("ignores the support percentage completely", () => {
    const worstButLast = youth("Zoe", { lowestSupport: 0 });
    const bestButFirst = youth("Ana", { lowestSupport: 1 });

    expect(firstYouth("name", true, worstButLast, bestButFirst)).toBe("Ana");
    expect(firstYouth("name", false, bestButFirst, worstButLast)).toBe("Zoe");
  });

  // A null percentage carries NO weight here at all — it is not pushed last, because `name` is
  // not asking about support.
  it("does not push a no-data young person last", () => {
    expect(firstYouth("name", true, youth("Zoe", { lowestSupport: 0.5 }), youth("Ana"))).toBe(
      "Ana",
    );
  });
});
