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
  compareYouth,
  describeActivitySupport,
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
    ...overrides,
  };
}

const BASKETBALL = { id: "profile-basketball", activityName: "Varsity basketball" };
const TRACK = { id: "profile-track", activityName: "Track and field" };

describe("activitySupport — the history half", () => {
  // THREE MEANINGS OF ONE COLUMN, ASSERTED SEPARATELY. `confirmed_attendance` is
  // `boolean | null`: true is "I went", false is "I did not go", and NULL is "nobody has said
  // either way". Only the first is support on a PAST game, and collapsing any two of them would
  // make the number report something nobody said.
  it("counts a past event where somebody CONFIRMED they went", () => {
    const result = activitySupport(
      BASKETBALL,
      [supportEvent({ attendeeCount: 1, confirmedAttendeeCount: 1 })],
      ASOF,
    );

    expect(result.playedCount).toBe(1);
    expect(result.attendedCount).toBe(1);
    expect(result.supportedFraction).toBe(1);
  });

  it("does NOT count a leader who signed up and never answered", () => {
    const result = activitySupport(
      BASKETBALL,
      // Down for the game — `attendeeCount` is 1 — and `confirmed_attendance` still null.
      [supportEvent({ attendeeCount: 1, confirmedAttendeeCount: 0 })],
      ASOF,
    );

    expect(result.attendedCount).toBe(0);
    expect(result.supportedFraction).toBe(0);
  });

  it("does NOT count a leader who said they did not go", () => {
    const result = activitySupport(
      BASKETBALL,
      // A `false` on the row still leaves `confirmedAttendeeCount` at zero, which is the shape
      // YouthOverview builds with an explicit `=== true`.
      [supportEvent({ attendeeCount: 1, confirmedAttendeeCount: 0 })],
      ASOF,
    );

    expect(result.attendedCount).toBe(0);
  });

  it("counts one event once however many leaders confirmed", () => {
    const result = activitySupport(
      BASKETBALL,
      [supportEvent({ attendeeCount: 3, confirmedAttendeeCount: 3 })],
      ASOF,
    );

    expect(result.playedCount).toBe(1);
    expect(result.attendedCount).toBe(1);
  });

  it("reports the fraction over every past game when nothing is coming up", () => {
    const result = activitySupport(
      BASKETBALL,
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
    expect(result.profileId).toBe(BASKETBALL.id);
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
      BASKETBALL,
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
      BASKETBALL,
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
      BASKETBALL,
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
      BASKETBALL,
      [...played, supportEvent({ eventDate: daysFrom(5), attendeeCount: 0 })],
      ASOF,
    );
    const after = activitySupport(
      BASKETBALL,
      [...played, supportEvent({ eventDate: daysFrom(5), attendeeCount: 1 })],
      ASOF,
    );

    expect(before.supportedFraction).toBe(0.25);
    expect(after.supportedFraction).toBe(0.5);
  });

  it("reports a plan and no history when the season has not started", () => {
    const result = activitySupport(
      BASKETBALL,
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
    const result = activitySupport(BASKETBALL, [supportEvent({ eventType: "away" })], ASOF);

    expect(result.playedCount).toBe(0);
    expect(result.supportedFraction).toBeNull();
  });

  it("excludes a `tbd` game — nobody classified it, so nobody could be asked", () => {
    const result = activitySupport(BASKETBALL, [supportEvent({ eventType: "tbd" })], ASOF);

    expect(result.playedCount).toBe(0);
  });

  it("excludes a CANCELLED game — a game called off is not a game nobody went to", () => {
    const result = activitySupport(BASKETBALL, [supportEvent({ status: "cancelled" })], ASOF);

    expect(result.playedCount).toBe(0);
  });

  it("excludes an unreadable date", () => {
    const result = activitySupport(BASKETBALL, [supportEvent({ eventDate: "not a date" })], ASOF);

    expect(result.playedCount).toBe(0);
  });

  it("does not treat an upcoming AWAY game as the next event", () => {
    const result = activitySupport(
      BASKETBALL,
      [supportEvent({ eventDate: daysFrom(5), eventType: "away", attendeeCount: 1 })],
      ASOF,
    );

    expect(result.nextEvent).toBeNull();
    expect(result.supportedFraction).toBeNull();
  });

  it("does not treat an upcoming CANCELLED game as the next event", () => {
    const result = activitySupport(
      BASKETBALL,
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
      BASKETBALL,
      [supportEvent({ eventType: "away" }), supportEvent({ status: "cancelled" })],
      ASOF,
    );

    expect(result.countedCount).toBe(0);
    expect(result.supportedFraction).toBeNull();
    expect(result.supportedFraction).not.toBe(0);
  });
});

describe("describeActivitySupport", () => {
  function support(overrides: Partial<ActivitySupport> = {}): ActivitySupport {
    return {
      profileId: BASKETBALL.id,
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
        [BASKETBALL.id]: [supportEvent({ confirmedAttendeeCount: 1 })],
        [TRACK.id]: [supportEvent({ confirmedAttendeeCount: 1 })],
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
        [BASKETBALL.id]: [
          supportEvent({ eventDate: daysFrom(-30), confirmedAttendeeCount: 1 }),
          supportEvent({ eventDate: daysFrom(-23) }),
          supportEvent({ eventDate: daysFrom(-16) }),
          supportEvent({ eventDate: daysFrom(-9) }),
        ],
        // 3 of 4 = 0.75
        [TRACK.id]: [
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
        [BASKETBALL.id]: [supportEvent({ confirmedAttendeeCount: 1 })],
        // Away, so it carries no coverage expectation on either side.
        [TRACK.id]: [supportEvent({ eventDate: daysFrom(10), eventType: "away" })],
      }),
      ASOF,
    );

    expect(result.activities.find((a) => a.profileId === TRACK.id)?.supportedFraction).toBeNull();
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
        [BASKETBALL.id]: [supportEvent({ confirmedAttendeeCount: 1 })],
        [TRACK.id]: [supportEvent({ eventDate: daysFrom(10), attendeeCount: 0 })],
      }),
      ASOF,
    );

    expect(result.activities.find((a) => a.profileId === TRACK.id)?.supportedFraction).toBe(0);
    expect(result.lowestSupport).toBe(0);
  });

  it("reports lowestSupport as NULL when no activity has anything to count", () => {
    const result = youthNeed(
      ETHAN,
      [BASKETBALL, TRACK],
      eventsFor({
        [BASKETBALL.id]: [supportEvent({ eventType: "away" })],
        [TRACK.id]: [],
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
        [BASKETBALL.id]: [supportEvent({ eventDate: daysFrom(3) })],
        [TRACK.id]: [
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
        [BASKETBALL.id]: [supportEvent({ eventDate: daysFrom(3), attendeeCount: 2 })],
        // `uncovered` — inside the notice window with nobody down. Worse, so it wins, and the
        // count that travels with it is its own zero rather than basketball's two.
        [TRACK.id]: [supportEvent({ eventDate: daysFrom(4), attendeeCount: 0 })],
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
        [BASKETBALL.id]: [supportEvent({ eventDate: daysFrom(3), attendeeCount: 2 })],
        [TRACK.id]: [supportEvent({ eventDate: daysFrom(4), attendeeCount: 5 })],
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
      eventsFor({ [BASKETBALL.id]: [supportEvent({ eventDate: daysFrom(-3) })] }),
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
// THE COMPARATOR — EVERY KEY ASSERTED ON ITS OWN
// ===========================================================================

function youth(memberName: string, overrides: Partial<YouthNeed> = {}): YouthNeed {
  return {
    memberId: `member-${memberName}`,
    memberName,
    activities: [],
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
