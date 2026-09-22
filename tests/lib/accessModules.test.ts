import { describe, expect, it } from "vitest";
import {
  ACCESS_MODULES,
  describeAccessRequest,
  findAccessModule,
  permissionsForModule,
} from "@/lib/access/accessModules";
import { NON_OVERRIDABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";

// The unit of an access request is a MODULE, and these are the two invariants that makes it safe.
//
// `lib/access/accessModules.ts` asserts the first at import time as well, because the cost of
// getting it wrong is a grant that silently does nothing. This file is where the failure is
// legible rather than a stack trace at boot.

describe("access modules", () => {
  it("offers no non-overridable permission", () => {
    for (const accessModule of ACCESS_MODULES) {
      const locked = accessModule.full.filter((permission) =>
        (NON_OVERRIDABLE_PERMISSIONS as readonly string[]).includes(permission),
      );

      expect(
        locked,
        `"${accessModule.key}" offers ${locked.join(", ")}, which mergeRoleAccess would discard`,
      ).toEqual([]);
    }
  });

  // ⚠️ THE INVARIANT THIS WHOLE CHANGE EXISTS FOR. Walking scenario 067 approved `topics.manage`
  // for an org president; the delta landed; the topic library was still refused, because the page
  // gates on `topics.view` and nobody thought to ask for it — while the card read "This is now
  // turned on for your ward."
  //
  // A module's `full` containing its own `read` is what makes that sentence true.
  it("gives every module a full level that contains its read level", () => {
    for (const accessModule of ACCESS_MODULES) {
      for (const permission of accessModule.read) {
        expect(
          accessModule.full,
          `"${accessModule.key}" grants ${permission} at read only but not at full`,
        ).toContain(permission);
      }
    }
  });

  it("grants only permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS);

    for (const accessModule of ACCESS_MODULES) {
      const unknown = accessModule.full.filter((permission) => !known.has(permission));
      expect(unknown, `"${accessModule.key}" grants unknown permissions`).toEqual([]);
    }
  });

  it("never offers an empty module", () => {
    for (const accessModule of ACCESS_MODULES) {
      expect(accessModule.read.length, `"${accessModule.key}" grants nothing`).toBeGreaterThan(0);
    }
  });

  it("expands a module and level into the right permissions", () => {
    expect(permissionsForModule("sacrament_talks", "R")).toEqual(["talks.view", "topics.view"]);
    expect(permissionsForModule("sacrament_talks", "F")).toContain("topics.manage");
    expect(permissionsForModule("sacrament_talks", "F")).toContain("talks.view");
  });

  // `Q` is the prototype's "their own organization only", which in WLT is what RLS already does.
  // It resolves to `full` rather than to less than was asked for — the scoping is the policy's.
  it("treats the quorum level as full, because org scoping is RLS's job", () => {
    expect(permissionsForModule("visits", "Q")).toEqual(permissionsForModule("visits", "F"));
  });

  it("returns nothing for a module it does not know, rather than guessing", () => {
    expect(findAccessModule("ward_admin")).toBeNull();
    expect(permissionsForModule("ward_admin", "F")).toEqual([]);
  });

  // APPROVING A PROGRAMME IS A BISHOPRIC ACT (program-a), and the module route must not become a
  // way around the decision the matrix re-derivation already settled for both secretaries and for
  // resource_center_specialist.
  it("never hands over program.approve", () => {
    for (const accessModule of ACCESS_MODULES) {
      expect(accessModule.full).not.toContain("program.approve");
    }
  });

  it("describes a request in the words the role-access page uses", () => {
    expect(describeAccessRequest("sacrament_talks", "F")).toBe("Sacrament — Talks");
    expect(describeAccessRequest("sacrament_talks", "R")).toBe("Sacrament — Talks (read only)");
  });
});
