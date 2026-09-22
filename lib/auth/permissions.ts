import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ForbiddenError } from "@/lib/auth/errors";
import type { Database } from "@/types/database";
import {
  ROLES,
  type OrganizationType,
  type Role,
  type SessionUser,
} from "@/types/domain";

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

// THE WARD CLERK. Re-derived from the prototype's `bishopric-ward-clerk` row in P2, taken
// LITERALLY on the user's instruction 2026-09-21 — every cell the matrix speaks to is adopted,
// including the two it WITHHOLDS.
//
// Gained: tithing (the clearest of the lot — the General Handbook makes ward finances clerk
// work, and an assistant clerk over finances must hold the Melchizedek Priesthood), the visit
// and goal set, youth view/log, and program.approve.
//
// LOST, and both are deliberate rather than an oversight: `talks.view`, because the matrix has a
// `sacramentTalks` column and this row does not carry it; and `music.view`, because it has a
// `music` column and this row does not carry it either. A permission absent from a row that the
// matrix HAS a column for is a withholding, unlike a module absent from the matrix entirely —
// those (roster, calendar, notifications) have no column at all and are left open, which is the
// prototype's own rule 1.12.
//
// ⚠️ ONE CELL OF THE LITERAL READING WAS OVERRIDDEN, decided by the user 2026-09-21 after the
// suite caught it: `program.approve` is WITHHELD, although `sacramentProgram=F` grants the whole
// programme set. APPROVING IS A BISHOPRIC ACT (program-a) and it is approval that writes
// `programs.public_data` and puts the programme on an unauthenticated page — so a clerk who
// prepares and sends the programme does not also decide that it is final.
//
// It is the same reading already applied to `resource_center_specialist`, which derives from the
// identical cell. Taking one literally and the other not was an inconsistency in the first pass;
// both now say the same thing. tests/routes/program-approval.test.ts names it in a test title:
// "this is the one step they cannot take".
//
// ⚠️ THE ODD CONSEQUENCE THAT REMAINS, recorded rather than smoothed over: this clerk can build
// and distribute the sacrament programme while being unable to open Music or see who is speaking.
// That is what the matrix says. It was put to the user with the alternative beside it and taken
// deliberately; if it reads wrong in a walk, change it here and say so, do not quietly re-add.
const WARD_SECRETARY_PERMISSIONS: readonly KnownPermission[] = [
  "roster.view",
  "calendar.view",
  "calendar.manage",
  "program.view",
  "program.build",
  "program.distribute",
  "visits.view",
  "visits.create",
  "visits.manage_goals",
  "goals.view",
  "goals.manage",
  "youth_activities.view",
  "youth_activities.log",
  "agendas.view",
  "agendas.manage",
  "agendas.publish",
  "tithing.view",
  "tithing.manage",
  "notifications.view",
];

// THE EXECUTIVE SECRETARY. Re-derived from `bishopric-secretary`, taken literally alongside the
// clerk above. The same shape minus tithing — the matrix gives `tithingCalculator` to the clerk
// and the bishopric and to nobody else, which matches who actually counts it.
//
// LOST: `talks.view`, for the reason given above. It keeps `music` absent too, but that changes
// nothing — it never held it.
const EXECUTIVE_SECRETARY_PERMISSIONS: readonly KnownPermission[] = [
  "roster.view",
  "calendar.view",
  "program.view",
  "program.build",
  "program.distribute",
  "visits.view",
  "visits.create",
  "visits.manage_goals",
  "goals.view",
  "goals.manage",
  "youth_activities.view",
  "youth_activities.log",
  "agendas.view",
  "agendas.manage",
  "agendas.publish",
  "notifications.view",
];

// ---------------------------------------------------------------------------
// ORG LEADERSHIP — THE ONE PLACE THE MATRIX IS ORGANIZATION-AWARE
// ---------------------------------------------------------------------------
//
// Until P2 these were two flat lists: every org_president held the same grants and WHICH
// organization was narrowed by RLS (current_org_id()). The prototype's matrix does not work that
// way, and re-deriving it in P2 is what made this organization-aware, on the user's instruction
// 2026-09-21.
//
// WHAT VARIES IS YOUTH, AND ONLY YOUTH. Everything else below is identical across the five
// organizations, so this is a narrow seam rather than a second permission engine — which is key
// requirement 1 of plans/p2-admin-and-access.md.
//
// The organization is still narrowed by RLS exactly as before. This decides WHAT the role may
// do; current_org_id() still decides WHOSE rows it may do it to. Both, not either.
const ORG_LEADERSHIP_BASE: readonly KnownPermission[] = [
  "roster.view",
  // Deliberately NOT calendar.manage. Widening that would let an Elders Quorum president edit
  // the sacrament meeting calendar, the bishopric rotation and every Sunday's type. This
  // permission says only "may manage AN organization's conducting"; WHICH one is narrowed to
  // the holder's own by RLS (migration 024) and by lib/calendar/orgRotationScope.ts.
  //
  // It is absent from ORG_SECRETARY_BASE on purpose: a secretary may be PICKED to
  // conduct, but deciding who conducts is a presidency decision.
  "calendar.manage_org_conducting",
  "visits.view",
  "visits.create",
  "visits.manage_goals",
  "goals.view",
  "goals.manage",
  "notifications.view",
];

// A SECRETARY DOES NOT SET GOALS, and that survived the re-derivation deliberately. The
// prototype gives org secretaries the same `visitsQuorum=F` as presidents, which maps to
// goals.manage and visits.manage_goals; the user kept WLT's narrower answer 2026-09-21.
//
// The reason is already written a few lines above about calendar.manage_org_conducting — "a
// secretary may be PICKED to conduct, but deciding who conducts is a presidency decision" — and
// visits-f recorded the same thing about the cadence: it is written under visits.manage_goals
// because "an org president owns that decision and does not own the roster".
const ORG_SECRETARY_BASE: readonly KnownPermission[] = [
  "roster.view",
  "visits.view",
  "visits.create",
  "goals.view",
  "notifications.view",
];

// WHO MAY TOUCH YOUTH ACTIVITIES, BY ORGANIZATION.
//
// Re-derived from the prototype's `youthSupport` (view + log) and `youthActivities` (manage)
// columns, adopted in full by the user 2026-09-21. It matches the General Handbook structure the
// user supplied in calling-hierarchy.json:
//
//   * YOUNG WOMEN run their own youth programme and hold a real ward presidency → full manage.
//   * THE AARONIC PRIESTHOOD SIDE HAS NO SEPARATE PRESIDENCY — "THE BISHOPRIC IS THE PRESIDENCY
//     OF THE AARONIC PRIESTHOOD IN THE WARD", so there is no ward Young Men president calling at
//     all. That is why the prototype lists five org presidencies where organizations.type has
//     six, and it is a correct reading rather than the omission module-map.md §4 assumed.
//   * ELDERS QUORUM, RELIEF SOCIETY and PRIMARY support the youth without running the programme
//     → they see it and write follow-ups, they do not manage the schedule.
//   * SUNDAY SCHOOL has no youth stewardship → nothing.
//
// `young_men` IS STILL GIVEN THE FULL SET, although the prototype has no row for it. An
// organization of that type genuinely exists in this schema and the youth module is built around
// it (an occasion holds a Young Men row beside a Young Women one), so whoever is assigned to one
// is doing youth work. The handbook point is about which CALLING presides, not about whether the
// work exists. `bishopric`, `other` and a null organization keep the pre-P2 behaviour for the
// same reason: no matrix row speaks to them, and rule 1.12 says never to invent a restriction
// that was not specified.
function organizationYouthPermissions(
  orgType: OrganizationType | null,
  includeManage: boolean,
): readonly KnownPermission[] {
  if (orgType === "sunday_school") return [];

  const supporting: readonly KnownPermission[] = [
    "youth_activities.view",
    "youth_activities.log",
  ];

  if (
    orgType === "elders_quorum" ||
    orgType === "relief_society" ||
    orgType === "primary"
  ) {
    return supporting;
  }

  return includeManage
    ? [...supporting, "youth_activities.manage"]
    : supporting;
}

// ALL FIVE ORGANIZATION PRESIDENTS SIT ON THE WARD COUNCIL, and none of their counselors or
// secretaries do. That is `wardCouncilAgenda` in the matrix, and it lines up exactly with the
// standing-member list in calling-hierarchy.json — which is the strongest evidence the module
// mapping is sound, because nothing made the two agree.
//
// It is the one thing that makes org_president and org_counselor stop sharing a list.
const WARD_COUNCIL_AGENDA: readonly KnownPermission[] = ["agendas.view"];

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

// EMPTY. A STAKE OFFICER HAS NO ACCESS TO THIS APP — decided by the user 2026-09-21, reversing
// what this list held for one day.
//
// It previously granted eleven `*.view` permissions across the roster, visits, youth activities,
// the program and agendas, on the reasoning that a stake officer "is there to SEE how the ward is
// doing". That reasoning was never the product's. WLT is a WARD's tool: a ward's roster, its
// visit reports and its youth are that ward's own stewardship, and a stake officer being able to
// read them is not a smaller version of the right thing, it is the wrong thing at a smaller size.
//
// WHAT IS INTENDED INSTEAD, and is NOT built: a stake leader attending a ward's meeting opens a
// READ-ONLY view of THAT MEETING'S AGENDA, with one exception — they may add to the prayer roll
// for that meeting. Nothing else. That is a narrow, purpose-built surface rather than a role with
// a permission list, and it belongs to whichever phase builds it; do not approximate it by adding
// `agendas.view` here, which would hand over every agenda the ward has ever published.
//
// The three stake roles therefore exist as ROLE VALUES that can be assigned and recognised, and
// reach nothing. That is deliberate and it is the safe direction: granting later is one list
// edit, revoking later is a security incident.
//
// One constant for all three rather than three identical literals — the BISHOPRIC_PERMISSIONS
// precedent, and for the same reason: three lists is three things to keep in step.
const STAKE_OFFICER_PERMISSIONS: readonly KnownPermission[] = [];

// EVERYTHING, exactly as BISHOPRIC_PERMISSIONS is everything. CLAUDE.md §7 says super admin
// "bypasses the access matrix"; granting the whole list IS that, through the one mechanism the
// app already has, rather than a second code path beside can(). One mechanism, not two.
const SUPER_ADMIN_PERMISSIONS: readonly KnownPermission[] = PERMISSIONS;

// PRINTING, NOT PUBLISHING — decided by the user 2026-09-21, and this is the proto-d decision
// the empty list was waiting for. The prototype gives this role `sacramentProgram=F`, which maps
// to the whole program set; only view and distribute are taken.
//
// `program.build` and `program.approve` are withheld on purpose: approving a programme is a
// bishopric act in this codebase (program-a), and it is approval that writes
// `programs.public_data` and puts the thing on an unauthenticated public page. A specialist who
// prints and hands out the programme needs to read it and to send it; they do not need to decide
// that it is final.
//
// Its other three matrix cells — prayerRoll, zoom, wltCommunicate — have no WLT module yet and
// are granted nothing. A permission shipped before its page is how CLAUDE.md §9's dead sidebar
// links happened, and this phase does not add a fourth.
const RESOURCE_CENTER_SPECIALIST_PERMISSIONS: readonly KnownPermission[] = [
  "program.view",
  "program.distribute",
];

// THE BASE MATRIX FOR ONE ORGANIZATION TYPE.
//
// Every role except the three org-scoped ones resolves identically whatever the organization is,
// so this is a small function rather than a second engine. It is called once per request by
// resolveRoleAccess() and the ward's deltas are merged onto its result — the delta shape,
// `wards.settings.role_access`, can(), assertCan() and all of their call sites are untouched by
// the move to organization-awareness. That is deliberate: key requirement 1 of
// plans/p2-admin-and-access.md forbids a parallel permission model beside this one.
export function basePermissionsFor(
  orgType: OrganizationType | null,
): RoleAccess {
  const leadershipYouth = organizationYouthPermissions(orgType, true);
  const secretaryYouth = organizationYouthPermissions(orgType, false);

  return {
    bishop: BISHOPRIC_PERMISSIONS,
    counselor: BISHOPRIC_PERMISSIONS,
    ward_secretary: WARD_SECRETARY_PERMISSIONS,
    executive_secretary: EXECUTIVE_SECRETARY_PERMISSIONS,
    org_president: [
      ...ORG_LEADERSHIP_BASE,
      ...leadershipYouth,
      ...WARD_COUNCIL_AGENDA,
    ],
    org_counselor: [...ORG_LEADERSHIP_BASE, ...leadershipYouth],
    org_secretary: [...ORG_SECRETARY_BASE, ...secretaryYouth],
    music_coordinator: MUSIC_COORDINATOR_PERMISSIONS,
    ward_council_member: WARD_COUNCIL_MEMBER_PERMISSIONS,
    sacrament_manager: SACRAMENT_MANAGER_PERMISSIONS,
    stake_president: STAKE_OFFICER_PERMISSIONS,
    stake_counselor: STAKE_OFFICER_PERMISSIONS,
    stake_secretary: STAKE_OFFICER_PERMISSIONS,
    super_admin: SUPER_ADMIN_PERMISSIONS,
    resource_center_specialist: RESOURCE_CENTER_SPECIALIST_PERMISSIONS,
  };
}

// THE ORGANIZATION-INDEPENDENT MATRIX. What a role holds when the session has no organization —
// which is every bishopric member, every secretary, and ward_council_member, the role CLAUDE.md
// calls "the role most likely to have no organization at all".
//
// It stays exported and stays the default base for mergeRoleAccess(), so anything that reasons
// about the code defaults without a session in hand — the tests, a future admin screen showing
// what a role gets — keeps one honest answer to point at.
export const ROLE_PERMISSIONS: RoleAccess = basePermissionsFor(null);

// A ward may not reconfigure the app-wide administrator who is there to HELP it. This is the same
// argument NON_OVERRIDABLE_PERMISSIONS makes about admin.*, one level up: that constant locks
// which PERMISSIONS a ward may move, and this locks a whole ROLE, because super_admin holds every
// permission and a ward removing them one by one would reach the same place.
//
// A role rather than a permission list, because the role itself is not ward-scoped — the
// assignment lives in `unit_assignments` with no ward_id at all (migration 065), so a ward has no
// standing to have an opinion about it.
export const NON_OVERRIDABLE_ROLES: readonly Role[] = ["super_admin"];

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
const LOCKED_ROLES = new Set<string>(NON_OVERRIDABLE_ROLES);

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

// `base` is the organization-specialized matrix from basePermissionsFor(), NOT the module-level
// ROLE_PERMISSIONS. It is threaded rather than closed over because the defaults an override
// resolves against now depend on which organization the session is acting in — resolving a
// Sunday School president's delta against Young Women's defaults would grant youth management
// through an override that never asked for it.
function applyDelta(
  role: Role,
  delta: ParsedDelta,
  base: RoleAccess,
): readonly KnownPermission[] {
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
    base[role].filter((permission) => !removed.has(permission)),
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
    const defaults = new Set<string>(base[role]);
    for (const permission of NON_OVERRIDABLE_PERMISSIONS) {
      if (defaults.has(permission)) resolved.add(permission);
      else resolved.delete(permission);
    }
  }

  // 5. De-duplicate — the Set has already done it.
  return [...resolved];
}

// `base` defaults to the organization-independent matrix so every existing caller and test keeps
// working unchanged. resolveRoleAccess() passes the specialized one.
export function mergeRoleAccess(
  override: unknown,
  base: RoleAccess = ROLE_PERMISSIONS,
): RoleAccess {
  if (override === null || override === undefined) return base;

  if (typeof override !== "object" || Array.isArray(override)) {
    console.warn(
      "wards.settings.role_access is not an object of per-role deltas; falling back to the code defaults",
    );
    return base;
  }

  const deltas = new Map<Role, ParsedDelta>();

  for (const [role, value] of Object.entries(override as Record<string, unknown>)) {
    if (!KNOWN_ROLES.has(role)) {
      console.warn(
        `wards.settings.role_access names an unknown role "${role}"; ignoring it`,
      );
      continue;
    }

    // A ward must not be able to disable the app-wide administrator who is there to help it.
    // Skipped WHOLE rather than filtered permission by permission: super_admin holds everything,
    // so a partial lock would leave a ward able to strip it down to nothing.
    if (LOCKED_ROLES.has(role)) {
      console.warn(
        `wards.settings.role_access tries to change the non-overridable role "${role}"; ` +
          "keeping the code defaults for it",
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

  const merged: RoleAccess = { ...base };
  for (const [role, delta] of deltas) {
    merged[role] = applyDelta(role, delta, base);
  }

  return merged;
}

// Throws rather than falling back on a read failure. An override can widen access as well as
// narrow it, so substituting the code defaults can be wrong in EITHER direction — silently
// restoring a permission the ward removed, or silently withholding one it granted. Neither is
// safe to guess at, so a failed read is an error rather than a default.
// `orgType` IS REQUIRED AND HAS NO DEFAULT, on purpose. This is ITER-005's lesson applied a
// second time: `can()`'s third parameter used to default, so 25 of 62 checks silently ignored the
// ward's configuration and nothing failed. A default here would do the same thing one level up —
// a route that forgot to pass the organization would resolve a Sunday School president against
// the organization-independent defaults and hand them youth management nobody granted.
//
// Pass `user.orgType`. It comes from session_context() in the same round trip as the role and the
// ward (migration 072), so it cannot disagree with what RLS resolved.
export async function resolveRoleAccess(
  supabase: SupabaseClient<Database>,
  wardId: string,
  orgType: OrganizationType | null,
): Promise<RoleAccess> {
  const base = basePermissionsFor(orgType);

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
    return base;
  }

  return mergeRoleAccess((settings as Record<string, unknown>).role_access, base);
}
