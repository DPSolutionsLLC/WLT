import { describe, expect, it } from "vitest";
import {
  compareCompanions,
  describeCompanions,
  describeInvite,
  orderCompanionLeaders,
  visitInviteBody,
} from "@/lib/visits/companionText";
import { MAX_VISIT_COMPANIONS, createAppointmentSchema } from "@/lib/validation/visit";
import type { VisitCompanion } from "@/types/domain";

// The words and the boundary for a booked visit's companions (ITER-055 bv6).

const HOUSEHOLD = "9b8f1c2e-1111-4a5b-8c9d-000000000001";
const LEADER = "9b8f1c2e-1111-4a5b-8c9d-000000000002";
const MEMBER = "9b8f1c2e-1111-4a5b-8c9d-000000000003";

function companion(overrides: Partial<VisitCompanion>): VisitCompanion {
  return {
    id: "c",
    appointmentId: "a",
    kind: "label",
    userId: null,
    memberId: null,
    displayName: "A neighbour",
    status: null,
    ...overrides,
  };
}

describe("describeCompanions", () => {
  it("is null when nobody is going along", () => {
    expect(describeCompanions([])).toBeNull();
  });

  it("names a status only for an invited leader", () => {
    expect(
      describeCompanions([
        companion({ kind: "user", userId: LEADER, displayName: "Ann Lee", status: "pending" }),
        companion({ kind: "user", userId: "x", displayName: "John Park", status: "accepted" }),
        companion({ kind: "user", userId: "y", displayName: "Rae Fox", status: "declined" }),
        companion({}),
      ]),
    ).toBe("With Ann Lee (invited), John Park (coming), Rae Fox (can't come), A neighbour");
  });
});

describe("compareCompanions (defect 102-D2)", () => {
  it("lists leaders first, then members and typed names, each A to Z, whatever order they arrive in", () => {
    const arrived = [
      companion({ id: "1", displayName: "Sister Ortiz" }),
      companion({ id: "2", kind: "user", userId: "t", displayName: "Tom Reyes", status: "pending" }),
      companion({ id: "3", kind: "member", memberId: MEMBER, displayName: "Ada Moss" }),
      companion({ id: "4", kind: "user", userId: "a", displayName: "aaron Pike", status: "accepted" }),
    ];
    expect([...arrived].sort(compareCompanions).map((c) => c.displayName)).toEqual([
      "aaron Pike",
      "Tom Reyes",
      "Ada Moss",
      "Sister Ortiz",
    ]);
  });

  it("gives the same order from any starting order", () => {
    const people = [
      companion({ id: "1", displayName: "Sister Ortiz" }),
      companion({ id: "2", kind: "user", userId: "t", displayName: "Tom Reyes", status: "pending" }),
      companion({ id: "3", kind: "user", userId: "a", displayName: "Aaron Pike", status: "pending" }),
    ];
    const forward = [...people].sort(compareCompanions).map((c) => c.id);
    const backward = [...people].reverse().sort(compareCompanions).map((c) => c.id);
    expect(backward).toEqual(forward);
  });
});

describe("orderCompanionLeaders", () => {
  it("puts the bishopric first and leaves the booker out", () => {
    const leaders = [{ id: "eq" }, { id: "bishop" }, { id: "c1" }, { id: "rs" }];
    expect(orderCompanionLeaders(leaders, ["bishop", "c1"], "bishop").map((l) => l.id)).toEqual([
      "c1",
      "eq",
      "rs",
    ]);
  });
});

describe("invite wording", () => {
  it("gives the time on the WARD's clock, not the process's", () => {
    // 01:30 UTC on 2 June is 7:30pm on 1 June in Denver.
    const body = visitInviteBody({
      bookerName: "Ann Lee",
      familyName: "Park",
      scheduledFor: "2099-06-02T01:30:00.000Z",
      wardZone: "America/Denver",
    });
    expect(body).toMatch(/^Ann Lee invited you to visit the Park family on /);
    expect(body).toContain("Jun 1");
    expect(body).toMatch(/7:30/);
  });

  it("falls back to words, never a blank", () => {
    expect(describeInvite({ householdName: null, madeByName: null })).toBe(
      "A leader asked you to visit a household",
    );
  });
});

describe("createAppointmentSchema companions", () => {
  const base = { householdId: HOUSEHOLD, scheduledFor: "2099-06-02T01:30:00.000Z" };

  it("defaults to nobody", () => {
    expect(createAppointmentSchema.parse(base).companions).toEqual([]);
  });

  it(`accepts ${MAX_VISIT_COMPANIONS} and refuses one more`, () => {
    const labels = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ kind: "label", label: `Person ${index}` }));
    expect(createAppointmentSchema.safeParse({ ...base, companions: labels(MAX_VISIT_COMPANIONS) }).success).toBe(true);
    expect(
      createAppointmentSchema.safeParse({ ...base, companions: labels(MAX_VISIT_COMPANIONS + 1) }).success,
    ).toBe(false);
  });

  it("refuses the same leader or member twice, and allows two of the same typed name", () => {
    const twice = (person: unknown) =>
      createAppointmentSchema.safeParse({ ...base, companions: [person, person] }).success;
    expect(twice({ kind: "user", userId: LEADER })).toBe(false);
    expect(twice({ kind: "member", memberId: MEMBER })).toBe(false);
    expect(twice({ kind: "label", label: "A neighbour" })).toBe(true);
  });
});
