import { describe, expect, it } from "vitest";
import { buildApplyPlan, buildNotificationBody } from "@/lib/roster/paste/applyRosterPaste";
import {
  buildRosterDiff,
  defaultSelectedIds,
  toReviewView,
  type RosterSnapshot,
  type SnapshotHousehold,
  type SnapshotMember,
} from "@/lib/roster/paste/buildRosterDiff";
import type { ReportPerson } from "@/lib/roster/paste/normalizeReportRow";
import type { ReportColumnKey } from "@/lib/roster/paste/reportColumns";

// Pure: no database. The same inputs must give the same checklist, because the preview and the
// apply each compute it independently.

const ALL_OPTIONAL: ReportColumnKey[] = [
  "gender",
  "phone",
  "email",
  "address",
  "classAssignment",
  "callings",
  "callingsSustained",
  "callingsSetApart",
  "ministeringBrothers",
  "ministeringSisters",
  "hasMinisteringBrothers",
  "hasMinisteringSisters",
];

let rowCounter = 0;

function person(overrides: Partial<ReportPerson> = {}): ReportPerson {
  rowCounter += 1;
  return {
    rowNumber: rowCounter,
    preferredName: "Example, Ann",
    fullName: "Example, Ann Marie",
    firstName: "Ann",
    lastName: "Example",
    birthDate: "1986-06-13",
    gender: "female",
    phone: "555-0101",
    email: "ann@example.com",
    address: "1 Test Lane",
    householdName: "Example, Bo & Ann",
    category: "adult",
    silent: {
      classAssignment: "Relief Society",
      callings: null,
      callingsSustained: null,
      callingsSetApart: null,
      ministeringBrothers: null,
      ministeringSisters: null,
      hasMinisteringBrothers: null,
      hasMinisteringSisters: true,
    },
    supplied: new Set(ALL_OPTIONAL),
    ...overrides,
  };
}

const HOUSEHOLD: SnapshotHousehold = {
  id: "household-1",
  familyName: "Example, Bo & Ann",
  address: "1 Test Lane",
};

// A member exactly as `person()` would have created them.
function member(overrides: Partial<SnapshotMember> = {}): SnapshotMember {
  return {
    id: "member-ann",
    householdId: HOUSEHOLD.id,
    firstName: "Ann",
    lastName: "Example",
    preferredName: "Example, Ann",
    fullName: "Example, Ann Marie",
    birthDate: "1986-06-13",
    gender: "female",
    phone: "555-0101",
    email: "ann@example.com",
    category: "adult",
    status: "active",
    classAssignment: "Relief Society",
    callings: null,
    callingsSustained: null,
    callingsSetApart: null,
    ministeringBrothers: null,
    ministeringSisters: null,
    hasMinisteringBrothers: null,
    hasMinisteringSisters: true,
    ...overrides,
  };
}

function legacyMember(overrides: Partial<SnapshotMember> = {}): SnapshotMember {
  return member({
    preferredName: null,
    fullName: null,
    birthDate: null,
    email: null,
    classAssignment: null,
    hasMinisteringSisters: null,
    ...overrides,
  });
}

function snapshot(
  members: SnapshotMember[],
  households: SnapshotHousehold[] = [HOUSEHOLD],
): RosterSnapshot {
  return { members, households };
}

describe("buildRosterDiff: matching", () => {
  it("matches on full name and birth date, and reports an identical person as unchanged", () => {
    const diff = buildRosterDiff(snapshot([member()]), [person()]);

    expect(diff.newPeople).toEqual([]);
    expect(diff.changedPeople).toEqual([]);
    expect(diff.silentUpdates).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it("matches a legacy member on first and last name, showing full name and birth date as added", () => {
    const diff = buildRosterDiff(snapshot([legacyMember()]), [person()]);

    expect(diff.newPeople).toEqual([]);
    const [changed] = diff.changedPeople;
    expect(changed.memberId).toBe("member-ann");
    const kinds = Object.fromEntries(changed.changes.map((change) => [change.field, change.kind]));
    expect(kinds).toMatchObject({ fullName: "added", birthDate: "added", preferredName: "added" });
  });

  it("treats a row as new when two legacy members share its name, and says so", () => {
    const diff = buildRosterDiff(
      snapshot([legacyMember({ id: "a" }), legacyMember({ id: "b" })]),
      [person()],
    );

    expect(diff.newPeople).toHaveLength(1);
    expect(diff.problems[0].message).toContain("More than one person named");
  });

  it("matches on full name alone when the birth date differs, as a birth date change", () => {
    const diff = buildRosterDiff(snapshot([member({ birthDate: "1986-06-14" })]), [person()]);

    expect(diff.newPeople).toEqual([]);
    expect(diff.changedPeople[0].changes).toEqual([
      expect.objectContaining({ field: "birthDate", before: "1986-06-14", after: "1986-06-13" }),
    ]);
  });

  it("brings back a moved-out member who reappears", () => {
    const diff = buildRosterDiff(snapshot([member({ status: "moved_out" })]), [person()]);

    expect(diff.changedPeople).toEqual([
      expect.objectContaining({ memberId: "member-ann", returning: true, changes: [] }),
    ]);
    expect(diff.movedOut).toEqual([]);
  });

  it("offers an unmatched do-not-contact member as no longer listed, but not a moved-out one", () => {
    const diff = buildRosterDiff(
      snapshot([
        member({ id: "dnc", fullName: "Gone, Dee", status: "do_not_contact" }),
        member({ id: "out", fullName: "Gone, Ed", status: "moved_out" }),
      ]),
      [],
    );

    expect(diff.movedOut.map((item) => item.memberId)).toEqual(["dnc"]);
  });
});

describe("buildRosterDiff: households and fields", () => {
  it("shows a household change by the households' names", () => {
    const other: SnapshotHousehold = { id: "household-2", familyName: "Sample, Dee", address: null };
    const diff = buildRosterDiff(snapshot([member()], [HOUSEHOLD, other]), [
      person({ householdName: "Sample, Dee", address: null }),
    ]);

    expect(diff.changedPeople[0].changes).toContainEqual(
      expect.objectContaining({
        field: "household",
        before: "Example, Bo & Ann",
        after: "Sample, Dee",
        kind: "changed",
      }),
    );
    expect(diff.changedPeople[0].householdChange).toEqual({ householdId: "household-2" });
  });

  it("creates a new household once for everybody in it", () => {
    const diff = buildRosterDiff(snapshot([]), [
      person({ fullName: "New, A", householdName: "New, A & B" }),
      person({ fullName: "New, B", householdName: "new, a & b" }),
    ]);

    expect(diff.newHouseholds).toEqual([
      { key: "household:new, a & b", familyName: "New, A & B", address: "1 Test Lane" },
    ]);
    expect(diff.newPeople.every((item) => item.isNewHousehold)).toBe(true);
  });

  it("offers an address change on an existing household only when the column is supplied", () => {
    const moved = person({ address: "9 New Road" });
    expect(buildRosterDiff(snapshot([member()]), [moved]).householdAddresses).toEqual([
      expect.objectContaining({ householdId: HOUSEHOLD.id, before: "1 Test Lane", after: "9 New Road" }),
    ]);

    const withoutAddress = person({
      address: null,
      supplied: new Set(ALL_OPTIONAL.filter((key) => key !== "address")),
    });
    expect(buildRosterDiff(snapshot([member()]), [withoutAddress]).householdAddresses).toEqual([]);
  });

  it("never reports a missing optional column as a removed value", () => {
    const withoutEmailOrPhone = person({
      email: null,
      phone: null,
      supplied: new Set(ALL_OPTIONAL.filter((key) => key !== "email" && key !== "phone")),
    });

    const diff = buildRosterDiff(snapshot([member()]), [withoutEmailOrPhone]);

    expect(diff.changedPeople).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it("reports a supplied value going blank as removed", () => {
    const diff = buildRosterDiff(snapshot([member()]), [person({ email: null })]);

    expect(diff.changedPeople[0].changes).toEqual([
      expect.objectContaining({ field: "email", kind: "removed", before: "ann@example.com", after: null }),
    ]);
    expect(diff.changedPeople[0].set).toEqual({ email: null });
  });

  it("puts silent field differences in silentUpdates and never in the checklist", () => {
    const diff = buildRosterDiff(snapshot([member()]), [
      person({ silent: { ...person().silent, callings: "Ward Clerk" }, category: "youth" }),
    ]);

    expect(diff.changedPeople).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
    expect(diff.silentUpdates).toEqual([
      { memberId: "member-ann", set: { callings: "Ward Clerk", category: "youth" } },
    ]);
  });
});

describe("buildRosterDiff: defaults, guard and stability", () => {
  it("ticks new, changed and address items by default and leaves move-outs unticked", () => {
    const diff = buildRosterDiff(
      snapshot([member({ phone: "555-9999" }), member({ id: "gone", fullName: "Gone, Ed" })]),
      [person({ address: "9 New Road" }), person({ fullName: "Brand, New", firstName: "New", lastName: "Brand" })],
    );

    expect(diff.newPeople.every((item) => item.defaultSelected)).toBe(true);
    expect(diff.changedPeople.every((item) => item.defaultSelected)).toBe(true);
    expect(diff.householdAddresses.every((item) => item.defaultSelected)).toBe(true);
    expect(diff.movedOut).toHaveLength(1);
    expect(diff.movedOut.every((item) => !item.defaultSelected)).toBe(true);

    const ids = defaultSelectedIds(toReviewView(diff));
    expect(ids).not.toContain("moveout:gone");
    expect(ids).toHaveLength(3);
  });

  function activeMembers(count: number): SnapshotMember[] {
    return Array.from({ length: count }, (_, index) =>
      member({ id: `m${index}`, fullName: `Person, ${index}` }),
    );
  }

  it("is not suspicious at nine move-outs, whatever the share", () => {
    expect(buildRosterDiff(snapshot(activeMembers(9)), []).guard.suspicious).toBe(false);
  });

  it("is suspicious at ten move-outs out of thirty", () => {
    const members = activeMembers(30);
    const keep = members.slice(10).map((kept) =>
      person({ fullName: kept.fullName ?? "", householdName: HOUSEHOLD.familyName }),
    );

    const { guard } = buildRosterDiff(snapshot(members), keep);

    expect(guard).toEqual({ movedOutCount: 10, activeCount: 30, suspicious: true });
  });

  it("is not suspicious at ten move-outs out of a hundred", () => {
    const members = activeMembers(100);
    const keep = members.slice(10).map((kept) => person({ fullName: kept.fullName ?? "" }));

    expect(buildRosterDiff(snapshot(members), keep).guard.suspicious).toBe(false);
  });

  it("gives identical ids for identical inputs", () => {
    const current = snapshot([member({ phone: "1" }), member({ id: "gone", fullName: "Gone, Ed" })]);
    const people = [person(), person({ fullName: "Brand, New", firstName: "New", lastName: "Brand" })];

    const first = buildRosterDiff(current, people);
    const second = buildRosterDiff(current, people);

    expect(toReviewView(second)).toEqual(toReviewView(first));
  });

  it("reports nothing to do when the roster already matches the paste", () => {
    const diff = buildRosterDiff(
      snapshot([member(), member({ id: "bo", fullName: "Example, Bo", firstName: "Bo", preferredName: "Example, Bo" })]),
      [person(), person({ fullName: "Example, Bo", firstName: "Bo", preferredName: "Example, Bo" })],
    );

    expect(diff.newPeople).toEqual([]);
    expect(diff.changedPeople).toEqual([]);
    expect(diff.householdAddresses).toEqual([]);
    expect(diff.movedOut).toEqual([]);
    expect(diff.silentUpdates).toEqual([]);
    expect(diff.unchangedCount).toBe(2);
  });
});

describe("buildApplyPlan", () => {
  const current = snapshot([
    member({ phone: "555-9999" }),
    member({ id: "gone", fullName: "Gone, Ed", firstName: "Ed", lastName: "Gone" }),
    member({ id: "quiet", fullName: "Quiet, Q", firstName: "Q", lastName: "Quiet", callings: "Old" }),
  ]);
  const people = [
    person(),
    person({ fullName: "Quiet, Q", firstName: "Q", lastName: "Quiet", silent: { ...person().silent, callings: "New" } }),
    person({ fullName: "Brand, New", firstName: "New", lastName: "Brand", householdName: "Brand, New" }),
  ];
  const diff = buildRosterDiff(current, people);

  it("writes only the ticked items, plus every silent update", () => {
    const { plan, staleSelections } = buildApplyPlan(diff, new Set(["member:member-ann"]));

    expect(plan.creates).toEqual([]);
    expect(plan.households).toEqual([]);
    expect(plan.move_outs).toEqual([]);
    expect(plan.updates).toContainEqual({ member_id: "member-ann", set: { phone: "555-0101" } });
    expect(plan.updates).toContainEqual({ member_id: "quiet", set: { callings: "New" } });
    expect(staleSelections).toBe(0);
  });

  it("creates only the households a ticked new person needs", () => {
    const newId = diff.newPeople[0].id;
    const { plan } = buildApplyPlan(diff, new Set([newId]));

    expect(plan.households).toEqual([
      { key: "household:brand, new", family_name: "Brand, New", address: "1 Test Lane" },
    ]);
    expect(plan.creates).toEqual([
      expect.objectContaining({ household_key: "household:brand, new", full_name: "Brand, New" }),
    ]);
  });

  it("moves out only the ticked members and counts an unknown id as stale", () => {
    const { plan, staleSelections } = buildApplyPlan(
      diff,
      new Set(["moveout:gone", "member:does-not-exist"]),
    );

    expect(plan.move_outs).toEqual(["gone"]);
    expect(staleSelections).toBe(1);
  });

  it("sets a returning member back to active", () => {
    const returning = buildRosterDiff(snapshot([member({ status: "moved_out" })]), [person()]);
    const { plan, membersReturned } = buildApplyPlan(returning, new Set(["member:member-ann"]));

    expect(plan.updates).toEqual([{ member_id: "member-ann", set: { status: "active" } }]);
    expect(membersReturned).toBe(1);
  });
});

describe("buildNotificationBody", () => {
  // LCR household names contain commas ("Andersen, Mark & Julia"), so a comma-joined list could not
  // be told apart (defect found walking scenario 089).
  it("separates LCR household names with semicolons", () => {
    expect(buildNotificationBody(["Andersen, Mark & Julia", "Brooks, Sarah"], 2)).toBe(
      "Andersen, Mark & Julia; Brooks, Sarah were added by a roster import.",
    );
  });

  it("names four and counts the rest", () => {
    const names = ["A, One", "B, Two", "C, Three", "D, Four", "E, Five"];
    expect(buildNotificationBody(names, 10)).toBe(
      "A, One; B, Two; C, Three; D, Four; and 6 more were added by a roster import.",
    );
  });
});
