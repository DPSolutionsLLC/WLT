import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedJoinLink } from "@/lib/zoom/joinLinkPaste";
import type { Database } from "@/types/database";

// THE ZOOM JOIN-LINK POOL (ITER-053, migration 095).
//
// Reads go through the CALLER's client, where RLS decides who sees the pool at all. Writes go
// through the service role, behind canManageInvitees() in the route — neither table has a write
// policy. Nothing in this file ever selects `join_url`: `authenticated` has no SELECT on that
// column, so `select("*")` through a user's client is a permission error, not a convenience.

type Client = SupabaseClient<Database>;

export const LOW_POOL_THRESHOLD = 5;

export type PoolTone = "ok" | "low" | "empty";

export type PoolLevel = { tone: PoolTone; sentence: string | null };

export type PoolLink = {
  id: string;
  placeholderName: string;
  placeholderEmail: string;
  createdAt: string;
  // Null while the link is free.
  heldBy: { inviteeId: string; displayName: string } | null;
};

export type PoolSummary = {
  links: PoolLink[];
  freeCount: number;
  givenCount: number;
};

// Computed on read, never stored or notified (P1).
export function describePoolLevel(freeCount: number): PoolLevel {
  if (freeCount <= 0) {
    return { tone: "empty", sentence: "No Zoom links are left. Paste more on the Link pool tab." };
  }
  if (freeCount <= LOW_POOL_THRESHOLD) {
    return {
      tone: "low",
      sentence:
        freeCount === 1 ? "Only 1 Zoom link is left." : `Only ${freeCount} Zoom links are left.`,
    };
  }
  return { tone: "ok", sentence: null };
}

const POOL_COLUMNS =
  "id, placeholder_name, placeholder_email, created_at, " +
  "zoom_invitees!zoom_invitees_join_link_id_ward_id_fkey (id, display_name)";

type PoolRow = {
  id: string;
  placeholder_name: string;
  placeholder_email: string;
  created_at: string;
  zoom_invitees: { id: string; display_name: string }[] | { id: string; display_name: string } | null;
};

function holderOf(row: PoolRow): PoolLink["heldBy"] {
  const embedded = Array.isArray(row.zoom_invitees) ? row.zoom_invitees[0] : row.zoom_invitees;
  return embedded ? { inviteeId: embedded.id, displayName: embedded.display_name } : null;
}

export function summarizePool(links: PoolLink[]): PoolSummary {
  const freeCount = links.filter((link) => link.heldBy === null).length;
  return { links, freeCount, givenCount: links.length - freeCount };
}

export async function listPool(supabase: Client): Promise<PoolSummary> {
  const { data, error } = await supabase
    .from("zoom_join_links")
    .select(POOL_COLUMNS)
    .order("created_at", { ascending: true })
    .order("placeholder_name", { ascending: true })
    .returns<PoolRow[]>();

  if (error) {
    console.error(`Could not read the Zoom link pool — ${error.message}`);
    throw new Error(`Could not read the Zoom link pool: ${error.message}`);
  }

  return summarizePool(
    (data ?? []).map((row) => ({
      id: row.id,
      placeholderName: row.placeholder_name,
      placeholderEmail: row.placeholder_email,
      createdAt: row.created_at,
      heldBy: holderOf(row),
    })),
  );
}

// The free count after a hand-out, through the service role (the route already holds the gate).
export async function countFreeLinks(wardId: string, service: Client): Promise<number> {
  const [links, given] = await Promise.all([
    service.from("zoom_join_links").select("id", { count: "exact", head: true }).eq("ward_id", wardId),
    service
      .from("zoom_invitees")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .not("join_link_id", "is", null),
  ]);

  const failure = links.error ?? given.error;
  if (failure) {
    console.error(`Could not count the free Zoom links — ${failure.message}`, { wardId });
    throw new Error(`Could not count the free Zoom links: ${failure.message}`);
  }

  return Math.max(0, (links.count ?? 0) - (given.count ?? 0));
}

export type AddJoinLinksResult = {
  addedIds: string[];
  // Line numbers of links whose URL or email the ward's pool already holds.
  alreadyInPool: number[];
};

const UNIQUE_VIOLATION = "23505";

// Row by row, because a paste is tens of lines and a 23505 on one must not lose the rest: that
// code means the link (or its placeholder email) is already in the pool, which is reported, not
// thrown. Any other error is thrown.
export async function addJoinLinks(
  params: { wardId: string; actorUserId: string; links: ParsedJoinLink[] },
  service: Client,
): Promise<AddJoinLinksResult> {
  const { wardId, actorUserId, links } = params;
  const addedIds: string[] = [];
  const alreadyInPool: number[] = [];

  for (const link of links) {
    const { data, error } = await service
      .from("zoom_join_links")
      .insert({
        ward_id: wardId,
        placeholder_name: link.placeholderName,
        placeholder_email: link.placeholderEmail,
        join_url: link.joinUrl,
        created_by: actorUserId,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        alreadyInPool.push(link.lineNumber);
        continue;
      }
      console.error(`Could not add a Zoom link to the pool — ${error.message}`, {
        wardId,
        lineNumber: link.lineNumber,
      });
      throw new Error(`Could not add the link on line ${link.lineNumber}: ${error.message}`);
    }

    addedIds.push(data.id);
  }

  return { addedIds, alreadyInPool };
}

// False when the link has been given to someone (or is not in this ward): the route's 409.
export async function removeJoinLink(
  params: { wardId: string; linkId: string },
  service: Client,
): Promise<boolean> {
  const { data, error } = await service.rpc("remove_unassigned_zoom_link", {
    p_ward_id: params.wardId,
    p_link_id: params.linkId,
  });

  if (error) {
    console.error(`Could not remove a Zoom link — ${error.message}`, params);
    throw new Error(`Could not remove the Zoom link: ${error.message}`);
  }

  return data === true;
}

export async function countWaitingInvitees(wardId: string, service: Client): Promise<number> {
  const { count, error } = await service
    .from("zoom_invitees")
    .select("id", { count: "exact", head: true })
    .eq("ward_id", wardId)
    .is("join_link_id", null);

  if (error) {
    console.error(`Could not count who is waiting for a Zoom link — ${error.message}`, { wardId });
    throw new Error(`Could not count who is waiting for a Zoom link: ${error.message}`);
  }

  return count ?? 0;
}
