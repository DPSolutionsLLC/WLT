import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { UpdateUserInput } from "@/lib/validation/adminUser";
import type { Database } from "@/types/database";
import {
  ORGANIZATION_TYPES,
  ROLES,
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

function toCounselorPosition(value: number | null): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

// A role the TypeScript union does not know means the CHECK constraint in migration 002 and
// ROLES in types/domain.ts have drifted — the same reasoning as lib/auth/session.ts.
function toRole(value: string): Role {
  if (!(ROLES as readonly string[]).includes(value)) {
    throw new Error(
      `users.role holds "${value}", which is not a known role. The CHECK constraint in ` +
        "migration 002 and ROLES in types/domain.ts have drifted.",
    );
  }
  return value as Role;
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

// Reads through the CALLER's session client, not the service client: the ward-scoped SELECT
// policy from migration 020 already scopes this correctly, and going through RLS is the point
// (CLAUDE.md rule 2).
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
    .from("users")
    .select(
      "id, first_name, last_name, email, username, role, org_id, counselor_position, is_active, created_at",
    )
    .eq("ward_id", wardId)
    .order("last_name", { nullsFirst: false })
    .order("first_name", { nullsFirst: false });

  if (error) {
    console.error("Could not read the ward's users", { wardId, error: error.message });
    throw new Error(`Could not read the ward's users: ${error.message}`);
  }

  const organizations = await listWardOrganizations(wardId, supabase);
  const organizationNames = new Map(
    organizations.map((organization) => [organization.id, organization.name]),
  );

  return (data ?? []).map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    username: row.username,
    role: toRole(row.role),
    orgId: row.org_id,
    organizationName: row.org_id ? (organizationNames.get(row.org_id) ?? null) : null,
    counselorPosition: toCounselorPosition(row.counselor_position),
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
}

export async function countActiveBishops(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { count, error } = await supabase
    .from("users")
    .select("id", { head: true, count: "exact" })
    .eq("ward_id", wardId)
    .eq("role", "bishop")
    .eq("is_active", true);

  if (error) {
    console.error("Could not count the ward's active bishops", {
      wardId,
      error: error.message,
    });
    throw new Error(`Could not count the ward's active bishops: ${error.message}`);
  }

  return count ?? 0;
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

  const changeSummaries = summariseChanges(before, changes, organizationNames);
  if (changeSummaries.length === 0) {
    return { ok: false, message: "Nothing changed." };
  }

  // `users` has no UPDATE policy for other people's rows — only users_update_self (migration
  // 019) — so this write MUST use the service-role client. That makes assertCan() in the route
  // the effective boundary here rather than RLS. It is the one place in this plan where that is
  // true, and it is why the permission check in the route cannot be skipped.
  const service = createServiceSupabaseClient();

  const { data, error } = await service
    .from("users")
    .update({
      ...(changes.role !== undefined ? { role: changes.role } : {}),
      ...(changes.orgId !== undefined ? { org_id: changes.orgId } : {}),
      ...(changes.counselorPosition !== undefined
        ? { counselor_position: changes.counselorPosition }
        : {}),
      ...(changes.isActive !== undefined ? { is_active: changes.isActive } : {}),
    })
    .eq("id", targetUserId)
    .eq("ward_id", wardId)
    .select(
      "id, first_name, last_name, email, username, role, org_id, counselor_position, is_active, created_at",
    )
    .maybeSingle();

  if (error) {
    console.error("Could not update a ward user", {
      wardId,
      targetUserId,
      error: error.message,
    });
    throw new Error(`Could not update the account: ${error.message}`);
  }

  if (!data) {
    return { ok: false, message: "That account is not in your ward." };
  }

  return {
    ok: true,
    user: {
      id: data.id,
      firstName: data.first_name,
      lastName: data.last_name,
      email: data.email,
      username: data.username,
      role: toRole(data.role),
      orgId: data.org_id,
      organizationName: data.org_id
        ? (organizationNames.get(data.org_id) ?? null)
        : null,
      counselorPosition: toCounselorPosition(data.counselor_position),
      isActive: data.is_active,
      createdAt: data.created_at,
    },
    changeSummaries,
  };
}
