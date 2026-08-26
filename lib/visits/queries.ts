import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  conductedByLabel,
  listParticipantsForVisits,
  type VisitParticipant,
} from "@/lib/visits/participants";
import type {
  CreateVisitGoalInput,
  CreateVisitLogInput,
  ListVisitsQuery,
  UpdateVisitGoalInput,
  UpdateVisitLogInput,
} from "@/lib/validation/visit";
import type { Database } from "@/types/database";
import {
  VISIT_ARRANGEMENTS,
  VISIT_CADENCES,
  VISIT_OUTCOMES,
  VISIT_TARGET_TYPES,
  VISIT_TYPES,
  type VisitArrangement,
  type VisitCadence,
  type VisitOutcome,
  type VisitTargetType,
  type VisitType,
} from "@/types/domain";

// Every `visit_goals` and `visit_logs` read and write goes through this module. Route handlers
// and pages never touch Supabase directly (conventions.md §Data Access).
//
// THIS MODULE NEVER SELECTS FROM `visit_private_notes`, AND NEVER IMPORTS THE MODULE THAT DOES.
//
// That is the mechanism, not a nicety. Private notes live in lib/visits/privateNotes.ts, so
// "did this response include a private note?" is answerable by reading the import list at the
// top of a route or a page without reading its body — the same rule lib/roster/memberNotes.ts
// states for member notes. A private note joined in here would reach a list endpoint, an
// export, a report tile and a notification body all at once, and every one of those is a
// promise this app made to the person who wrote it (CLAUDE.md rule 5).
//
// This module is the reminder. RLS is the guard: migration 019 gives visit_private_notes four
// author-only policies and no bishopric branch on any of them, and
// tests/rls/private-notes.test.ts is what proves it holds whether or not a caller remembers
// this file exists.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers.

export type VisitGoal = {
  id: string;
  // The organization that owns this goal. Null is a bishopric-authored, ward-level goal, which
  // migration 019's `org_id = current_org_id()` makes bishopric-only — null is never equal to
  // null in SQL, so no org leader can see it. Stamped from the session, never from a request.
  orgId: string | null;
  title: string | null;
  targetType: VisitTargetType | null;
  cadence: VisitCadence | null;
  cadenceMonths: number | null;
  goalPeriodStart: string | null;
  goalPeriodEnd: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type VisitLog = {
  id: string;
  orgId: string | null;
  householdId: string | null;
  // WHO TYPED IT IN, not who went. Those are frequently different people — a secretary records
  // the visits their presidency made — and visits-a had one column for both, which is what this
  // slice split. Who WENT is `visit_participants`, read through lib/visits/participants.ts.
  recordedBy: string | null;
  visitDate: string;
  visitType: VisitType;
  // `completed` or `attempted`. visits-b counts `completed` only; an attempt is shown on the
  // dashboard as its own state so a household nobody can catch at home stays visible.
  outcome: VisitOutcome;
  arrangement: VisitArrangement;
  sharedNotes: string | null;
  flaggedForWardCouncil: boolean;
  flagSentAt: string | null;
  createdAt: string;
};

// The display shape the list endpoint returns. Note what is NOT here and cannot be added by
// accident: there is no private-note field on VisitLog, so a response built from this type
// cannot carry one even if a future `select` widened.
//
// `conductedByLabel` is NULL when there are no participants, and the page says "Nobody recorded
// as visiting" rather than falling back to the recorder. Falling back would re-create the exact
// ambiguity this slice exists to remove.
export type VisitLogWithContext = VisitLog & {
  householdName: string | null;
  recordedByName: string | null;
  participants: VisitParticipant[];
  conductedByLabel: string | null;
};

type VisitGoalRow = {
  id: string;
  org_id: string | null;
  title: string | null;
  target_type: string | null;
  cadence: string | null;
  cadence_months: number | null;
  goal_period_start: string | null;
  goal_period_end: string | null;
  created_by: string | null;
  created_at: string;
};

type VisitLogRow = {
  id: string;
  org_id: string | null;
  household_id: string | null;
  recorded_by: string | null;
  visit_date: string;
  visit_type: string;
  outcome: string;
  arrangement: string;
  shared_notes: string | null;
  flagged_for_ward_council: boolean;
  flag_sent_at: string | null;
  created_at: string;
};

type VisitLogJoinedRow = VisitLogRow & {
  households: { id: string; family_name: string } | null;
  users: { id: string; first_name: string | null; last_name: string | null } | null;
};

// One string literal on ONE line, never a `+` concatenation — concatenation widens the type to
// `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md). And never `select("*")`: an explicit list is what
// stops a column added later riding into a response nobody reviewed.
const VISIT_GOAL_COLUMNS =
  "id, org_id, title, target_type, cadence, cadence_months, goal_period_start, goal_period_end, created_by, created_at";

const VISIT_LOG_COLUMNS =
  "id, org_id, household_id, recorded_by, visit_date, visit_type, outcome, arrangement, shared_notes, flagged_for_ward_council, flag_sent_at, created_at";

// Households and users, for the family/who-recorded display. NOT private notes, and there is no
// arrangement of this string that could reach them — visit_private_notes has no foreign key
// from visit_logs pointing at it, so PostgREST cannot embed it here at all.
//
// The `users` embed is the RECORDER now that visits-a's single `visited_by` column has split.
// Who WENT is a separate table with its own policy, read through listParticipantsForVisits.
//
// THE FOREIGN KEY IS NAMED, NOT INFERRED. Between migrations 046 and 049 this table had TWO
// foreign keys to `users` — the new `recorded_by` and the outgoing `visited_by` — and a bare
// `users (...)` was ambiguous while both existed: PostgREST answers "more than one relationship
// was found" and every visit query 500s. That window is the whole point of expand-and-contract,
// so the query had to survive it rather than only work at each end.
//
// 049 has since dropped the old column, so the ambiguity is gone. The name STAYS anyway: an
// inferred embed is a query that silently changes meaning the next time somebody adds a second
// foreign key to this table, and the next person to do that will not be thinking about this line.
const VISIT_LOG_JOINED_COLUMNS = `${VISIT_LOG_COLUMNS}, households (id, family_name), users!visit_logs_recorded_by_fkey (id, first_name, last_name)` as const;

// A value the CHECK constraint should have made impossible means the constraint and
// types/domain.ts have drifted, and that is worth a crash rather than a silent cast — the same
// reasoning toEnumValue() uses in lib/roster/queries.ts.
function toEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  column: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `${column} holds "${value}", which is not a known value. The CHECK constraint and ` +
        "types/domain.ts have drifted.",
    );
  }
  return value as T;
}

function toOptionalEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
  column: string,
): T | null {
  return value === null ? null : toEnum(value, allowed, column);
}

// Builds an explicit object rather than spreading the row, for the same reason mapGoalRow does:
// a column added to `visit_goals` later cannot ride along into a response nobody reviewed.
export function mapVisitGoalRow(row: VisitGoalRow): VisitGoal {
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    targetType: toOptionalEnum(row.target_type, VISIT_TARGET_TYPES, "visit_goals.target_type"),
    cadence: toOptionalEnum(row.cadence, VISIT_CADENCES, "visit_goals.cadence"),
    cadenceMonths: row.cadence_months,
    goalPeriodStart: row.goal_period_start,
    goalPeriodEnd: row.goal_period_end,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapVisitLogRow(row: VisitLogRow): VisitLog {
  return {
    id: row.id,
    orgId: row.org_id,
    householdId: row.household_id,
    recordedBy: row.recorded_by,
    visitDate: row.visit_date,
    visitType: toEnum(row.visit_type, VISIT_TYPES, "visit_logs.visit_type"),
    outcome: toEnum(row.outcome, VISIT_OUTCOMES, "visit_logs.outcome"),
    arrangement: toEnum(row.arrangement, VISIT_ARRANGEMENTS, "visit_logs.arrangement"),
    sharedNotes: row.shared_notes,
    flaggedForWardCouncil: row.flagged_for_ward_council,
    flagSentAt: row.flag_sent_at,
    createdAt: row.created_at,
  };
}

function mapVisitLogJoinedRow(
  row: VisitLogJoinedRow,
  participants: VisitParticipant[],
): VisitLogWithContext {
  const recorder = row.users;
  const recordedByName =
    recorder === null
      ? null
      : `${recorder.first_name ?? ""} ${recorder.last_name ?? ""}`.trim() || null;

  return {
    ...mapVisitLogRow(row),
    householdName: row.households?.family_name ?? null,
    recordedByName,
    participants,
    conductedByLabel: conductedByLabel(participants),
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// Every function below takes the CALLER'S session client. RLS does the org scoping, and there is
// deliberately no belt-and-braces `org_id` filter on top of it: a redundant filter would mask a
// policy regression by hiding rows the policy had started letting through, which is exactly the
// leak the RLS tests exist to catch.

export async function listVisitGoals(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<VisitGoal[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_goals")
    .select(VISIT_GOAL_COLUMNS)
    .eq("ward_id", wardId)
    .order("goal_period_start", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Could not read visit goals — ${error.message}`, { wardId });
    throw new Error(`Could not load the visit goals: ${error.message}`);
  }

  return (data ?? []).map(mapVisitGoalRow);
}

export async function getVisitGoal(
  wardId: string,
  goalId: string,
  client?: SupabaseClient<Database>,
): Promise<VisitGoal | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_goals")
    .select(VISIT_GOAL_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", goalId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a visit goal — ${error.message}`, { wardId, goalId });
    throw new Error(`Could not load that visit goal: ${error.message}`);
  }

  return data === null ? null : mapVisitGoalRow(data);
}

export async function createVisitGoal(
  wardId: string,
  orgId: string | null,
  userId: string,
  input: CreateVisitGoalInput,
  client?: SupabaseClient<Database>,
): Promise<VisitGoal> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_goals")
    .insert({
      ward_id: wardId,
      org_id: orgId,
      title: input.title,
      target_type: input.targetType,
      cadence: input.cadence,
      cadence_months: input.cadenceMonths ?? null,
      goal_period_start: input.goalPeriodStart,
      goal_period_end: input.goalPeriodEnd,
      created_by: userId,
    })
    .select(VISIT_GOAL_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a visit goal — ${error.message}`, { wardId, orgId });
    throw new Error(`Could not save that visit goal: ${error.message}`);
  }

  return mapVisitGoalRow(data);
}

// Returns null when the row did not change, which from here is indistinguishable from a row RLS
// refused — an RLS-denied UPDATE is a zero-row success, not an error
// (plans/retros/foundation-c-services.md). The route turns that into a 404.
export async function updateVisitGoal(
  wardId: string,
  goalId: string,
  input: UpdateVisitGoalInput,
  client?: SupabaseClient<Database>,
): Promise<VisitGoal | null> {
  const supabase = await resolveClient(client);

  const patch: Database["public"]["Tables"]["visit_goals"]["Update"] = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.cadence !== undefined) patch.cadence = input.cadence;
  if (input.cadenceMonths !== undefined) patch.cadence_months = input.cadenceMonths;
  if (input.goalPeriodStart !== undefined) patch.goal_period_start = input.goalPeriodStart;
  if (input.goalPeriodEnd !== undefined) patch.goal_period_end = input.goalPeriodEnd;

  const { data, error } = await supabase
    .from("visit_goals")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", goalId)
    .select(VISIT_GOAL_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update a visit goal — ${error.message}`, { wardId, goalId });
    throw new Error(`Could not save that visit goal: ${error.message}`);
  }

  return data === null ? null : mapVisitGoalRow(data);
}

// WHERE THE LAST PAGE STOPPED. Both halves are needed because the order is on two columns:
// several visits share a `visit_date`, so a cursor holding the date alone would either repeat
// them on the next page or skip them.
export type VisitLogCursor = {
  visitDate: string;
  createdAt: string;
};

export type ListVisitLogsOptions = ListVisitsQuery & {
  limit?: number;
  before?: VisitLogCursor | null;
};

export async function listVisitLogs(
  wardId: string,
  filter: ListVisitLogsOptions,
  client?: SupabaseClient<Database>,
): Promise<VisitLogWithContext[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("visit_logs")
    .select(VISIT_LOG_JOINED_COLUMNS)
    .eq("ward_id", wardId);

  if (filter.orgId !== undefined) query = query.eq("org_id", filter.orgId);
  if (filter.householdId !== undefined) query = query.eq("household_id", filter.householdId);
  if (filter.from !== undefined) query = query.gte("visit_date", filter.from);
  if (filter.to !== undefined) query = query.lte("visit_date", filter.to);

  // The keyset the ORDER BY below implies, expressed as a filter: strictly earlier by date, or
  // the same date and strictly earlier by creation. Keyset rather than `.range()` because an
  // offset shifts under a feed that gains rows while somebody is reading it — the page after an
  // insert would repeat a tile the reader already scrolled past.
  //
  // `created_at` is a timestamptz whose text form carries `+` and `:`, both of which PostgREST
  // reads as syntax inside an `or()`. The double quotes are what make it a value.
  if (filter.before) {
    const { visitDate, createdAt } = filter.before;
    query = query.or(
      `visit_date.lt.${visitDate},and(visit_date.eq.${visitDate},created_at.lt."${createdAt}")`,
    );
  }

  if (filter.limit !== undefined) query = query.limit(filter.limit);

  // Ordered explicitly, because these tables are shared by every suite running against the
  // hosted project and heap order shifts under them (plans/retros/route-tests-and-realtime.md).
  const { data, error } = await query
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Could not read visit logs — ${error.message}`, { wardId });
    throw new Error(`Could not load the visits: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as VisitLogJoinedRow[];

  // ONE query for every visit's participants, not one per visit. The list page renders every
  // recent log, so an N+1 here is the whole page rather than one row of it.
  const participants = await listParticipantsForVisits(
    wardId,
    rows.map((row) => row.id),
    supabase,
  );

  return rows.map((row) => mapVisitLogJoinedRow(row, participants.get(row.id) ?? []));
}

export type VisitLogSummary = {
  id: string;
  orgId: string | null;
};

// EVERY visit log this caller can see, ordered like the feed and carrying only an id and an
// organization.
//
// UNFILTERED, DELIBERATELY, and it answers two questions the paginated tile query cannot:
//
//   1. The unread badge counts over the whole feed rather than over the page on screen, so it
//      cannot be derived from a page. The caller narrows this list in memory to match whatever
//      filter is applied.
//   2. WHICH organizations the filter should offer. Derived from the reports that exist rather
//      than from the ward's organization list, so the dropdown never offers a Primary that has
//      never logged a visit — and never loses an organization as the reader pages past its last
//      report, because this list does not paginate.
//
// Two columns rather than a join: no participants query, no households, no notes. Three years of
// a ward's visits is a few thousand rows of two uuids.
//
// RLS decides the scope here exactly as it does above, which is where cross-org visibility takes
// effect for the count and the filter options as well as for the tiles.
export async function listVisitLogSummaries(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<VisitLogSummary[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_logs")
    .select("id, org_id")
    .eq("ward_id", wardId)
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Could not read visit log ids — ${error.message}`, { wardId });
    throw new Error(`Could not load the visits: ${error.message}`);
  }

  return (data ?? []).map((row) => ({ id: row.id, orgId: row.org_id }));
}

export async function getVisitLog(
  wardId: string,
  visitLogId: string,
  client?: SupabaseClient<Database>,
): Promise<VisitLog | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_logs")
    .select(VISIT_LOG_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", visitLogId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a visit log — ${error.message}`, { wardId, visitLogId });
    throw new Error(`Could not load that visit: ${error.message}`);
  }

  return data === null ? null : mapVisitLogRow(data);
}

// `recordedBy` is a parameter rather than a field on CreateVisitLogInput, and that is the point:
// createVisitLogSchema has no such field, so a request cannot put a visit in somebody else's
// name. Who WENT is written separately, through replaceParticipants.
export async function createVisitLog(
  wardId: string,
  orgId: string | null,
  recordedBy: string,
  input: CreateVisitLogInput,
  client?: SupabaseClient<Database>,
): Promise<VisitLog> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_logs")
    .insert({
      ward_id: wardId,
      org_id: orgId,
      household_id: input.householdId,
      recorded_by: recordedBy,
      visit_date: input.visitDate,
      visit_type: input.visitType,
      outcome: input.outcome,
      arrangement: input.arrangement,
      shared_notes: input.sharedNotes ?? null,
    })
    .select(VISIT_LOG_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a visit log — ${error.message}`, { wardId, orgId });
    throw new Error(`Could not save that visit: ${error.message}`);
  }

  return mapVisitLogRow(data);
}

// `flagSentAt` is a separate parameter rather than a field on UpdateVisitLogInput because no
// request may set it. The flag TRANSITION is the route's decision (07-visits.md §Step 3) and a
// body that could stamp its own flag_sent_at could silence the notification.
export async function updateVisitLog(
  wardId: string,
  visitLogId: string,
  input: UpdateVisitLogInput,
  flagSentAt?: string | null,
  client?: SupabaseClient<Database>,
): Promise<VisitLog | null> {
  const supabase = await resolveClient(client);

  // `participants` is deliberately absent from this patch: it is not a column on this table.
  // The route writes it through replaceParticipants, which is what keeps org_id on a participant
  // row stamped from the VISIT rather than from a request.
  const patch: Database["public"]["Tables"]["visit_logs"]["Update"] = {};
  if (input.sharedNotes !== undefined) patch.shared_notes = input.sharedNotes;
  if (input.outcome !== undefined) patch.outcome = input.outcome;
  if (input.arrangement !== undefined) patch.arrangement = input.arrangement;
  if (input.flaggedForWardCouncil !== undefined) {
    patch.flagged_for_ward_council = input.flaggedForWardCouncil;
  }
  if (flagSentAt !== undefined) patch.flag_sent_at = flagSentAt;

  // A PATCH that changes only the participants touches no column on THIS table, and an empty
  // `update({})` is a request PostgREST rejects. The row is not simply re-read instead: with
  // cross-org visibility on, an Elders Quorum leader can READ a Relief Society visit, so a read
  // would answer 200 where visits-a answered 404 and the write would be refused a moment later
  // by visit_participants' policy with nothing but a database error to show for it.
  //
  // So the no-op write is a write. `org_id` is set to the value it already holds, which changes
  // nothing and still has to satisfy BOTH halves of visit_logs_update — its `using` clause and
  // its `with check` — so the caller is judged by the policy rather than by a rule restated here
  // (CLAUDE.md rule 2). A refused caller gets the same zero-row success, and the same 404, as
  // any other refused update. `org_id` is never patchable from a request body, so this cannot be
  // steered: the value comes from the row itself.
  if (Object.keys(patch).length === 0) {
    const existing = await getVisitLog(wardId, visitLogId, supabase);
    if (existing === null) return null;
    patch.org_id = existing.orgId;
  }

  const { data, error } = await supabase
    .from("visit_logs")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", visitLogId)
    .select(VISIT_LOG_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update a visit log — ${error.message}`, { wardId, visitLogId });
    throw new Error(`Could not save that visit: ${error.message}`);
  }

  return data === null ? null : mapVisitLogRow(data);
}
