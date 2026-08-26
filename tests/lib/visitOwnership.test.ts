import { describe, expect, it } from "vitest";
import { canManageVisitLog } from "@/lib/visits/visitOwnership";
import { ROLES, type Role, type SessionUser } from "@/types/domain";

// Pure. This mirrors migration 019's `visit_logs_update` org clause, and the whole value of the
// function is that the two agree — so these cases are written from the POLICY, not from the
// button that calls it.
//
// The bug it exists to stop: with cross-org visibility on, the Recent visits panel offered
// "Flag for ward council" on every organization's visits. RLS refused the writes, so nothing
// leaked — but a leader was invited through a locked door. Found walking scenario 042.

const EQ = "aaaaaaaa-0000-4000-8000-000000000001";
const RS = "bbbbbbbb-0000-4000-8000-000000000002";

function actor(role: Role, orgId: string | null): Pick<SessionUser, "role" | "orgId"> {
  return { role, orgId };
}

describe("canManageVisitLog", () => {
  // is_bishopric() with no org clause after it: the bishopric may write to any visit in the ward,
  // including one belonging to an organization and one belonging to none.
  it.each(["bishop", "counselor"] as const)("lets a %s manage any visit", (role) => {
    expect(canManageVisitLog(actor(role, null), EQ)).toBe(true);
    expect(canManageVisitLog(actor(role, null), RS)).toBe(true);
    expect(canManageVisitLog(actor(role, null), null)).toBe(true);
  });

  it("lets an organization leader manage their own organization's visit", () => {
    expect(canManageVisitLog(actor("org_president", EQ), EQ)).toBe(true);
    expect(canManageVisitLog(actor("org_counselor", EQ), EQ)).toBe(true);
    expect(canManageVisitLog(actor("org_secretary", EQ), EQ)).toBe(true);
  });

  // THE ASSERTION THE FIX EXISTS FOR.
  it("refuses an organization leader another organization's visit", () => {
    expect(canManageVisitLog(actor("org_president", EQ), RS)).toBe(false);
    expect(canManageVisitLog(actor("org_counselor", EQ), RS)).toBe(false);
    expect(canManageVisitLog(actor("org_secretary", EQ), RS)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // THE NULL-EQUALS-NULL TRAP
  // ---------------------------------------------------------------------------
  // A bishopric-authored visit has org_id null. In SQL `null = null` is NULL, not true, so
  // migration 019 refuses every org leader. In JavaScript `null === null` is TRUE — so a naive
  // port would hand edit controls on every bishopric visit to any leader whose account has no
  // organization. These two cases are the whole reason the function has explicit null guards.
  it("refuses an organization leader a bishopric-authored visit", () => {
    expect(canManageVisitLog(actor("org_president", EQ), null)).toBe(false);
  });

  it("refuses a leader with no organization, whatever the visit", () => {
    expect(canManageVisitLog(actor("org_president", null), null)).toBe(false);
    expect(canManageVisitLog(actor("org_president", null), EQ)).toBe(false);
  });

  // Roles that hold no write permission on visits at all still resolve to false here, so the
  // helper is safe to call before the permission check as well as after it.
  it("refuses every non-bishopric role a visit outside their organization", () => {
    const nonBishopric = ROLES.filter(
      (role) => role !== "bishop" && role !== "counselor",
    );

    for (const role of nonBishopric) {
      expect(canManageVisitLog(actor(role, EQ), RS)).toBe(false);
    }
  });
});
