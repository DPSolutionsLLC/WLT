import type { SupabaseClient } from "@supabase/supabase-js";
import { toRole } from "@/lib/callings/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { listUnitAssignments } from "@/lib/units/queries";
import type { UpdateUserInput } from "@/lib/validation/adminUser";
import type { Database } from "@/types/database";
import {
  CALLING_SOURCES,
  ORGANIZATION_TYPES,
  type CallingSource,
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
  // Where the calling came from (ITER-058): typed in by hand, applied from the ward list, or the
  // super admin's override. Admin → Users shows it beside the calling.
  callingSource: CallingSource;
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
  // Who made the change. An account cannot deactivate itself (ITER-058 cr2).
  actorUserId: string;
};

export type UpdateWardUserResult =
  | { ok: true; user: WardUser; changeSummaries: string[] }
  | { ok: false; message: string };

export const LAST_BISHOP_MESSAGE =
  "This is the only active bishop. Assign another bishop before changing this account.";

export const SELF_DEACTIVATE_MESSAGE =
  "You can't deactivate your own account. Ask another member of the bishopric.";

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

function toCallingSource(value: string): CallingSource {
  if (!(CALLING_SOURCES as readonly string[]).includes(value)) {
    throw new Error(
      `ward_role_assignments.source holds "${value}", which is not a known source. The CHECK ` +
        "constraint in migration 105 and CALLING_SOURCES in types/domain.ts have drifted.",
    );
  }
  return value as CallingSource;
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
      "user_id, role, org_id, counselor_position, source, users!user_id!inner(first_name, last_name, email, username, is_active, created_at)",
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
      callingSource: toCallingSource(row.source),
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

function summariseChanges(before: WardUser, changes: UpdateUserInput): string[] {
  if (changes.isActive === before.isActive) return [];
  return [changes.isActive ? "account reactivated" : "account deactivated"];
}

// ONLY THE ACCOUNT'S ACTIVE FLAG IS CHANGED HERE (ITER-058 cr2). A calling follows the ward list
// through the Calling review (lib/callings/applyCallingReview.ts), and the one hand edit left is
// the super admin's override (app/api/callings/override/route.ts). Both go through
// lib/callings/writeCalling.ts, which stays the only writer of a calling.
export async function updateWardUser(
  params: UpdateWardUserParams,
  client?: SupabaseClient<Database>,
): Promise<UpdateWardUserResult> {
  const { wardId, targetUserId, changes, actorUserId } = params;
  const readClient = client ?? (await createServerSupabaseClient());

  // Refused on the SERVER, not only by a disabled button: deactivating yourself is a lockout
  // nobody can undo from inside the account, and a hand-rolled PATCH reaches this line too.
  if (targetUserId === actorUserId && changes.isActive === false) {
    return { ok: false, message: SELF_DEACTIVATE_MESSAGE };
  }

  const existing = await listWardUsers(wardId, readClient);
  const before = existing.find((user) => user.id === targetUserId);

  // RLS would refuse a cross-ward write anyway, but an UPDATE denied by policy comes back as
  // success with zero rows (plans/retros/foundation-c-services.md). A clear message beats an
  // empty result the caller has to interpret.
  if (!before) {
    return { ok: false, message: "That account is not in your ward." };
  }

  // Last-bishop guard. The ward must never be able to lock itself out of its own admin surface.
  //
  // This is check-then-act: two simultaneous deactivations could in principle both read a count
  // of 2 and both proceed. Accepted deliberately — the recovery is a one-row service-role fix, and
  // the alternative (a database constraint on the bishop count) would block every legitimate
  // bishopric transition, which happens far more often than this race.
  const losesBishop = before.role === "bishop" && before.isActive && changes.isActive === false;

  if (losesBishop && (await countActiveBishops(wardId, readClient)) <= 1) {
    return { ok: false, message: LAST_BISHOP_MESSAGE };
  }

  // Last-super-admin guard. THE APP must never be able to lock itself out of its own app-wide
  // administrator, which is a strictly larger version of what the bishop guard protects. The
  // ASSIGNMENT itself lives in `unit_assignments` and is removed by proto-d's own screen, so only
  // deactivation can reach it from here.
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

  const changeSummaries = summariseChanges(before, changes);
  if (changeSummaries.length === 0) {
    return { ok: false, message: "Nothing changed." };
  }

  // `users` has no UPDATE policy for other people's rows (only users_update_self), so this write
  // MUST use the service-role client. That makes assertCan() in the route the effective boundary
  // here rather than RLS, and it is why the permission check in the route can never be skipped.
  //
  // NOT scoped by `ward_id`, deliberately. Under the calling model the target's `users.ward_id`
  // may be another ward entirely, and a ward filter here would make a cross-ward leader
  // impossible to deactivate from the ward that called them. The membership check is `before`
  // above, which IS ward-scoped — by callings, which is the question the admin list asks.
  //
  // Deactivating an account does NOT release its callings, and must not start to — see the header
  // of lib/callings/writeCalling.ts for why reactivation cannot be got right if it does.
  const { error: accountError } = await createServiceSupabaseClient()
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
