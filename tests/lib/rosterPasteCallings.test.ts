import { describe, expect, it } from "vitest";
import { buildCallingReview, type CallingReviewRow } from "@/lib/callings/callingReview";
import { buildApplyPlan } from "@/lib/roster/paste/applyRosterPaste";
import {
  buildRosterDiff,
  defaultSelectedIds,
  toReviewView,
  type SnapshotMember,
} from "@/lib/roster/paste/buildRosterDiff";
import {
  OWN_CALLING_ROW_MESSAGE,
  countTickedChanges,
  isCallingReviewId,
  reconcileMoveOutTicks,
  toPasteCallingReview,
  type PasteCallingRow,
} from "@/lib/roster/paste/callingRows";
import type { ReportPerson } from "@/lib/roster/paste/normalizeReportRow";
import type { ReportColumnKey } from "@/lib/roster/paste/reportColumns";

// CALLINGS ON A ROSTER PASTE (ITER-058 cr3), pure. The writes are in
// tests/routes/roster-paste-import.test.ts.

const SUPPLIED: ReportColumnKey[] = ["callings"];

function person(overrides: Partial<ReportPerson> = {}): ReportPerson {
  return {
    rowNumber: 1,
    preferredName: "Example, Ann",
    fullName: "Example, Ann Marie",
    firstName: "Ann",
    lastName: "Example",
    birthDate: "1986-06-13",
    gender: null,
    phone: null,
    email: null,
    address: null,
    householdName: "Example, Ann",
    category: "adult",
    silent: {
      classAssignment: null,
      callings: "Ward Clerk",
      callingsSustained: null,
      callingsSetApart: null,
      ministeringBrothers: null,
      ministeringSisters: null,
      hasMinisteringBrothers: null,
      hasMinisteringSisters: null,
    },
    supplied: new Set(SUPPLIED),
    ...overrides,
  };
}

function member(overrides: Partial<SnapshotMember> = {}): SnapshotMember {
  return {
    id: "member-ann",
    householdId: "household-1",
    firstName: "Ann",
    lastName: "Example",
    preferredName: "Example, Ann",
    fullName: "Example, Ann Marie",
    birthDate: "1986-06-13",
    gender: null,
    phone: null,
    email: null,
    category: "adult",
    status: "active",
    classAssignment: null,
    callings: "Music Coordinator",
    callingsSustained: null,
    callingsSetApart: null,
    ministeringBrothers: null,
    ministeringSisters: null,
    hasMinisteringBrothers: null,
    hasMinisteringSisters: null,
    ...overrides,
  };
}

const HOUSEHOLDS = [{ id: "household-1", familyName: "Example, Ann", address: null }];

function reviewRow(overrides: Partial<CallingReviewRow>): CallingReviewRow {
  return {
    id: "calling:c1:ward_secretary.-.-",
    kind: "change",
    userId: "user-1",
    accountName: "Ann Example",
    memberId: "member-ann",
    memberName: "Ann Example",
    callingId: "c1",
    current: { role: "music_coordinator", orgId: null, counselorPosition: null },
    currentLabel: "Music Coordinator",
    target: { role: "ward_secretary", orgId: null, counselorPosition: null },
    sentence: "Ann Example: from Music Coordinator to Ward Secretary.",
    details: [],
    defaultSelected: false,
    canApply: true,
    refusal: null,
    ...overrides,
  };
}

const RELEASE = reviewRow({
  id: "release:c1",
  kind: "release",
  current: { role: "ward_secretary", orgId: null, counselorPosition: null },
  currentLabel: "Ward Secretary",
  target: null,
  sentence: "Ann Example is no longer on the ward list. Release their Ward Secretary calling?",
});

const ACTOR = { id: "actor", isSuperAdmin: false };

describe("what a paste says about callings", () => {
  it("carries the pasted callings text for a matched member", () => {
    const diff = buildRosterDiff({ members: [member()], households: HOUSEHOLDS }, [person()]);

    expect(diff.pastedRoster.callings.get("member-ann")).toBe("Ward Clerk");
    expect(diff.pastedRoster.statuses.has("member-ann")).toBe(false);
  });

  it("says nothing about callings when the paste has no Callings column", () => {
    const diff = buildRosterDiff({ members: [member()], households: HOUSEHOLDS }, [
      person({ supplied: new Set<ReportColumnKey>() }),
    ]);

    expect(diff.pastedRoster.callings.has("member-ann")).toBe(false);
  });

  it("marks somebody the paste leaves off as moved out, and somebody it brings back as active", () => {
    const gone = buildRosterDiff({ members: [member()], households: HOUSEHOLDS }, []);
    const back = buildRosterDiff(
      { members: [member({ status: "moved_out" })], households: HOUSEHOLDS },
      [person()],
    );

    expect(gone.pastedRoster.statuses.get("member-ann")).toBe("moved_out");
    expect(back.pastedRoster.statuses.get("member-ann")).toBe("active");
  });
});

describe("calling ids on the paste checklist", () => {
  it("recognises every id the calling review produces and none of the paste's own", () => {
    for (const id of ["calling:c:x", "call:u:x", "release:c", "override:c:x", "unresolvable:u:x"]) {
      expect(isCallingReviewId(id)).toBe(true);
    }
    for (const id of ["new:x", "member:x", "household:x", "moveout:x"]) {
      expect(isCallingReviewId(id)).toBe(false);
    }
  });

  it("recognises the ids buildCallingReview really builds", () => {
    const rows = buildCallingReview({
      links: [
        { userId: "a", memberId: "m-a" },
        { userId: "b", memberId: "m-b" },
        { userId: "c", memberId: "m-c" },
      ],
      members: [
        { id: "m-a", name: "A", status: "active", callings: "Ward Clerk" },
        { id: "m-b", name: "B", status: "moved_out", callings: null },
        { id: "m-c", name: "C", status: "active", callings: "Ward Clerk" },
      ],
      callings: [
        { id: "c-a", userId: "a", role: "music_coordinator", orgId: null, counselorPosition: null, source: "manual" },
        { id: "c-b", userId: "b", role: "music_coordinator", orgId: null, counselorPosition: null, source: "manual" },
      ],
      organizations: [],
      accountNames: new Map(),
    });

    expect(rows.map((row) => row.kind).sort()).toEqual(["call", "change", "release"]);
    expect(rows.every((row) => isCallingReviewId(row.id))).toBe(true);
  });

  it("does not count a ticked calling id as a stale roster item", () => {
    const diff = buildRosterDiff({ members: [member()], households: HOUSEHOLDS }, [person()]);

    const { staleSelections } = buildApplyPlan(diff, new Set(["calling:c1:x", "member:unknown"]));

    expect(staleSelections).toBe(1);
  });

  it("still applies the silent callings text when no calling is ticked", () => {
    const diff = buildRosterDiff({ members: [member()], households: HOUSEHOLDS }, [person()]);

    const { plan } = buildApplyPlan(diff, new Set());

    expect(plan.updates).toEqual([{ member_id: "member-ann", set: { callings: "Ward Clerk" } }]);
  });

  it("starts every calling row unticked", () => {
    const diff = buildRosterDiff({ members: [member()], households: HOUSEHOLDS }, [person()]);
    const callingChanges = toPasteCallingReview({
      rows: [reviewRow({})],
      movedOutMemberIds: new Set(),
      actor: ACTOR,
      canReview: true,
    });

    const ids = defaultSelectedIds(toReviewView(diff, callingChanges));

    expect(ids.some(isCallingReviewId)).toBe(false);
  });
});

describe("toPasteCallingReview", () => {
  it("sends the browser labels and ids, and no account or role", () => {
    const { rows } = toPasteCallingReview({
      rows: [reviewRow({})],
      movedOutMemberIds: new Set(),
      actor: ACTOR,
      canReview: true,
    });

    expect(rows[0]).toEqual({
      id: "calling:c1:ward_secretary.-.-",
      sentence: "Ann Example: from Music Coordinator to Ward Secretary.",
      details: [],
      isRelease: false,
      canApply: true,
      refusal: null,
      moveOutId: null,
      releasedCallingLabel: null,
    });
  });

  it("tells somebody who cannot decide callings only that changes exist", () => {
    const review = toPasteCallingReview({
      rows: [reviewRow({})],
      movedOutMemberIds: new Set(),
      actor: ACTOR,
      canReview: false,
    });

    expect(review).toEqual({ rows: [], reviewedByBishopric: true });
  });

  it("says nothing to that person when there are no changes", () => {
    const review = toPasteCallingReview({
      rows: [],
      movedOutMemberIds: new Set(),
      actor: ACTOR,
      canReview: false,
    });

    expect(review.reviewedByBishopric).toBe(false);
  });

  it("refuses the actor's own row, unless they are the super admin", () => {
    const own = reviewRow({ userId: ACTOR.id });

    const ordinary = toPasteCallingReview({
      rows: [own],
      movedOutMemberIds: new Set(),
      actor: ACTOR,
      canReview: true,
    });
    const superAdmin = toPasteCallingReview({
      rows: [own],
      movedOutMemberIds: new Set(),
      actor: { id: ACTOR.id, isSuperAdmin: true },
      canReview: true,
    });

    expect(ordinary.rows[0]).toMatchObject({ canApply: false, refusal: OWN_CALLING_ROW_MESSAGE });
    expect(superAdmin.rows[0]).toMatchObject({ canApply: true, refusal: null });
  });

  it("ties a release to the move-out only for somebody this paste leaves off", () => {
    const leftOff = toPasteCallingReview({
      rows: [RELEASE],
      movedOutMemberIds: new Set(["member-ann"]),
      actor: ACTOR,
      canReview: true,
    });
    const alreadyGone = toPasteCallingReview({
      rows: [RELEASE],
      movedOutMemberIds: new Set(),
      actor: ACTOR,
      canReview: true,
    });

    expect(leftOff.rows[0]).toMatchObject({
      isRelease: true,
      moveOutId: "moveout:member-ann",
      releasedCallingLabel: "Ward Secretary",
    });
    expect(alreadyGone.rows[0]).toMatchObject({ isRelease: true, moveOutId: null });
  });

  it("never ties the actor's own release to their move-out", () => {
    const { rows } = toPasteCallingReview({
      rows: [{ ...RELEASE, userId: ACTOR.id }],
      movedOutMemberIds: new Set(["member-ann"]),
      actor: ACTOR,
      canReview: true,
    });

    expect(rows[0]).toMatchObject({ isRelease: false, canApply: false, moveOutId: null });
  });

  it("does not call a row that cannot be applied a release", () => {
    const { rows } = toPasteCallingReview({
      rows: [reviewRow({ kind: "unresolvable", target: null, canApply: false, refusal: "No." })],
      movedOutMemberIds: new Set(["member-ann"]),
      actor: ACTOR,
      canReview: true,
    });

    expect(rows[0]).toMatchObject({ isRelease: false, canApply: false, moveOutId: null });
  });
});

describe("reconcileMoveOutTicks", () => {
  const row: PasteCallingRow = {
    id: "release:c1",
    sentence: "",
    details: [],
    isRelease: true,
    canApply: true,
    refusal: null,
    moveOutId: "moveout:m",
    releasedCallingLabel: "Ward Secretary",
  };

  it("ticks the release with the move-out", () => {
    const next = reconcileMoveOutTicks(new Set(["moveout:m"]), [row]);
    expect([...next].sort()).toEqual(["moveout:m", "release:c1"]);
  });

  it("unticks the release with the move-out", () => {
    const next = reconcileMoveOutTicks(new Set(["release:c1"]), [row]);
    expect([...next]).toEqual([]);
  });

  it("leaves a release that is not tied to a move-out alone", () => {
    const untied: PasteCallingRow = { ...row, id: "release:c2", moveOutId: null };
    const next = reconcileMoveOutTicks(new Set(["release:c2"]), [untied]);
    expect([...next]).toEqual(["release:c2"]);
  });
});

describe("countTickedChanges", () => {
  const row: PasteCallingRow = {
    id: "release:c1",
    sentence: "",
    details: [],
    isRelease: true,
    canApply: true,
    refusal: null,
    moveOutId: "moveout:m",
    releasedCallingLabel: "Ward Secretary",
  };

  it("counts a move-out and the release inside it as one change", () => {
    expect(countTickedChanges(new Set(["moveout:m", "release:c1", "changed:x"]), [row])).toBe(2);
  });
});
