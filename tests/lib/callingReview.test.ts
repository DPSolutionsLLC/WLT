import { describe, expect, it } from "vitest";
import {
  buildCallingReview,
  listUnlinkedHolders,
  type CallingReviewInput,
  type UnlinkedHolderInput,
  type ReviewCalling,
  type ReviewMember,
} from "@/lib/callings/callingReview";

// THE CALLING REVIEW (ITER-058 cr2) — pure, so every row kind is asserted here without a database.
// The route test (tests/routes/calling-review.test.ts) proves the writes.

const EQ = { id: "org-eq", type: "elders_quorum" as const, name: "Elders Quorum" };
const RS = { id: "org-rs", type: "relief_society" as const, name: "Relief Society" };

function member(id: string, callings: string | null, status: ReviewMember["status"] = "active"): ReviewMember {
  return { id, name: `Member ${id}`, status, callings };
}

function calling(
  userId: string,
  fields: Partial<ReviewCalling> & Pick<ReviewCalling, "role">,
): ReviewCalling {
  return {
    id: `calling-${userId}`,
    userId,
    orgId: null,
    counselorPosition: null,
    source: "manual",
    ...fields,
  };
}

function input(overrides: Partial<CallingReviewInput>): CallingReviewInput {
  return {
    links: [],
    members: [],
    callings: [],
    organizations: [EQ, RS],
    accountNames: new Map([
      ["a", "Alma Account"],
      ["b", "Beth Account"],
      ["c", "Carl Account"],
    ]),
    ...overrides,
  };
}

describe("buildCallingReview", () => {
  it("proposes a change when the ward list disagrees with the app", () => {
    const rows = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Elders Quorum President")],
        callings: [calling("a", { role: "org_counselor", orgId: EQ.id })],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "change",
      userId: "a",
      callingId: "calling-a",
      current: { role: "org_counselor", orgId: EQ.id, counselorPosition: null },
      target: { role: "org_president", orgId: EQ.id, counselorPosition: null },
      canApply: true,
      defaultSelected: false,
    });
    expect(rows[0].sentence).toBe(
      "Alma Account: from Elders Quorum Counselor to Elders Quorum President.",
    );
  });

  it("produces no row when the ward list and the app agree", () => {
    const rows = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Bishop")],
        callings: [calling("a", { role: "bishop" })],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("swaps two counselors as two change rows and no release", () => {
    const rows = buildCallingReview(
      input({
        links: [
          { userId: "a", memberId: "m-a" },
          { userId: "b", memberId: "m-b" },
        ],
        members: [member("m-a", "Bishopric Second Counselor"), member("m-b", "Bishopric First Counselor")],
        callings: [
          calling("a", { role: "counselor", counselorPosition: 1 }),
          calling("b", { role: "counselor", counselorPosition: 2 }),
        ],
      }),
    );

    expect(rows.map((row) => row.kind)).toEqual(["change", "change"]);
    expect(rows.map((row) => row.sentence)).toEqual([
      "Alma Account: from 1st Counselor to 2nd Counselor.",
      "Beth Account: from 2nd Counselor to 1st Counselor.",
    ]);
  });

  it("names the calling set aside when two map, and the higher one wins", () => {
    const rows = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Music Coordinator\nElders Quorum President\nWard Mission Leader")],
        callings: [calling("a", { role: "org_counselor", orgId: EQ.id })],
      }),
    );

    expect(rows[0].target?.role).toBe("org_president");
    expect(rows[0].details).toEqual([
      "Also holds Music Coordinator, set aside for Elders Quorum President",
      "Calling not recognised: Ward Mission Leader",
    ]);
  });

  it("calls a linked account that holds no calling here", () => {
    const rows = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Ward Clerk")],
      }),
    );
    expect(rows[0]).toMatchObject({
      kind: "call",
      callingId: null,
      current: null,
      target: { role: "ward_secretary", orgId: null, counselorPosition: null },
    });
  });

  it("releases somebody who moved out, saying so", () => {
    const rows = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Ward Clerk", "moved_out")],
        callings: [calling("a", { role: "ward_secretary" })],
      }),
    );
    expect(rows[0]).toMatchObject({ kind: "release", id: "release:calling-a", target: null });
    expect(rows[0].sentence).toBe(
      "Member m-a is no longer on the ward list. Release their Ward Secretary calling?",
    );
  });

  it("releases somebody whose record is gone from the list", () => {
    const rows = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-missing" }],
        callings: [calling("a", { role: "ward_secretary" })],
      }),
    );
    expect(rows[0].kind).toBe("release");
    expect(rows[0].sentence).toContain("Alma Account is no longer on the ward list");
  });

  it("releases somebody whose only calling is not recognised, and lists it", () => {
    const rows = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Primary Teacher")],
        callings: [calling("a", { role: "ward_secretary" })],
      }),
    );
    expect(rows[0].kind).toBe("release");
    expect(rows[0].sentence).toContain("holds no calling the app recognises");
    expect(rows[0].details).toEqual(["Calling not recognised: Primary Teacher"]);
  });

  it("never proposes releasing a ward council member the list cannot name, until they leave it", () => {
    const stays = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Ward Mission Leader")],
        callings: [calling("a", { role: "ward_council_member" })],
      }),
    );
    expect(stays).toEqual([]);

    const leaves = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Ward Mission Leader", "moved_out")],
        callings: [calling("a", { role: "ward_council_member" })],
      }),
    );
    expect(leaves.map((row) => row.kind)).toEqual(["release"]);
  });

  it("shows an override that differs as a keep-or-clear row", () => {
    const rows = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Ward Clerk")],
        callings: [calling("a", { role: "executive_secretary", source: "override" })],
      }),
    );
    expect(rows[0]).toMatchObject({
      kind: "override",
      target: { role: "ward_secretary" },
      canApply: true,
    });
    expect(rows[0].sentence).toContain("overridden by the super admin as Executive Secretary");
  });

  it("shows no row for an override that already matches the ward list", () => {
    const rows = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Ward Clerk")],
        callings: [calling("a", { role: "ward_secretary", source: "override" })],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("cannot apply a calling whose organization the ward does not have", () => {
    const rows = buildCallingReview(
      input({
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Primary President")],
        callings: [calling("a", { role: "ward_secretary" })],
      }),
    );
    expect(rows[0]).toMatchObject({
      kind: "unresolvable",
      canApply: false,
      refusal: "Can't apply: this ward has no Primary organization.",
    });
  });

  it("cannot apply when the ward has two organizations of that type", () => {
    const rows = buildCallingReview(
      input({
        organizations: [EQ, { id: "org-eq-2", type: "elders_quorum", name: "Elders Quorum 2" }],
        links: [{ userId: "a", memberId: "m-a" }],
        members: [member("m-a", "Elders Quorum President")],
        callings: [calling("a", { role: "ward_secretary" })],
      }),
    );
    expect(rows[0].refusal).toBe("Can't apply: this ward has more than one Elders Quorum organization.");
  });

  it("skips callings the ward list does not decide, and accounts that are not linked", () => {
    const rows = buildCallingReview(
      input({
        links: [
          { userId: "a", memberId: "m-a" },
          { userId: "b", memberId: "m-b" },
        ],
        members: [member("m-a", "Bishop"), member("m-b", "Bishop")],
        callings: [
          calling("a", { role: "super_admin" }),
          calling("b", { role: "sacrament_manager" }),
          calling("c", { role: "ward_secretary" }),
        ],
      }),
    );
    expect(rows).toEqual([]);
  });

  it("starts every row unticked and gives the same ids on two runs", () => {
    const shape = input({
      links: [
        { userId: "a", memberId: "m-a" },
        { userId: "b", memberId: "m-b" },
        { userId: "c", memberId: "m-c" },
      ],
      members: [
        member("m-a", "Bishopric Second Counselor"),
        member("m-b", "Ward Clerk", "moved_out"),
        member("m-c", "Relief Society Secretary"),
      ],
      callings: [
        calling("a", { role: "counselor", counselorPosition: 1 }),
        calling("b", { role: "ward_secretary" }),
      ],
    });

    const first = buildCallingReview(shape);
    const second = buildCallingReview(shape);

    expect(first.every((row) => row.defaultSelected === false)).toBe(true);
    expect(first.map((row) => row.id)).toEqual(second.map((row) => row.id));
    expect(first.map((row) => row.kind)).toEqual(["change", "call", "release"]);
  });

  it("gives a change a new id when the ward list's answer changes", () => {
    const base = {
      links: [{ userId: "a", memberId: "m-a" }],
      callings: [calling("a", { role: "ward_secretary" })],
    };
    const toClerk = buildCallingReview(input({ ...base, members: [member("m-a", "Ward Executive Secretary")] }));
    const toMusic = buildCallingReview(input({ ...base, members: [member("m-a", "Music Coordinator")] }));
    expect(toClerk[0].id).not.toBe(toMusic[0].id);
  });
});

describe("listUnlinkedHolders (cr4)", () => {
  function holderInput(overrides: Partial<UnlinkedHolderInput>): UnlinkedHolderInput {
    return {
      members: [],
      linkedMemberIds: new Set(),
      invitedMemberIds: new Set(),
      declinedMemberIds: new Map(),
      unlinkedAccountsByEmail: new Map(),
      organizations: [EQ, RS],
      ...overrides,
    };
  }

  function withEmail(id: string, callings: string | null, email: string | null = null) {
    return { ...member(id, callings), email };
  }

  it("lists a ward list calling with no linked account, offering an invite", () => {
    const holders = listUnlinkedHolders(
      holderInput({ members: [withEmail("m-clerk", "Ward Clerk", "clerk@example.com")] }),
    );
    expect(holders).toEqual([
      {
        memberId: "m-clerk",
        memberName: "Member m-clerk",
        email: "clerk@example.com",
        role: "ward_secretary",
        callingLabel: expect.any(String),
        state: "invite",
        possibleAccountName: null,
        declinedAt: null,
      },
    ]);
  });

  it("leaves out linked people, moved-out people and titles the app does not recognise", () => {
    const holders = listUnlinkedHolders(
      holderInput({
        members: [
          withEmail("m-linked", "Ward Clerk"),
          { ...withEmail("m-gone", "Bishop"), status: "moved_out" },
          withEmail("m-assistant", "Ward Assistant Clerk"),
          withEmail("m-ym", "Young Men President"),
        ],
        linkedMemberIds: new Set(["m-linked"]),
      }),
    );
    expect(holders).toEqual([]);
  });

  it("leaves out a calling whose organization cannot be resolved", () => {
    const holders = listUnlinkedHolders(
      holderInput({ members: [withEmail("m-p", "Primary President")] }),
    );
    expect(holders).toEqual([]);
  });

  it("says when somebody has already been invited", () => {
    const [holder] = listUnlinkedHolders(
      holderInput({
        members: [withEmail("m-eq", "Elders Quorum President")],
        invitedMemberIds: new Set(["m-eq"]),
      }),
    );
    expect(holder.state).toBe("invited");
  });

  it("says when the person answered their latest invite \"not me\"", () => {
    const [holder] = listUnlinkedHolders(
      holderInput({
        members: [withEmail("m-eq", "Elders Quorum President")],
        declinedMemberIds: new Map([["m-eq", "2026-11-18T12:00:00Z"]]),
      }),
    );
    expect(holder).toMatchObject({ state: "declined", declinedAt: "2026-11-18T12:00:00Z" });
  });

  it("prefers a fresh invite over an older \"not me\"", () => {
    const [holder] = listUnlinkedHolders(
      holderInput({
        members: [withEmail("m-eq", "Elders Quorum President")],
        invitedMemberIds: new Set(["m-eq"]),
        declinedMemberIds: new Map([["m-eq", "2026-11-18T12:00:00Z"]]),
      }),
    );
    expect(holder.state).toBe("invited");
  });

  it("names an unlinked account with the same email, case-insensitively, instead of offering an invite", () => {
    const [holder] = listUnlinkedHolders(
      holderInput({
        members: [withEmail("m-rs", "Relief Society President", " Rosa@Example.com ")],
        invitedMemberIds: new Set(["m-rs"]),
        unlinkedAccountsByEmail: new Map([["rosa@example.com", "Rosa Account"]]),
      }),
    );
    expect(holder).toMatchObject({ state: "maybe_account", possibleAccountName: "Rosa Account" });
  });

  it("orders by calling precedence, then name", () => {
    const holders = listUnlinkedHolders(
      holderInput({
        members: [
          withEmail("m-2", "Music Coordinator"),
          withEmail("m-1", "Bishop"),
          withEmail("m-3", "Ward Clerk"),
        ],
      }),
    );
    expect(holders.map((holder) => holder.role)).toEqual(["bishop", "ward_secretary", "music_coordinator"]);
  });
});
