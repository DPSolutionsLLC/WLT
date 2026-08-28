import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { CreateActivityLogInput, UpdateActivityLogInput } from "@/lib/validation/youth";
import type { ActivityLog } from "@/lib/youth/queries";
import type { Database } from "@/types/database";
import type { ActivityType } from "@/types/domain";

// A leader's account of a game that has already happened.
//
// ---------------------------------------------------------------------------
// THIS MODULE NEVER SELECTS FROM `activity_private_notes`, AND NEVER IMPORTS THE MODULE THAT DOES
// ---------------------------------------------------------------------------
// lib/youth/queries.ts and lib/youth/attendees.ts both carry that sentence; this file makes three,
// and it is the one where it would actually be tempting — a follow-up has a shared note and a
// private note, and joining them would look like completeness. It is CLAUDE.md rule 5's second
// mechanism: "did this response include a private note?" must be answerable by reading an import
// list rather than a query body. `ActivityLogWithContext` below has no field one could occupy.
//
// ---------------------------------------------------------------------------
// MIGRATION 057 NARROWED THE READ, AND NOTHING HERE RESTATES IT
// ---------------------------------------------------------------------------
// `activity_logs_select` is `is_bishopric() or logged_by = auth.uid() or
// activity_event_is_in_caller_org(event_id) or ward_allows_cross_org_visibility()`. Every function
// below takes the CALLER'S session client and adds no org filter of its own — a redundant filter
// would mask a policy regression by hiding rows the policy had started letting through, which is
// the reasoning lib/visits/queries.ts gives for leaving out its own (CLAUDE.md rule 2).
//
// This is the ONE table in Phase 8 whose read is org-scoped. Profiles, events and attendees keep
// their ward-wide SELECT; the migration's header argues why, and why the asymmetry is deliberate
// in both directions.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. The pure half —
// whether an event is waiting on a reader's follow-up — is lib/youth/followUp.ts, which is
// client-importable on purpose. Do not merge the two files.

// A follow-up plus everything a tile or a list row needs to render it, resolved in one query
// rather than one per row.
//
// `confirmedAttendance` comes from the AUTHOR'S OWN attendee row, not from the event: a tile that
// says "Did not attend" is saying it about the person who wrote the log.
export type ActivityLogWithContext = ActivityLog & {
  eventTitle: string | null;
  eventDate: string | null;
  profileId: string | null;
  profileName: string | null;
  activityType: ActivityType | null;
  loggedByName: string | null;
  confirmedAttendance: boolean | null;
};

type ActivityLogJoinedRow = {
  id: string;
  event_id: string;
  logged_by: string;
  shared_notes: string | null;
  flagged_for_ward_council: boolean;
  flag_sent_at: string | null;
  created_at: string;
  event: {
    id: string;
    title: string;
    event_date: string;
    profile_id: string | null;
    profile: {
      id: string;
      activity_name: string;
      activity_type: string;
    } | null;
  } | null;
  author: { id: string; first_name: string | null; last_name: string | null } | null;
};

// ONE STRING LITERAL ON ONE LINE. A `+` concatenation widens the type to `string` and defeats
// supabase-js's literal parsing of the select list, degrading every row to something untyped
// (plans/retros/calendar-a-rules-and-api.md).
//
// EVERY EMBED IS NAMED, and naming them is REQUIRED rather than tidy here: this query reaches
// three tables, slice B added `activity_calendars` relationships nearby, and an inferred embed is
// a query that silently changes meaning the next time somebody adds a second foreign key. visits-d
// recorded the trap and lib/youth/attendees.ts records it again.
//
// `!inner` ON THE EVENT IS LOAD-BEARING, not decoration. `event_id` is `not null` as of migration
// 057a so no row is lost by it — but without `!inner` a filter on `event.profile_id` narrows the
// EMBEDDED resource rather than the parent, so a feed filtered to one activity would return every
// log in the ward with most of their event blocks nulled out. That is the roster-b defect in a
// new place: a list narrowed one way beside a count answering a different question.
//
// The PROFILE embed stays outer, because `profile_id` is nullable and an event with no profile
// must behave like a profile with no organization — absent means ward-wide, and dropping such a
// log from the feed would hide the very rows migration 057's LEFT JOIN went out of its way to
// keep readable.
//
// ONLY THE ID AND THE NAME COME BACK FROM `users`. Not an email, not a phone, not a role — the
// same rule lib/youth/attendees.ts and lib/visits/participants.ts state.
const ACTIVITY_LOG_JOINED_COLUMNS =
  "id, event_id, logged_by, shared_notes, flagged_for_ward_council, flag_sent_at, created_at, event:activity_events!activity_logs_event_id_ward_id_fkey!inner (id, title, event_date, profile_id, profile:youth_activity_profiles!activity_events_profile_id_ward_id_fkey (id, activity_name, activity_type)), author:users!activity_logs_logged_by_ward_id_fkey (id, first_name, last_name)";

// The plain column list, for the reads that want the row and nothing around it.
const ACTIVITY_LOG_COLUMNS =
  "id, event_id, logged_by, shared_notes, flagged_for_ward_council, flag_sent_at, created_at";

type ActivityLogRow = {
  id: string;
  event_id: string;
  logged_by: string;
  shared_notes: string | null;
  flagged_for_ward_council: boolean;
  flag_sent_at: string | null;
  created_at: string;
};

// A row whose author join came back empty is a person whose `users` row was deleted since.
// "Someone" beats a blank, exactly as mapAttendeeRow has it: the follow-up still records that a
// person wrote it, and losing that would quietly change what the record says.
const UNKNOWN_AUTHOR = "Someone";

function fullName(embed: { first_name: string | null; last_name: string | null } | null): string {
  return `${embed?.first_name ?? ""} ${embed?.last_name ?? ""}`.trim();
}

// snake_case to camelCase happens HERE and nowhere else (CLAUDE.md §6).
function mapActivityLogRow(row: ActivityLogRow): ActivityLog {
  return {
    id: row.id,
    eventId: row.event_id,
    loggedBy: row.logged_by,
    sharedNotes: row.shared_notes,
    flaggedForWardCouncil: row.flagged_for_ward_council,
    flagSentAt: row.flag_sent_at,
    createdAt: row.created_at,
  };
}

function mapJoinedRow(
  row: ActivityLogJoinedRow,
  confirmedAttendance: boolean | null,
): ActivityLogWithContext {
  const profile = row.event?.profile ?? null;

  return {
    ...mapActivityLogRow(row),
    eventTitle: row.event?.title ?? null,
    eventDate: row.event?.event_date ?? null,
    profileId: row.event?.profile_id ?? null,
    profileName: profile?.activity_name ?? null,
    activityType: (profile?.activity_type ?? null) as ActivityType | null,
    loggedByName: fullName(row.author) || UNKNOWN_AUTHOR,
    confirmedAttendance,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// The author's own attendance answer for each (event, author) pair on a page.
//
// ONE QUERY FOR THE WHOLE PAGE rather than one per tile, the rule listAttendeesForEvents states.
// It is a separate query rather than an embed because `activity_attendees` has no foreign key
// from `activity_logs` to follow — the pair is (event_id, logged_by), which is a join PostgREST
// cannot express as a nested select.
//
// The over-fetch is deliberate and bounded: filtering both columns with `.in()` returns the cross
// product of one page's events and one page's authors, which is at most `limit²` rows and in
// practice a handful. Narrowing it further would need one round trip per tile.
async function readAuthorAttendance(
  wardId: string,
  pairs: readonly { eventId: string; userId: string }[],
  supabase: SupabaseClient<Database>,
): Promise<Map<string, boolean | null>> {
  const byPair = new Map<string, boolean | null>();
  if (pairs.length === 0) return byPair;

  const { data, error } = await supabase
    .from("activity_attendees")
    .select("event_id, user_id, confirmed_attendance")
    .eq("ward_id", wardId)
    .in("event_id", [...new Set(pairs.map((pair) => pair.eventId))])
    .in("user_id", [...new Set(pairs.map((pair) => pair.userId))]);

  if (error) {
    console.error(`Could not read follow-up attendance — ${error.message}`, { wardId });
    throw new Error(`Could not load who attended: ${error.message}`);
  }

  for (const row of data ?? []) {
    byPair.set(`${row.event_id}:${row.user_id}`, row.confirmed_attendance);
  }

  return byPair;
}

// ---------------------------------------------------------------------------
// THE CURSOR IS `created_at`, AND THAT IS A DELIBERATE DEPARTURE FROM VISITS
// ---------------------------------------------------------------------------
// lib/visits/queries.ts pages on `visit_date` — the day it happened — because that column is on
// the row being paged. A youth log's event date lives on ANOTHER TABLE, and PostgREST cannot
// order parent rows by an embedded column, so a keyset over it is not expressible.
//
// So this feed is ordered NEWEST REPORT FIRST while the tile displays the EVENT'S date.
// lib/youth/reportFeed.ts defends that choice rather than apologising for it, and states the trap:
// the cursor's `occurredOn` half must never be taken from `tile.occurredOn`.
export type ActivityLogCursor = {
  createdAt: string;
};

export type ListActivityLogsOptions = {
  // The ACTIVITY the reader has filtered to. Resolved through the event's `profile_id`, which is
  // why the event embed is `!inner`.
  profileId?: string;
  limit?: number;
  before?: ActivityLogCursor | null;
};

export async function listActivityLogsForFeed(
  wardId: string,
  options: ListActivityLogsOptions,
  client?: SupabaseClient<Database>,
): Promise<ActivityLogWithContext[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("activity_logs")
    .select(ACTIVITY_LOG_JOINED_COLUMNS)
    .eq("ward_id", wardId);

  if (options.profileId !== undefined) {
    query = query.eq("event.profile_id", options.profileId);
  }

  // The keyset the ORDER BY below implies. Keyset rather than `.range()` because an offset shifts
  // under a feed that gains rows while somebody is reading it — the page after an insert would
  // repeat a tile the reader already scrolled past.
  //
  // `created_at` is a timestamptz whose text form carries `+` and `:`, both of which PostgREST
  // reads as syntax. The double quotes are what make it a value (lib/visits/queries.ts hit the
  // same thing).
  //
  // One column is enough here where visits needed two: `created_at` is microsecond-precision and
  // migration 057a's `unique (event_id, logged_by)` means two rows sharing an instant would have
  // to be two different authors saving in the same microsecond. The `id` tiebreaker below is
  // still ordered on, so a tie renders in a stable order even though the cursor cannot express it.
  if (options.before) {
    query = query.lt("created_at", options.before.createdAt);
  }

  if (options.limit !== undefined) query = query.limit(options.limit);

  // Ordered explicitly, and WITH THE `id` TIEBREAKER. These tables are shared by every suite
  // running against the hosted project and heap order shifts under them
  // (plans/retros/route-tests-and-realtime.md). The youth-c retro found `listActivityEvents`
  // missing exactly this and deliberately left it; a second one is not going in.
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.error(`Could not read activity logs — ${error.message}`, { wardId });
    throw new Error(`Could not load the follow-ups: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as ActivityLogJoinedRow[];

  const attendance = await readAuthorAttendance(
    wardId,
    rows.map((row) => ({ eventId: row.event_id, userId: row.logged_by })),
    supabase,
  );

  return rows.map((row) =>
    mapJoinedRow(row, attendance.get(`${row.event_id}:${row.logged_by}`) ?? null),
  );
}

export type ActivityLogSummary = {
  id: string;
  profileId: string | null;
};

// EVERY follow-up this caller can see, carrying only an id and the activity it belongs to.
//
// UNFILTERED, DELIBERATELY, and it answers two questions the paginated query cannot: how many are
// unread under whatever filter is applied (the caller narrows this in memory), and WHICH
// activities the filter should offer at all. Fetching it filtered would make the dropdown's
// options depend on the option already chosen — a filter you could not undo.
//
// listVisitLogSummaries states the same rule; the difference is that a visit carries its
// organization on the row and a follow-up reaches its activity through the event.
export async function listActivityLogSummaries(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityLogSummary[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_logs")
    .select(
      "id, event:activity_events!activity_logs_event_id_ward_id_fkey!inner (profile_id)",
    )
    .eq("ward_id", wardId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.error(`Could not read activity log ids — ${error.message}`, { wardId });
    throw new Error(`Could not load the follow-ups: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    event: { profile_id: string | null } | null;
  }[];

  return rows.map((row) => ({ id: row.id, profileId: row.event?.profile_id ?? null }));
}

// THE CALLER'S OWN follow-ups for a screenful of events, keyed back by event id.
//
// ONE QUERY FOR A WHOLE SCREEN, not one per card — /youth renders the season, so an N+1 here is
// the whole page rather than one row of it (lib/youth/attendees.ts states the same rule).
//
// `userId` is the CALLER'S OWN id from the session. It is a filter rather than a permission:
// migration 057 lets a leader read other people's follow-ups too, and the panel is about what
// THIS reader still owes. Somebody else's account answers nothing about that.
//
// An empty `eventIds` returns an empty Map WITHOUT QUERYING: `.in("event_id", [])` is a round trip
// to learn nothing.
export async function listOwnLogsForEvents(
  wardId: string,
  userId: string,
  eventIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<Map<string, ActivityLog>> {
  const byEvent = new Map<string, ActivityLog>();
  if (eventIds.length === 0) return byEvent;

  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_logs")
    .select(ACTIVITY_LOG_COLUMNS)
    .eq("ward_id", wardId)
    .eq("logged_by", userId)
    .in("event_id", eventIds as string[]);

  if (error) {
    console.error(`Could not read your activity logs — ${error.message}`, { wardId });
    throw new Error(`Could not load your follow-ups: ${error.message}`);
  }

  // Migration 057a's `unique (event_id, logged_by)` is what makes "the caller's log for this
  // event" a single row, so the last-write-wins loop below can never silently drop a second one.
  for (const row of (data ?? []) as ActivityLogRow[]) {
    byEvent.set(row.event_id, mapActivityLogRow(row));
  }

  return byEvent;
}

const UNIQUE_VIOLATION = "23505";
const POLICY_VIOLATION = "42501";

// ---------------------------------------------------------------------------
// THREE OUTCOMES, NAMED, RATHER THAN A NULL DOING TWO JOBS
// ---------------------------------------------------------------------------
// An INSERT is the one operation RLS refuses LOUDLY — an UPDATE or DELETE it denies is a zero-row
// success, but an INSERT raises 42501. So this write has two distinct failures a person can act
// on, and collapsing either into a thrown error gives the caller a 500 for something they did
// wrong rather than a sentence (CLAUDE.md rule 7).
//
//   duplicate  migration 057a's `unique (event_id, logged_by)`. The route answers 409 with a
//              sentence naming the alternative — unlike addAttendee's quiet 200, because being
//              already down for an event is the state the caller wanted and a second follow-up is
//              not: they meant to change the one they wrote.
//   refused    migration 057c's INSERT policy. The event is READABLE ward-wide (057 does not touch
//              `activity_events`) and still not one this caller may write a follow-up against —
//              the visits-d parent-scope rule, in its second module. Naming that in the response
//              leaks nothing the caller could not already see.
//
// Anything else is a genuine fault and still throws.
export type CreateActivityLogResult =
  | { status: "created"; log: ActivityLog }
  | { status: "duplicate" }
  | { status: "refused" };

// `userId` is a separate parameter, never a body field: the author is always the session's user.
// A body that could name its own `loggedBy` is a body that can forge one, and migration 057c's
// INSERT policy checks `logged_by = auth.uid()` with no bishopric exemption.
export async function createActivityLog(
  wardId: string,
  userId: string,
  input: CreateActivityLogInput,
  client?: SupabaseClient<Database>,
): Promise<CreateActivityLogResult> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_logs")
    .insert({
      ward_id: wardId,
      event_id: input.eventId,
      logged_by: userId,
      shared_notes: input.sharedNotes ?? null,
    })
    .select(ACTIVITY_LOG_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
    if (error.code === POLICY_VIOLATION) return { status: "refused" };

    console.error(`Could not create an activity log — ${error.message}`, {
      wardId,
      eventId: input.eventId,
    });
    throw new Error(`Could not save that follow-up: ${error.message}`);
  }

  return { status: "created", log: mapActivityLogRow(data) };
}

export async function getActivityLogWithContext(
  wardId: string,
  activityLogId: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityLogWithContext | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_logs")
    .select(ACTIVITY_LOG_JOINED_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", activityLogId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read an activity log — ${error.message}`, {
      wardId,
      activityLogId,
    });
    throw new Error(`Could not load that follow-up: ${error.message}`);
  }

  if (data === null) return null;

  const row = data as unknown as ActivityLogJoinedRow;
  const attendance = await readAuthorAttendance(
    wardId,
    [{ eventId: row.event_id, userId: row.logged_by }],
    supabase,
  );

  return mapJoinedRow(row, attendance.get(`${row.event_id}:${row.logged_by}`) ?? null);
}

// `flagSentAt` IS A SEPARATE PARAMETER rather than a field on UpdateActivityLogInput, exactly as
// lib/visits/queries.ts has it: no request may set it. The flag TRANSITION is the route's decision
// (07-visits.md §Step 3, reproduced for this module), and a body that could stamp its own
// `flag_sent_at` would be able to silence the notification.
//
// Returns null when the row did not change, which from here is indistinguishable from a row RLS
// refused — an RLS-denied UPDATE is a zero-row success, not an error
// (plans/retros/foundation-c-services.md). The route turns that into a 404.
export async function updateActivityLog(
  wardId: string,
  activityLogId: string,
  input: UpdateActivityLogInput,
  flagSentAt?: string | null,
  client?: SupabaseClient<Database>,
): Promise<ActivityLog | null> {
  const supabase = await resolveClient(client);

  // `attended` is deliberately absent from this patch: it is not a column on this table. The
  // route writes it through setConfirmedAttendance(), which is what keeps the attendee row's own
  // policy (056c) deciding who may confirm somebody's attendance.
  const patch: Database["public"]["Tables"]["activity_logs"]["Update"] = {};
  if (input.sharedNotes !== undefined) patch.shared_notes = input.sharedNotes;
  if (input.flaggedForWardCouncil !== undefined) {
    patch.flagged_for_ward_council = input.flaggedForWardCouncil;
  }
  if (flagSentAt !== undefined) patch.flag_sent_at = flagSentAt;

  // Stamped on every update, because migration 057a added the column for a reader who needs to
  // know when a follow-up last changed. It is written HERE rather than by a database trigger for
  // the reason every other timestamp in this schema is: there is exactly one writer, and a
  // trigger would be a second place to look.
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("activity_logs")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", activityLogId)
    .select(ACTIVITY_LOG_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update an activity log — ${error.message}`, {
      wardId,
      activityLogId,
    });
    throw new Error(`Could not save that follow-up: ${error.message}`);
  }

  return data === null ? null : mapActivityLogRow(data);
}
