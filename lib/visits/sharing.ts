import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidInputError } from "@/lib/auth/errors";
import type { Database } from "@/types/database";
import type { VisitSharingGrant } from "@/types/domain";

// WHICH ORGANIZATION MAY READ WHICH ORGANIZATION'S VISITS (ITER-055, migration 099).
//
// The bishopric decides, organization by organization. A grant `owner → viewer` lets the viewer's
// leaders READ the owner's visit logs, goals, cadences, stewardship, appointments and participants.
// It never lets them write one, and never reaches a private note.
//
// THE RULE IS ENFORCED IN SQL. `visit_org_visible_to_caller()` is what the six SELECT policies ask;
// this file only reads and writes the grants. Nothing above it should branch on a grant to decide
// what a caller may read — the query already returns the right rows (CLAUDE.md rule 2).
//
// THE BISHOPRIC'S VISITS ARE STORED WITH `org_id = null` (P1, revised). A grant for them is stored
// against the ward's `bishopric`-typed organization, which is what the SQL function looks up.
//
// `visit_org_sharing` HAS NO WRITE POLICY. writeVisitSharing() runs on the service role behind
// PUT /api/visit-sharing, whose check (visits.manage_sharing AND a bishopric calling) is the write
// boundary. It is the only writer.

type Client = SupabaseClient<Database>;

export async function readVisitSharing(wardId: string, client: Client): Promise<VisitSharingGrant[]> {
  const { data, error } = await client
    .from("visit_org_sharing")
    .select("owner_org_id, viewer_org_id")
    .eq("ward_id", wardId)
    .order("created_at");

  if (error) {
    console.error("Could not read the ward's visit sharing", { wardId, error: error.message });
    throw new Error(`Could not read who can see each organization's visits: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    ownerOrgId: row.owner_org_id,
    viewerOrgId: row.viewer_org_id,
  }));
}

export function orgIdsSharedWith(
  grants: readonly VisitSharingGrant[],
  viewerOrgId: string | null,
): string[] {
  if (viewerOrgId === null) return [];
  return grants.filter((grant) => grant.viewerOrgId === viewerOrgId).map((grant) => grant.ownerOrgId);
}

function grantKey(grant: VisitSharingGrant): string {
  return `${grant.ownerOrgId}→${grant.viewerOrgId}`;
}

export function diffVisitSharing(
  current: readonly VisitSharingGrant[],
  next: readonly VisitSharingGrant[],
): { added: VisitSharingGrant[]; removed: VisitSharingGrant[] } {
  const currentKeys = new Set(current.map(grantKey));
  const nextByKey = new Map(next.map((grant) => [grantKey(grant), grant]));

  return {
    added: [...nextByKey.values()].filter((grant) => !currentKeys.has(grantKey(grant))),
    removed: current.filter((grant) => !nextByKey.has(grantKey(grant))),
  };
}

type SharingOrganization = { id: string; type: string };

// Pure, so the refusals are testable without a database. A viewer that is the Bishopric is refused
// rather than stored: the bishopric already reads every organization's visits, so the grant would
// promise something it cannot change.
export function checkVisitSharingGrants(
  grants: readonly VisitSharingGrant[],
  organizations: readonly SharingOrganization[],
): void {
  const byId = new Map(organizations.map((organization) => [organization.id, organization]));

  for (const grant of grants) {
    const owner = byId.get(grant.ownerOrgId);
    const viewer = byId.get(grant.viewerOrgId);

    if (owner === undefined || viewer === undefined) {
      throw new InvalidInputError(
        "One of those organizations is not in this ward any more. Reload the page and try again.",
      );
    }
    if (viewer.type === "bishopric") {
      throw new InvalidInputError(
        "The bishopric already sees every organization's visits, so there is nothing to share with it.",
      );
    }
  }
}

export type VisitSharingWriteResult = {
  added: VisitSharingGrant[];
  removed: VisitSharingGrant[];
  grantCount: number;
};

export async function writeVisitSharing(
  params: { wardId: string; grants: readonly VisitSharingGrant[]; actorUserId: string },
  service: Client,
): Promise<VisitSharingWriteResult> {
  const { wardId, grants, actorUserId } = params;

  const { data: organizations, error: organizationsError } = await service
    .from("organizations")
    .select("id, type")
    .eq("ward_id", wardId)
    .eq("is_active", true);

  if (organizationsError) {
    throw new Error(`Could not read the ward's organizations: ${organizationsError.message}`);
  }

  checkVisitSharingGrants(grants, organizations ?? []);

  const current = await readVisitSharing(wardId, service);
  const { added, removed } = diffVisitSharing(current, grants);

  for (const grant of removed) {
    const { error } = await service
      .from("visit_org_sharing")
      .delete()
      .eq("ward_id", wardId)
      .eq("owner_org_id", grant.ownerOrgId)
      .eq("viewer_org_id", grant.viewerOrgId);

    if (error) {
      throw new Error(`Could not stop sharing those visits: ${error.message}`);
    }
  }

  if (added.length > 0) {
    const { error } = await service.from("visit_org_sharing").insert(
      added.map((grant) => ({
        ward_id: wardId,
        owner_org_id: grant.ownerOrgId,
        viewer_org_id: grant.viewerOrgId,
        created_by: actorUserId,
      })),
    );

    if (error) {
      throw new Error(`Could not share those visits: ${error.message}`);
    }
  }

  return { added, removed, grantCount: current.length - removed.length + added.length };
}

// The sentence the return-and-report feed shows, so "why can I see the Relief Society's visits?"
// is answered on the page rather than by asking a counselor. Pure, for the same reason.
export function describeVisitSharingForReader(
  isBishopric: boolean,
  sharedOrganizationNames: readonly string[],
): string {
  if (isBishopric) {
    return "The bishopric sees every organization's visits. Private notes are never shown.";
  }
  if (sharedOrganizationNames.length === 0) {
    return "You see your own organization's visits. The bishopric decides whether any other organization's are shared with yours.";
  }
  const names = [...sharedOrganizationNames].sort((first, second) => first.localeCompare(second));
  const listed =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `You see your own organization's visits, and the visits of the ${listed}, which the bishopric has shared with yours.`;
}
