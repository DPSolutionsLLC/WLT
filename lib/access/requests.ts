import type { SupabaseClient } from "@supabase/supabase-js";
import { findAccessModule, permissionsForModule } from "@/lib/access/accessModules";
import { grantPermission, type WardSettings } from "@/lib/access/roleAccessDeltas";
import type { KnownPermission } from "@/lib/auth/permissions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/types/database";
import {
  ACCESS_LEVELS,
  ACCESS_REQUEST_STATUSES,
  ROLES,
  type AccessLevel,
  type AccessRequest,
  type AccessRequestStatus,
  type Role,
} from "@/types/domain";

// THE REQUEST → DECISION FLOW. A ward asks; a super admin answers; an approval writes an ordinary
// add-delta into `wards.settings.role_access`.
//
// ---------------------------------------------------------------------------
// READS GO THROUGH THE CALLER'S CLIENT. WRITES GO THROUGH THE SERVICE ROLE.
// ---------------------------------------------------------------------------
// `access_requests` has a SELECT policy and NO WRITE POLICIES (migration 073b), so RLS denies
// every write by default and A WARD ADMIN CANNOT APPROVE THEIR OWN REQUEST EVEN IF A ROUTE
// FORGETS TO CHECK. That is the single most important property of this table and it is enforced
// by the absence of a policy rather than by a predicate somebody could get wrong.
//
// So the route's guard is the effective boundary for the writes here — the same documented
// exception to CLAUDE.md rule 2 that lib/callings/writeCalling.ts and lib/units/writeUnit.ts
// carry. The READ is governed by `access_requests_select` and nothing in this file filters for
// security.
//
// NO AUDIT ROW IS WRITTEN HERE. The route writes it (conventions.md §Route Handler Shape), as
// every other mutation in this app does.

// ONE STRING LITERAL, not a concatenation. PostgREST's generated types infer the row shape from
// the literal, and a `+` expression collapses it to GenericStringError — which surfaces as a type
// error at every call site rather than as anything to do with the query. lib/units/queries.ts and
// lib/callings/queries.ts keep theirs on one line for the same reason.
const COLUMNS =
  "id, ward_id, requested_by, role, module, level, reason, status, decided_by, decision_note, decided_at, created_at";

export type CreateAccessRequestParams = {
  wardId: string;
  requestedBy: string;
  role: Role;
  module: string;
  level: AccessLevel;
  reason: string;
};

export type DecideAccessRequestParams = {
  requestId: string;
  decidedBy: string;
  // `pending` is not a decision, so the type refuses it rather than a runtime check refusing it.
  status: Exclude<AccessRequestStatus, "pending">;
  decisionNote?: string | null;
};

type AccessRequestRow = {
  id: string;
  ward_id: string;
  requested_by: string | null;
  role: string;
  module: string;
  level: string;
  reason: string;
  status: string;
  decided_by: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
};

// The columns are plain `text` in the database on purpose — a CHECK against ROLES or PERMISSIONS
// would be another copy of a list that grows every phase (`notification-trigger-drift`). So the
// mapper is where a drifted value is caught, and it THROWS rather than guessing: a request naming
// a role the app does not know cannot be rendered or acted on, and defaulting it would put a
// decision in front of somebody about a permission that does not exist.
function toAccessRequest(row: AccessRequestRow): AccessRequest {
  if (!(ROLES as readonly string[]).includes(row.role)) {
    throw new Error(
      `access_requests.role holds "${row.role}", which is not a known role. The request was ` +
        "written against a different version of ROLES in types/domain.ts.",
    );
  }

  if (!(ACCESS_REQUEST_STATUSES as readonly string[]).includes(row.status)) {
    throw new Error(
      `access_requests.status holds "${row.status}", which the app does not know. The CHECK ` +
        "constraint in migration 073a and ACCESS_REQUEST_STATUSES have drifted.",
    );
  }

  if (!(ACCESS_LEVELS as readonly string[]).includes(row.level)) {
    throw new Error(
      `access_requests.level holds "${row.level}", which the app does not know. The CHECK ` +
        "constraint in migration 073a and ACCESS_LEVELS have drifted.",
    );
  }

  if (findAccessModule(row.module) === null) {
    throw new Error(
      `access_requests.module holds "${row.module}", which is not a module this app knows. The ` +
        "request was written against a different version of ACCESS_MODULES in " +
        "lib/access/accessModules.ts.",
    );
  }

  return {
    id: row.id,
    wardId: row.ward_id,
    requestedBy: row.requested_by,
    role: row.role as Role,
    module: row.module,
    level: row.level as AccessLevel,
    reason: row.reason,
    status: row.status as AccessRequestStatus,
    decidedBy: row.decided_by,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

// WHAT THIS SESSION MAY SEE, which `access_requests_select` already decides: a super admin sees
// every request, a ward sees its own.
//
// THE READ IS THE WHOLE WARD'S, not just the requester's own rows. A bishopric shares admin
// authority (CLAUDE.md §7), so a counselor must be able to see what the bishop asked for — and
// scoping on `requested_by` would be the `talks-d` hole besides.
export async function listAccessRequests(
  client?: SupabaseClient<Database>,
): Promise<AccessRequest[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("access_requests")
    .select(COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Could not list the access requests — ${error.message}`);
    throw new Error(`Could not load the access requests: ${error.message}`);
  }

  return (data ?? []).map(toAccessRequest);
}

export async function readAccessRequest(
  requestId: string,
  client?: SupabaseClient<Database>,
): Promise<AccessRequest | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("access_requests")
    .select(COLUMNS)
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the access request — ${error.message}`, { requestId });
    throw new Error(`Could not load the request: ${error.message}`);
  }

  return data ? toAccessRequest(data) : null;
}

export async function createAccessRequest(
  params: CreateAccessRequestParams,
  client?: SupabaseClient<Database>,
): Promise<AccessRequest> {
  const service = client ?? createServiceSupabaseClient();

  const { data, error } = await service
    .from("access_requests")
    .insert({
      ward_id: params.wardId,
      requested_by: params.requestedBy,
      role: params.role,
      module: params.module,
      level: params.level,
      reason: params.reason.trim(),
    })
    .select(COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create the access request — ${error.message}`, {
      wardId: params.wardId,
      role: params.role,
      module: params.module,
    });
    throw new Error(`Could not send the request: ${error.message}`);
  }

  return toAccessRequest(data);
}

// APPLYING A WARD-SCOPED APPROVAL. Merges an add-delta into that ONE ward's settings.
//
// It reads and rewrites the settings object as a unit through lib/access/roleAccessDeltas.ts,
// which never replaces — see its header, and writeCrossOrgVisibility()'s, for what a wholesale
// write would destroy.
async function applyWardGrant(
  service: SupabaseClient<Database>,
  wardId: string,
  role: Role,
  moduleKey: string,
  level: AccessLevel,
): Promise<void> {
  // THE EXPANSION, and the reason a grant can no longer arrive inert. `full` always contains its
  // own `read`, so approving "Sacrament — Talks" hands over `talks.view` as well as
  // `talks.approve` — which is what the walk of scenario 067 found missing when the unit of a
  // request was a single permission.
  const permissions = permissionsForModule(moduleKey, level);

  if (permissions.length === 0) {
    // A module the app no longer knows. THROWS rather than writing an empty delta: an approval
    // that silently granted nothing is the exact failure this whole change was made to remove,
    // and the route reports it rather than telling the ward it is turned on.
    throw new Error(
      `Cannot apply the grant: "${moduleKey}" is not a module this app knows, so there is ` +
        "nothing to turn on. The request was written against a different version of " +
        "ACCESS_MODULES.",
    );
  }

  const { data, error } = await service
    .from("wards")
    .select("settings")
    .eq("id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the ward's settings — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's settings: ${error.message}`);
  }

  const settings: WardSettings =
    typeof data?.settings === "object" && data.settings !== null && !Array.isArray(data.settings)
      ? (data.settings as WardSettings)
      : {};

  // Folded one permission at a time through the same merge the single-permission path used, so
  // the delta discipline in lib/access/roleAccessDeltas.ts still owns every write and this
  // function never touches the settings object itself.
  const next = permissions.reduce<WardSettings>(
    (carried, permission) => grantPermission(carried, role, permission),
    settings,
  );

  const { error: writeError } = await service
    .from("wards")
    .update({ settings: next as unknown as Json })
    .eq("id", wardId);

  if (writeError) {
    console.error(`Could not apply the grant — ${writeError.message}`, {
      wardId,
      role,
      module: moduleKey,
      level,
    });
    throw new Error(`Could not apply the grant: ${writeError.message}`);
  }
}

// DECIDING. The row is stamped first and the grant applied second, deliberately:
//
// If the stamp fails, nothing happened and the request is still pending — which is recoverable by
// deciding again. If the GRANT fails after the stamp, the request reads as approved while the
// permission has not landed; that surfaces as a thrown error the route reports, and re-deciding
// re-applies it because `grantPermission` is idempotent. The other order would leave a ward
// silently holding a permission against a request that still reads pending, which is the worse
// half — a granted permission nobody can see a decision for.
//
// `approved_app_wide` deliberately applies NO ward delta here. Its grant is a CODE change plus
// the fan-out in lib/access/appWideGrant.ts, and writing an add-delta as well would grant the
// requesting ward the permission twice over by two different mechanisms.
export async function decideAccessRequest(
  params: DecideAccessRequestParams,
  client?: SupabaseClient<Database>,
): Promise<AccessRequest | null> {
  const service = client ?? createServiceSupabaseClient();

  const { data, error } = await service
    .from("access_requests")
    .update({
      status: params.status,
      decided_by: params.decidedBy,
      decision_note: params.decisionNote?.trim() || null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", params.requestId)
    // ONLY A PENDING REQUEST MAY BE DECIDED. Without this a second press re-stamps a decision
    // that was already made, moving `decided_by` and `decided_at` onto whoever pressed last —
    // and on an approval it would re-apply the grant under a new decider's name. A zero-row
    // result is what the route reports as "that request has already been answered".
    .eq("status", "pending")
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not decide the access request — ${error.message}`, {
      requestId: params.requestId,
    });
    throw new Error(`Could not record the decision: ${error.message}`);
  }

  if (!data) return null;

  const decided = toAccessRequest(data);

  if (decided.status === "approved_ward") {
    await applyWardGrant(
      service,
      decided.wardId,
      decided.role,
      decided.module,
      decided.level,
    );
  }

  return decided;
}

// WHO ANSWERS A REQUEST — every active super admin in the app.
//
// Needed because a super admin is NOT A WARD ROLE: the assignment lives in `unit_assignments`,
// which has no ward_id at all (migration 065b), so emitNotification's role-based resolution
// cannot reach them from the asking ward. The route passes these as `recipientUserIds`.
//
// Reads through the SERVICE-ROLE client for the same reason countActiveSuperAdmins() does:
// `unit_assignments_select` (065f) admits only the caller's OWN rows unless they are a super
// admin themselves, so a bishopric member resolving this through their own client would always
// get an empty list — and emitNotification RETURNS WITHOUT AN ERROR when nobody matches
// (`notification-trigger-drift`'s actual damage). A silent empty list here is a request that
// nobody is ever told about.
//
// JOINED TO `users.is_active`, matching is_super_admin()'s own join: a deactivated super admin is
// not a super admin, and must not be notified.
export async function listActiveSuperAdminIds(
  client?: SupabaseClient<Database>,
): Promise<string[]> {
  const service = client ?? createServiceSupabaseClient();

  const { data, error } = await service
    .from("unit_assignments")
    // `users!user_id!inner`, NOT `users!inner`. `unit_assignments` has TWO foreign keys to `users`
    // — `user_id` and `created_by` — so the bare embed is ambiguous and PostgREST refuses it with
    // "more than one relationship was found". The error was caught and an empty list returned, so
    // the notification silently never arrived: exactly the damage this function's own header warns
    // about. Found by walking scenario 067.
    .select("user_id, users!user_id!inner(is_active)")
    .eq("role", "super_admin")
    .eq("users.is_active", true);

  if (error) {
    // Logged and returned empty rather than thrown. This is a notification recipient list, and a
    // notification outage must not become a request that cannot be filed — writeAuditLog and
    // emitNotification take the same line. The log is what makes it findable.
    console.error(`Could not resolve the super admins to notify — ${error.message}`);
    return [];
  }

  return [...new Set((data ?? []).map((row) => row.user_id))];
}
