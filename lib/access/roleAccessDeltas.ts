import type { KnownPermission } from "@/lib/auth/permissions";
import type { Role } from "@/types/domain";

// EDITING ONE WARD'S `role_access` OBJECT. Pure, synchronous, and database-free — which is what
// lets tests/lib/appWideGrant.test.ts prove the dangerous part of this phase without a network
// round trip.
//
// ---------------------------------------------------------------------------
// A DELTA, NEVER A REPLACEMENT LIST (ITER-005)
// ---------------------------------------------------------------------------
// `wards.settings.role_access` stores what a ward CHANGED, not the list it wants:
// `{ "org_president": { "add": [...], "remove": [...] } }`. `mergeRoleAccess()` resolves those
// against whatever the code currently grants, so a permission added in a later phase reaches a
// ward that already has an override. Under replace-semantics it never would, and nothing would
// surface the drift.
//
// From P2 it resolves against the ORGANIZATION-SPECIALIZED defaults, which changes nothing here:
// a delta names a permission, and which defaults it lands on is resolveRoleAccess()'s business.
//
// ---------------------------------------------------------------------------
// EVERY FUNCTION HERE MERGES. NONE OF THEM REPLACES.
// ---------------------------------------------------------------------------
// `wards.settings` also holds `timezone`, `cross_org_visibility`, `default_speaking_slots` and
// `home_venues`. A wholesale write would silently delete every one of them, and inside
// `role_access` it would delete every OTHER role's override — which, on the app-wide fan-out in
// lib/access/appWideGrant.ts, would mean flipping one default quietly wiping every ward's
// permission configuration in the app. That is the worst thing in this phase and it is exactly
// what writeCrossOrgVisibility()'s header warns about for this same column.

export type RoleAccessDeltaShape = {
  add?: string[];
  remove?: string[];
};

// A settings object read straight from the database — unknown shape, because a ward configured by
// hand may hold anything at all.
export type WardSettings = Record<string, unknown>;

const ROLE_ACCESS_KEY = "role_access";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Reads the existing delta for one role, discarding anything malformed. It does NOT warn — that
// is `mergeRoleAccess`'s job at resolution time, and warning again here would produce two log
// lines per malformed row for one problem. What matters here is that a malformed delta is not
// propagated into the object being written.
function readDelta(settings: WardSettings, role: Role): RoleAccessDeltaShape {
  const roleAccess = settings[ROLE_ACCESS_KEY];
  if (!isPlainObject(roleAccess)) return {};

  const delta = roleAccess[role];
  if (!isPlainObject(delta)) return {};

  const add = Array.isArray(delta.add)
    ? delta.add.filter((entry): entry is string => typeof entry === "string")
    : [];
  const remove = Array.isArray(delta.remove)
    ? delta.remove.filter((entry): entry is string => typeof entry === "string")
    : [];

  return { add, remove };
}

// Rebuilds the settings object with one role's delta replaced, leaving every sibling key and
// every other role untouched. This is the ONLY place that writes the `role_access` key, so the
// merge discipline lives in one function rather than in each caller.
//
// An EMPTY delta removes the role's entry entirely rather than storing `{}`. That is what makes
// the operations below genuinely reversible: "turn this back to the default" must leave the
// object as though nothing had ever been written, or a ward would accumulate empty overrides
// that read as configuration somebody chose.
function writeDelta(
  settings: WardSettings,
  role: Role,
  delta: RoleAccessDeltaShape,
): WardSettings {
  const existingRoleAccess = isPlainObject(settings[ROLE_ACCESS_KEY])
    ? { ...(settings[ROLE_ACCESS_KEY] as Record<string, unknown>) }
    : {};

  const add = delta.add ?? [];
  const remove = delta.remove ?? [];

  if (add.length === 0 && remove.length === 0) {
    delete existingRoleAccess[role];
  } else {
    existingRoleAccess[role] = {
      ...(add.length > 0 ? { add } : {}),
      ...(remove.length > 0 ? { remove } : {}),
    };
  }

  const next: WardSettings = { ...settings };

  // And if no role has an override left, the key goes too — same reasoning one level up.
  if (Object.keys(existingRoleAccess).length === 0) {
    delete next[ROLE_ACCESS_KEY];
  } else {
    next[ROLE_ACCESS_KEY] = existingRoleAccess;
  }

  return next;
}

// GRANT — an approved request. The permission joins `add` and leaves `remove`.
//
// Leaving `remove` is not housekeeping, it is the correctness point: a permission named in BOTH
// lists ends up GRANTED, because `applyDelta` subtracts `remove` and then adds `add`. That order
// is arbitrary but deterministic and written down, and this function relies on it rather than
// restating it — so a ward that had explicitly turned something off and has now been granted it
// ends up with it on.
export function grantPermission(
  settings: WardSettings,
  role: Role,
  permission: KnownPermission,
): WardSettings {
  const delta = readDelta(settings, role);
  const add = delta.add ?? [];
  const remove = (delta.remove ?? []).filter((entry) => entry !== permission);

  // IDEMPOTENT. Granting twice is the same object as granting once, which is what makes the
  // fan-out re-runnable after a partial failure.
  const nextAdd = add.includes(permission) ? add : [...add, permission];

  return writeDelta(settings, role, { add: nextAdd, remove });
}

// WITHHOLD — the app-wide fan-out's per-ward off-override, and a ward narrowing a default for
// itself. The permission joins `remove` and leaves `add`, for the mirror of the reason above.
export function withholdPermission(
  settings: WardSettings,
  role: Role,
  permission: KnownPermission,
): WardSettings {
  const delta = readDelta(settings, role);
  const remove = delta.remove ?? [];
  const add = (delta.add ?? []).filter((entry) => entry !== permission);

  const nextRemove = remove.includes(permission) ? remove : [...remove, permission];

  return writeDelta(settings, role, { add, remove: nextRemove });
}

// BACK TO THE DEFAULT — the one-tap "turn it on for my ward" that deletes this ward's
// off-override, and the way a ward undoes its own narrowing.
//
// It removes the permission from BOTH lists. A ward that has been granted something app-wide,
// had the off-override written, and then turns it on should end up with no override at all
// rather than with an `add` that happens to cancel a `remove` — the stored shape is what a later
// admin screen renders, and "nothing configured" and "two entries that cancel out" look very
// different to a person reading it.
export function clearPermissionOverride(
  settings: WardSettings,
  role: Role,
  permission: KnownPermission,
): WardSettings {
  const delta = readDelta(settings, role);

  return writeDelta(settings, role, {
    add: (delta.add ?? []).filter((entry) => entry !== permission),
    remove: (delta.remove ?? []).filter((entry) => entry !== permission),
  });
}

// Whether a ward currently withholds a permission — what the "turn on for my ward" control reads
// to know whether it has anything to do.
export function withholdsPermission(
  settings: WardSettings,
  role: Role,
  permission: KnownPermission,
): boolean {
  return (readDelta(settings, role).remove ?? []).includes(permission);
}
