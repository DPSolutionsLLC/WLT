import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ForbiddenError } from "@/lib/auth/errors";
import type { Database } from "@/types/database";
import { ROLES, type Role, type SessionUser } from "@/types/domain";

export const PERMISSIONS = [
  "roster.view",
  "roster.manage",
  "roster.import",

  "calendar.view",
  "calendar.manage",
  "calendar.manage_org_conducting",

  "talks.view",
  "talks.plan",
  "talks.approve",
  "talks.request",
  "talks.confirm",

  "topics.view",
  "topics.manage",

  "knowledge.view",
  "knowledge.manage",

  "ai_settings.view",
  "ai_settings.manage",

  "program.view",
  "program.build",
  "program.approve",
  "program.distribute",

  "music.view",
  "music.manage",

  "visits.view",
  "visits.create",
  "visits.manage_goals",

  "youth_activities.view",
  "youth_activities.manage",
  "youth_activities.log",

  "goals.view",
  "goals.manage",

  "agendas.view",
  "agendas.manage",
  "agendas.publish",

  "tithing.view",
  "tithing.manage",

  "notifications.view",
  "notifications.manage",

  "sacrament.view_assignments",
  "sacrament.update_assignments",
  "sacrament.mark_sent",
  "sacrament.manage_pools",
  "sacrament.manage_manager",

  "admin.view",
  "admin.manage_users",
  "admin.manage_ward",
  "admin.manage_roles",
  "admin.manage_notifications",

  "audit.view",
] as const;

export type KnownPermission = (typeof PERMISSIONS)[number];

// Bishopric admin authority is shared (CLAUDE.md §7). These are the permissions the
// bishop/counselor equivalence test loops over exhaustively.
export const ADMIN_PERMISSIONS = PERMISSIONS.filter(
  (permission) => permission.startsWith("admin.") || permission === "audit.view",
) as readonly KnownPermission[];

// Permissions a ward may not reconfigure, in EITHER direction.
//
// admin.*  — these run through the service-role client (lib/auth/adminUsers.ts,
//            lib/auth/youthAccounts.ts), where assertCan() is the only boundary and RLS is not
//            behind it. Widening one is self-escalation: a role granted admin.manage_users can
//            make itself bishop. Locking removal too means the bishopric cannot lock itself out
//            of the admin screen, which is the guard 11-notifications-admin.md asks for.
//
// sacrament.* — the whole reach of a youth PIN account. FEATURES.md §Module 17: exactly one
//            module. Widening that is a product decision, not a checkbox.
//
// audit.view is deliberately NOT locked. It is in ADMIN_PERMISSIONS for the bishopric-equivalence
// loop, but it grants reading rather than writing, and a ward may legitimately want its secretary
// to see the audit log.
export const NON_OVERRIDABLE_PERMISSIONS: readonly KnownPermission[] = PERMISSIONS.filter(
  (permission) =>
    permission.startsWith("admin.") || permission.startsWith("sacrament."),
);

export const BISHOPRIC_ROLES = ["bishop", "counselor"] as const;

export type RoleAccess = Record<Role, readonly KnownPermission[]>;

// Bishop and counselor share one list rather than two identical literals. Two lists is two
// things to keep in step, and CLAUDE.md §7 forbids them ever diverging.
const BISHOPRIC_PERMISSIONS: readonly KnownPermission[] = PERMISSIONS;

const WARD_SECRETARY_PERMISSIONS: readonly KnownPermission[] = [
  "roster.view",
  "calendar.view",
  "calendar.manage",
  "talks.view",
  "program.view",
  "program.build",
  "program.distribute",
  "music.view",
  "agendas.view",
  "agendas.manage",
  "agendas.publish",
  "notifications.view",
];

const EXECUTIVE_SECRETARY_PERMISSIONS: readonly KnownPermission[] = [
  "roster.view",
  "calendar.view",
  "talks.view",
  "agendas.view",
  "agendas.manage",
  "agendas.publish",
  "notifications.view",
];

// Org leadership. The role does not encode which organization, so these grants are
// organization-wide by intent and narrowed to one org by RLS (current_org_id()), not here.
const ORG_LEADERSHIP_PERMISSIONS: readonly KnownPermission[] = [
  "roster.view",
  // Deliberately NOT calendar.manage. Widening that would let an Elders Quorum president edit
  // the sacrament meeting calendar, the bishopric rotation and every Sunday's type. This
  // permission says only "may manage AN organization's conducting"; WHICH one is narrowed to
  // the holder's own by RLS (migration 024) and by lib/calendar/orgRotationScope.ts.
  //
  // It is absent from ORG_SECRETARY_PERMISSIONS on purpose: a secretary may be PICKED to
  // conduct, but deciding who conducts is a presidency decision.
  "calendar.manage_org_conducting",
  "visits.view",
  "visits.create",
  "visits.manage_goals",
  "goals.view",
  "goals.manage",
  "youth_activities.view",
  "youth_activities.manage",
  "youth_activities.log",
  "notifications.view",
];

const ORG_SECRETARY_PERMISSIONS: readonly KnownPermission[] = [
  "roster.view",
  "visits.view",
  "visits.create",
  "goals.view",
  "youth_activities.view",
  "youth_activities.log",
  "notifications.view",
];

const MUSIC_COORDINATOR_PERMISSIONS: readonly KnownPermission[] = [
  "calendar.view",
  "talks.view",
  "music.view",
  "music.manage",
  "notifications.view",
];

const WARD_COUNCIL_MEMBER_PERMISSIONS: readonly KnownPermission[] = [
  "roster.view",
  "youth_activities.view",
  "youth_activities.manage",
  "youth_activities.log",
  "agendas.view",
  "notifications.view",
];

// FEATURES.md §Module 17: exactly one module. Not the roster, not the calendar, not even
// the notification centre. Adding anything here widens a youth account's reach.
const SACRAMENT_MANAGER_PERMISSIONS: readonly KnownPermission[] = [
  "sacrament.view_assignments",
  "sacrament.update_assignments",
  "sacrament.mark_sent",
];

export const ROLE_PERMISSIONS: RoleAccess = {
  bishop: BISHOPRIC_PERMISSIONS,
  counselor: BISHOPRIC_PERMISSIONS,
  ward_secretary: WARD_SECRETARY_PERMISSIONS,
  executive_secretary: EXECUTIVE_SECRETARY_PERMISSIONS,
  org_president: ORG_LEADERSHIP_PERMISSIONS,
  org_counselor: ORG_LEADERSHIP_PERMISSIONS,
  org_secretary: ORG_SECRETARY_PERMISSIONS,
  music_coordinator: MUSIC_COORDINATOR_PERMISSIONS,
  ward_council_member: WARD_COUNCIL_MEMBER_PERMISSIONS,
  sacrament_manager: SACRAMENT_MANAGER_PERMISSIONS,
};

// No default on roleAccess. A defaulted third parameter is how 25 call sites came to silently
// ignore the ward's configuration (ITER-005): nothing failed when a new route forgot to pass it.
// A missing argument must be a type error. Do not restore the default as a convenience.
export function can(
  user: SessionUser,
  permission: KnownPermission,
  roleAccess: RoleAccess,
): boolean {
  const granted = roleAccess[user.role];
  if (!granted) return false;
  return granted.includes(permission);
}

// No default — see can() above.
export function assertCan(
  user: SessionUser,
  permission: KnownPermission,
  roleAccess: RoleAccess,
): void {
  if (!can(user, permission, roleAccess)) {
    throw new ForbiddenError(permission);
  }
}

// A ward stores what it CHANGED, not the list it wants. Deltas resolve against whatever the code
// currently grants, so a permission added in a later phase reaches a ward that already has an
// override. Under replace-semantics it never would, and nothing would surface the drift.
export type RoleAccessDelta = {
  add?: readonly KnownPermission[];
  remove?: readonly KnownPermission[];
};

// Parsed per role rather than as one z.record over the whole object, so a single malformed value
// leaves that role on the defaults instead of discarding every sibling's valid configuration.
// This is what lets a legacy array value degrade gracefully.
const roleAccessDeltaSchema = z.object({
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
});

const KNOWN_ROLES = new Set<string>(ROLES);
const KNOWN_PERMISSIONS = new Set<string>(PERMISSIONS);
const LOCKED_PERMISSIONS = new Set<string>(NON_OVERRIDABLE_PERMISSIONS);

type ParsedDelta = { add: string[]; remove: string[] };

function unionDeltas(first: ParsedDelta, second: ParsedDelta): ParsedDelta {
  return {
    add: [...new Set([...first.add, ...second.add])],
    remove: [...new Set([...first.remove, ...second.remove])],
  };
}

function sameDelta(first: ParsedDelta, second: ParsedDelta): boolean {
  const signature = (delta: ParsedDelta) =>
    `${[...delta.add].sort().join(",")}|${[...delta.remove].sort().join(",")}`;
  return signature(first) === signature(second);
}

function applyDelta(role: Role, delta: ParsedDelta): readonly KnownPermission[] {
  // Unknown names are dropped from both lists, with one warning per role naming every offender.
  const unrecognised = [...delta.add, ...delta.remove].filter(
    (permission) => !KNOWN_PERMISSIONS.has(permission),
  );
  if (unrecognised.length > 0) {
    // The names go in the message string on purpose. Next.js's dev logger renders an object
    // argument to console.warn as {} (plans/retros/auth-b-invites-admin.md).
    console.warn(
      `wards.settings.role_access names unknown permissions for "${role}": ` +
        `${[...new Set(unrecognised)].join(", ")}; ignoring them`,
    );
  }

  const add = delta.add.filter((permission) =>
    KNOWN_PERMISSIONS.has(permission),
  ) as KnownPermission[];
  const remove = delta.remove.filter((permission) =>
    KNOWN_PERMISSIONS.has(permission),
  ) as KnownPermission[];

  // 1. Start from the code defaults.
  // 2. Subtract `remove`.
  // 3. Add `add`. A permission named in BOTH lists ends up GRANTED — `add` wins. That choice is
  //    arbitrary, but it must be deterministic and it must be written down, so it is both.
  const removed = new Set<string>(remove);
  const resolved = new Set<KnownPermission>(
    ROLE_PERMISSIONS[role].filter((permission) => !removed.has(permission)),
  );
  for (const permission of add) resolved.add(permission);

  // 4. Restore the default membership of every locked permission, in both directions. One rule
  //    covers add and remove alike: for a locked permission, the answer is whatever
  //    ROLE_PERMISSIONS says, regardless of what the delta asked for. Only the locked entries are
  //    restored, so the rest of the delta still applies.
  const lockedNamed = [...add, ...remove].filter((permission) =>
    LOCKED_PERMISSIONS.has(permission),
  );
  if (lockedNamed.length > 0) {
    console.warn(
      `wards.settings.role_access tries to change non-overridable permissions for "${role}": ` +
        `${[...new Set(lockedNamed)].join(", ")}; keeping the code defaults for them`,
    );
    const defaults = new Set<string>(ROLE_PERMISSIONS[role]);
    for (const permission of NON_OVERRIDABLE_PERMISSIONS) {
      if (defaults.has(permission)) resolved.add(permission);
      else resolved.delete(permission);
    }
  }

  // 5. De-duplicate — the Set has already done it.
  return [...resolved];
}

export function mergeRoleAccess(override: unknown): RoleAccess {
  if (override === null || override === undefined) return ROLE_PERMISSIONS;

  if (typeof override !== "object" || Array.isArray(override)) {
    console.warn(
      "wards.settings.role_access is not an object of per-role deltas; falling back to the code defaults",
    );
    return ROLE_PERMISSIONS;
  }

  const deltas = new Map<Role, ParsedDelta>();

  for (const [role, value] of Object.entries(override as Record<string, unknown>)) {
    if (!KNOWN_ROLES.has(role)) {
      console.warn(
        `wards.settings.role_access names an unknown role "${role}"; ignoring it`,
      );
      continue;
    }

    const parsed = roleAccessDeltaSchema.safeParse(value);
    if (!parsed.success) {
      console.warn(
        `wards.settings.role_access has a malformed delta for "${role}" ` +
          `(expected { add?: string[], remove?: string[] }); keeping the code defaults for that role`,
      );
      continue;
    }

    deltas.set(role as Role, {
      add: [...(parsed.data.add ?? [])],
      remove: [...(parsed.data.remove ?? [])],
    });
  }

  // Bishopric equivalence, applied BEFORE resolution (CLAUDE.md §7). A delta naming either role is
  // applied to both, so the two resolved lists are identical by construction rather than by the
  // Phase 11 UI remembering to render one row. Same move as BISHOPRIC_PERMISSIONS being one
  // constant instead of two identical literals.
  const [bishopRole, counselorRole] = BISHOPRIC_ROLES;
  const bishopDelta = deltas.get(bishopRole);
  const counselorDelta = deltas.get(counselorRole);

  if (bishopDelta ?? counselorDelta) {
    const empty: ParsedDelta = { add: [], remove: [] };
    if (bishopDelta && counselorDelta && !sameDelta(bishopDelta, counselorDelta)) {
      console.warn(
        `wards.settings.role_access gives "${bishopRole}" and "${counselorRole}" different deltas; ` +
          `bishopric authority is shared, so the union of both is applied to both. ` +
          `${bishopRole}: add=[${bishopDelta.add.join(", ")}] remove=[${bishopDelta.remove.join(", ")}]; ` +
          `${counselorRole}: add=[${counselorDelta.add.join(", ")}] remove=[${counselorDelta.remove.join(", ")}]`,
      );
    }
    const shared = unionDeltas(bishopDelta ?? empty, counselorDelta ?? empty);
    deltas.set(bishopRole, shared);
    deltas.set(counselorRole, shared);
  }

  const merged: RoleAccess = { ...ROLE_PERMISSIONS };
  for (const [role, delta] of deltas) {
    merged[role] = applyDelta(role, delta);
  }

  return merged;
}

// Throws rather than falling back on a read failure. An override can widen access as well as
// narrow it, so substituting the code defaults can be wrong in EITHER direction — silently
// restoring a permission the ward removed, or silently withholding one it granted. Neither is
// safe to guess at, so a failed read is an error rather than a default.
export async function resolveRoleAccess(
  supabase: SupabaseClient<Database>,
  wardId: string,
): Promise<RoleAccess> {
  const { data, error } = await supabase
    .from("wards")
    .select("settings")
    .eq("id", wardId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not read role access settings for ward ${wardId}: ${error.message}`,
    );
  }

  const settings = data?.settings;
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    return ROLE_PERMISSIONS;
  }

  return mergeRoleAccess((settings as Record<string, unknown>).role_access);
}
