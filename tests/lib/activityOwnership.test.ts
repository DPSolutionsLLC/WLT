import { describe, expect, it } from "vitest";
import { canManageActivityProfile, isBishopricRole } from "@/lib/youth/activityOwnership";
import type { SessionUser } from "@/types/domain";

// The UI half of migration 054d, table-driven over the cases the policy distinguishes.
//
// This suite exists because the walk of scenario 049 found Edit and Remove offered on every
// organization's activities (youth-a-D1). RLS refused the writes, so nothing leaked — but a leader
// was handed a destructive control that could never succeed. tests/rls/youth-activity-scope.test.ts
// proves the DATABASE refuses; this proves the SCREEN agrees with it, which is the half no RLS
// test can see.

const BISHOP = "11111111-1111-4111-8111-000000000001";
const EQ_PRESIDENT = "11111111-1111-4111-8111-000000000002";
const COUNCIL_MEMBER = "11111111-1111-4111-8111-000000000003";
const ELDERS_QUORUM = "22222222-2222-4222-8222-000000000001";
const RELIEF_SOCIETY = "22222222-2222-4222-8222-000000000002";

type Actor = Pick<SessionUser, "id" | "role" | "orgId">;

const bishop: Actor = { id: BISHOP, role: "bishop", orgId: null };
const counselor: Actor = { id: BISHOP, role: "counselor", orgId: null };
const eqPresident: Actor = { id: EQ_PRESIDENT, role: "org_president", orgId: ELDERS_QUORUM };
// The role the phase plan calls the widest in the app, and the one most likely to have no
// organization at all.
const councilMember: Actor = { id: COUNCIL_MEMBER, role: "ward_council_member", orgId: null };

describe("isBishopricRole", () => {
  it.each(["bishop", "counselor"] as const)("admits %s", (role) => {
    expect(isBishopricRole(role)).toBe(true);
  });

  it.each(["org_president", "org_secretary", "ward_council_member", "ward_secretary"] as const)(
    "excludes %s",
    (role) => {
      expect(isBishopricRole(role)).toBe(false);
    },
  );
});

describe("canManageActivityProfile", () => {
  it("lets the bishopric manage any organization's activity", () => {
    expect(
      canManageActivityProfile(bishop, { orgId: RELIEF_SOCIETY, enteredBy: EQ_PRESIDENT }),
    ).toBe(true);
    expect(
      canManageActivityProfile(counselor, { orgId: RELIEF_SOCIETY, enteredBy: EQ_PRESIDENT }),
    ).toBe(true);
  });

  it("lets the bishopric manage a ward-wide activity somebody else entered", () => {
    expect(canManageActivityProfile(bishop, { orgId: null, enteredBy: COUNCIL_MEMBER })).toBe(true);
  });

  it("lets an org leader manage their own organization's activity", () => {
    expect(
      canManageActivityProfile(eqPresident, { orgId: ELDERS_QUORUM, enteredBy: BISHOP }),
    ).toBe(true);
  });

  it("refuses an org leader another organization's activity", () => {
    expect(
      canManageActivityProfile(eqPresident, { orgId: RELIEF_SOCIETY, enteredBy: BISHOP }),
    ).toBe(false);
  });

  it("lets the creator manage what they entered, whatever organization owns it", () => {
    expect(
      canManageActivityProfile(eqPresident, {
        orgId: RELIEF_SOCIETY,
        enteredBy: EQ_PRESIDENT,
      }),
    ).toBe(true);
  });

  it("lets a council member with no organization manage the ward-wide activity they entered", () => {
    expect(
      canManageActivityProfile(councilMember, { orgId: null, enteredBy: COUNCIL_MEMBER }),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // THE null === null TRAP, WHICH IS THE WHOLE REASON THIS FUNCTION IS NOT A ONE-LINER
  // ---------------------------------------------------------------------------
  // SQL says `null = null` is NULL, so policy 054d refuses these. JavaScript says
  // `null === null` is true, so a naive comparison would hand a no-organization account edit
  // controls on EVERY ward-wide activity in the ward — and ward-wide is the ordinary case here,
  // not an edge one.
  it("refuses a no-organization account somebody else's ward-wide activity", () => {
    expect(
      canManageActivityProfile(councilMember, { orgId: null, enteredBy: EQ_PRESIDENT }),
    ).toBe(false);
  });

  it("refuses an org leader somebody else's ward-wide activity", () => {
    expect(
      canManageActivityProfile(eqPresident, { orgId: null, enteredBy: COUNCIL_MEMBER }),
    ).toBe(false);
  });

  // `entered_by` is nullable in migration 009 — a profile survives the user who entered it. A null
  // there must match nobody rather than everybody.
  it("refuses on a null enteredBy rather than matching it", () => {
    expect(canManageActivityProfile(councilMember, { orgId: null, enteredBy: null })).toBe(false);
    expect(canManageActivityProfile(eqPresident, { orgId: null, enteredBy: null })).toBe(false);
  });

  it("still admits the owning organization when enteredBy is null", () => {
    expect(
      canManageActivityProfile(eqPresident, { orgId: ELDERS_QUORUM, enteredBy: null }),
    ).toBe(true);
  });

  // The scenario 049 seed, asserted as the table it is — this is the screen the walk found wrong.
  it("matches the shape of scenario 049 for a Young Men president", () => {
    const youngMen = ELDERS_QUORUM;
    const youngWomen = RELIEF_SOCIETY;
    const ymPresident: Actor = { id: EQ_PRESIDENT, role: "org_president", orgId: youngMen };

    const seeded = [
      { name: "Varsity basketball", orgId: youngMen, enteredBy: EQ_PRESIDENT, expected: true },
      { name: "Chamber choir", orgId: youngWomen, enteredBy: BISHOP, expected: false },
      { name: "Debate team", orgId: youngWomen, enteredBy: BISHOP, expected: false },
      { name: "Community orchestra", orgId: null, enteredBy: COUNCIL_MEMBER, expected: false },
    ];

    for (const profile of seeded) {
      expect(
        canManageActivityProfile(ymPresident, {
          orgId: profile.orgId,
          enteredBy: profile.enteredBy,
        }),
        `${profile.name} should be ${profile.expected ? "manageable" : "read-only"}`,
      ).toBe(profile.expected);
    }
  });
});
