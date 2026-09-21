import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";
import {
  ADMIN_PERMISSIONS,
  NON_OVERRIDABLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  assertCan,
  can,
  mergeRoleAccess,
  resolveRoleAccess,
  type KnownPermission,
  type RoleAccess,
} from "@/lib/auth/permissions";
import { updateUserSchema } from "@/lib/validation/adminUser";
import type { Database } from "@/types/database";
import { INVITABLE_ROLES, ROLES, type Role, type SessionUser } from "@/types/domain";

function sessionUser(role: Role): SessionUser {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    wardId: "00000000-0000-4000-8000-000000000001",
    // A session at HOME: the effective ward and the home ward are the same and
    // nothing is switched. lib/auth/session.ts reads all of these from session_context().
    homeWardId: "00000000-0000-4000-8000-000000000001",
    activeWardId: null,
    // The CALLING this session is acting under (migration 068). `role` and `orgId` below
    // are ITS facts, not the person\'s — a fixed id is enough here because nothing in
    // these tests reads it.
    callingId: "00000000-0000-4000-8000-00000000ca11",
    role,
    orgId: null,
    counselorPosition: null,
    firstName: "Test",
    lastName: "User",
    username: null,
    themePreference: "system",
    isActive: true,
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

// Membership, not order. applyDelta rebuilds the list through a Set, and restoring a locked
// permission re-adds it at the end, so a resolved list can hold exactly the right permissions in
// a different order. Order has never been meaningful here — only membership is.
function sorted(permissions: readonly KnownPermission[]): string[] {
  return [...permissions].sort();
}

// Deltas that name a locked permission, an unknown permission, or a malformed shape all warn on
// purpose. The suite silences console.warn so that intent does not read as noise, and the tests
// that care about the warning assert on the spy.
function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("permission matrix", () => {
  // Generated from ROLES × PERMISSIONS rather than spot-checked, so a role added in a later
  // phase cannot ship without a decision for every permission.
  it("has a decision for every role and every permission", () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role], `no entry for role "${role}"`).toBeDefined();

      for (const permission of PERMISSIONS) {
        expect(typeof can(sessionUser(role), permission, ROLE_PERMISSIONS)).toBe(
          "boolean",
        );
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
        can(bishop, permission, ROLE_PERMISSIONS),
        `bishop and counselor differ on "${permission}"`,
      ).toBe(can(counselor, permission, ROLE_PERMISSIONS));
    }
  });

  it("resolves bishop and counselor identically for every permission", () => {
    const bishop = sessionUser("bishop");
    const counselor = sessionUser("counselor");

    for (const permission of PERMISSIONS) {
      expect(can(bishop, permission, ROLE_PERMISSIONS), `differ on "${permission}"`).toBe(
        can(counselor, permission, ROLE_PERMISSIONS),
      );
    }
  });

  it("gives the bishopric every admin permission", () => {
    for (const permission of ADMIN_PERMISSIONS) {
      expect(can(sessionUser("bishop"), permission, ROLE_PERMISSIONS)).toBe(true);
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

    expect(can(manager, "roster.view", ROLE_PERMISSIONS)).toBe(false);
    expect(can(manager, "calendar.view", ROLE_PERMISSIONS)).toBe(false);
    expect(can(manager, "admin.view", ROLE_PERMISSIONS)).toBe(false);
    expect(can(manager, "sacrament.manage_pools", ROLE_PERMISSIONS)).toBe(false);
  });
});

describe("role restrictions from FEATURES.md", () => {
  it("keeps both secretaries out of visits and tithing", () => {
    for (const role of ["ward_secretary", "executive_secretary"] as const) {
      const user = sessionUser(role);
      expect(can(user, "visits.view", ROLE_PERMISSIONS)).toBe(false);
      expect(can(user, "visits.create", ROLE_PERMISSIONS)).toBe(false);
      expect(can(user, "tithing.view", ROLE_PERMISSIONS)).toBe(false);
    }
  });

  it("keeps org leadership out of tithing and sacrament planning", () => {
    for (const role of ["org_president", "org_counselor", "org_secretary"] as const) {
      const user = sessionUser(role);
      expect(can(user, "tithing.view", ROLE_PERMISSIONS)).toBe(false);
      expect(can(user, "talks.plan", ROLE_PERMISSIONS)).toBe(false);
      expect(can(user, "admin.manage_users", ROLE_PERMISSIONS)).toBe(false);
    }
  });

  it("gives the music coordinator hymn selection but not program approval", () => {
    const user = sessionUser("music_coordinator");
    expect(can(user, "music.manage", ROLE_PERMISSIONS)).toBe(true);
    expect(can(user, "calendar.view", ROLE_PERMISSIONS)).toBe(true);
    expect(can(user, "program.approve", ROLE_PERMISSIONS)).toBe(false);
  });
});

describe("assertCan", () => {
  // The two must never disagree: routes rely on the throwing form, and a boolean that says
  // no while assertCan says yes would be a silent authorization bypass.
  it("throws exactly where can() returns false, across every role and permission", () => {
    for (const role of ROLES) {
      const user = sessionUser(role);

      for (const permission of PERMISSIONS) {
        const allowed = can(user, permission, ROLE_PERMISSIONS);

        if (allowed) {
          expect(() => assertCan(user, permission, ROLE_PERMISSIONS)).not.toThrow();
        } else {
          expect(() => assertCan(user, permission, ROLE_PERMISSIONS)).toThrow(
            ForbiddenError,
          );
        }
      }
    }
  });

  it("names the permission on the error", () => {
    try {
      assertCan(sessionUser("sacrament_manager"), "admin.manage_users", ROLE_PERMISSIONS);
      throw new Error("assertCan should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).permission).toBe("admin.manage_users");
    }
  });

  // The same loop under an override, because the two forms agreeing on the defaults says
  // nothing about them agreeing on a ward's configuration — which is the code path every route
  // actually takes after ITER-005.
  it("throws exactly where can() returns false under an override", () => {
    silenceWarnings();
    const merged = mergeRoleAccess({
      ward_secretary: { add: ["talks.plan"], remove: ["agendas.publish"] },
      music_coordinator: { remove: ["music.manage"] },
    });

    for (const role of ROLES) {
      const user = sessionUser(role);

      for (const permission of PERMISSIONS) {
        if (can(user, permission, merged)) {
          expect(() => assertCan(user, permission, merged)).not.toThrow();
        } else {
          expect(() => assertCan(user, permission, merged)).toThrow(ForbiddenError);
        }
      }
    }
  });
});

describe("mergeRoleAccess — no override", () => {
  it("falls back to the code default when there is no override", () => {
    expect(mergeRoleAccess(undefined)).toEqual(ROLE_PERMISSIONS);
    expect(mergeRoleAccess(null)).toEqual(ROLE_PERMISSIONS);
  });

  it("falls back to the code default when the override is not an object of deltas", () => {
    silenceWarnings();
    expect(mergeRoleAccess("nonsense")).toEqual(ROLE_PERMISSIONS);
    expect(mergeRoleAccess(["music.view"])).toEqual(ROLE_PERMISSIONS);
  });

  it("leaves unnamed roles on the code default", () => {
    const merged = mergeRoleAccess({ music_coordinator: { remove: ["music.manage"] } });

    expect(merged.bishop).toEqual(ROLE_PERMISSIONS.bishop);
    expect(merged.org_president).toEqual(ROLE_PERMISSIONS.org_president);
  });
});

describe("mergeRoleAccess — deltas", () => {
  it("removes a permission the ward took away", () => {
    const merged = mergeRoleAccess({ music_coordinator: { remove: ["music.manage"] } });
    const coordinator = sessionUser("music_coordinator");

    expect(can(coordinator, "music.manage", merged)).toBe(false);
    expect(can(coordinator, "music.view", merged)).toBe(true);
    expect(can(coordinator, "calendar.view", merged)).toBe(true);
  });

  // The case replace-semantics got wrong. Under a replacement list this role would have kept
  // ONLY talks.plan; under deltas every default survives, which is what lets a permission added
  // in Phase 6 reach a ward that already stored an override.
  it("adds a permission without discarding the role's defaults", () => {
    const merged = mergeRoleAccess({ ward_secretary: { add: ["talks.plan"] } });

    expect(can(sessionUser("ward_secretary"), "talks.plan", merged)).toBe(true);
    expect(sorted(merged.ward_secretary)).toEqual(
      sorted([...ROLE_PERMISSIONS.ward_secretary, "talks.plan"]),
    );
  });

  // Arbitrary but documented, and pinned here so it cannot drift silently.
  it("grants a permission named in both add and remove — add wins", () => {
    const merged = mergeRoleAccess({
      music_coordinator: { add: ["music.manage"], remove: ["music.manage"] },
    });

    expect(can(sessionUser("music_coordinator"), "music.manage", merged)).toBe(true);
  });

  it("drops unknown permissions and applies the known ones", () => {
    silenceWarnings();
    const merged = mergeRoleAccess({
      org_secretary: { add: ["not.a.permission"], remove: ["visits.view"] },
    });

    expect(merged.org_secretary).not.toContain("not.a.permission");
    expect(sorted(merged.org_secretary)).toEqual(
      sorted(ROLE_PERMISSIONS.org_secretary.filter((p) => p !== "visits.view")),
    );
  });

  it("ignores an unknown role", () => {
    silenceWarnings();
    const merged = mergeRoleAccess({ not_a_role: { add: ["admin.manage_users"] } });

    expect(merged).not.toHaveProperty("not_a_role");
    expect(merged).toEqual(ROLE_PERMISSIONS);
  });

  // Per-role parse granularity. One malformed value must not discard a sibling's valid delta —
  // under the old whole-object z.record this legacy array threw the entire override away.
  it("keeps a malformed role on its defaults while siblings still apply", () => {
    silenceWarnings();
    const merged = mergeRoleAccess({
      music_coordinator: ["music.view"],
      ward_secretary: { add: ["talks.plan"] },
    });

    expect(merged.music_coordinator).toEqual(ROLE_PERMISSIONS.music_coordinator);
    expect(can(sessionUser("ward_secretary"), "talks.plan", merged)).toBe(true);
  });

  it("warns naming the role when a delta is malformed", () => {
    const warn = silenceWarnings();
    mergeRoleAccess({ music_coordinator: ["music.view"] });

    // The name must be in the message string: Next.js's dev logger renders an object argument
    // to console.warn as {} (plans/retros/auth-b-invites-admin.md).
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain("music_coordinator");
  });
});

describe("mergeRoleAccess — non-overridable permissions", () => {
  it("locks every admin.* and sacrament.* permission", () => {
    expect(NON_OVERRIDABLE_PERMISSIONS.length).toBeGreaterThan(0);

    for (const permission of NON_OVERRIDABLE_PERMISSIONS) {
      expect(
        permission.startsWith("admin.") || permission.startsWith("sacrament."),
        `"${permission}" is locked but is neither admin.* nor sacrament.*`,
      ).toBe(true);
    }
  });

  // audit.view grants reading, not writing, and a ward may legitimately want its secretary to
  // see the audit log. It is in ADMIN_PERMISSIONS for the equivalence loop only.
  it("leaves audit.view overridable", () => {
    expect(NON_OVERRIDABLE_PERMISSIONS).not.toContain("audit.view");

    const merged = mergeRoleAccess({ ward_secretary: { add: ["audit.view"] } });
    expect(can(sessionUser("ward_secretary"), "audit.view", merged)).toBe(true);
  });

  // The escalation case, and the reason this deny-list exists. lib/auth/adminUsers.ts writes
  // with the SERVICE-ROLE client because `users` has no INSERT or UPDATE policy for other
  // people's rows (migration 019), so assertCan is the only boundary and RLS is not behind it.
  // A role granted admin.manage_users could make itself bishop.
  it("ignores an attempt to grant admin.manage_users to another role", () => {
    silenceWarnings();
    const merged = mergeRoleAccess({
      ward_council_member: { add: ["admin.manage_users"] },
    });

    expect(can(sessionUser("ward_council_member"), "admin.manage_users", merged)).toBe(
      false,
    );
    expect(merged.ward_council_member).toEqual(ROLE_PERMISSIONS.ward_council_member);
  });

  // The lockout case. Because removal is locked too, "never remove the last bishopric member's
  // admin access" (plans/11-notifications-admin.md) is unreachable rather than hand-guarded.
  it("ignores an attempt to remove admin.manage_users from the bishopric", () => {
    silenceWarnings();
    const merged = mergeRoleAccess({ bishop: { remove: ["admin.manage_users"] } });

    expect(can(sessionUser("bishop"), "admin.manage_users", merged)).toBe(true);
    expect(can(sessionUser("counselor"), "admin.manage_users", merged)).toBe(true);
  });

  // FEATURES.md §Module 17: the youth PIN account reaches exactly one module. Widening that is
  // a product decision, not a matrix checkbox.
  it("ignores an attempt to grant a sacrament permission to another role", () => {
    silenceWarnings();
    const merged = mergeRoleAccess({
      ward_council_member: { add: ["sacrament.view_assignments"] },
    });

    expect(
      can(sessionUser("ward_council_member"), "sacrament.view_assignments", merged),
    ).toBe(false);
  });

  // Proves step 5 RESTORES the locked entries rather than discarding the whole delta.
  it("applies the unlocked half of a delta that also names a locked permission", () => {
    silenceWarnings();
    const merged = mergeRoleAccess({
      ward_secretary: { add: ["admin.manage_users", "talks.plan"] },
    });

    expect(can(sessionUser("ward_secretary"), "talks.plan", merged)).toBe(true);
    expect(can(sessionUser("ward_secretary"), "admin.manage_users", merged)).toBe(false);
  });

  it("warns naming the locked permission it refused to change", () => {
    const warn = silenceWarnings();
    mergeRoleAccess({ ward_council_member: { add: ["admin.manage_users"] } });

    expect(warn.mock.calls.flat().join(" ")).toContain("admin.manage_users");
  });

  // Table-driven over the whole deny-list × every role, per CLAUDE.md §8 priority 2. Whatever
  // the delta asks for, a locked permission's membership always equals the code default.
  it("keeps every locked permission at its default for every role, in both directions", () => {
    silenceWarnings();

    for (const role of ROLES) {
      for (const permission of NON_OVERRIDABLE_PERMISSIONS) {
        const expected = ROLE_PERMISSIONS[role].includes(permission);

        const widened = mergeRoleAccess({ [role]: { add: [permission] } });
        expect(
          can(sessionUser(role), permission, widened),
          `add "${permission}" changed "${role}"`,
        ).toBe(expected);

        const narrowed = mergeRoleAccess({ [role]: { remove: [permission] } });
        expect(
          can(sessionUser(role), permission, narrowed),
          `remove "${permission}" changed "${role}"`,
        ).toBe(expected);
      }
    }
  });
});

describe("mergeRoleAccess — bishopric equivalence", () => {
  // CLAUDE.md §7. Enforced in mergeRoleAccess rather than left to the Phase 11 UI to render one
  // row, so the invariant holds by construction.
  it("applies a delta naming only the bishop to the counselor too", () => {
    const merged = mergeRoleAccess({ bishop: { remove: ["talks.plan"] } });

    expect(can(sessionUser("bishop"), "talks.plan", merged)).toBe(false);
    expect(can(sessionUser("counselor"), "talks.plan", merged)).toBe(false);
  });

  it("applies a delta naming only the counselor to the bishop too", () => {
    const merged = mergeRoleAccess({ counselor: { remove: ["music.manage"] } });

    expect(can(sessionUser("counselor"), "music.manage", merged)).toBe(false);
    expect(can(sessionUser("bishop"), "music.manage", merged)).toBe(false);
  });

  // Unions the two deltas, then add beats remove — both rules in one case.
  it("unions divergent deltas rather than letting either role win", () => {
    silenceWarnings();
    const merged = mergeRoleAccess({
      bishop: { remove: ["talks.plan"] },
      counselor: { add: ["talks.plan"] },
    });

    expect(can(sessionUser("bishop"), "talks.plan", merged)).toBe(true);
    expect(can(sessionUser("counselor"), "talks.plan", merged)).toBe(true);
  });

  it("warns when the two roles are given different deltas", () => {
    const warn = silenceWarnings();
    mergeRoleAccess({
      bishop: { remove: ["talks.plan"] },
      counselor: { remove: ["music.manage"] },
    });

    const message = warn.mock.calls.flat().join(" ");
    expect(message).toContain("bishop");
    expect(message).toContain("counselor");
  });

  // Exhaustive rather than a spot check, matching the defaults-level test above: this is a
  // stated product requirement and an override is exactly where it could silently drift.
  it("resolves the two identically for every permission under divergent deltas", () => {
    silenceWarnings();
    const merged = mergeRoleAccess({
      bishop: { remove: ["talks.plan", "admin.manage_users"] },
      counselor: { remove: ["music.manage"], add: ["audit.view"] },
    });

    for (const permission of PERMISSIONS) {
      expect(
        can(sessionUser("bishop"), permission, merged),
        `bishop and counselor differ on "${permission}" under an override`,
      ).toBe(can(sessionUser("counselor"), permission, merged));
    }

    expect(sorted(merged.bishop)).toEqual(sorted(merged.counselor));
  });
});

describe("resolveRoleAccess", () => {
  it("reads the override from wards.settings.role_access", async () => {
    const client = stubWardClient({
      role_access: { music_coordinator: { remove: ["music.manage"] } },
    });
    const resolved: RoleAccess = await resolveRoleAccess(client, "ward-id");

    expect(can(sessionUser("music_coordinator"), "music.manage", resolved)).toBe(false);
    expect(can(sessionUser("music_coordinator"), "music.view", resolved)).toBe(true);
  });

  it("returns the code default when the ward stores no override", async () => {
    const client = stubWardClient({ timezone: "America/Denver" });

    expect(await resolveRoleAccess(client, "ward-id")).toEqual(ROLE_PERMISSIONS);
  });

  // Falling back to the code default on a read failure can now be wrong in EITHER direction:
  // silently restoring a permission the ward removed, or silently withholding one it granted.
  // Neither is safe to guess at, so a failed read is an error rather than a default.
  it("throws rather than failing open when the read errors", async () => {
    const client = stubWardClient(null, { message: "connection reset" });

    await expect(resolveRoleAccess(client, "ward-id")).rejects.toThrow(/connection reset/);
  });
});

// ---------------------------------------------------------------------------
// The unit hierarchy's five new roles (migration 065, types/domain.ts)
// ---------------------------------------------------------------------------

describe("stake officers", () => {
  const STAKE_ROLE_LIST: Role[] = ["stake_president", "stake_counselor", "stake_secretary"];

  // Identical BY CONSTRUCTION — one STAKE_OFFICER_PERMISSIONS constant, not three literals, the
  // same move BISHOPRIC_PERMISSIONS makes. Asserted anyway, so splitting them later is a failure
  // rather than a quiet divergence.
  it("resolves all three stake roles identically for every permission", () => {
    for (const permission of PERMISSIONS) {
      const answers = STAKE_ROLE_LIST.map((role) =>
        can(sessionUser(role), permission, ROLE_PERMISSIONS),
      );
      expect(new Set(answers).size, `stake roles disagree about "${permission}"`).toBe(1);
    }
  });

  // A STAKE OFFICER REACHES NOTHING IN THIS APP — decided by the user 2026-09-21, reversing a
  // list that stood for one day and granted eleven `*.view` permissions across the roster,
  // visits, youth activities, the program and agendas.
  //
  // WLT is a WARD's tool. A ward's roster, its visit reports and its youth are that ward's own
  // stewardship, and a stake officer reading them is not a smaller version of the right thing.
  // What is intended instead — a read-only view of the ONE meeting's agenda they are attending,
  // plus adding to that meeting's prayer roll — is a purpose-built surface, not a permission
  // list, and it is not built. Asserted over every permission rather than spot-checked, so
  // granting one back is a deliberate act that fails here first.
  it("reaches nothing at all, across every permission there is", () => {
    for (const role of STAKE_ROLE_LIST) {
      expect(ROLE_PERMISSIONS[role], `"${role}" should hold nothing`).toEqual([]);

      for (const permission of PERMISSIONS) {
        expect(
          can(sessionUser(role), permission, ROLE_PERMISSIONS),
          `"${role}" should not hold "${permission}"`,
        ).toBe(false);
      }
    }
  });

  // The trap this guards: `agendas.view` is the one permission that looks like it would implement
  // the intended read-only agenda view, and it would not — it hands over every agenda the ward
  // has ever published, not the single meeting the officer is attending.
  it("does not hold agendas.view, which is not the agenda view that was asked for", () => {
    for (const role of STAKE_ROLE_LIST) {
      expect(can(sessionUser(role), "agendas.view", ROLE_PERMISSIONS)).toBe(false);
    }
  });
});

describe("super_admin", () => {
  // CLAUDE.md §7 says super admin "bypasses the access matrix". Granting the whole list IS that,
  // through the one mechanism the app already has, rather than a second code path beside can().
  it("holds every permission there is", () => {
    for (const permission of PERMISSIONS) {
      expect(
        can(sessionUser("super_admin"), permission, ROLE_PERMISSIONS),
        `super_admin is missing "${permission}"`,
      ).toBe(true);
    }
  });

  // A WARD MUST NOT BE ABLE TO DISABLE THE APP-WIDE ADMINISTRATOR WHO IS THERE TO HELP IT. This
  // is NON_OVERRIDABLE_PERMISSIONS' argument one level up: that constant locks which permissions
  // a ward may move, and this locks a whole ROLE, because super_admin holds every permission and
  // removing them one at a time reaches the same place.
  it("ignores a ward's attempt to narrow it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const resolved = mergeRoleAccess({
      super_admin: { remove: ["roster.view", "visits.view"] },
    });

    expect(sorted(resolved.super_admin)).toEqual(sorted(ROLE_PERMISSIONS.super_admin));
  });

  it("warns naming the role it refused to change", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    mergeRoleAccess({ super_admin: { remove: ["roster.view"] } });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("super_admin"));
  });

  // The rest of a delta still applies. Locking the role must not discard a ward's valid
  // configuration for its own leaders.
  it("leaves a sibling role's delta alone", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const resolved = mergeRoleAccess({
      super_admin: { remove: ["roster.view"] },
      music_coordinator: { remove: ["music.manage"] },
    });

    expect(sorted(resolved.super_admin)).toEqual(sorted(ROLE_PERMISSIONS.super_admin));
    expect(can(sessionUser("music_coordinator"), "music.manage", resolved)).toBe(false);
  });
});

describe("resource_center_specialist", () => {
  // EMPTY ON PURPOSE. WLT has no resource-centre module for this role to reach, and guessing a
  // grant is how a role comes to hold a permission nobody chose. proto-d decides what it gets
  // when somebody can say what it does — at which point this assertion is the thing to change
  // deliberately.
  it("holds nothing at all, deliberately", () => {
    expect(ROLE_PERMISSIONS.resource_center_specialist).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ONE LIST, THREE COPIES — read from disk rather than trusted
// ---------------------------------------------------------------------------
//
// `users.role` and `invites.role` carry the role list as CHECK constraints, and ROLES carries it
// in TypeScript. They drift, and the drift is silent: the database accepts a value the union
// rejects, and lib/auth/session.ts then throws on a row nobody can fix from inside the app.
// Migration 002's own comment warns about exactly this — which is a rule stated beside the thing
// it governs, and therefore not a rule that is kept. This is that comment, enforced, the way
// tests/db/notification-triggers-seed.test.ts is for the trigger keys.
//
// It reads migration 065 for the two named CHECKs, because that is the file that DEFINES both,
// and migration 068 for the inline one on `ward_role_assignments.role`. When a later migration
// widens any of them, point this at that file in the same commit.
//
// ⚠️ THERE ARE NOW THREE COPIES, NOT TWO. Migration 068 added the calling's own CHECK, and from
// migration 070 on IT is the one the session actually reads — so a role present in `users` and
// missing from `ward_role_assignments` would be a role the app can be given and can never act
// under. `notification-trigger-drift` (ITER-023) is one list in three places, all disagreeing,
// and its damage was silent; this is the same shape caught before it can happen.
describe("ROLES matches the database CHECK constraints", () => {
  const UNIT_HIERARCHY_PATH = path.resolve(
    process.cwd(),
    "supabase/migrations/065_unit_hierarchy.sql",
  );

  const CALLINGS_PATH = path.resolve(
    process.cwd(),
    "supabase/migrations/068_ward_role_assignments.sql",
  );

  // A role every source has carried since Foundation. Its presence proves the parser actually
  // parsed something — a regex that matched nothing would make the comparisons below pass on two
  // empty arrays, which is the one way this could ship green and useless.
  const ANCHOR_ROLE = "bishop";

  function rolesFromList(source: string, pattern: RegExp, label: string): string[] {
    const match = pattern.exec(source);
    if (!match) {
      throw new Error(
        `Could not find ${label}. If a later migration redefines it, point this test at that file.`,
      );
    }
    return [...match[1].matchAll(/'([a-z_]+)'/g)].map((role) => role[1]).sort();
  }

  function rolesFromCheck(constraintName: string): string[] {
    return rolesFromList(
      readFileSync(UNIT_HIERARCHY_PATH, "utf8"),
      new RegExp(`add constraint ${constraintName} check \\(\\s*role in \\(([^)]*)\\)`, "i"),
      `"${constraintName}" in 065_unit_hierarchy.sql`,
    );
  }

  it("matches users_role_check exactly", () => {
    const fromSql = rolesFromCheck("users_role_check");

    expect(fromSql).toContain(ANCHOR_ROLE);
    expect(fromSql).toEqual([...ROLES].sort());
  });

  it("matches invites_role_check exactly", () => {
    const fromSql = rolesFromCheck("invites_role_check");

    expect(fromSql).toContain(ANCHOR_ROLE);
    expect(fromSql).toEqual([...ROLES].sort());
  });

  // THE THIRD COPY. It is declared inline in the CREATE TABLE rather than as a named constraint,
  // so it is matched on the column definition instead — `role text not null check (role in (…))`.
  it("matches the ward_role_assignments.role CHECK exactly", () => {
    const fromSql = rolesFromList(
      readFileSync(CALLINGS_PATH, "utf8"),
      /role\s+text not null check \(\s*role in \(([^)]*)\)/i,
      "the inline role CHECK in 068_ward_role_assignments.sql",
    );

    expect(fromSql).toContain(ANCHOR_ROLE);
    expect(fromSql).toEqual([...ROLES].sort());
  });
});

// ---------------------------------------------------------------------------
// INVITABLE_ROLES
// ---------------------------------------------------------------------------

describe("INVITABLE_ROLES", () => {
  // THE SLICE IS NOT INVISIBLE WITHOUT THIS. INVITABLE_ROLES used to be "everything but
  // sacrament_manager", so all five new roles would have appeared in the admin invite dropdown
  // the moment they were added — a visible behaviour change in a slice whose whole requirement
  // is zero visible change.
  it("excludes the five roles a ward has no standing to hand out", () => {
    for (const role of [
      "sacrament_manager",
      "stake_president",
      "stake_counselor",
      "stake_secretary",
      "super_admin",
    ] as const) {
      expect(INVITABLE_ROLES, `"${role}" must not be invitable`).not.toContain(role);
    }
  });

  // Not excluded: an ordinary ward-scoped calling that simply has no module to reach yet.
  it("still offers resource_center_specialist", () => {
    expect(INVITABLE_ROLES).toContain("resource_center_specialist");
  });

  // updateUserSchema is the OTHER half of the friction: the schema refuses the value, so a
  // hand-rolled PATCH is a 400 rather than a promotion to app-wide administrator.
  it("is matched by the admin role-change schema refusing super_admin", () => {
    expect(updateUserSchema.safeParse({ role: "super_admin" }).success).toBe(false);
    expect(updateUserSchema.safeParse({ role: "ward_secretary" }).success).toBe(true);
  });
});
