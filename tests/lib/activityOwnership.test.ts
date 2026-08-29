import { describe, expect, it } from "vitest";
import {
  canManageActivityLog,
  canManageActivityProfile,
  canWriteFollowUpOn,
  isBishopricRole,
} from "@/lib/youth/activityOwnership";
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
const SECRETARY = "11111111-1111-4111-8111-000000000004";
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
// ---------------------------------------------------------------------------
// THE FOLLOW-UP HALF — TWO MIRRORS OF TWO POLICIES THAT DELIBERATELY DISAGREE
// ---------------------------------------------------------------------------
// canManageActivityLog mirrors migration 058's UPDATE (the author or the bishopric, with NO
// organization arm); canWriteFollowUpOn mirrors migration 057c's INSERT (the bishopric or the
// organization that owns the event through its profile). Which one applies depends on which
// action the screen is offering, and collapsing them breaks in both directions.
//
// tests/rls/activity-logs.test.ts proves the DATABASE refuses a cross-org follow-up and
// tests/routes/youthLogs.test.ts proves the ROUTE answers 403 with a sentence. This proves the
// SCREEN agrees with both — the half no RLS test can see, and the half scenario 056 found missing
// (ITER-021).

describe("canManageActivityLog", () => {
  it("lets the bishopric manage a follow-up somebody else wrote", () => {
    expect(canManageActivityLog(bishop, { loggedBy: EQ_PRESIDENT })).toBe(true);
    expect(canManageActivityLog(counselor, { loggedBy: EQ_PRESIDENT })).toBe(true);
  });

  it("lets an author manage their own follow-up", () => {
    expect(canManageActivityLog(eqPresident, { loggedBy: EQ_PRESIDENT })).toBe(true);
    expect(canManageActivityLog(councilMember, { loggedBy: COUNCIL_MEMBER })).toBe(true);
  });

  it("refuses an org leader a colleague's follow-up", () => {
    expect(canManageActivityLog(eqPresident, { loggedBy: SECRETARY })).toBe(false);
  });

  // THE ASSERTION THAT STOPS SOMEBODY "IMPROVING" THIS FUNCTION WITH AN ORGANIZATION BRANCH.
  // Migration 058's UPDATE policy has no `org_id` arm at all: a follow-up is a personal account of
  // an event, and editing another person's account is not oversight. So on the SAME event — the
  // reader's own organization's, where canWriteFollowUpOn admits them to write their own — they
  // are still refused a colleague's follow-up. The pair is the point; asserting the refusal alone
  // would not say that the organization was ever in question.
  it("refuses a colleague's follow-up even on the reader's own organization's event", () => {
    const ownOrgEvent = { orgId: ELDERS_QUORUM };

    expect(canWriteFollowUpOn(eqPresident, ownOrgEvent)).toBe(true);
    expect(canManageActivityLog(eqPresident, { loggedBy: SECRETARY })).toBe(false);
  });
});

describe("canWriteFollowUpOn", () => {
  it("lets the bishopric write on any organization's event", () => {
    expect(canWriteFollowUpOn(bishop, { orgId: RELIEF_SOCIETY })).toBe(true);
    expect(canWriteFollowUpOn(counselor, { orgId: RELIEF_SOCIETY })).toBe(true);
  });

  it("lets an org leader write on their own organization's event", () => {
    expect(canWriteFollowUpOn(eqPresident, { orgId: ELDERS_QUORUM })).toBe(true);
  });

  // THE SCENARIO 056 DEFECT, ASSERTED DIRECTLY. "Say how it went" was offered here and the route
  // answered 403.
  it("refuses an org leader another organization's event", () => {
    expect(canWriteFollowUpOn(eqPresident, { orgId: RELIEF_SOCIETY })).toBe(false);
  });

  // The arm the walk verified working, and which must not regress: absent means ward-wide, and a
  // ward-wide activity is the ORDINARY case for this module.
  it("lets an org leader write on a ward-wide event", () => {
    expect(canWriteFollowUpOn(eqPresident, { orgId: null })).toBe(true);
  });

  it("lets a no-organization account write on a ward-wide event", () => {
    expect(canWriteFollowUpOn(councilMember, { orgId: null })).toBe(true);
  });

  // The null-equals-null trap, which applies to THIS side of the comparison only. SQL's
  // `null = current_org_id()` is NULL rather than true, so a reader with no organization cannot
  // match an owned profile.
  it("refuses a no-organization account an owned event", () => {
    expect(canWriteFollowUpOn(councilMember, { orgId: RELIEF_SOCIETY })).toBe(false);
  });

  // `activity_event_is_in_caller_org` resolves the profile with a LEFT JOIN, so an event with no
  // profile at all yields a null org_id and satisfies the policy's `profile.org_id is null` arm.
  it("treats an event with no profile as ward-wide", () => {
    expect(canWriteFollowUpOn(eqPresident, null)).toBe(true);
    expect(canWriteFollowUpOn(councilMember, null)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // THE INVERSION, WRITTEN AS ONE TEST SO A "UNIFYING" REFACTOR GOES RED WITH THE REASON ATTACHED
  // ---------------------------------------------------------------------------
  // The SAME `{ orgId: null }` that canManageActivityProfile REFUSES for a non-author is ADMITTED
  // here. The two policies genuinely differ: `youth_activity_profiles_update` compares
  // `org_id = current_org_id()` directly, while `activity_event_is_in_caller_org` carries an
  // explicit `profile.org_id is null` arm. Two mirrors of two different policies are allowed to
  // disagree; a reader assuming they agree is the hazard.
  it("inverts canManageActivityProfile on a null organization, deliberately", () => {
    const wardWide = { orgId: null };

    expect(canManageActivityProfile(eqPresident, { ...wardWide, enteredBy: SECRETARY })).toBe(
      false,
    );
    expect(canWriteFollowUpOn(eqPresident, wardWide)).toBe(true);
  });

  // The scenario 056 seed, asserted as the table it is — this is the screen the walk found wrong.
  it("matches the shape of scenario 056 for a Young Men president", () => {
    const youngMen = ELDERS_QUORUM;
    const youngWomen = RELIEF_SOCIETY;
    const ymPresident: Actor = { id: EQ_PRESIDENT, role: "org_president", orgId: youngMen };

    const seeded = [
      { name: "Varsity basketball", orgId: youngMen, expected: true },
      { name: "Winter concert", orgId: youngWomen, expected: false },
      { name: "Community orchestra", orgId: null, expected: true },
    ];

    for (const event of seeded) {
      expect(
        canWriteFollowUpOn(ymPresident, { orgId: event.orgId }),
        `${event.name} should ${event.expected ? "offer" : "withhold"} the follow-up control`,
      ).toBe(event.expected);
    }
  });
});
