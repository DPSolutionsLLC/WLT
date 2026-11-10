import { describe, expect, it } from "vitest";
import type { HouseholdWithMembers } from "@/lib/roster/queries";
import { buildGoalHistory } from "@/lib/visits/goalHistory";
import type { VisitGoal, VisitLogWithContext } from "@/lib/visits/queries";

// Goal history (ITER-055 bv4): an ended goal's numbers are recomputed from the visits dated on or
// before the day it ended, never stored.

const ORGANIZATIONS = [
  { id: "org-bishopric", name: "Bishopric", type: "bishopric" },
  { id: "org-eq", name: "Elders Quorum", type: "elders_quorum" },
];

function household(id: string, familyName: string): HouseholdWithMembers {
  return {
    id,
    familyName,
    address: null,
    latitude: null,
    longitude: null,
    doNotContact: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    members: [
      {
        id: `member-${id}`,
        householdId: id,
        firstName: "A",
        lastName: familyName,
        category: "adult",
        gender: null,
        status: "active",
        phone: null,
        fullName: null,
        preferredName: null,
        birthDate: null,
        email: null,
        classAssignment: null,
        callings: null,
        callingsSustained: null,
        callingsSetApart: null,
        ministeringBrothers: null,
        ministeringSisters: null,
        hasMinisteringBrothers: null,
        hasMinisteringSisters: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
}

function doneVisit(householdId: string, visitDate: string, orgId: string | null): VisitLogWithContext {
  return {
    id: `log-${householdId}-${visitDate}`,
    orgId,
    householdId,
    recordedBy: "user-1",
    visitDate,
    visitType: "in_home",
    outcome: "completed",
    needsAnotherVisit: false,
    needsAnotherReason: null,
    attemptDetail: null,
    arrangement: "drop_in",
    sharedNotes: null,
    flaggedForWardCouncil: false,
    flagSentAt: null,
    createdAt: `${visitDate}T00:00:00.000Z`,
    householdName: null,
    recordedByName: null,
    participants: [],
    conductedByLabel: null,
  };
}

function goal(overrides: Partial<VisitGoal>): VisitGoal {
  return {
    id: "goal-1",
    orgId: "org-bishopric",
    title: "Every household",
    targetType: "all_households",
    cadence: null,
    notice: null,
    deadline: null,
    kind: "sweep",
    startedOn: "2026-03-01",
    endedAt: "2026-04-30T18:00:00.000Z",
    endReason: "set_aside",
    createdBy: "user-1",
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

const HOUSEHOLDS = [household("h-1", "Abbott"), household("h-2", "Brooks"), household("h-3", "Carver")];

function history(goals: VisitGoal[], logs: VisitLogWithContext[]) {
  return buildGoalHistory({
    goals,
    organizations: ORGANIZATIONS,
    households: HOUSEHOLDS,
    logs,
    householdCadences: [],
    stewardships: [],
    wardTimeZone: "America/Denver",
  });
}

describe("buildGoalHistory", () => {
  it("lists ended goals only", () => {
    expect(history([goal({ endedAt: null, endReason: null })], [])).toEqual([]);
  });

  it("counts a bishopric sweep from the visits with no organization, up to the day it ended", () => {
    const [entry] = history(
      [goal({})],
      [
        doneVisit("h-1", "2026-03-10", null),
        // After the goal ended: not counted.
        doneVisit("h-2", "2026-05-02", null),
        // Another organization's visit: not the bishopric's.
        doneVisit("h-3", "2026-03-12", "org-eq"),
      ],
    );

    expect(entry.orgName).toBe("Bishopric");
    expect(entry.endedOn).toBe("2026-04-30");
    expect(entry.endReason).toBe("set_aside");
    expect(entry.sweep).toEqual({ total: 3, done: 1, partlyReached: 0, notYet: 2 });
    expect(entry.onTrack).toBeNull();
  });

  // 18:00 UTC on 30 April is still 30 April in Denver; 03:00 UTC on 1 May is 30 April there too.
  it("takes the end date on the ward's calendar", () => {
    const [entry] = history([goal({ endedAt: "2026-05-01T03:00:00.000Z" })], []);
    expect(entry.endedOn).toBe("2026-04-30");
  });

  it("gives a cadence goal its on-track share at the moment it ended", () => {
    const [entry] = history(
      [
        goal({
          orgId: "org-eq",
          kind: "cadence",
          cadence: { amount: 1, unit: "year" },
          notice: { amount: 2, unit: "month" },
        }),
      ],
      [doneVisit("h-1", "2026-03-10", "org-eq")],
    );

    expect(entry.sweep).toBeNull();
    expect(entry.onTrack).toEqual({ onTrack: 1, counted: 3, percent: 33 });
  });

  it("puts the most recently ended first", () => {
    const entries = history(
      [
        goal({ id: "first", endedAt: "2026-02-01T00:00:00.000Z" }),
        goal({ id: "second", endedAt: "2026-04-01T00:00:00.000Z" }),
      ],
      [],
    );
    expect(entries.map((entry) => entry.goalId)).toEqual(["second", "first"]);
  });
});
