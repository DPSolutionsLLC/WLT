import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { toRole } from "@/lib/callings/queries";
import { callingMatchesPosition, positionForCalling } from "@/lib/zoom/remoteLinkPositions";
import type { Database } from "@/types/database";
import {
  REMOTE_LINK_POSITIONS,
  type Calling,
  type RemoteLinkPosition,
  type SessionUser,
} from "@/types/domain";

// READS AND WRITES FOR `zoom_remote_links` (migration 094). THE ONLY FILE THAT TOUCHES ITS `url`
// — tests/lib/remoteLinkRetireSites.test.ts holds every other file to that.
//
// Two kinds of reader, and they never mix:
//   * the HOLDER, through their own client, where RLS decides whether they see their row at all;
//   * the BISHOPRIC's Remote links tab, through the service role after canManageRemoteLinks(),
//     which selects every column EXCEPT `url`. The bishopric never reads a link back (D3).

type Client = SupabaseClient<Database>;

export type RemoteLinkOwnState = "live" | "none" | "no_position";

export type RemoteLinkDeactivatedReason = "holder_changed" | "turned_off";

export type PositionHolder = {
  callingId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  position: RemoteLinkPosition;
};

// A link row as the tab sees it. There is deliberately no `url` field.
export type RemoteLinkRecord = {
  position: RemoteLinkPosition;
  holderCallingId: string | null;
  holderName: string | null;
  setAt: string;
  setByName: string | null;
  deactivatedAt: string | null;
  deactivatedReason: RemoteLinkDeactivatedReason | null;
  deactivatedByName: string | null;
};

export type RemoteLinkAdminEntry = {
  position: RemoteLinkPosition;
  holders: PositionHolder[];
  link: RemoteLinkRecord | null;
};

// A refusal the bishopric can act on. The route answers 409 with the message.
export class RemoteLinkRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteLinkRefusalError";
  }
}

export function isRemoteLinkRefusalError(error: unknown): error is RemoteLinkRefusalError {
  return error instanceof RemoteLinkRefusalError;
}

const NOBODY_HOLDS =
  "No one holds this calling, so there is nobody to give a link to.";
const SEVERAL_HOLD =
  "More than one person holds this calling. Fix the callings first, then paste the link.";

const LINK_STATUS_COLUMNS =
  "position, holder_calling_id, set_by, set_at, deactivated_at, deactivated_reason, deactivated_by";

const HOLDER_ROLES = ["bishop", "counselor", "ward_secretary", "executive_secretary"];

function toPosition(value: string): RemoteLinkPosition {
  if (!(REMOTE_LINK_POSITIONS as readonly string[]).includes(value)) {
    throw new Error(
      `zoom_remote_links.position holds "${value}", which is not a known position. Migration 094 ` +
        "and REMOTE_LINK_POSITIONS in types/domain.ts have drifted.",
    );
  }
  return value as RemoteLinkPosition;
}

function toReason(value: string | null): RemoteLinkDeactivatedReason | null {
  if (value === null) return null;
  if (value === "holder_changed" || value === "turned_off") return value;
  throw new Error(`zoom_remote_links.deactivated_reason holds "${value}", which is not known.`);
}

function toCounselorPosition(value: number | null): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

function fullName(firstName: string | null, lastName: string | null): string | null {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : null;
}

// ---------------------------------------------------------------------------
// THE HOLDER
// ---------------------------------------------------------------------------

export async function readOwnRemoteLinkState(
  supabase: Client,
  user: Pick<SessionUser, "role" | "counselorPosition" | "wardId">,
): Promise<RemoteLinkOwnState> {
  const position = positionForCalling(user.role, user.counselorPosition);
  if (position === null) return "no_position";

  const { data, error } = await supabase
    .from("zoom_remote_links")
    .select("id")
    .eq("ward_id", user.wardId)
    .eq("position", position)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the remote link state — ${error.message}`, {
      wardId: user.wardId,
      position,
    });
    throw new Error(`Could not read your remote link: ${error.message}`);
  }

  return data ? "live" : "none";
}

// Used by GET /api/zoom/remote-control ONLY. Never pass the result to a component.
export async function readOwnRemoteLinkUrl(
  supabase: Client,
  user: Pick<SessionUser, "role" | "counselorPosition" | "wardId">,
): Promise<string | null> {
  const position = positionForCalling(user.role, user.counselorPosition);
  if (position === null) return null;

  const { data, error } = await supabase
    .from("zoom_remote_links")
    .select("url")
    .eq("ward_id", user.wardId)
    .eq("position", position)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the remote link — ${error.message}`, {
      wardId: user.wardId,
      position,
    });
    throw new Error(`Could not read your remote link: ${error.message}`);
  }

  return data?.url ?? null;
}

// ---------------------------------------------------------------------------
// THE BISHOPRIC'S TAB — service role, after canManageRemoteLinks(), never `url`
// ---------------------------------------------------------------------------

export async function listPositionHolders(
  wardId: string,
  service: Client,
): Promise<PositionHolder[]> {
  const { data, error } = await service
    .from("ward_role_assignments")
    .select(
      "id, user_id, role, counselor_position, users!user_id!inner(first_name, last_name, email, is_active)",
    )
    .eq("ward_id", wardId)
    .eq("is_active", true)
    .eq("users.is_active", true)
    .in("role", HOLDER_ROLES);

  if (error) {
    console.error(`Could not read who holds the remote-link callings — ${error.message}`, {
      wardId,
    });
    throw new Error(`Could not read who holds the remote-link callings: ${error.message}`);
  }

  return (data ?? []).flatMap((row) => {
    const position = positionForCalling(
      toRole(row.role),
      toCounselorPosition(row.counselor_position),
    );
    if (position === null) return [];
    return [
      {
        callingId: row.id,
        userId: row.user_id,
        firstName: row.users.first_name,
        lastName: row.users.last_name,
        email: row.users.email,
        position,
      },
    ];
  });
}

async function readUserNames(userIds: string[], service: Client): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;

  const { data, error } = await service
    .from("users")
    .select("id, first_name, last_name")
    .in("id", userIds);

  if (error) {
    console.error(`Could not read names for the remote links — ${error.message}`);
    throw new Error(`Could not read names for the remote links: ${error.message}`);
  }

  for (const row of data ?? []) {
    const name = fullName(row.first_name, row.last_name);
    if (name) names.set(row.id, name);
  }
  return names;
}

async function readCallingUserIds(
  callingIds: string[],
  service: Client,
): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  if (callingIds.length === 0) return owners;

  const { data, error } = await service
    .from("ward_role_assignments")
    .select("id, user_id")
    .in("id", callingIds);

  if (error) {
    console.error(`Could not read the callings behind the remote links — ${error.message}`);
    throw new Error(`Could not read the callings behind the remote links: ${error.message}`);
  }

  for (const row of data ?? []) owners.set(row.id, row.user_id);
  return owners;
}

export async function listRemoteLinkRows(
  wardId: string,
  service: Client,
): Promise<RemoteLinkRecord[]> {
  const { data, error } = await service
    .from("zoom_remote_links")
    .select(LINK_STATUS_COLUMNS)
    .eq("ward_id", wardId);

  if (error) {
    console.error(`Could not read the remote links — ${error.message}`, { wardId });
    throw new Error(`Could not read the remote links: ${error.message}`);
  }

  const rows = data ?? [];
  const callingOwners = await readCallingUserIds(
    rows.flatMap((row) => (row.holder_calling_id ? [row.holder_calling_id] : [])),
    service,
  );
  const names = await readUserNames(
    [
      ...new Set(
        rows.flatMap((row) =>
          [
            row.set_by,
            row.deactivated_by,
            row.holder_calling_id ? callingOwners.get(row.holder_calling_id) : null,
          ].filter((id): id is string => typeof id === "string"),
        ),
      ),
    ],
    service,
  );

  return rows.map((row) => {
    const holderUserId = row.holder_calling_id ? callingOwners.get(row.holder_calling_id) : null;
    return {
      position: toPosition(row.position),
      holderCallingId: row.holder_calling_id,
      holderName: holderUserId ? (names.get(holderUserId) ?? null) : null,
      setAt: row.set_at,
      setByName: row.set_by ? (names.get(row.set_by) ?? null) : null,
      deactivatedAt: row.deactivated_at,
      deactivatedReason: toReason(row.deactivated_reason),
      deactivatedByName: row.deactivated_by ? (names.get(row.deactivated_by) ?? null) : null,
    };
  });
}

export async function listRemoteLinkAdminEntries(
  wardId: string,
  service: Client,
): Promise<RemoteLinkAdminEntry[]> {
  const [holders, links] = await Promise.all([
    listPositionHolders(wardId, service),
    listRemoteLinkRows(wardId, service),
  ]);

  return REMOTE_LINK_POSITIONS.map((position) => ({
    position,
    holders: holders.filter((holder) => holder.position === position),
    link: links.find((link) => link.position === position) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// WRITES — service role, behind the route's gate
// ---------------------------------------------------------------------------

export type SetRemoteLinkResult = {
  replaced: boolean;
  holderUserId: string;
  previousHolderUserId: string | null;
};

export async function setRemoteLink(
  params: { wardId: string; position: RemoteLinkPosition; url: string; actorUserId: string },
  service: Client,
): Promise<SetRemoteLinkResult> {
  const { wardId, position, url, actorUserId } = params;

  const holders = (await listPositionHolders(wardId, service)).filter(
    (holder) => holder.position === position,
  );
  if (holders.length === 0) throw new RemoteLinkRefusalError(NOBODY_HOLDS);
  if (holders.length > 1) throw new RemoteLinkRefusalError(SEVERAL_HOLD);
  const [holder] = holders;

  const before = await service
    .from("zoom_remote_links")
    .select("holder_calling_id, deactivated_at")
    .eq("ward_id", wardId)
    .eq("position", position)
    .maybeSingle();

  if (before.error) {
    console.error(`Could not read the remote link before setting it — ${before.error.message}`, {
      wardId,
      position,
    });
    throw new Error(`Could not set the remote link: ${before.error.message}`);
  }

  const previousCallingId = before.data?.holder_calling_id ?? null;
  const previousHolderUserId = previousCallingId
    ? ((await readCallingUserIds([previousCallingId], service)).get(previousCallingId) ?? null)
    : null;

  const { error } = await service.from("zoom_remote_links").upsert(
    {
      ward_id: wardId,
      position,
      url,
      holder_calling_id: holder.callingId,
      set_by: actorUserId,
      set_at: new Date().toISOString(),
      deactivated_at: null,
      deactivated_reason: null,
      deactivated_by: null,
    },
    { onConflict: "ward_id,position" },
  );

  if (error) {
    console.error(`Could not set the remote link — ${error.message}`, { wardId, position });
    throw new Error(`Could not set the remote link: ${error.message}`);
  }

  return {
    replaced: before.data !== null && before.data.deactivated_at === null,
    holderUserId: holder.userId,
    previousHolderUserId,
  };
}

// Null when nothing was live: the route's 404.
export async function turnOffRemoteLink(
  params: { wardId: string; position: RemoteLinkPosition; actorUserId: string },
  service: Client,
): Promise<{ previousHolderUserId: string | null } | null> {
  const { wardId, position, actorUserId } = params;

  const { data, error } = await service
    .from("zoom_remote_links")
    .update({
      url: null,
      deactivated_at: new Date().toISOString(),
      deactivated_reason: "turned_off",
      deactivated_by: actorUserId,
    })
    .eq("ward_id", wardId)
    .eq("position", position)
    .is("deactivated_at", null)
    .select("holder_calling_id")
    .maybeSingle();

  if (error) {
    console.error(`Could not turn off the remote link — ${error.message}`, { wardId, position });
    throw new Error(`Could not turn off the remote link: ${error.message}`);
  }

  if (!data) return null;

  const callingId = data.holder_calling_id;
  return {
    previousHolderUserId: callingId
      ? ((await readCallingUserIds([callingId], service)).get(callingId) ?? null)
      : null,
  };
}

// THE ONE SHARED FUNCTION FOR HOLDER CHANGES, called by updateCalling() and endCalling() with the
// calling as it now stands. Every live link bound to that calling whose position it no longer
// matches is turned off, and each turn-off is audited here — it is a different mutation from the
// calling change, which the calling's own route audits.
//
// Errors are logged and thrown, never swallowed (rule 7): a calling change that could not retire a
// link must fail loudly. The SELECT policy still protects the link meanwhile, because
// holds_remote_link() re-checks the calling on every read; the stamp is what stops a later undo
// from reviving it.
export async function retireRemoteLinksForCalling(
  params: { calling: Calling; actorUserId: string },
  service: Client,
): Promise<RemoteLinkPosition[]> {
  const { calling, actorUserId } = params;

  const { data, error } = await service
    .from("zoom_remote_links")
    .select("id, position")
    .eq("ward_id", calling.wardId)
    .eq("holder_calling_id", calling.id)
    .is("deactivated_at", null);

  if (error) {
    console.error(`Could not read the remote links bound to a calling — ${error.message}`, {
      callingId: calling.id,
    });
    throw new Error(`Could not check the stream remote links for this calling: ${error.message}`);
  }

  const stale = (data ?? []).filter(
    (row) =>
      !calling.isActive ||
      !callingMatchesPosition(calling.role, calling.counselorPosition, toPosition(row.position)),
  );

  const retired: RemoteLinkPosition[] = [];
  for (const row of stale) {
    const position = toPosition(row.position);
    const update = await service
      .from("zoom_remote_links")
      .update({
        url: null,
        deactivated_at: new Date().toISOString(),
        deactivated_reason: "holder_changed",
        deactivated_by: actorUserId,
      })
      .eq("id", row.id)
      .is("deactivated_at", null);

    if (update.error) {
      console.error(`Could not turn off a remote link on a calling change — ${update.error.message}`, {
        callingId: calling.id,
        position,
      });
      throw new Error(`Could not turn off the stream remote link: ${update.error.message}`);
    }

    await writeAuditLog(
      {
        wardId: calling.wardId,
        userId: actorUserId,
        action: "zoom_remote_link_turned_off",
        module: "zoom",
        detail: { position, reason: "holder_changed", previousHolderUserId: calling.userId },
      },
      service,
    );
    retired.push(position);
  }

  return retired;
}
