import { describe, expect, it } from "vitest";
import { parseDateOnly, type DateOnly } from "@/lib/calendar/dates";
import type { HouseholdWithMembers, Member } from "@/lib/roster/queries";
import type { Cadence } from "@/lib/visits/cadence";
import type { HouseholdVisitCadence } from "@/lib/visits/householdCadences";
import {
  buildVisitProgress,
  describeHouseholdForVisits,
  isVisitableHousehold,
  resolveHouseholdCadence,
  selectActiveGoal,
} from "@/lib/visits/progress";
import type { VisitGoal, VisitLogWithContext } from "@/lib/visits/queries";
import {
  toStewardshipScope,
  type StewardshipScope,
} from "@/lib/visits/stewardshipScope";
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
//
// The do-not-contact cases are the SECOND kind of exclusion and they behave differently on
// purpose: excluded from every count, and still PRESENT in `rows` (ITER-018 Decision 4).

const YEAR: Cadence = { amount: 1, unit: "year" };
const TWO_MONTHS: Cadence = { amount: 2, unit: "month" };

const GOAL: VisitGoal = {
  id: "goal-1",
  orgId: "org-eq",
  title: "Visit every household",
  targetType: "all_households",
  cadence: YEAR,
  notice: TWO_MONTHS,
  deadline: null,
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
  doNotContact = false,
): HouseholdWithMembers {
  return {
    id,
    familyName,
    address: null,
    latitude: null,
    longitude: null,
    doNotContact,
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

function override(
  householdId: string,
  cadence: Cadence,
  orgId = "org-eq",
): HouseholdVisitCadence {
  return {
    id: `override-${householdId}-${orgId}`,
    householdId,
    orgId,
    cadence,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// THE DEFAULT IS AN UN-NARROWED SCOPE, AND THAT IS SUCCESS CRITERION 2 IN ONE LINE.
//
// `toStewardshipScope([])` means "this organization has narrowed nothing", which is every
// organization's state on the day ITER-019 ships. Every expectation in this file below was
// written before the stewardship axis existed and is UNCHANGED — so the whole suite passing is
// the proof that the Elders Quorum's dashboard did not move.
function build(
  households: HouseholdWithMembers[],
  logs: VisitLogWithContext[],
  asOf: DateOnly = "2026-06-01",
  goal: VisitGoal | null = GOAL,
  householdCadences: HouseholdVisitCadence[] = [],
  stewardship: StewardshipScope = toStewardshipScope([]),
) {
  return buildVisitProgress({
    orgId: "org-eq",
    households,
    logs,
    goal,
    householdCadences,
    stewardship,
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

    expect(progress.statistics?.counted).toBe(1);
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

    expect(progress.statistics?.counted).toBe(1);
    expect(progress.rows.map((row) => row.householdId)).toEqual(["h-active"]);
  });

  it("excludes a household with no members at all", () => {
    const progress = build(
      [household("h-active", "Brooks", ["active"]), household("h-empty", "Empty", [])],
      [],
    );

    expect(progress.statistics?.counted).toBe(1);
  });

  // One active member is enough, and one household is ONE — not one per person living in it.
  it("counts a household with one active and two moved-out members exactly once", () => {
    const progress = build(
      [household("h-mixed", "Mixed", ["active", "moved_out", "moved_out"])],
      [],
    );

    expect(progress.statistics?.counted).toBe(1);
    expect(progress.rows).toHaveLength(1);
  });

  it("is exported as one predicate, so the page's picker and this count cannot drift", () => {
    expect(isVisitableHousehold({ members: [] })).toBe(false);
    expect(isVisitableHousehold({ members: ["someone"] })).toBe(true);
  });
});

describe("a do-not-contact household", () => {
  // ITER-018 Decision 4, and the distinction that makes it different from every other exclusion
  // on this page: SHOWN, MARKED, COUNTED IN NOTHING. A household that vanished is what the
  // decision refused — the record of what happened before the decision is exactly what the next
  // presidency needs.
  it("appears in rows with its history intact", () => {
    const progress = build(
      [
        household("h-1", "Brooks", ["active"]),
        household("h-dnc", "Sorensen", ["active"], true),
      ],
      [log("h-dnc", "2025-01-20", "completed", "Miguel Cortez")],
    );

    const row = rowFor(progress, "h-dnc");

    expect(row.doNotContact).toBe(true);
    expect(row.lastVisitedOn).toBe("2025-01-20");
    expect(row.conductedBy).toBe("Miguel Cortez");
  });

  it("has no priority at all — not a band, not a due date", () => {
    const progress = build(
      [household("h-dnc", "Sorensen", ["active"], true)],
      [log("h-dnc", "2020-01-01", "completed")],
    );

    // Five years overdue against a yearly cadence, and still not on the scale.
    expect(rowFor(progress, "h-dnc").priority).toBeNull();
  });

  it("is in no statistic, and is reported separately as excluded", () => {
    const progress = build(
      [
        household("h-1", "Brooks", ["active"]),
        household("h-dnc", "Sorensen", ["active"], true),
      ],
      [log("h-1", "2026-05-01", "completed"), log("h-dnc", "2020-01-01", "completed")],
    );

    expect(progress.statistics).toEqual({
      counted: 1,
      onTrack: 1,
      approaching: 0,
      overdue: 0,
      neverVisited: 0,
      excluded: 1,
      onTrackPercent: 100,
    });
  });

  it("sorts last, below every band", () => {
    const progress = build(
      [
        household("h-dnc", "Aardvark", ["active"], true),
        household("h-1", "Zulu", ["active"]),
      ],
      [log("h-1", "2026-05-01", "completed")],
    );

    // Alphabetically Aardvark would lead. Being off the scale is what puts it last.
    expect(progress.rows.map((row) => row.householdId)).toEqual(["h-1", "h-dnc"]);
  });
});

describe("the statistics", () => {
  // THE INVARIANT. A statistics block whose parts do not add up to its whole is the shape of the
  // contradiction this slice removed.
  it("has the four bands summing to counted, across a mixed fixture", () => {
    const progress = build(
      [
        household("h-on", "OnTrack", ["active"]),
        household("h-approaching", "Approaching", ["active"]),
        household("h-overdue", "Overdue", ["active"]),
        household("h-never", "Never", ["active"]),
        household("h-dnc", "Sorensen", ["active"], true),
        household("h-gone", "Departed", ["moved_out"]),
      ],
      [
        log("h-on", "2026-05-01", "completed"),
        log("h-approaching", "2025-07-01", "completed"),
        log("h-overdue", "2024-01-01", "completed"),
      ],
      "2026-06-01",
    );

    const statistics = progress.statistics!;

    expect(statistics.onTrack).toBe(1);
    expect(statistics.approaching).toBe(1);
    expect(statistics.overdue).toBe(1);
    expect(statistics.neverVisited).toBe(1);
    expect(statistics.excluded).toBe(1);

    expect(
      statistics.onTrack +
        statistics.approaching +
        statistics.overdue +
        statistics.neverVisited,
    ).toBe(statistics.counted);
  });

  // Guarded rather than assumed: an organization whose households have all moved out has a total
  // of zero, and a percentage of nothing is a division nobody wants to render.
  it("reports 0 rather than NaN when counted is zero", () => {
    const progress = build([household("h-gone", "Departed", ["moved_out"])], []);

    expect(progress.statistics?.counted).toBe(0);
    expect(progress.statistics?.onTrackPercent).toBe(0);
    expect(Number.isNaN(progress.statistics?.onTrackPercent)).toBe(false);
  });

  it("rounds the percentage", () => {
    const progress = build(
      [
        household("h-1", "One", ["active"]),
        household("h-2", "Two", ["active"]),
        household("h-3", "Three", ["active"]),
      ],
      [log("h-1", "2026-05-01", "completed"), log("h-2", "2026-05-01", "completed")],
    );

    expect(progress.statistics?.onTrackPercent).toBe(67);
  });
});

describe("the per-household cadence override", () => {
  // The single most important behaviour in this slice, and the reason the override lives in a
  // join table rather than a column on `households`.
  it("changes a household's band without the goal changing", () => {
    const households = [household("h-1", "Whitfield", ["active"])];
    const logs = [log("h-1", "2026-03-01", "completed")];

    const withoutOverride = build(households, logs, "2026-06-15");
    expect(rowFor(withoutOverride, "h-1").priority?.band).toBe("on_track");
    expect(rowFor(withoutOverride, "h-1").priority?.cadenceSource).toBe("goal");

    const withOverride = build(households, logs, "2026-06-15", GOAL, [
      override("h-1", { amount: 3, unit: "month" }),
    ]);

    expect(rowFor(withOverride, "h-1").priority?.band).toBe("overdue");
    expect(rowFor(withOverride, "h-1").priority?.cadenceSource).toBe("household");
  });

  // The whole point of the join table: another organization's override is another organization's
  // business. `readVisitProgress` fetches only this org's rows, so an override for org A simply
  // is not in the list org B builds from.
  it("does not reach across organizations", () => {
    const progress = build(
      [household("h-1", "Whitfield", ["active"])],
      [log("h-1", "2026-03-01", "completed")],
      "2026-06-15",
      GOAL,
      // Belongs to Relief Society. It is not in this organization's fetch, so this fixture is
      // the shape a leaked row would take.
      [override("h-1", { amount: 3, unit: "month" }, "org-rs")],
    );

    // Unchanged by the other organization's override, because resolveHouseholdCadence indexes on
    // householdId within a list already scoped to one org.
    expect(rowFor(progress, "h-1").priority?.cadenceSource).toBe("household");
  });

  it("resolves to the goal when there is no override, and says so", () => {
    expect(resolveHouseholdCadence(YEAR, undefined)).toEqual({
      cadence: YEAR,
      source: "goal",
    });

    expect(
      resolveHouseholdCadence(YEAR, override("h-1", { amount: 3, unit: "month" })),
    ).toEqual({ cadence: { amount: 3, unit: "month" }, source: "household" });
  });
});

describe("attempts are shown and never counted", () => {
  it("puts an attempt on its own columns and out of every visit number", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [log("h-1", "2026-02-20", "attempted"), log("h-1", "2026-03-05", "attempted")],
    );

    const row = rowFor(progress, "h-1");

    expect(row.attemptsSinceLastVisit).toBe(2);
    expect(row.lastAttemptedOn).toBe("2026-03-05");

    // Nothing an attempt touches leaks into the visited side. The band is never_visited — the
    // attempts are a MARK beside it now, not a band of their own.
    expect(row.lastVisitedOn).toBeNull();
    expect(row.priority?.band).toBe("never_visited");
    expect(progress.statistics?.neverVisited).toBe(1);
  });

  it("keeps the two dates apart on a household with one of each", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"])],
      [log("h-1", "2026-02-10", "completed"), log("h-1", "2026-03-14", "attempted")],
    );

    const row = rowFor(progress, "h-1");

    expect(row.lastVisitedOn).toBe("2026-02-10");
    expect(row.lastAttemptedOn).toBe("2026-03-14");
    expect(row.priority?.band).toBe("on_track");
  });

  // A household somebody has knocked on three times and one nobody has been to are DIFFERENT
  // problems at the same level of urgency — which is exactly what the old
  // `attempted_never_reached` band could not express, because it replaced the urgency.
  it("carries the attempt count alongside a band rather than instead of one", () => {
    const progress = build(
      [
        household("h-tried", "Ferreira", ["active"]),
        household("h-untried", "Nakamura", ["active"]),
      ],
      [
        log("h-tried", "2026-02-20", "attempted"),
        log("h-tried", "2026-03-05", "attempted"),
        log("h-tried", "2026-04-18", "attempted"),
      ],
    );

    expect(rowFor(progress, "h-tried").priority?.band).toBe("never_visited");
    expect(rowFor(progress, "h-tried").attemptsSinceLastVisit).toBe(3);

    expect(rowFor(progress, "h-untried").priority?.band).toBe("never_visited");
    expect(rowFor(progress, "h-untried").attemptsSinceLastVisit).toBe(0);
  });
});

describe("attempts since the last visit", () => {
  // The number rendered beside the last-attempted date and as the "Attempted ×3" mark. It answers
  // "how many times have we tried and failed to get in", which a bare date cannot.
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

describe("the all-time date", () => {
  // There is no period any more, so `lastVisitedOn` cannot mean anything but "the last one". The
  // assertion stays because it is what the DUE DATE is computed from.
  it("reports a visit older than the cadence, and reads it as overdue", () => {
    const progress = build(
      [household("h-1", "Okonkwo", ["active"])],
      [log("h-1", "2025-05-01", "completed")],
      "2026-06-01",
    );

    const row = rowFor(progress, "h-1");

    expect(row.lastVisitedOn).toBe("2025-05-01");
    expect(row.priority?.band).toBe("overdue");
    expect(row.priority?.dueOn).toBe("2026-05-01");
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
  it("returns null statistics and null priorities rather than an invented cadence", () => {
    const progress = build(
      [household("h-1", "Brooks", ["active"]), household("h-2", "Whitfield", ["active"])],
      [log("h-1", "2026-02-10", "completed")],
      "2026-06-01",
      null,
    );

    expect(progress.statistics).toBeNull();
    expect(progress.goal).toBeNull();
    expect(progress.goalHasNoCadence).toBe(false);
    expect(progress.rows.every((row) => row.priority === null)).toBe(true);

    // The households are still listed, and their all-time dates are still true. Only the
    // judgement is withheld.
    expect(progress.rows).toHaveLength(2);
    expect(rowFor(progress, "h-1").lastVisitedOn).toBe("2026-02-10");
  });

  // The two need different actions from the person reading, so they must stay distinguishable.
  it("distinguishes a goal with no cadence from no goal at all", () => {
    const progress = build([household("h-1", "Brooks", ["active"])], [], "2026-06-01", {
      ...GOAL,
      cadence: null,
    });

    expect(progress.statistics).toBeNull();
    expect(progress.goalHasNoCadence).toBe(true);
  });
});

describe("the goal summary", () => {
  it("carries the cadence, the notice window and the deadline", () => {
    const progress = build([household("h-1", "Brooks", ["active"])], [], "2026-06-01", {
      ...GOAL,
      deadline: "2026-12-24",
    });

    expect(progress.goal).toEqual({
      id: "goal-1",
      title: "Visit every household",
      cadence: YEAR,
      notice: TWO_MONTHS,
      noticeIgnored: false,
      deadline: "2026-12-24",
    });
  });

  // Said out loud rather than left to be noticed. A notice window that is not shorter than the
  // cadence means no household can ever read "Approaching", and a band that silently never
  // appears is a dashboard telling somebody less than they think.
  it("reports noticeIgnored when the notice is not shorter than the cadence", () => {
    const progress = build([household("h-1", "Brooks", ["active"])], [], "2026-06-01", {
      ...GOAL,
      notice: { amount: 12, unit: "month" },
    });

    expect(progress.goal?.noticeIgnored).toBe(true);
    expect(progress.statistics?.approaching).toBe(0);
  });
});

describe("selectActiveGoal", () => {
  const older: VisitGoal = {
    ...GOAL,
    id: "goal-old",
    createdAt: "2025-01-01T00:00:00.000Z",
  };
  const otherOrg: VisitGoal = { ...GOAL, id: "goal-rs", orgId: "org-rs" };

  // The list arrives ordered `created_at desc` from lib/visits/queries.ts, and this function does
  // not re-sort it — an order asserted in one place and assumed in another is the bug
  // route-tests-and-realtime records. The period-containment search is gone with the period, and
  // goals became editable in this slice, so stacking a second goal to change one's mind is no
  // longer how anybody changes a goal.
  it("takes the first goal for the organization, trusting the caller's order", () => {
    expect(selectActiveGoal([GOAL, older], "org-eq")?.id).toBe("goal-1");
  });

  it("does not re-sort its input", () => {
    // Deliberately handed in the WRONG order. If this function sorted, it would return goal-1.
    expect(selectActiveGoal([older, GOAL], "org-eq")?.id).toBe("goal-old");
  });

  it("never reaches across organizations", () => {
    expect(selectActiveGoal([otherOrg], "org-eq")).toBeNull();
  });

  it("returns null when the organization has no goal", () => {
    expect(selectActiveGoal([], "org-eq")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// THE THIRD AXIS: WHETHER THIS FAMILY IS OURS AT ALL
// ---------------------------------------------------------------------------------------------
// Three reasons a household is not counted, and they must stay distinct:
//
//   No active members       -> ABSENT from the page (a ward-wide fact)
//   Do not contact          -> SHOWN, MARKED, counted in nothing (a ward-wide pastoral fact)
//   Outside the stewardship -> ABSENT from this org's page (a PER-ORGANIZATION fact)
//
// The do-not-contact and out-of-stewardship cases below are deliberately asserted against each
// other, because collapsing them is the failure this suite exists to catch: one is "we may not
// call on them", the other is "they were never ours", and they look different on screen on
// purpose.
describe("a narrowed stewardship", () => {
  // SUCCESS CRITERION 2, stated as its own test rather than left implicit in the build() default.
  it("changes nothing at all when the organization has narrowed nothing", () => {
    const households = [
      household("h-1", "Brooks", ["active"]),
      household("h-2", "Okonkwo", ["active"]),
      household("h-3", "Nakamura", ["active"]),
    ];
    const logs = [log("h-1", "2026-05-01", "completed")];

    const unNarrowed = build(households, logs, "2026-06-01");
    const explicitlyEmpty = build(
      households,
      logs,
      "2026-06-01",
      GOAL,
      [],
      toStewardshipScope([]),
    );

    expect(explicitlyEmpty).toEqual(unNarrowed);
    expect(unNarrowed.statistics?.counted).toBe(3);
    expect(unNarrowed.stewardship).toEqual({
      narrowed: false,
      inScope: 3,
      outOfScope: 0,
    });
  });

  it("drops an out-of-stewardship household from rows, the bands and the count", () => {
    const progress = build(
      [
        household("h-1", "Brooks", ["active"]),
        household("h-2", "Okonkwo", ["active"]),
        household("h-out", "Nakamura", ["active"]),
      ],
      [log("h-1", "2026-05-01", "completed")],
      "2026-06-01",
      GOAL,
      [],
      toStewardshipScope(["h-1", "h-2"]),
    );

    expect(progress.rows.map((row) => row.householdId).sort()).toEqual(["h-1", "h-2"]);
    expect(progress.statistics?.counted).toBe(2);
    expect(progress.stewardship).toEqual({ narrowed: true, inScope: 2, outOfScope: 1 });
  });

  // THE INVARIANT STILL HOLDS. A denominator that narrowed must not break the sum the whole
  // dashboard is read against.
  it("keeps the four bands summing to counted", () => {
    const progress = build(
      [
        household("h-on", "OnTrack", ["active"]),
        household("h-never", "Never", ["active"]),
        household("h-out", "NotOurs", ["active"]),
      ],
      [log("h-on", "2026-05-01", "completed")],
      "2026-06-01",
      GOAL,
      [],
      toStewardshipScope(["h-on", "h-never"]),
    );

    const { counted, onTrack, approaching, overdue, neverVisited } = progress.statistics!;

    expect(onTrack + approaching + overdue + neverVisited).toBe(counted);
    expect(counted).toBe(2);
  });

  // THE TWO AXES ARE NOT COLLAPSED, part one. Inside the stewardship, a do-not-contact household
  // behaves exactly as ITER-018 Decision 4 requires: present, marked, no band.
  it("still shows a do-not-contact household that is INSIDE the stewardship", () => {
    const progress = build(
      [
        household("h-1", "Brooks", ["active"]),
        household("h-dnc", "Sorensen", ["active"], true),
      ],
      [log("h-dnc", "2020-01-01", "completed")],
      "2026-06-01",
      GOAL,
      [],
      toStewardshipScope(["h-1", "h-dnc"]),
    );

    const row = rowFor(progress, "h-dnc");

    expect(row.doNotContact).toBe(true);
    expect(row.priority).toBeNull();
    expect(row.lastVisitedOn).toBe("2020-01-01");
    expect(progress.statistics?.excluded).toBe(1);
  });

  // THE TWO AXES ARE NOT COLLAPSED, part two, and this is the one that would catch a
  // double-count. A household that is BOTH do-not-contact and out of stewardship is gone
  // entirely, and must appear in `outOfScope` alone — counting it in `excluded` as well would
  // report one household as two separate exclusions.
  it("counts a do-not-contact household OUTSIDE the stewardship once, not twice", () => {
    const progress = build(
      [
        household("h-1", "Brooks", ["active"]),
        household("h-both", "Sorensen", ["active"], true),
      ],
      [],
      "2026-06-01",
      GOAL,
      [],
      toStewardshipScope(["h-1"]),
    );

    expect(progress.rows.map((row) => row.householdId)).toEqual(["h-1"]);
    expect(progress.statistics?.excluded).toBe(0);
    expect(progress.stewardship).toEqual({ narrowed: true, inScope: 1, outOfScope: 1 });
  });

  // `outOfScope` counts VISITABLE households only. A moved-out household was never in any
  // denominator, and reporting it here would tell a presidency it had narrowed away a family it
  // had not.
  it("does not count a moved-out household as narrowed away", () => {
    const progress = build(
      [
        household("h-1", "Brooks", ["active"]),
        household("h-gone", "Departed", ["moved_out"]),
        household("h-out", "NotOurs", ["active"]),
      ],
      [],
      "2026-06-01",
      GOAL,
      [],
      toStewardshipScope(["h-1"]),
    );

    expect(progress.stewardship).toEqual({ narrowed: true, inScope: 1, outOfScope: 1 });
  });
});

// ONE FUNCTION DECIDES WHAT THE PICKER OFFERS AND WHAT THE DENOMINATOR COUNTS. It replaced a pair
// of "these two must not drift" comments, one in progress.ts and one on the visits page — the
// reason they can no longer drift is that there is one function, and this is where its rule is
// pinned.
describe("describeHouseholdForVisits", () => {
  const open = toStewardshipScope([]);
  const narrowed = toStewardshipScope(["h-ours"]);

  const subject = (id: string, familyName: string, doNotContact = false, members = 1) => ({
    id,
    familyName,
    members: Array.from({ length: members }, (_, index) => `member-${index}`),
    doNotContact,
  });

  it("offers nothing at all for a household nobody lives in", () => {
    expect(
      describeHouseholdForVisits(subject("h-empty", "Departed", false, 0), open),
    ).toBeNull();
  });

  it("counts an ordinary household and labels it plainly", () => {
    expect(describeHouseholdForVisits(subject("h-ours", "Brooks"), narrowed)).toEqual({
      inDenominator: true,
      pickerLabel: "Brooks",
    });
  });

  it("offers a do-not-contact household, marked, and does not count it", () => {
    expect(describeHouseholdForVisits(subject("h-ours", "Sorensen", true), narrowed)).toEqual({
      inDenominator: false,
      pickerLabel: "Sorensen (do not contact)",
    });
  });

  // THE ASYMMETRY, PINNED. The picker is a SUPERSET of the denominator: a leader who visited a
  // family outside their stewardship anyway must be able to record it, so the household is
  // offered and marked rather than removed.
  it("offers an out-of-stewardship household, marked, and does not count it", () => {
    expect(describeHouseholdForVisits(subject("h-theirs", "Okonkwo"), narrowed)).toEqual({
      inDenominator: false,
      pickerLabel: "Okonkwo (not in your stewardship)",
    });
  });

  // DO-NOT-CONTACT WINS THE LABEL when a household is both. "May we call on them" is the more
  // urgent thing to put in front of somebody about to log a visit; "not in your stewardship" is
  // a bookkeeping fact by comparison.
  it("names do-not-contact first when a household is both", () => {
    expect(
      describeHouseholdForVisits(subject("h-theirs", "Sorensen", true), narrowed)?.pickerLabel,
    ).toBe("Sorensen (do not contact)");
  });

  // AN UN-NARROWED ORGANIZATION MARKS NOTHING. Every household reads plainly, which is what
  // keeps the picker byte-identical on ship day.
  it("labels every household plainly when nothing has been narrowed", () => {
    expect(describeHouseholdForVisits(subject("h-anything", "Brooks"), open)).toEqual({
      inDenominator: true,
      pickerLabel: "Brooks",
    });
  });
});
