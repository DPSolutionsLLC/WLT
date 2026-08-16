import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  ADMIN_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  assertCan,
  can,
  mergeRoleAccess,
  resolveRoleAccess,
  type KnownPermission,
} from "@/lib/auth/permissions";
import type { Database } from "@/types/database";
import { ROLES, type Role, type SessionUser } from "@/types/domain";

function sessionUser(role: Role): SessionUser {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    wardId: "00000000-0000-4000-8000-000000000001",
    role,
    orgId: null,
    counselorPosition: null,
    firstName: "Test",
    lastName: "User",
  };
}

function stubWardClient(
  settings: unknown,
  error: { message: string } | null = null,
): SupabaseClient<Database> {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: error ? null : { settings },
            error,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("permission matrix", () => {
  // Generated from ROLES × PERMISSIONS rather than spot-checked, so a role added in a later
  // phase cannot ship without a decision for every permission.
  it("has a decision for every role and every permission", () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role], `no entry for role "${role}"`).toBeDefined();

      for (const permission of PERMISSIONS) {
        expect(typeof can(sessionUser(role), permission)).toBe("boolean");
      }
    }
  });

  it("grants only permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS);

    for (const role of ROLES) {
      const unknown = ROLE_PERMISSIONS[role].filter(
        (permission) => !known.has(permission),
      );
      expect(unknown, `role "${role}" grants unknown permissions`).toEqual([]);
    }
  });
});

describe("bishopric equivalence", () => {
  // CLAUDE.md §7: never build a check that grants the bishop something a counselor lacks.
  // The whole admin set is looped rather than sampled, because this is a stated product
  // requirement and the matrix is the one place it can silently drift.
  it("resolves bishop and counselor identically for every admin permission", () => {
    const bishop = sessionUser("bishop");
    const counselor = sessionUser("counselor");

    expect(ADMIN_PERMISSIONS.length).toBeGreaterThan(0);

    for (const permission of ADMIN_PERMISSIONS) {
      expect(
        can(bishop, permission),
        `bishop and counselor differ on "${permission}"`,
      ).toBe(can(counselor, permission));
    }
  });

  it("resolves bishop and counselor identically for every permission", () => {
    const bishop = sessionUser("bishop");
    const counselor = sessionUser("counselor");

    for (const permission of PERMISSIONS) {
      expect(can(bishop, permission), `differ on "${permission}"`).toBe(
        can(counselor, permission),
      );
    }
  });

  it("gives the bishopric every admin permission", () => {
    for (const permission of ADMIN_PERMISSIONS) {
      expect(can(sessionUser("bishop"), permission)).toBe(true);
    }
  });
});

describe("sacrament_manager", () => {
  const expected: KnownPermission[] = [
    "sacrament.view_assignments",
    "sacrament.update_assignments",
    "sacrament.mark_sent",
  ];

  it("has exactly its one module and nothing else", () => {
    expect([...ROLE_PERMISSIONS.sacrament_manager].sort()).toEqual([...expected].sort());
  });

  it("cannot reach the roster, the calendar, or admin", () => {
    const manager = sessionUser("sacrament_manager");

    expect(can(manager, "roster.view")).toBe(false);
    expect(can(manager, "calendar.view")).toBe(false);
    expect(can(manager, "admin.view")).toBe(false);
    expect(can(manager, "sacrament.manage_pools")).toBe(false);
  });
});

describe("role restrictions from FEATURES.md", () => {
  it("keeps both secretaries out of visits and tithing", () => {
    for (const role of ["ward_secretary", "executive_secretary"] as const) {
      const user = sessionUser(role);
      expect(can(user, "visits.view")).toBe(false);
      expect(can(user, "visits.create")).toBe(false);
      expect(can(user, "tithing.view")).toBe(false);
    }
  });

  it("keeps org leadership out of tithing and sacrament planning", () => {
    for (const role of ["org_president", "org_counselor", "org_secretary"] as const) {
      const user = sessionUser(role);
      expect(can(user, "tithing.view")).toBe(false);
      expect(can(user, "talks.plan")).toBe(false);
      expect(can(user, "admin.manage_users")).toBe(false);
    }
  });

  it("gives the music coordinator hymn selection but not program approval", () => {
    const user = sessionUser("music_coordinator");
    expect(can(user, "music.manage")).toBe(true);
    expect(can(user, "calendar.view")).toBe(true);
    expect(can(user, "program.approve")).toBe(false);
  });
});

describe("assertCan", () => {
  // The two must never disagree: routes rely on the throwing form, and a boolean that says
  // no while assertCan says yes would be a silent authorization bypass.
  it("throws exactly where can() returns false, across every role and permission", () => {
    for (const role of ROLES) {
      const user = sessionUser(role);

      for (const permission of PERMISSIONS) {
        const allowed = can(user, permission);

        if (allowed) {
          expect(() => assertCan(user, permission)).not.toThrow();
        } else {
          expect(() => assertCan(user, permission)).toThrow(ForbiddenError);
        }
      }
    }
  });

  it("names the permission on the error", () => {
    try {
      assertCan(sessionUser("sacrament_manager"), "admin.manage_users");
      throw new Error("assertCan should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).permission).toBe("admin.manage_users");
    }
  });
});

describe("mergeRoleAccess", () => {
  it("falls back to the code default when there is no override", () => {
    expect(mergeRoleAccess(undefined)).toEqual(ROLE_PERMISSIONS);
    expect(mergeRoleAccess(null)).toEqual(ROLE_PERMISSIONS);
  });

  it("lets a stored override take precedence for the roles it names", () => {
    const merged = mergeRoleAccess({ music_coordinator: ["music.view"] });

    expect(merged.music_coordinator).toEqual(["music.view"]);
    expect(can(sessionUser("music_coordinator"), "music.manage", merged)).toBe(false);
    expect(can(sessionUser("music_coordinator"), "music.view", merged)).toBe(true);
  });

  it("leaves unnamed roles on the code default", () => {
    const merged = mergeRoleAccess({ music_coordinator: ["music.view"] });

    expect(merged.bishop).toEqual(ROLE_PERMISSIONS.bishop);
    expect(merged.org_president).toEqual(ROLE_PERMISSIONS.org_president);
  });

  it("ignores unknown roles and unknown permissions", () => {
    const merged = mergeRoleAccess({
      not_a_role: ["admin.manage_users"],
      org_secretary: ["visits.view", "not.a.permission"],
    });

    expect(merged).not.toHaveProperty("not_a_role");
    expect(merged.org_secretary).toEqual(["visits.view"]);
  });

  it("falls back to the code default when the override is malformed", () => {
    expect(mergeRoleAccess("nonsense")).toEqual(ROLE_PERMISSIONS);
    expect(mergeRoleAccess({ bishop: "everything" })).toEqual(ROLE_PERMISSIONS);
  });
});

describe("resolveRoleAccess", () => {
  it("reads the override from wards.settings.role_access", async () => {
    const client = stubWardClient({ role_access: { music_coordinator: ["music.view"] } });
    const resolved = await resolveRoleAccess(client, "ward-id");

    expect(resolved.music_coordinator).toEqual(["music.view"]);
  });

  it("returns the code default when the ward stores no override", async () => {
    const client = stubWardClient({ timezone: "America/Denver" });

    expect(await resolveRoleAccess(client, "ward-id")).toEqual(ROLE_PERMISSIONS);
  });

  // Falling back to the code default on a read failure would fail open: an override can only
  // narrow access, so substituting the defaults could grant a role something the ward
  // deliberately removed.
  it("throws rather than failing open when the read errors", async () => {
    const client = stubWardClient(null, { message: "connection reset" });

    await expect(resolveRoleAccess(client, "ward-id")).rejects.toThrow(/connection reset/);
  });
});
