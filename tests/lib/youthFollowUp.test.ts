import { describe, expect, it } from "vitest";
import {
  followUpState,
  isFollowUpWritable,
  summariseFollowUp,
  type FollowUpInput,
} from "@/lib/youth/followUp";
import type { FollowUpState } from "@/types/domain";

// Pure. No database, no client, no clock — the point of keeping the arithmetic out of the panel
// and out of the route.
//
// What these pin is the set of decisions the panel can get quietly wrong: a cancelled game
// generating a prompt at some distance from the clock but not another, a game in progress being
// treated as finished, a leader being asked for an account of something they never said they were
// going to, and — the one that carries the most weight on a tile — a confirmed non-attendance
// collapsing into an ordinary logged follow-up.

const NOW = new Date("2027-01-15T12:00:00Z");

const THREE_DAYS_OUT = "2027-01-18T19:30:00Z";
const THREE_DAYS_PAST = "2027-01-12T19:30:00Z";

function input(overrides: Partial<FollowUpInput> = {}): FollowUpInput {
  return {
    eventDate: THREE_DAYS_PAST,
    status: "upcoming",
    isAttendee: true,
    hasLog: false,
    confirmedAttendance: null,
    ...overrides,
  };
}

describe("followUpState", () => {
  // ---------------------------------------------------------------------------
  // CANCELLED, BEFORE THE CLOCK. BOTH DIRECTIONS, WHICH IS THE WHOLE POINT.
  // ---------------------------------------------------------------------------
  // Testing only the past case would pass against a function that consulted the clock first and
  // happened to answer correctly today. Asserting both distances is what pins the ORDER of the
  // branches rather than the answer on the day the test was written.
  describe("a cancelled event", () => {
    it("is not due three days in the future", () => {
      expect(
        followUpState(input({ status: "cancelled", eventDate: THREE_DAYS_OUT }), NOW),
      ).toBe("not_due");
    });

    it("is not due three days in the past", () => {
      expect(
        followUpState(input({ status: "cancelled", eventDate: THREE_DAYS_PAST }), NOW),
      ).toBe("not_due");
    });

    // A cancelled game somebody already wrote about keeps its follow-up readable elsewhere; what
    // it must never do is ask for another one.
    it("is not due even when the reader has already written a follow-up", () => {
      expect(
        followUpState(
          input({ status: "cancelled", eventDate: THREE_DAYS_PAST, hasLog: true }),
          NOW,
        ),
      ).toBe("not_due");
    });
  });

  it("is not due for an unreadable date", () => {
    expect(followUpState(input({ eventDate: "not a date" }), NOW)).toBe("not_due");
  });

  // ---------------------------------------------------------------------------
  // THE PAST/FUTURE BOUNDARY, FROM BOTH SIDES
  // ---------------------------------------------------------------------------
  // "Past" is the START instant, because this schema has no duration column. A game that kicked
  // off a minute ago is already asking for an account of itself, and that limitation is named in
  // both this module's header and coverage.ts's rather than left to be read as a bug.
  describe("the past/future boundary", () => {
    it("is not due one minute before the event starts", () => {
      expect(
        followUpState(input({ eventDate: "2027-01-15T12:01:00Z" }), NOW),
      ).toBe("not_due");
    });

    it("is awaiting one minute after the event starts", () => {
      expect(followUpState(input({ eventDate: "2027-01-15T11:59:00Z" }), NOW)).toBe(
        "awaiting",
      );
    });

    it("is awaiting at exactly the start instant", () => {
      expect(followUpState(input({ eventDate: NOW.toISOString() }), NOW)).toBe("awaiting");
    });
  });

  describe("once a follow-up exists", () => {
    it("reads did_not_attend when the author confirmed they did not go", () => {
      expect(
        followUpState(input({ hasLog: true, confirmedAttendance: false }), NOW),
      ).toBe("did_not_attend");
    });

    it("reads logged when the author confirmed they went", () => {
      expect(followUpState(input({ hasLog: true, confirmedAttendance: true }), NOW)).toBe(
        "logged",
      );
    });

    // NULL IS NOT FALSE. Never having answered is not the same as saying no, and only the second
    // earns a warning-toned label on a tile.
    it("reads logged when the author never said either way", () => {
      expect(followUpState(input({ hasLog: true, confirmedAttendance: null }), NOW)).toBe(
        "logged",
      );
    });

    // A follow-up from somebody who was never down for the event is still a follow-up, and the
    // state has to say so — the attendee branch is below the log branch for exactly this.
    it("reads logged for a non-attendee who wrote one anyway", () => {
      expect(
        followUpState(input({ isAttendee: false, hasLog: true }), NOW),
      ).toBe("logged");
    });
  });

  // Nobody is WAITING on somebody who never said they were going. It does not stop them writing
  // one — decision 5, enforced nowhere but in the panel's choice of what to list.
  it("is not due for a past event the reader was never down for", () => {
    expect(followUpState(input({ isAttendee: false }), NOW)).toBe("not_due");
  });

  it("is awaiting for a past event the reader was down for and has not written about", () => {
    expect(followUpState(input(), NOW)).toBe("awaiting");
  });
});

// ---------------------------------------------------------------------------
// `isFollowUpWritable` AND `followUpState` ANSWER DIFFERENT QUESTIONS
// ---------------------------------------------------------------------------
// The one case where they diverge is the whole reason the first function exists: a past game the
// reader was never down for is `not_due` (nobody is waiting on them) and STILL WRITABLE (any
// `youth_activities.log` holder may file their own account — decision 5). EventList gates its
// control on the second, not the first, and a component that mixed them up would hide the button
// from precisely the person whose account is worth having.
describe("isFollowUpWritable", () => {
  it("is true for a past event the reader was never down for, which reads not_due", () => {
    const past = input({ isAttendee: false });

    expect(followUpState(past, NOW)).toBe("not_due");
    expect(isFollowUpWritable(past, NOW)).toBe(true);
  });

  it("is true for a past event that has already been logged", () => {
    expect(isFollowUpWritable(input({ hasLog: true }), NOW)).toBe(true);
  });

  it("is false for a cancelled event at any distance from the clock", () => {
    expect(
      isFollowUpWritable({ status: "cancelled", eventDate: THREE_DAYS_OUT }, NOW),
    ).toBe(false);
    expect(
      isFollowUpWritable({ status: "cancelled", eventDate: THREE_DAYS_PAST }, NOW),
    ).toBe(false);
  });

  it("is false for an event still to come", () => {
    expect(isFollowUpWritable({ status: "upcoming", eventDate: THREE_DAYS_OUT }, NOW)).toBe(
      false,
    );
  });

  it("is false for an unreadable date", () => {
    expect(isFollowUpWritable({ status: "upcoming", eventDate: "not a date" }, NOW)).toBe(
      false,
    );
  });

  it("is true at exactly the start instant", () => {
    expect(
      isFollowUpWritable({ status: "upcoming", eventDate: NOW.toISOString() }, NOW),
    ).toBe(true);
  });
});

describe("summariseFollowUp", () => {
  // Every state present including the zeroes, so a caller reading `summary.awaiting` never has to
  // decide what `undefined` meant — the rule summariseCoverage() follows.
  it("returns a zero for every state when given nothing", () => {
    expect(summariseFollowUp([])).toEqual({
      awaiting: 0,
      did_not_attend: 0,
      logged: 0,
      not_due: 0,
    });
  });

  it("counts each state", () => {
    const states: FollowUpState[] = [
      "awaiting",
      "awaiting",
      "logged",
      "did_not_attend",
      "not_due",
      "not_due",
      "not_due",
    ];

    expect(summariseFollowUp(states)).toEqual({
      awaiting: 2,
      did_not_attend: 1,
      logged: 1,
      not_due: 3,
    });
  });
});
