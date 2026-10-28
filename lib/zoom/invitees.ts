import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidInputError } from "@/lib/auth/errors";
import type { CreateInviteeInput, UpdateInviteeInput } from "@/lib/validation/zoom";
import type { Database } from "@/types/database";

// WHO HOLDS A ZOOM JOIN LINK, OR IS WAITING FOR ONE (ITER-053, migration 095).
//
// The list is read through the CALLER's client, where RLS admits the bishopric, the ward clerk and
// the executive secretary. Every write — and every read of a `join_url` — is the service role behind
// canManageInvitees() in the route, because neither table has a write policy and no signed-in
// client may select `join_url` at all. Every service-role call here filters `ward_id` (rule 1).
//
// `display_name` is a snapshot kept even when `member_id` is set, so a roster record that changes
// or is deleted never loses the person — and ITER-054's attendance attaches to this row.

type Client = SupabaseClient<Database>;

export type ZoomInvitee = {
  id: string;
  displayName: string;
  memberId: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  assignedByName: string | null;
  // Null while they are waiting for a link.
  placeholderName: string | null;
  linkGivenAt: string | null;
  createdAt: string;
  // Filled by ITER-054's attendance import; always null until then (plan P5).
  lastWatchedOn: string | null;
  sundaysWatched: number | null;
};

const INVITEE_COLUMNS =
  "id, display_name, member_id, phone, email, notes, link_given_at, created_at, " +
  "zoom_join_links!zoom_invitees_join_link_id_ward_id_fkey (placeholder_name), " +
  "assigner:users!zoom_invitees_assigned_by_fkey (first_name, last_name)";

type OneOrMany<T> = T | T[] | null;

type InviteeRow = {
  id: string;
  display_name: string;
  member_id: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  link_given_at: string | null;
  created_at: string;
  zoom_join_links: OneOrMany<{ placeholder_name: string }>;
  assigner: OneOrMany<{ first_name: string; last_name: string }>;
};

function first<T>(value: OneOrMany<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toInvitee(row: InviteeRow): ZoomInvitee {
  const link = first(row.zoom_join_links);
  const assigner = first(row.assigner);
  return {
    id: row.id,
    displayName: row.display_name,
    memberId: row.member_id,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    assignedByName: assigner ? `${assigner.first_name} ${assigner.last_name}`.trim() : null,
    placeholderName: link?.placeholder_name ?? null,
    linkGivenAt: row.link_given_at,
    createdAt: row.created_at,
    lastWatchedOn: null,
    sundaysWatched: null,
  };
}

// Waiting first (oldest first, so nobody waits longest unseen), then newest given first.
export function orderInvitees(invitees: readonly ZoomInvitee[]): ZoomInvitee[] {
  const waiting = invitees
    .filter((invitee) => invitee.linkGivenAt === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const given = invitees
    .filter((invitee) => invitee.linkGivenAt !== null)
    .sort((a, b) => (b.linkGivenAt ?? "").localeCompare(a.linkGivenAt ?? ""));
  return [...waiting, ...given];
}

export async function listInvitees(supabase: Client): Promise<ZoomInvitee[]> {
  const { data, error } = await supabase
    .from("zoom_invitees")
    .select(INVITEE_COLUMNS)
    .returns<InviteeRow[]>();

  if (error) {
    console.error(`Could not read the Zoom invitee list — ${error.message}`);
    throw new Error(`Could not read the Zoom invitee list: ${error.message}`);
  }

  return orderInvitees((data ?? []).map(toInvitee));
}

export async function readInvitee(
  params: { wardId: string; inviteeId: string },
  service: Client,
): Promise<ZoomInvitee | null> {
  const { data, error } = await service
    .from("zoom_invitees")
    .select(INVITEE_COLUMNS)
    .eq("ward_id", params.wardId)
    .eq("id", params.inviteeId)
    .returns<InviteeRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`Could not read a Zoom invitee — ${error.message}`, params);
    throw new Error(`Could not read the Zoom invitee: ${error.message}`);
  }

  return data ? toInvitee(data) : null;
}

// The invitee row was written but the link could not be given — they are saved as waiting. It
// carries the new row's id so the route can still audit the insert that did happen.
export class ZoomLinkAssignError extends Error {
  readonly inviteeId: string;

  constructor(displayName: string, inviteeId: string) {
    super(
      `${displayName} is saved, but a link could not be given just now. ` +
        "They're on the Invitees list as waiting — try Give a link there.",
    );
    this.name = "ZoomLinkAssignError";
    this.inviteeId = inviteeId;
  }
}

async function assignNextLink(
  params: { wardId: string; inviteeId: string },
  service: Client,
): Promise<{ joinLinkId: string | null; error: string | null }> {
  const { data, error } = await service.rpc("assign_next_zoom_link", {
    p_ward_id: params.wardId,
    p_invitee_id: params.inviteeId,
  });
  if (error) return { joinLinkId: null, error: error.message };
  return { joinLinkId: data ?? null, error: null };
}

export type CreateInviteeResult = {
  inviteeId: string;
  joinLinkId: string | null;
};

export async function createInvitee(
  params: { wardId: string; actorUserId: string; input: CreateInviteeInput },
  service: Client,
): Promise<CreateInviteeResult> {
  const { wardId, actorUserId, input } = params;

  const { data, error } = await service
    .from("zoom_invitees")
    .insert({
      ward_id: wardId,
      display_name: input.displayName,
      member_id: input.memberId,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      source: "visit",
      assigned_by: actorUserId,
    })
    .select("id")
    .single();

  if (error) {
    console.error(`Could not save a Zoom invitee — ${error.message}`, { wardId });
    throw new Error(`Could not save the person: ${error.message}`);
  }

  const assigned = await assignNextLink({ wardId, inviteeId: data.id }, service);
  if (assigned.error) {
    console.error(`Could not give a Zoom link — ${assigned.error}`, { wardId, inviteeId: data.id });
    throw new ZoomLinkAssignError(input.displayName, data.id);
  }

  return { inviteeId: data.id, joinLinkId: assigned.joinLinkId };
}

export type GiveLinkResult =
  | { status: "given"; joinLinkId: string }
  | { status: "already_has_link" }
  | { status: "pool_empty" }
  | { status: "not_found" };

export async function giveWaitingInviteeALink(
  params: { wardId: string; inviteeId: string },
  service: Client,
): Promise<GiveLinkResult> {
  const existing = await readInvitee(params, service);
  if (!existing) return { status: "not_found" };
  if (existing.linkGivenAt !== null) return { status: "already_has_link" };

  const assigned = await assignNextLink(params, service);
  if (assigned.error) {
    console.error(`Could not give a Zoom link — ${assigned.error}`, params);
    throw new Error(`Could not give the Zoom link: ${assigned.error}`);
  }
  if (assigned.joinLinkId) return { status: "given", joinLinkId: assigned.joinLinkId };

  // A null return is "no free link" OR "somebody gave them one a moment ago" — re-read to tell.
  const after = await readInvitee(params, service);
  if (!after) return { status: "not_found" };
  return after.linkGivenAt !== null ? { status: "already_has_link" } : { status: "pool_empty" };
}

// The only read of a `join_url` outside the paste. Null when the person has no link.
export async function readJoinUrl(
  params: { wardId: string; inviteeId: string },
  service: Client,
): Promise<string | null> {
  const { data, error } = await service
    .from("zoom_invitees")
    .select("zoom_join_links!zoom_invitees_join_link_id_ward_id_fkey (join_url)")
    .eq("ward_id", params.wardId)
    .eq("id", params.inviteeId)
    .returns<{ zoom_join_links: OneOrMany<{ join_url: string }> }[]>()
    .maybeSingle();

  if (error) {
    console.error(`Could not read a Zoom join link — ${error.message}`, params);
    throw new Error(`Could not read the Zoom link: ${error.message}`);
  }

  return data ? (first(data.zoom_join_links)?.join_url ?? null) : null;
}

export const INVITEE_FIELDS = ["memberId", "displayName", "phone", "email", "notes"] as const;
export type InviteeField = (typeof INVITEE_FIELDS)[number];

// Which of the sent fields differ from what is stored. Pure, so the audit's field list is tested
// without a database.
export function changedInviteeFields(
  current: Pick<ZoomInvitee, InviteeField>,
  input: UpdateInviteeInput,
): InviteeField[] {
  return INVITEE_FIELDS.filter(
    (field) => input[field] !== undefined && input[field] !== current[field],
  );
}

export type UpdateInviteeResult = {
  invitee: ZoomInvitee;
  changedFields: InviteeField[];
} | null;

export async function updateInvitee(
  params: { wardId: string; inviteeId: string; input: UpdateInviteeInput },
  service: Client,
): Promise<UpdateInviteeResult> {
  const { wardId, inviteeId, input } = params;
  const current = await readInvitee({ wardId, inviteeId }, service);
  if (!current) return null;

  const changedFields = changedInviteeFields(current, input);
  if (changedFields.length === 0) return { invitee: current, changedFields };

  const changed = new Set(changedFields);
  const patch: Database["public"]["Tables"]["zoom_invitees"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (changed.has("displayName") && input.displayName) patch.display_name = input.displayName;
  if (changed.has("memberId")) patch.member_id = input.memberId ?? null;
  if (changed.has("phone")) patch.phone = input.phone ?? null;
  if (changed.has("email")) patch.email = input.email ?? null;
  if (changed.has("notes")) patch.notes = input.notes ?? null;

  const { error } = await service
    .from("zoom_invitees")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", inviteeId);

  if (error) {
    console.error(`Could not update a Zoom invitee — ${error.message}`, { wardId, inviteeId });
    throw new Error(`Could not save the changes: ${error.message}`);
  }

  const invitee = await readInvitee({ wardId, inviteeId }, service);
  if (!invitee) return null;
  return { invitee, changedFields };
}

const MEMBER_NOT_AVAILABLE = "Pick the person again — that roster record isn't available.";

// Read through the CALLER's client, so `members` RLS decides what is reachable, and only an active
// member counts (D4). The composite foreign key would refuse another ward's member anyway, but as a
// 500; this makes it a sentence.
export async function assertPickableMember(supabase: Client, memberId: string): Promise<void> {
  const { data, error } = await supabase
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error(`Could not check a roster member for a Zoom link — ${error.message}`, { memberId });
    throw new Error(`Could not check the roster: ${error.message}`);
  }
  if (!data) throw new InvalidInputError(MEMBER_NOT_AVAILABLE);
}
