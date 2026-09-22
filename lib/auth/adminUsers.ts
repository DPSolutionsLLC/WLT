import type { SupabaseClient } from "@supabase/supabase-js";
import { toRole } from "@/lib/callings/queries";
import { updateCalling } from "@/lib/callings/writeCalling";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { listUnitAssignments } from "@/lib/units/queries";
import type { UpdateUserInput } from "@/lib/validation/adminUser";
import type { Database } from "@/types/database";
import {
  ORGANIZATION_TYPES,
  ROLE_LABELS,
  type OrganizationType,
  type Role,
} from "@/types/domain";

export type WardUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  username: string | null;
  role: Role;
  orgId: string | null;
  organizationName: string | null;
  counselorPosition: 1 | 2 | null;
  isActive: boolean;
  createdAt: string;
};

export type WardOrganization = {
  id: string;
  name: string;
  // The TYPE, not only the name, because the type is what carries meaning a screen can act on:
  // visits-c colours a report's organization chip from it (types/domain.ts §ORGANIZATION_TYPE_TONES)
  // so the Relief Society is the same hue everywhere, rather than taking whatever colour the set
  // on screen left free. A ward may rename an organization; it does not change its type.
  type: OrganizationType;
};

export type UpdateWardUserParams = {
  wardId: string;
  targetUserId: string;
  changes: UpdateUserInput;
};

export type UpdateWardUserResult =
  | { ok: true; user: WardUser; changeSummaries: string[] }
  | { ok: false; message: string };

export const LAST_BISHOP_MESSAGE =
  "This is the only active bishop. Assign another bishop before changing this account.";

export const LAST_SUPER_ADMIN_MESSAGE =
  "This is the only active super admin. Assign another before changing this account.";

function toCounselorPosition(value: number | null): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

// Takes a structural subset so both a SessionUser and a WardUser fit. SessionUser carries no
// email, which is why that field is optional here rather than required.
export function displayName(user: {
  firstName: string | null;
  lastName: string | null;
  username?: string | null;
  email?: string | null;
}): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.username || user.email || "this account";
}

function toOrganizationType(value: string): OrganizationType {
  if (!(ORGANIZATION_TYPES as readonly string[]).includes(value)) {
    throw new Error(
      `organizations.type holds "${value}", which is not a known value. The CHECK constraint ` +
        "and types/domain.ts have drifted.",
    );
  }
  return value as OrganizationType;
}

export async function listWardOrganizations(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<WardOrganization[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, type")
    .eq("ward_id", wardId)
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error("Could not read the ward's organizations", {
      wardId,
      error: error.message,
    });
    throw new Error(`Could not read the ward's organizations: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    // A value the CHECK constraint should have made impossible means it and types/domain.ts have
    // drifted — worth a crash rather than a silent cast, the same reading toEnum() takes in
    // lib/visits/queries.ts.
    type: toOrganizationType(row.type),
  }));
}

// THE WARD'S LIST IS THE WARD'S CALLINGS, NOT THE ACCOUNTS THAT LIVE HERE.
//
// This read `users` filtered by `ward_id`, which answers "whose ACCOUNT belongs to this ward".
// Under the calling model (migration 068) that is the wrong question, and getting it wrong is
// invisible: a Relief Society president whose account lives in ward A holds a real calling in
// ward B, and she would simply be MISSING from ward B's admin list — no error, no empty state, a
// list that looks complete with a leader absent from it.
//
// So the list is built from the ward's ACTIVE CALLINGS, with `users!inner` supplying the person.
// `role`, `org_id` and `counselor_position` come off the CALLING; `email`, `username`,
// `is_active` and `created_at` come off the ACCOUNT. Migration 070d is what makes the join
// readable — `users_ward_select` gained an arm admitting somebody who holds a calling in the ward
// being acted in, precisely so this query returns them.
//
// Reads through the CALLER's session client, not the service client: RLS already scopes both
// halves correctly, and going through it is the point (CLAUDE.md rule 2).
//
// The organization name is resolved with a second query rather than a PostgREST embed. The
// foreign key is composite ((org_id, ward_id) → organizations (id, ward_id)) and the page needs
// the organization list anyway for its selects, so one extra small read buys a simpler join.
export async function listWardUsers(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<WardUser[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("ward_role_assignments")
    .select(
      "user_id, role, org_id, counselor_position, users!user_id!inner(first_name, last_name, email, username, is_active, created_at)",
    )
    .eq("ward_id", wardId)
    .eq("is_active", true);

  if (error) {
    console.error("Could not read the ward's users", { wardId, error: error.message });
    throw new Error(`Could not read the ward's users: ${error.message}`);
  }

  const organizations = await listWardOrganizations(wardId, supabase);
  const organizationNames = new Map(
    organizations.map((organization) => [organization.id, organization.name]),
  );

  return (data ?? [])
    .map((row) => ({
      id: row.user_id,
      firstName: row.users.first_name,
      lastName: row.users.last_name,
      email: row.users.email,
      username: row.users.username,
      role: toRole(row.role),
      orgId: row.org_id,
      organizationName: row.org_id ? (organizationNames.get(row.org_id) ?? null) : null,
      counselorPosition: toCounselorPosition(row.counselor_position),
      isActive: row.users.is_active,
      createdAt: row.users.created_at,
    }))
    // Sorted here rather than in PostgREST: both name columns live on the embedded `users` row,
    // and PostgREST cannot order parent rows by an embedded column. `localeCompare` on `?? ""`
    // keeps a nameless account at the top rather than throwing, which is what `nullsFirst: false`
    // used to do at the other end — the change of position is cosmetic and affects only rows with
    // no surname at all.
    .sort(
      (left, right) =>
        (left.lastName ?? "").localeCompare(right.lastName ?? "") ||
        (left.firstName ?? "").localeCompare(right.firstName ?? ""),
    );
}

// COUNTS CALLINGS, NOT ACCOUNTS, and joins the account's own `is_active`.
//
// Both halves matter. A bishop whose account lives in another ward still holds the bishop calling
// HERE and must count, or the last-bishop guard fires on a ward that has one. And a calling stays
// active on a deactivated account by design (lib/callings/writeCalling.ts), so without the join a
// switched-off bishop would keep a ward from ever correcting itself.
export async function countActiveBishops(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { count, error } = await supabase
    .from("ward_role_assignments")
    .select("user_id, users!user_id!inner(is_active)", { head: true, count: "exact" })
    .eq("ward_id", wardId)
    .eq("role", "bishop")
    .eq("is_active", true)
    .eq("users.is_active", true);

  if (error) {
    console.error("Could not count the ward's active bishops", {
      wardId,
      error: error.message,
    });
    throw new Error(`Could not count the ward's active bishops: ${error.message}`);
  }

  return count ?? 0;
}

// COUNTS ACROSS THE WHOLE APP, WITH NO WARD FILTER — and that is the one thing this guard must
// not copy from countActiveBishops() above.
//
// `super_admin` is the only role in this schema that is not ward-scoped: the assignment lives in
// `unit_assignments`, which has no ward_id at all (migration 065b). Adding `.eq("ward_id", …)`
// would make the guard trivially bypassable — deactivate the last super admin from a ward they do
// not belong to and the count comes back zero.
//
// It reads through the SERVICE-ROLE client, deliberately. `unit_assignments_select` (065f) admits
// only your own rows unless you are a super admin yourself, so a bishopric member counting through
// their own client would always see zero and the guard would never fire. Whether the app-wide
// administrator may be removed is a fact about the APP, not about who is looking — the same
// uniform-evaluability argument migration 060b's `activity_profile_followup_count` makes.
export async function countActiveSuperAdmins(
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = client ?? createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("unit_assignments")
    // `users!user_id!inner`, NOT `users!inner` — `unit_assignments` has two foreign keys to `users`
    // (`user_id` and `created_by`), so the bare embed is ambiguous and PostgREST refuses it. Here it
    // THROWS rather than failing silent, so deactivating a super admin answered 500 and this guard
    // never ran. Found by walking scenario 067.
    .select("user_id, users!user_id!inner(is_active)")
    .eq("role", "super_admin")
    .eq("users.is_active", true);

  if (error) {
    console.error("Could not count the app's active super admins", { error: error.message });
    throw new Error(`Could not count the app's active super admins: ${error.message}`);
  }

  // Distinct PEOPLE, not rows. `unit_assignments_unique` carries `nulls not distinct`, so one
  // person cannot hold two super_admin rows today — but this guard must stay correct if that ever
  // widens, and counting rows would let one person's two assignments read as two administrators.
  return new Set((data ?? []).map((row) => row.user_id)).size;
}

function summariseChanges(
  before: WardUser,
  changes: UpdateUserInput,
  organizationNames: Map<string, string>,
): string[] {
  const summaries: string[] = [];

  if (changes.role !== undefined && changes.role !== before.role) {
    summaries.push(
      `role changed from ${ROLE_LABELS[before.role]} to ${ROLE_LABELS[changes.role]}`,
    );
  }

  if (changes.orgId !== undefined && (changes.orgId ?? null) !== before.orgId) {
    const nextName = changes.orgId
      ? (organizationNames.get(changes.orgId) ?? "another organization")
      : "none";
    summaries.push(
      `organization changed from ${before.organizationName ?? "none"} to ${nextName}`,
    );
  }

  if (
    changes.counselorPosition !== undefined &&
    (changes.counselorPosition ?? null) !== before.counselorPosition
  ) {
    summaries.push(
      `counselor position changed from ${before.counselorPosition ?? "none"} to ${
        changes.counselorPosition ?? "none"
      }`,
    );
  }

  if (changes.isActive !== undefined && changes.isActive !== before.isActive) {
    summaries.push(changes.isActive ? "account reactivated" : "account deactivated");
  }

  return summaries;
}

export async function updateWardUser(
  params: UpdateWardUserParams,
  client?: SupabaseClient<Database>,
): Promise<UpdateWardUserResult> {
  const { wardId, targetUserId, changes } = params;
  const readClient = client ?? (await createServerSupabaseClient());

  const existing = await listWardUsers(wardId, readClient);
  const before = existing.find((user) => user.id === targetUserId);

  // RLS would refuse a cross-ward write anyway, but an UPDATE denied by policy comes back as
  // success with zero rows (plans/retros/foundation-c-services.md). A clear message beats an
  // empty result the caller has to interpret.
  if (!before) {
    return { ok: false, message: "That account is not in your ward." };
  }

  const organizationNames = new Map(
    existing
      .filter((user) => user.orgId && user.organizationName)
      .map((user) => [user.orgId as string, user.organizationName as string]),
  );

  if (changes.orgId) {
    const organizations = await listWardOrganizations(wardId, readClient);
    const target = organizations.find((organization) => organization.id === changes.orgId);
    if (!target) {
      return { ok: false, message: "That organization is not in your ward." };
    }
    organizationNames.set(target.id, target.name);
  }

  // Last-bishop guard. The ward must never be able to lock itself out of its own admin surface.
  //
  // This is check-then-act: two simultaneous demotions could in principle both read a count of
  // 2 and both proceed. Accepted deliberately — the recovery is a one-row service-role fix, and
  // the alternative (a database constraint on the bishop count) would block every legitimate
  // bishopric transition, which happens far more often than this race.
  const losesBishop =
    before.role === "bishop" &&
    before.isActive &&
    (changes.isActive === false || (changes.role !== undefined && changes.role !== "bishop"));

  if (losesBishop && (await countActiveBishops(wardId, readClient)) <= 1) {
    return { ok: false, message: LAST_BISHOP_MESSAGE };
  }

  // Last-super-admin guard. THE APP must never be able to lock itself out of its own app-wide
  // administrator, which is a strictly larger version of what the bishop guard protects.
  //
  // Only DEACTIVATION can reach it from here: `super_admin` is not a value updateUserSchema will
  // accept (lib/validation/adminUser.ts), so `changes.role` can never move somebody OFF it
  // through this path, and the ASSIGNMENT itself lives in `unit_assignments` and is removed by
  // proto-d's own screen — which must call countActiveSuperAdmins() before deleting a row.
  //
  // Check-then-act, with the same trade-off accepted for the same reason as the bishop guard
  // above: the recovery is a one-row service-role fix, and a database constraint on the count
  // would block every legitimate transition.
  if (changes.isActive === false && before.isActive) {
    // Through the SERVICE-ROLE client for the same reason countActiveSuperAdmins() is:
    // `unit_assignments_select` admits only the caller's OWN rows, so a bishopric member reading
    // the target's assignments through their own client would always see none and the guard
    // would never fire.
    const assignments = await listUnitAssignments(targetUserId, createServiceSupabaseClient());
    const isSuperAdmin = assignments.some((assignment) => assignment.role === "super_admin");

    if (isSuperAdmin && (await countActiveSuperAdmins()) <= 1) {
      return { ok: false, message: LAST_SUPER_ADMIN_MESSAGE };
    }
  }

  const changeSummaries = summariseChanges(before, changes, organizationNames);
  if (changeSummaries.length === 0) {
    return { ok: false, message: "Nothing changed." };
  }

  // Neither `users` nor `ward_role_assignments` has an UPDATE policy for other people's rows —
  // only users_update_self (migration 019/066d), and migration 068c gives callings no write
  // policy at all — so both writes below MUST use the service-role client. That makes assertCan()
  // in the route the effective boundary here rather than RLS, and it is why the permission check
  // in the route can never be skipped.
  const service = createServiceSupabaseClient();

  // ---------------------------------------------------------------------------
  // TWO WRITES, BECAUSE THERE ARE TWO SUBJECTS
  // ---------------------------------------------------------------------------
  // `role`, `orgId` and `counselorPosition` are facts about the CALLING IN THIS WARD. `isActive`
  // is a fact about the ACCOUNT, which is app-wide: a person barred from the app is barred
  // everywhere, and there is deliberately no path here that writes it per ward.
  //
  // Deactivating an account does NOT release its callings, and must not start to — see the header
  // of lib/callings/writeCalling.ts for why reactivation cannot be got right if it does.

  const callingChanged =
    changes.role !== undefined ||
    changes.orgId !== undefined ||
    changes.counselorPosition !== undefined;

  if (callingChanged) {
    const updated = await updateCalling(
      {
        userId: targetUserId,
        wardId,
        changes: {
          ...(changes.role !== undefined ? { role: changes.role } : {}),
          ...(changes.orgId !== undefined ? { orgId: changes.orgId } : {}),
          ...(changes.counselorPosition !== undefined
            ? { counselorPosition: changes.counselorPosition }
            : {}),
        },
      },
      service,
    );

    // A zero-row UPDATE: they hold no active calling in this ward. `before` was read through the
    // caller's client a moment ago, so this is a race rather than a mistake — somebody released
    // them in between — and it gets the same sentence a missing row gets rather than a fault.
    if (!updated) {
      return { ok: false, message: "That account is not in your ward." };
    }
  }

  if (changes.isActive !== undefined) {
    // NOT scoped by `ward_id`, deliberately, where the old version was. Under the calling model
    // the target's `users.ward_id` may be another ward entirely, and a ward filter here would
    // make a cross-ward leader impossible to deactivate from the ward that called them. The
    // membership check is `before` above, which IS ward-scoped — by callings, which is the
    // question the admin list asks.
    const { error: accountError } = await service
      .from("users")
      .update({ is_active: changes.isActive })
      .eq("id", targetUserId);

    if (accountError) {
      console.error("Could not update a ward user's account", {
        wardId,
        targetUserId,
        error: accountError.message,
      });
      throw new Error(`Could not update the account: ${accountError.message}`);
    }
  }

  // Re-read rather than assembled from `before` plus `changes`. A 200 describing a state the
  // database is not in is the failure this catches, and it costs one query on an admin path.
  const after = (await listWardUsers(wardId, readClient)).find(
    (user) => user.id === targetUserId,
  );

  if (!after) {
    return { ok: false, message: "That account is not in your ward." };
  }

  return { ok: true, user: after, changeSummaries };
}
