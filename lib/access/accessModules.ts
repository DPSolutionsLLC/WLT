import {
  NON_OVERRIDABLE_PERMISSIONS,
  type KnownPermission,
} from "@/lib/auth/permissions";
import type { AccessLevel } from "@/types/domain";

// ---------------------------------------------------------------------------
// A WARD ASKS FOR A MODULE, NOT FOR A PERMISSION
// ---------------------------------------------------------------------------
//
// Decided by the user 2026-09-22, walking scenario 067. The picker used to offer 39 raw permission
// keys — `topics.manage`, `calendar.manage_org_conducting` — beside a humanised role name, and a
// bishop was expected to know which of them their presidencies actually needed.
//
// The prototype's own role-access management page never did that. It works in MODULES with real
// descriptors ("Sacrament — Talks", "Tithing Calculator") and a LEVEL, and its request rows read
// *"Relief Society President — Sacrament — Talks (Full)"*. The labels below are its
// `ACCESS_MODULES` list, verbatim where a module maps.
//
// ---------------------------------------------------------------------------
// IT ALSO FIXES A DEFECT, WHICH IS THE REAL ARGUMENT FOR IT
// ---------------------------------------------------------------------------
// The walk approved `topics.manage` for `org_president`, the delta landed correctly, and the topic
// library was STILL refused — because `/talks/topics` gates on `topics.view`, which nobody thought
// to ask for. The card meanwhile read "This is now turned on for your ward", which was not true.
//
// A MODULE EXPANDS TO A COHERENT SET, so `full` always contains its own `read`. A grant can no
// longer arrive inert. That is not a convenience; it is the thing that makes the sentence honest.
//
// ---------------------------------------------------------------------------
// LEVELS: `F` AND `R`. `Q` IS NOT A LEVEL A WARD ASKS FOR.
// ---------------------------------------------------------------------------
// decisions.md §2.3: the prototype's `Q` maps onto WLT's EXISTING org scoping, which RLS applies
// through `current_org_id()` whether anybody asked or not. Offering it would suggest a ward could
// turn it on, and there is nothing to turn on. `R` is offered although the prototype's own matrix
// never uses it — here it has a real meaning, because WLT's view/manage split already expresses it.

export type AccessModule = {
  key: string;
  // The prototype's descriptor where one exists; WLT's own navigation label otherwise.
  label: string;
  // What the module is for, in the words a bishop would use. The picker shows it under the label,
  // because "Sacrament — Talks" still does not say what a president would be able to DO.
  description: string;
  read: readonly KnownPermission[];
  full: readonly KnownPermission[];
};

// `full` is written as read + the rest, never as a separate list. Two independent lists is two
// things to keep in step, and the one invariant this file exists to guarantee — that `full`
// contains `read` — would be the first to drift.
function moduleOf(
  key: string,
  label: string,
  description: string,
  read: readonly KnownPermission[],
  extra: readonly KnownPermission[] = [],
): AccessModule {
  return { key, label, description, read, full: [...read, ...extra] };
}

export const ACCESS_MODULES: readonly AccessModule[] = [
  // --- mapped from the prototype's matrix, labels verbatim -------------------
  moduleOf(
    "visits",
    "Visits",
    "See and record visits for their own organization, and set the visiting goals.",
    ["visits.view", "goals.view"],
    ["visits.create", "visits.manage_goals", "goals.manage"],
  ),
  moduleOf(
    "youth_support",
    "Youth Support",
    "See the youth calendar and write follow-ups after an activity.",
    ["youth_activities.view"],
    ["youth_activities.log"],
  ),
  moduleOf(
    "youth_activities",
    "Youth Activities",
    "Run the schedule itself — add activities, import a season, manage the roster.",
    ["youth_activities.view"],
    ["youth_activities.log", "youth_activities.manage"],
  ),
  moduleOf(
    "sacrament_talks",
    "Sacrament — Talks",
    "Plan speakers and topics for sacrament meeting.",
    ["talks.view", "topics.view"],
    ["talks.plan", "talks.approve", "talks.request", "talks.confirm", "topics.manage"],
  ),
  moduleOf(
    "sacrament_prayers",
    "Sacrament — Prayers",
    "Assign the invocation and benediction.",
    ["talks.view"],
    ["talks.plan"],
  ),
  moduleOf(
    "sacrament_program",
    "Sacrament Program",
    "Build the printed programme and send it out.",
    ["program.view"],
    // NOT `program.approve`. Approving is what writes `programs.public_data` and puts the
    // programme on an unauthenticated page, and it is a bishopric act (program-a) — the same
    // reading applied to the two secretaries and to `resource_center_specialist`. A module grant
    // must not be a way around a decision the matrix re-derivation already settled.
    ["program.build", "program.distribute"],
  ),
  moduleOf(
    "agendas",
    "Agenda Management",
    "Read, build and publish meeting agendas.",
    ["agendas.view"],
    ["agendas.manage", "agendas.publish"],
  ),
  moduleOf("music", "Music", "Choose hymns and record musical numbers.", ["music.view"], [
    "music.manage",
  ]),
  moduleOf(
    "tithing",
    "Tithing Calculator",
    "Open the counting worksheet and enter amounts.",
    ["tithing.view"],
    ["tithing.manage"],
  ),

  // --- WLT's own, which the prototype's matrix has no column for -------------
  //
  // decisions.md §1.12: modules absent from the uploaded matrix were left OPEN in the prototype
  // rather than gated on a guess. WLT gates them, so they need a way to be asked for or the move
  // to modules would quietly make five modules un-requestable. Labels come from NAVIGATION_ITEMS,
  // so the picker and the sidebar call the same thing by the same name.
  moduleOf(
    "roster",
    "Roster",
    "See the ward roster, and keep households and members up to date.",
    ["roster.view"],
    ["roster.manage", "roster.import"],
  ),
  moduleOf(
    "calendar",
    "Calendar",
    "See the Sunday calendar, and set who conducts their own organization's meeting.",
    ["calendar.view"],
    ["calendar.manage", "calendar.manage_org_conducting"],
  ),
  moduleOf(
    "knowledge",
    "Knowledge Base",
    "Search the reference library, and upload documents to it.",
    ["knowledge.view"],
    ["knowledge.manage"],
  ),
  moduleOf(
    "ai_settings",
    "AI Settings",
    "Read how drafting is configured for the ward, and change it.",
    ["ai_settings.view"],
    ["ai_settings.manage"],
  ),
  moduleOf(
    "notifications",
    "Notifications",
    "Receive notifications, and manage which ones the ward sends.",
    ["notifications.view"],
    ["notifications.manage"],
  ),
  // Read-only by nature: there is no `audit.manage` and there should not be. `full` and `read` are
  // deliberately the same list rather than the module being left out — a ward may legitimately
  // want its clerk to read the audit log, and `audit.view` is NOT locked (see
  // NON_OVERRIDABLE_PERMISSIONS, which excludes it on purpose).
  moduleOf("audit", "Audit Log", "Read the record of who changed what.", ["audit.view"]),
];

// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY ABSENT, AND WHY
// ---------------------------------------------------------------------------
//
//   wardAdmin, callings, sacramentAssignments — map onto `admin.*` and `sacrament.*`, which are
//     NON-OVERRIDABLE IN BOTH DIRECTIONS. A request for one would be accepted, approved, written,
//     and silently have no effect, because `mergeRoleAccess` restores the code default. The
//     assertion below is what keeps that true if a module is ever edited carelessly.
//
//   stakeAdmin, todo, prayerRoll, prayerItems, zoom, wltCommunicate, ministeringSandbox — no WLT
//     module exists yet. A permission granted before its page is how CLAUDE.md §9's dead sidebar
//     links happened; a MODULE offered before its page would be worse, because somebody would be
//     told they had been given something that does not exist.
//
//   bishopricAgenda, wardCouncilAgenda — WLT has no per-agenda-type permission, so both would
//     expand to exactly `agendas.view`. Offering two controls that do the same thing is worse than
//     offering one: "Agenda Management" at Read only already says it.
//
//   visitsAll — cross-organization visibility is a WARD SETTING with its own switch
//     (`ward_allows_cross_org_visibility()`), not a permission a delta could grant.

const REQUESTABLE = new Set<string>(
  ACCESS_MODULES.flatMap((accessModule) => [...accessModule.full]),
);

// Proved at import time rather than in a test, because the cost of getting it wrong is a grant
// that silently does nothing — and the module list is exactly the kind of thing that gets a line
// added to it in a hurry. tests/lib/accessModules.test.ts asserts it too, so the failure is
// legible rather than a stack trace at boot.
const LOCKED_LEAK = [...REQUESTABLE].filter((permission) =>
  (NON_OVERRIDABLE_PERMISSIONS as readonly string[]).includes(permission),
);

if (LOCKED_LEAK.length > 0) {
  throw new Error(
    `ACCESS_MODULES offers non-overridable permissions (${LOCKED_LEAK.join(", ")}). ` +
      "A request for one would be approved and silently have no effect, because mergeRoleAccess " +
      "restores the code default for admin.* and sacrament.* whatever a delta says.",
  );
}

export const ACCESS_MODULE_KEYS: readonly string[] = ACCESS_MODULES.map(
  (accessModule) => accessModule.key,
);

export function findAccessModule(key: string): AccessModule | null {
  return ACCESS_MODULES.find((accessModule) => accessModule.key === key) ?? null;
}

// THE EXPANSION. One module plus one level becomes the permissions an approval writes.
//
// `Q` resolves to `full`: it is the prototype's "their own organization only", and in WLT that
// narrowing is what RLS already does through `current_org_id()`. A request carrying it should
// grant the module and let the policy do the scoping, rather than granting less than was asked.
export function permissionsForModule(
  key: string,
  level: AccessLevel,
): readonly KnownPermission[] {
  const accessModule = findAccessModule(key);
  if (!accessModule) return [];
  return level === "R" ? accessModule.read : accessModule.full;
}

// What the requester and the decider both read: "Sacrament — Talks (Full)".
export function describeAccessRequest(key: string, level: AccessLevel): string {
  const accessModule = findAccessModule(key);
  const label = accessModule?.label ?? key;
  return level === "R" ? `${label} (read only)` : label;
}
