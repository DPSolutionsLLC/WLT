import type { SupabaseClient } from "@supabase/supabase-js";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export { defaultOrganizationFilter } from "@/lib/roster/organizationScope";

// Organization membership — which members belong to which organization. Distinct from
// users.org_id, which says which organization a LEADER serves in; this table says who the
// organization is responsible for.
//
// roster.manage in the route is the effective write boundary for everything here. The
// ward-scoped policy loop in migration 019 lets any authenticated member of the ward insert
// into member_organizations (plans/roster-a-data-and-pages.md Decision 3), so RLS stops a
// cross-WARD write and nothing else. Never call these functions from a route that has not
// already called assertCan(user, "roster.manage").

export type MemberOrganization = {
  organizationId: string;
  organizationName: string;
};

// The union shape copies updateWardUser in lib/auth/adminUsers.ts rather than the bare object
// roster-b sketched. A cross-ward organization id has to come back as a sentence a user can act
// on, and the composite foreign key's own complaint is not one (plans/retros/auth-b-invites-admin.md).
export type SetMemberOrganizationsResult =
  | { ok: true; added: string[]; removed: string[] }
  | { ok: false; message: string };

export type BulkAssignResult =
  | { ok: true; assigned: number; alreadyMember: number }
  | { ok: false; message: string };

export const BULK_ASSIGN_LIMIT = 500;

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

async function readOrganizationIdsForMember(
  supabase: SupabaseClient<Database>,
  wardId: string,
  memberId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("member_organizations")
    .select("org_id")
    .eq("ward_id", wardId)
    .eq("member_id", memberId);

  if (error) {
    console.error(
      `Could not read a member's organizations — ${error.message}`,
      { wardId, memberId },
    );
    throw new Error(`Could not read that member's organizations: ${error.message}`);
  }

  return (data ?? []).map((row) => row.org_id);
}

// Returns the ids that exist in this ward, so a caller can tell "all present" from "one of these
// is not ours" without a second round trip per id.
async function readKnownMemberIds(
  supabase: SupabaseClient<Database>,
  wardId: string,
  memberIds: readonly string[],
): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from("members")
    .select("id")
    .eq("ward_id", wardId)
    .in("id", memberIds);

  if (error) {
    console.error(`Could not verify member ids — ${error.message}`, { wardId });
    throw new Error(`Could not verify those members: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => row.id));
}

export async function listMemberOrganizations(
  wardId: string,
  memberId: string,
  client?: SupabaseClient<Database>,
): Promise<MemberOrganization[]> {
  const supabase = await resolveClient(client);

  const organizationIds = await readOrganizationIdsForMember(supabase, wardId, memberId);
  if (organizationIds.length === 0) return [];

  // Names come from the ward's organization list rather than a PostgREST embed, for the reason
  // listWardUsers gives: the foreign key is composite ((org_id, ward_id) → organizations
  // (id, ward_id)) and an embed across it is more fragile than a second small read.
  const organizations = await listWardOrganizations(wardId, supabase);
  const namesById = new Map(
    organizations.map((organization) => [organization.id, organization.name]),
  );

  return organizationIds
    .filter((organizationId) => namesById.has(organizationId))
    .map((organizationId) => ({
      organizationId,
      organizationName: namesById.get(organizationId)!,
    }))
    .sort((left, right) => left.organizationName.localeCompare(right.organizationName));
}

export async function listOrganizationMemberIds(
  wardId: string,
  organizationId: string,
  client?: SupabaseClient<Database>,
): Promise<string[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("member_organizations")
    .select("member_id")
    .eq("ward_id", wardId)
    .eq("org_id", organizationId);

  if (error) {
    console.error(
      `Could not read an organization's members — ${error.message}`,
      { wardId, organizationId },
    );
    throw new Error(`Could not read the organization's members: ${error.message}`);
  }

  return (data ?? []).map((row) => row.member_id);
}

// Replaces the whole set: reads what is there, deletes what left, inserts what arrived. The
// returned lists are what ACTUALLY changed, not what was submitted, so the audit row records the
// difference rather than the request.
export async function setMemberOrganizations(
  wardId: string,
  memberId: string,
  organizationIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<SetMemberOrganizationsResult> {
  const supabase = await resolveClient(client);

  const requested = [...new Set(organizationIds)];

  // Validated before any write, not after a foreign-key violation. The composite key would
  // reject a cross-ward organization anyway, but "insert or update on table
  // member_organizations violates foreign key constraint" is not a message anyone can act on.
  if (requested.length > 0) {
    const organizations = await listWardOrganizations(wardId, supabase);
    const wardOrganizationIds = new Set(
      organizations.map((organization) => organization.id),
    );

    if (requested.some((organizationId) => !wardOrganizationIds.has(organizationId))) {
      return { ok: false, message: "That organization is not in your ward." };
    }
  }

  const known = await readKnownMemberIds(supabase, wardId, [memberId]);
  if (!known.has(memberId)) {
    return { ok: false, message: "That member is not in your ward." };
  }

  const current = await readOrganizationIdsForMember(supabase, wardId, memberId);
  const currentSet = new Set(current);

  const added = requested.filter((organizationId) => !currentSet.has(organizationId));
  const removed = current.filter(
    (organizationId) => !requested.includes(organizationId),
  );

  if (removed.length > 0) {
    const { error } = await supabase
      .from("member_organizations")
      .delete()
      .eq("ward_id", wardId)
      .eq("member_id", memberId)
      .in("org_id", removed);

    if (error) {
      console.error(
        `Could not remove a member from organizations — ${error.message}`,
        { wardId, memberId },
      );
      throw new Error(`Could not update that member's organizations: ${error.message}`);
    }
  }

  if (added.length > 0) {
    const { error } = await supabase.from("member_organizations").insert(
      added.map((organizationId) => ({
        ward_id: wardId,
        member_id: memberId,
        org_id: organizationId,
      })),
    );

    if (error) {
      console.error(
        `Could not add a member to organizations — ${error.message}`,
        { wardId, memberId },
      );
      throw new Error(`Could not update that member's organizations: ${error.message}`);
    }
  }

  return { ok: true, added, removed };
}

// `assigned` is counted from the rows the database RETURNED, never from memberIds.length. An
// insert refused by policy comes back as success with zero rows
// (plans/retros/foundation-c-services.md), so counting the request would report a bulk assign
// that never happened.
export async function bulkAssignToOrganization(
  wardId: string,
  memberIds: readonly string[],
  organizationId: string,
  client?: SupabaseClient<Database>,
): Promise<BulkAssignResult> {
  const supabase = await resolveClient(client);

  const requested = [...new Set(memberIds)];

  if (requested.length === 0) {
    return { ok: false, message: "Select at least one member." };
  }

  if (requested.length > BULK_ASSIGN_LIMIT) {
    return {
      ok: false,
      message: `Select ${BULK_ASSIGN_LIMIT} members or fewer. Use the roster import for anything larger.`,
    };
  }

  const organizations = await listWardOrganizations(wardId, supabase);
  if (!organizations.some((organization) => organization.id === organizationId)) {
    return { ok: false, message: "That organization is not in your ward." };
  }

  // One unknown member id would fail the whole batch on the composite foreign key, and the
  // error would name a constraint rather than the problem. Checked up front instead.
  const known = await readKnownMemberIds(supabase, wardId, requested);
  if (known.size !== requested.length) {
    return {
      ok: false,
      message: "Some of those members are not in your ward. Reload the roster and try again.",
    };
  }

  // ignoreDuplicates turns the unique (member_id, org_id) constraint from migration 003 into
  // idempotence: re-running the same assign is a no-op that reports 0 assigned, not an error.
  const { data, error } = await supabase
    .from("member_organizations")
    .upsert(
      requested.map((memberId) => ({
        ward_id: wardId,
        member_id: memberId,
        org_id: organizationId,
      })),
      { onConflict: "member_id,org_id", ignoreDuplicates: true },
    )
    .select("member_id");

  if (error) {
    console.error(`Could not bulk assign members — ${error.message}`, {
      wardId,
      organizationId,
    });
    throw new Error(`Could not assign those members: ${error.message}`);
  }

  const assigned = (data ?? []).length;

  return { ok: true, assigned, alreadyMember: requested.length - assigned };
}
