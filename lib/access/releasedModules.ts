import {
  RELEASED_MODULE_KEYS,
  type ReleasedModuleKey,
  type SessionUser,
} from "@/types/domain";

export { RELEASED_MODULE_KEYS, type ReleasedModuleKey };

// THE RELEASED-MODULES CATALOG (ITER-041 slice b).
//
// A ward can carry a list of the modules it has released (`ward_release_settings`, migration
// 091). Everything not on the list is hidden and refused in that ward, for everybody but the
// super admin. ABSENT MEANS EVERYTHING: a ward with no list has every module released.
//
// This file is the one place that says which permissions, which routes and which tables belong
// to which module. Three things read it, and none may keep a second copy:
//
//   * can() — a permission whose module is unreleased is refused (lib/auth/permissions.ts)
//   * the bounce — a page whose module is unreleased redirects to /dashboard
//     (lib/access/requireReleasedRoute.ts)
//   * the database — migration 091 restricts each module's OWN tables, and
//     tests/db/module-release-policies.test.ts proves its mapping equals `tables` below
//
// ---------------------------------------------------------------------------
// NOTHING ESCAPES BY ACCIDENT
// ---------------------------------------------------------------------------
// moduleOfPermission() THROWS on a permission no prefix claims, and
// assertPermissionsArePlaced() runs when lib/auth/permissions.ts loads: add a permission without
// placing it and every page fails to load, rather than the permission quietly ignoring the
// release list. (It is called FROM permissions.ts rather than importing PERMISSIONS here, because
// permissions.ts imports this file and an import-time read the other way would be a cycle.) tests/lib/releasedRoutesCovered
// reads app/ from disk for the same guarantee about pages.

export const RELEASED_MODULES = [
  {
    key: "sacrament",
    label: "Sacrament meeting",
    description: "Talks, prayers, topics, music, the programme and the calendar.",
    built: true,
    permissionPrefixes: ["talks.", "topics.", "program.", "music.", "calendar."],
    routePrefixes: [
      "/sacrament",
      "/assignments",
      "/prayers",
      "/talks",
      "/program",
      "/music",
      "/calendar",
    ],
    tables: [
      "assignments",
      "assignment_approvals",
      "assignment_comments",
      "assignment_history",
      "talk_references",
      "prayer_assignments",
      "topics",
      "topic_candidates",
      "programs",
      "hymn_selections",
      "musical_numbers",
      "sunday_music",
      "conducting_rotation",
      "sunday_org_conducting",
    ],
  },
  {
    // Named now so Buffalo's list can carry it today. ITER-042 adds its `speakers.` permissions,
    // its route, its tables (with a migration adding their restrictive policy) and flips `built`.
    key: "speakers",
    label: "Speakers & Prayers",
    description: "The bishopric's tracker of who has spoken and prayed.",
    built: false,
    permissionPrefixes: [],
    routePrefixes: [],
    tables: [],
  },
  {
    key: "agendas",
    label: "Agendas",
    description: "Meeting agendas and their action items.",
    built: true,
    permissionPrefixes: ["agendas."],
    routePrefixes: ["/agendas"],
    tables: ["agendas", "action_items"],
  },
  {
    // members and households stay readable: Speakers & Prayers reads the people. Only the roster's
    // pages, its actions and its notes are this module's.
    key: "roster",
    label: "Roster",
    description: "The ward's people and households, and the LCR import.",
    built: true,
    permissionPrefixes: ["roster."],
    routePrefixes: ["/roster"],
    tables: ["member_notes"],
  },
  {
    key: "visits",
    label: "Visits",
    description: "Visit reports, goals and appointments.",
    built: true,
    permissionPrefixes: ["visits.", "goals."],
    routePrefixes: ["/visits", "/goals"],
    tables: [
      "visit_logs",
      "visit_private_notes",
      "visit_participants",
      "visit_appointments",
      "visit_goals",
      "household_visit_cadences",
      "household_stewardships",
      "goals",
    ],
  },
  {
    key: "youth",
    label: "Youth activities",
    description: "Youth activity schedules, support and follow-ups.",
    built: true,
    permissionPrefixes: ["youth_activities."],
    routePrefixes: ["/youth"],
    tables: [
      "youth_activity_profiles",
      "activity_events",
      "activity_attendees",
      "activity_logs",
      "activity_private_notes",
      "activity_calendars",
      "activity_occasions",
      "activity_roster",
      "activity_event_participation",
    ],
  },
  {
    key: "tithing",
    label: "Tithing",
    description: "The Sunday counting worksheet.",
    built: true,
    permissionPrefixes: ["tithing."],
    routePrefixes: ["/tithing"],
    tables: ["tithing_entries", "tithing_sessions"],
  },
  {
    key: "personal_tools",
    label: "To Do & Appointments",
    description: "A leader's own to-do list and appointments.",
    built: true,
    permissionPrefixes: ["personal_tools."],
    routePrefixes: ["/todos", "/appointments"],
    tables: [],
  },
  {
    key: "knowledge",
    label: "Knowledge Base",
    description: "Documents the AI drafts from.",
    built: true,
    permissionPrefixes: ["knowledge."],
    routePrefixes: ["/knowledge"],
    tables: [],
  },
  {
    key: "ai_settings",
    label: "AI Settings",
    description: "How the AI drafts for this ward.",
    built: true,
    permissionPrefixes: ["ai_settings."],
    routePrefixes: ["/ai-settings"],
    tables: [],
  },
  {
    // Unreleased in Buffalo, on purpose. The super admin does invites and settings there, and
    // reaches it through can()'s bypass. This narrowing DOES reach admin.*, which role_access
    // cannot — see can().
    key: "admin",
    label: "Admin",
    description: "Users, invites, roles and ward settings.",
    built: true,
    permissionPrefixes: ["admin.", "audit."],
    routePrefixes: ["/admin"],
    tables: [],
  },
  {
    key: "sacrament_ordinances",
    label: "Sacrament ordinances",
    description: "Who blesses and passes, and the youth sign-in for it.",
    built: true,
    permissionPrefixes: ["sacrament."],
    // `/sacrament/ordinances` is longer than `/sacrament`, so it wins the match (moduleForPath).
    routePrefixes: ["/ordinances", "/sacrament/ordinances"],
    tables: [
      "sacrament_assignments",
      "sacrament_rotation_pools",
      "sacrament_send_log",
      "sacrament_assignment_managers",
    ],
  },
] as const satisfies readonly {
  key: ReleasedModuleKey;
  label: string;
  description: string;
  built: boolean;
  permissionPrefixes: readonly string[];
  routePrefixes: readonly string[];
  tables: readonly string[];
}[];

export type ReleasedModule = (typeof RELEASED_MODULES)[number];

// Never on the list, in any ward: a notification is account-level and the dashboard, the account
// page, sign-in and the session are what every other module sits inside.
export const ALWAYS_ON_PERMISSION_PREFIXES: readonly string[] = ["notifications."];
export const CORE_ROUTE_PREFIXES: readonly string[] = ["/dashboard"];

// The request header middleware.ts sets to the page path, so a layout can bounce by route.
export const PATHNAME_HEADER = "x-wlt-pathname";

const MODULE_KEYS = new Set<string>(RELEASED_MODULE_KEYS);

export function isReleasedModuleKey(value: string): value is ReleasedModuleKey {
  return MODULE_KEYS.has(value);
}

export function releasedModuleLabel(key: ReleasedModuleKey): string {
  return RELEASED_MODULES.find((entry) => entry.key === key)?.label ?? key;
}

// Null means always on. Throws on a permission that matches no prefix, so a new permission cannot
// be added without deciding which module it belongs to.
export function moduleOfPermission(permission: string): ReleasedModuleKey | null {
  if (ALWAYS_ON_PERMISSION_PREFIXES.some((prefix) => permission.startsWith(prefix))) {
    return null;
  }

  const owner = RELEASED_MODULES.find((entry) =>
    (entry.permissionPrefixes as readonly string[]).some((prefix) =>
      permission.startsWith(prefix),
    ),
  );

  if (!owner) {
    throw new Error(
      `The permission "${permission}" belongs to no released module. Add its prefix to a ` +
        "module in lib/access/releasedModules.ts, or to ALWAYS_ON_PERMISSION_PREFIXES.",
    );
  }

  return owner.key;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// Null means core, or a path no module claims. Whole-segment matching (`/talks` does not claim
// `/talkative`) and the LONGEST matching prefix wins, so `/sacrament/ordinances` belongs to
// sacrament_ordinances rather than to sacrament.
export function moduleForPath(pathname: string): ReleasedModuleKey | null {
  let best: { key: ReleasedModuleKey; length: number } | null = null;

  for (const entry of RELEASED_MODULES) {
    for (const prefix of entry.routePrefixes as readonly string[]) {
      if (matchesPrefix(pathname, prefix) && (best === null || prefix.length > best.length)) {
        best = { key: entry.key, length: prefix.length };
      }
    }
  }

  return best?.key ?? null;
}

export function isCorePath(pathname: string): boolean {
  return CORE_ROUTE_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isModuleReleased(
  user: Pick<SessionUser, "isSuperAdmin" | "releasedModules">,
  key: ReleasedModuleKey,
): boolean {
  return user.isSuperAdmin || user.releasedModules === null || user.releasedModules.includes(key);
}

// Built modules this ward has not released. Drives the dashboard's "coming soon" line, which only
// makes sense when something that exists is being withheld.
export function unreleasedBuiltModules(
  releasedModules: readonly ReleasedModuleKey[] | null,
): ReleasedModuleKey[] {
  if (releasedModules === null) return [];
  return RELEASED_MODULES.filter(
    (entry) => entry.built && !releasedModules.includes(entry.key),
  ).map((entry) => entry.key);
}

// THE INVARIANT, CHECKED AT IMPORT of lib/auth/permissions.ts — accessModules.ts's precedent.
// Every permission belongs to exactly one module or is always on, and no prefix is claimed by two
// modules.
export function assertPermissionsArePlaced(permissions: readonly string[]): void {
  const describedKeys = RELEASED_MODULES.map((entry) => entry.key);
  if (
    describedKeys.length !== RELEASED_MODULE_KEYS.length ||
    RELEASED_MODULE_KEYS.some((key) => !describedKeys.includes(key))
  ) {
    throw new Error(
      "RELEASED_MODULES must describe every key in RELEASED_MODULE_KEYS (types/domain.ts) once.",
    );
  }

  const prefixOwners = new Map<string, string>();
  for (const entry of RELEASED_MODULES) {
    for (const prefix of entry.permissionPrefixes as readonly string[]) {
      const existing = prefixOwners.get(prefix);
      if (existing) {
        throw new Error(
          `The permission prefix "${prefix}" is claimed by ${existing} and ${entry.key}.`,
        );
      }
      prefixOwners.set(prefix, entry.key);
    }
  }

  for (const permission of permissions) {
    const owners = RELEASED_MODULES.filter((entry) =>
      (entry.permissionPrefixes as readonly string[]).some((prefix) =>
        permission.startsWith(prefix),
      ),
    );
    const alwaysOn = ALWAYS_ON_PERMISSION_PREFIXES.some((prefix) => permission.startsWith(prefix));
    if (owners.length + (alwaysOn ? 1 : 0) !== 1) {
      throw new Error(
        `The permission "${permission}" must belong to exactly one released module ` +
          `(found ${owners.length}${alwaysOn ? " and it is always on" : ""}).`,
      );
    }
  }
}
