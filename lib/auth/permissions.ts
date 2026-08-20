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

export function can(
  user: SessionUser,
  permission: KnownPermission,
  roleAccess: RoleAccess = ROLE_PERMISSIONS,
): boolean {
  const granted = roleAccess[user.role];
  if (!granted) return false;
  return granted.includes(permission);
}

export function assertCan(
  user: SessionUser,
  permission: KnownPermission,
  roleAccess: RoleAccess = ROLE_PERMISSIONS,
): void {
  if (!can(user, permission, roleAccess)) {
    throw new ForbiddenError(permission);
  }
}

// Keys are validated against ROLES below rather than by the schema, so one unrecognised role
// in the stored override does not discard the whole object.
const roleAccessOverrideSchema = z.record(z.string(), z.array(z.string()));

const KNOWN_ROLES = new Set<string>(ROLES);
const KNOWN_PERMISSIONS = new Set<string>(PERMISSIONS);

export function mergeRoleAccess(override: unknown): RoleAccess {
  if (override === null || override === undefined) return ROLE_PERMISSIONS;

  const parsed = roleAccessOverrideSchema.safeParse(override);
  if (!parsed.success) {
    console.warn(
      "wards.settings.role_access is malformed; falling back to the code defaults",
      { issues: parsed.error.issues },
    );
    return ROLE_PERMISSIONS;
  }

  const merged: RoleAccess = { ...ROLE_PERMISSIONS };

  for (const [role, permissions] of Object.entries(parsed.data)) {
    if (!KNOWN_ROLES.has(role)) {
      console.warn(
        `wards.settings.role_access names an unknown role "${role}"; ignoring it`,
      );
      continue;
    }

    const recognised = permissions.filter((permission) =>
      KNOWN_PERMISSIONS.has(permission),
    ) as KnownPermission[];

    const unrecognised = permissions.filter(
      (permission) => !KNOWN_PERMISSIONS.has(permission),
    );
    if (unrecognised.length > 0) {
      console.warn(
        `wards.settings.role_access grants unknown permissions to "${role}"; ignoring them`,
        { unrecognised },
      );
    }

    merged[role as Role] = recognised;
  }

  return merged;
}

// Throws rather than falling back on a read failure. An override can only ever *narrow*
// access relative to what an admin configured, so silently substituting the code defaults
// would fail open — it could grant a role something the ward had deliberately removed.
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
