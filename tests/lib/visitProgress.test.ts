import { describe, expect, it } from "vitest";
import { parseDateOnly, type DateOnly } from "@/lib/calendar/dates";
import type { HouseholdWithMembers, Member } from "@/lib/roster/queries";
import {
  buildVisitProgress,
  isVisitableHousehold,
  resolveCadenceMonths,
  selectActiveGoal,
} from "@/lib/visits/progress";
import type { VisitGoal, VisitLogWithContext } from "@/lib/visits/queries";
import type { MemberStatus } from "@/types/domain";

// PURE, against hand-built fixtures. buildVisitProgress() takes already-fetched data precisely so
// this suite needs no database — the denominator is the one number on the dashboard a ward has to
// be able to trust, and it should not be provable only over a network to a shared project.
//
// ---------------------------------------------------------------------------------------------
// THE ASSERTION THIS FILE EXISTS FOR
// ---------------------------------------------------------------------------------------------
// listHouseholds() filters the members it ATTACHES, not the households it RETURNS. A household
// whose people have all moved out comes back present with `members: []`, so `households.length`
// counts houses nobody can visit and holds a ward's progress down forever. Every "absent from the
// denominator" case below is that bug, in one of its shapes.

const PERIOD_START: DateOnly = "2026-01-01";
const PERIOD_END: DateOnly = "2026-12-31";

const GOAL: VisitGoal = {
  id: "goal-1",
  orgId: "org-eq",
  title: "Visit every household this year",
  targetType: "all_households",
  cadence: "annual",
  cadenceMonths: null,
  goalPeriodStart: PERIOD_START,
  goalPeriodEnd: PERIOD_END,
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

let memberCounter = 0;

function member(status: MemberStatus, householdId: string): Member {
  memberCounter += 1;
  return {
    id: `member-${memberCounter}`,
    householdId,
    firstName: "A",
    lastName: `Person${memberCounter}`,
    category: "adult",
    gender: null,
    status,
    phone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

// The fixture mirrors what listHouseholds() ACTUALLY returns: the household is always present,
// and the status filter has already been applied to `members`. A fixture that dropped the
// household instead would be testing a data layer this app does not have.
function household(
  id: string,
  familyName: string,
  attachedMemberStatuses: MemberStatus[],
): HouseholdWithMembers {
  return {
    id,
    familyName,
    address: null,
    latitude: null,
    longitude: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    // DEFAULT_MEMBER_STATUSES is ["active"], so only active members are ever attached.
    members: attachedMemberStatuses
      .filter((status) => status === "active")
      .map((status) => member(status, id)),
  };
}

let logCounter = 0;

function log(
  householdId: string,
  visitDate: DateOnly,
  outcome: "completed" | "attempted",
  conductedByLabel: string | null = "Miguel Cortez",
): VisitLogWithContext {
  logCounter += 1;
  return {
    id: `log-${logCounter}`,
    orgId: "org-eq",
    householdId,
    recordedBy: "user-1",
    visitDate,
    visitType: "in_home",
    outcome,
    arrangement: "drop_in",
    sharedNotes: null,
    flaggedForWardCouncil: false,
    flagSentAt: null,
    createdAt: `${visitDate}T00:00:00.000Z`,
    householdName: null,
    recordedByName: "Peter Nakamura",
    participants: [],
    conductedByLabel,
  };
}

function build(
  households: HouseholdWithMembers[],
  logs: VisitLogWithContext[],
  asOf: DateOnly = "2026-06-01",
  goal: VisitGoal | null = GOAL,
) {
  return buildVisitProgress({
    orgId: "org-eq",
    households,
    logs,
    goal,
    asOf: parseDateOnly(asOf),
  });
}

function rowFor(progress: ReturnType<typeof build>, householdId: string) {
  const row = progress.rows.find((candidate) => candidate.householdId === householdId);
  if (row === undefined) throw new Error(`No row for ${householdId}`);
  return row;
}

describe("the denominator", () => {
  it("excludes a household whose members have all moved out", () => {
    const progress = build(
      [
        household("h-active", "Brooks", ["active"]),
        household("h-moved", "Departed", ["moved_out", "moved_out"]),
      ],
      [],
    );

    expect(progress.banner?.total).toBe(1);
    expect(progress.rows.map((row) => row.householdId)).toEqual(["h-active"]);
  });

  it("excludes a household whose members are all do_not_contact", () => {
    const progress = build(
      [
        household("h-active", "Brooks", ["active"]),
        household("h-dnc", "Quiet", ["do_not_contact"]),
      ],
      [],
    );

    expect(progress.banner?.total).toBe(1);
    expect(progress.rows.map((row) => row.householdId)).toEqual(["h-active"]);
  });

  it("excludes a household with no members at all", () => {
    const progress = build(
      [household("h-active", "Brooks", ["active"]), household("h-empty", "Empty", [])],
      [],
    );

    expect(progress.banner?.total).toBe(1);
  });

  // One active member is enough, and one household is ONE — not one per person living in it.
  it("counts a household with one active and two moved-out members exactly once", () => {
    const progress = build(
      [household("h-mixed", "Mixed", ["active", "moved_out", "moved_out"])],
      [],
    );

    expect(progress.banner?.total).toBe(1);
    expect(progress.rows).toHaveLength(1);
  });

  it("keeps remaining equal to total minus visited on every shape", () => {
    const progress = build(
      [
        household("h-1", "One", ["active"]),
        household("h-2", "Two", ["active"]),
        household("h-3", "Three", ["active"]),
        household("h-gone", "Gone", ["moved_out"]),
      ],
      [log("h-1", "2026-02-01", "completed"), log("h-2", "2026-03-01", "completed")],
    );

    expect(progress.banner).toEqual({ visitedCount: 2, total: 3, remaining: 1 });
    expect(progress.banner!.remaining).toBe(
      progress.banner!.total - progress.banner!.visitedCount,
    );
  });

  it("is exported as one predicate, so the page's picker and this count cannot drift", () => {
    expect(isVisitableHousehold({ members: [] })).toBe(false);
    expect(isVisitableHousehold({ members: ["someone"] })).toBe(true);
  });
});

describe("the period and the columns", () => {
  // The distinction the plan asked to have commented, asserted rather than trusted: the STATUS
  // uses the period, the COLUMN shows the truth. A leader wants to know a family was last seen
  // fourteen months ago, not merely that the count for this period is zero.
  it("ignores a log before the period in the count while still reporting its date", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [log("h-1", "2025-06-15", "completed")],
    );

    const row = rowFor(progress, "h-1");

    expect(row.visitCountThisPeriod).toBe(0);
    expect(row.lastVisitedOn).toBe("2025-06-15");
    expect(progress.banner).toEqual({ visitedCount: 0, total: 1, remaining: 1 });

    // due_soon, NOT overdue, and the difference is the whole reason lastVisitedOn is all-time:
    // the status is anchored on the VISIT, so eleven and a half months after it the household is
    // approaching its next one rather than past it. It is still uncounted for this period.
    expect(row.status).toBe("due_soon");
  });

  // The scenario-040 shape: visited thirteen months ago, on a twelve-month cadence.
  it("reads a visit older than the cadence as overdue, from a date the column still shows", () => {
    const progress = build(
      [household("h-1", "Okonkwo", ["active"])],
      [log("h-1", "2025-05-01", "completed")],
      "2026-06-01",
    );

    const row = rowFor(progress, "h-1");

    expect(row.lastVisitedOn).toBe("2025-05-01");
    expect(row.visitCountThisPeriod).toBe(0);
    expect(row.status).toBe("overdue");
  });

  it("ignores a log after the period ends", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [log("h-1", "2027-02-01", "completed")],
      "2027-02-02",
    );

    expect(rowFor(progress, "h-1").visitCountThisPeriod).toBe(0);
  });

  // "X of Y households visited" means visited THIS PERIOD, which is not the same set as "rows
  // whose status is `visited`". A household visited nine months into a twelve-month cadence
  // reads due_soon and has still been visited — see the deviation note in lib/visits/progress.ts.
  it("counts a due_soon household as visited in the banner", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [log("h-1", "2026-01-10", "completed")],
      "2026-11-15",
    );

    expect(rowFor(progress, "h-1").status).toBe("due_soon");
    expect(progress.banner).toEqual({ visitedCount: 1, total: 1, remaining: 0 });
  });
});

describe("attempts are shown and never counted", () => {
  it("puts an attempt on its own columns and out of every visit number", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [log("h-1", "2026-02-20", "attempted"), log("h-1", "2026-03-05", "attempted")],
    );

    const row = rowFor(progress, "h-1");

    expect(row.attemptCountThisPeriod).toBe(2);
    expect(row.lastAttemptedOn).toBe("2026-03-05");

    // Nothing an attempt touches leaks into the visited side.
    expect(row.visitCountThisPeriod).toBe(0);
    expect(row.lastVisitedOn).toBeNull();
    expect(row.status).toBe("attempted_never_reached");
    expect(progress.banner).toEqual({ visitedCount: 0, total: 1, remaining: 1 });
  });

  it("keeps the two dates apart on a household with one of each", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [log("h-1", "2026-02-10", "completed"), log("h-1", "2026-03-14", "attempted")],
    );

    const row = rowFor(progress, "h-1");

    expect(row.lastVisitedOn).toBe("2026-02-10");
    expect(row.lastAttemptedOn).toBe("2026-03-14");
    expect(row.visitCountThisPeriod).toBe(1);
    expect(row.attemptCountThisPeriod).toBe(1);
    expect(row.status).toBe("visited");
  });
});

describe("attempts since the last visit", () => {
  // The number rendered in parentheses beside the last-attempted date. It answers "how many times
  // have we tried and failed to get in", which a bare date cannot: one knock and a standing
  // pattern of five render identically without it.
  it("counts every attempt when the household has never been visited", () => {
    const progress = build(
      [household("h-1", "Ferreira", ["active"])],
      [
        log("h-1", "2026-02-20", "attempted"),
        log("h-1", "2026-03-05", "attempted"),
        log("h-1", "2026-04-18", "attempted"),
      ],
    );

    expect(rowFor(progress, "h-1").attemptsSinceLastVisit).toBe(3);
  });

  // A completed visit RESETS it. Somebody got in; the knocks before that are history rather than
  // a household nobody can reach.
  it("counts only the attempts made after the last completed visit", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [
        log("h-1", "2026-01-10", "attempted"),
        log("h-1", "2026-01-12", "attempted"),
        log("h-1", "2026-02-01", "completed"),
        log("h-1", "2026-03-01", "attempted"),
      ],
    );

    expect(rowFor(progress, "h-1").attemptsSinceLastVisit).toBe(1);
  });

  it("is zero when the last thing that happened was a visit", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [log("h-1", "2026-01-10", "attempted"), log("h-1", "2026-02-01", "completed")],
    );

    expect(rowFor(progress, "h-1").attemptsSinceLastVisit).toBe(0);
  });

  // NOT bounded by the goal period, unlike attemptCountThisPeriod. A household knocked on either
  // side of a period boundary has been failed to reach that many times running, and the boundary
  // is not a fact about the household.
  it("crosses the goal period boundary that attemptCountThisPeriod stops at", () => {
    const progress = build(
      [household("h-1", "Ferreira", ["active"])],
      [log("h-1", "2025-12-20", "attempted"), log("h-1", "2026-02-14", "attempted")],
    );

    const row = rowFor(progress, "h-1");

    expect(row.attemptCountThisPeriod).toBe(1);
    expect(row.attemptsSinceLastVisit).toBe(2);
  });

  // The fixtures deliberately arrive out of order: a running counter incremented while looping
  // would count the March attempt against a visit it had not read yet.
  it("does not depend on the order the logs arrive in", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [
        log("h-1", "2026-03-01", "attempted"),
        log("h-1", "2026-01-10", "attempted"),
        log("h-1", "2026-02-01", "completed"),
      ],
    );

    expect(rowFor(progress, "h-1").attemptsSinceLastVisit).toBe(1);
  });
});

describe("conducted by", () => {
  // Never a fallback to `recordedByName`, which is set on every fixture above precisely so this
  // assertion would fail if one were ever added.
  it("is null when nobody is recorded as having gone", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [log("h-1", "2026-02-10", "completed", null)],
    );

    expect(rowFor(progress, "h-1").conductedBy).toBeNull();
  });

  // It describes the visit `lastVisitedOn` NAMES. A "conducted by" that belonged to a different
  // visit than the date beside it is a row contradicting itself.
  it("comes from the most recent completed visit, not the most recent of any kind", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [
        log("h-1", "2026-01-05", "completed", "Old Companion"),
        log("h-1", "2026-04-05", "completed", "Recent Companion"),
        log("h-1", "2026-05-05", "attempted", "Somebody Knocking"),
      ],
    );

    const row = rowFor(progress, "h-1");

    expect(row.lastVisitedOn).toBe("2026-04-05");
    expect(row.conductedBy).toBe("Recent Companion");
  });
});

describe("no goal", () => {
  it("returns a null banner and null statuses rather than an invented cadence", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"]), household("h-2", "Whitfield", ["active"])],
      [log("h-1", "2026-02-10", "completed")],
      "2026-06-01",
      null,
    );

    expect(progress.banner).toBeNull();
    expect(progress.goal).toBeNull();
    expect(progress.goalHasNoCadence).toBe(false);
    expect(progress.rows.every((row) => row.status === null)).toBe(true);

    // The households are still listed, and their all-time dates are still true. Only the
    // judgement is withheld.
    expect(progress.rows).toHaveLength(2);
    expect(rowFor(progress, "h-1").lastVisitedOn).toBe("2026-02-10");
  });

  it("distinguishes a goal with no cadence from no goal at all", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [],
      "2026-06-01",
      { ...GOAL, cadence: null },
    );

    expect(progress.banner).toBeNull();
    expect(progress.goalHasNoCadence).toBe(true);
  });
});

describe("resolveCadenceMonths", () => {
  // Read from lib/validation/visit.ts §CADENCE_MONTHS, the same map the goal form writes against.
  // Two copies drift and the denominator quietly changes with them.
  it("reads annual as 12 and biannual as 6 without a cadenceMonths column", () => {
    expect(resolveCadenceMonths({ ...GOAL, cadence: "annual" })).toBe(12);
    expect(resolveCadenceMonths({ ...GOAL, cadence: "biannual" })).toBe(6);
  });

  it("uses the column only for a custom cadence", () => {
    expect(resolveCadenceMonths({ ...GOAL, cadence: "custom", cadenceMonths: 3 })).toBe(3);
    expect(resolveCadenceMonths({ ...GOAL, cadence: "custom", cadenceMonths: null })).toBeNull();
  });
});

describe("selectActiveGoal", () => {
  const older: VisitGoal = {
    ...GOAL,
    id: "goal-old",
    goalPeriodStart: "2025-01-01",
    goalPeriodEnd: "2025-12-31",
  };
  const otherOrg: VisitGoal = { ...GOAL, id: "goal-rs", orgId: "org-rs" };

  // The list arrives ordered by goal_period_start descending from lib/visits/queries.ts, and this
  // function does not re-sort it — an order asserted in one place and assumed in another is the
  // bug route-tests-and-realtime records.
  it("takes the goal whose period contains today", () => {
    expect(selectActiveGoal([GOAL, older], "org-eq", "2026-06-01")?.id).toBe("goal-1");
    expect(selectActiveGoal([GOAL, older], "org-eq", "2025-06-01")?.id).toBe("goal-old");
  });

  it("falls back to the most recently started when none contains today", () => {
    expect(selectActiveGoal([GOAL, older], "org-eq", "2030-01-01")?.id).toBe("goal-1");
  });

  it("never reaches across organizations", () => {
    expect(selectActiveGoal([otherOrg], "org-eq", "2026-06-01")).toBeNull();
  });
});
