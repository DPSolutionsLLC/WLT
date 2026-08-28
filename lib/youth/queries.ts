import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  CreateActivityEventInput,
  CreateActivityProfileInput,
  UpdateActivityEventInput,
  UpdateActivityProfileInput,
} from "@/lib/validation/youth";
import type { Database } from "@/types/database";
import type { ActivityType, EventStatus, EventType } from "@/types/domain";

// Youth activity logs.
//
// ONE FUNCTION, AND IT IS HERE BECAUSE visits-c NEEDED IT. Phase 8
// (plans/08-youth-activities.md) owns this module and will fill it in; the read-status route
// built in visits-c is deliberately generic, and "does this report exist and may this caller see
// it?" has to be answerable for `youth_activity` on the day the route ships or the genericity is
// a claim rather than a fact.
//
// THIS MODULE NEVER SELECTS FROM `activity_private_notes`, AND NEVER IMPORTS THE MODULE THAT
// WILL. Migration 009 gives that table the same author-only shape as visit_private_notes, and
// CLAUDE.md rule 5 names both. The rule lib/visits/queries.ts states in its header applies here
// unchanged.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers.

export type ActivityLog = {
  id: string;
  eventId: string | null;
  // WHO TYPED IT IN. `activity_logs` has no participants table and no equivalent of
  // `visit_participants`, so unlike a visit there is no separate record of who was actually
  // there. A feed tile must not present this under the same label a visit's "who went" uses
  // (lib/reports/types.ts).
  loggedBy: string | null;
  sharedNotes: string | null;
  flaggedForWardCouncil: boolean;
  createdAt: string;
};

type ActivityLogRow = {
  id: string;
  event_id: string | null;
  logged_by: string | null;
  shared_notes: string | null;
  flagged_for_ward_council: boolean;
  created_at: string;
};

// One string literal on ONE line, never a `+` concatenation — concatenation widens the type to
// `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md).
const ACTIVITY_LOG_COLUMNS =
  "id, event_id, logged_by, shared_notes, flagged_for_ward_council, created_at";

function mapActivityLogRow(row: ActivityLogRow): ActivityLog {
  return {
    id: row.id,
    eventId: row.event_id,
    loggedBy: row.logged_by,
    sharedNotes: row.shared_notes,
    flaggedForWardCouncil: row.flagged_for_ward_council,
    createdAt: row.created_at,
  };
}

// Null, not an error, for a log this caller cannot see. Migration 019 gives `activity_logs` a
// plain ward-scoped select policy, so today that means "not in your ward" — but the caller's
// session client is still what runs the query, so a narrower policy added by Phase 8 narrows this
// too without anything here changing.
export async function getActivityLog(
  wardId: string,
  activityLogId: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityLog | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("activity_logs")
    .select(ACTIVITY_LOG_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", activityLogId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read an activity log — ${error.message}`, {
      wardId,
      activityLogId,
    });
    throw new Error(`Could not load that activity: ${error.message}`);
  }

  return data === null ? null : mapActivityLogRow(data);
}

// ===========================================================================
// Phase 8 slice A — activity profiles and their events
// ===========================================================================
//
// Everything below takes the CALLER'S session client, so migration 054d's policies are what
// decide which profiles a write reaches. Nothing here branches on a role: an org leader and a
// bishopric member run the same query and the database answers differently (CLAUDE.md rule 2).
//
// READS ARE WARD-WIDE AND THE FUNCTIONS BELOW DO NOT NARROW THEM.
// `youth_activity_profiles_ward_select` admits every profile in the ward regardless of org_id,
// on purpose — FEATURES.md §Module 10 gives the ward council the full calendar. The org scoping
// lives entirely on the WRITE side, in migration 054d and in the routes that stamp ownership.

export type ActivityProfile = {
  id: string;
  memberId: string;
  memberName: string;
  orgId: string | null;
  activityName: string;
  schoolOrg: string | null;
  activityType: ActivityType;
  seasonSchedule: string | null;
  notes: string | null;
  enteredBy: string | null;
  createdAt: string;
};

export type ActivityEvent = {
  id: string;
  profileId: string | null;
  calendarId: string | null;
  title: string;
  eventType: EventType;
  eventDate: string;
  location: string | null;
  status: EventStatus;
  createdAt: string;
};

// A NAMED embed, not an inferred one. `members!youth_activity_profiles_member_id_ward_id_fkey`
// says which foreign key this join follows, so adding a second one to `members` later cannot
// silently change what this column means — and slice B is about to add `activity_calendars`
// relationships nearby (visits-d's release note records the same trap).
//
// ONE STRING LITERAL ON ONE LINE. A concatenation widens the type to `string` and defeats
// supabase-js's literal parsing of the select list, degrading every row to something untyped
// (plans/retros/calendar-a-rules-and-api.md).
const ACTIVITY_PROFILE_COLUMNS =
  "id, member_id, org_id, activity_name, school_org, activity_type, season_schedule, notes, entered_by, created_at, members!youth_activity_profiles_member_id_ward_id_fkey (first_name, last_name)";

const ACTIVITY_EVENT_COLUMNS =
  "id, profile_id, calendar_id, title, event_type, event_date, location, status, created_at";

type ActivityProfileRow = {
  id: string;
  member_id: string;
  org_id: string | null;
  activity_name: string;
  school_org: string | null;
  activity_type: string;
  season_schedule: string | null;
  notes: string | null;
  entered_by: string | null;
  created_at: string;
  members: { first_name: string; last_name: string } | null;
};

type ActivityEventRow = {
  id: string;
  profile_id: string | null;
  calendar_id: string | null;
  title: string;
  event_type: string;
  event_date: string;
  location: string | null;
  status: string;
  created_at: string;
};

// snake_case to camelCase happens HERE and nowhere else (CLAUDE.md §6). The member's name is
// flattened onto the profile because every screen that shows an activity shows whose it is, and
// a nested object would make every caller reach through the same two levels.
function mapActivityProfileRow(row: ActivityProfileRow): ActivityProfile {
  const member = row.members;

  return {
    id: row.id,
    memberId: row.member_id,
    // The embed is null only when RLS hid the member row from this caller, which the ward-scoped
    // `members` policy makes impossible for anybody who could read the profile. The fallback is a
    // truthful placeholder rather than an empty string, so a name that DID go missing reads as
    // missing rather than as a blank line.
    memberName:
      member === null ? "A member" : `${member.first_name} ${member.last_name}`.trim(),
    orgId: row.org_id,
    activityName: row.activity_name,
    schoolOrg: row.school_org,
    activityType: row.activity_type as ActivityType,
    seasonSchedule: row.season_schedule,
    notes: row.notes,
    enteredBy: row.entered_by,
    createdAt: row.created_at,
  };
}

function mapActivityEventRow(row: ActivityEventRow): ActivityEvent {
  return {
    id: row.id,
    profileId: row.profile_id,
    calendarId: row.calendar_id,
    title: row.title,
    eventType: row.event_type as EventType,
    eventDate: row.event_date,
    location: row.location,
    status: row.status as EventStatus,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// Ordered by activity name, because the page groups by youth and then lists that youth's
// activities. The grouping itself is the page's job — this is the order WITHIN a group, and
// putting it here means the list arrives in a stable order rather than in insertion order.
export async function listActivityProfiles(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityProfile[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("youth_activity_profiles")
    .select(ACTIVITY_PROFILE_COLUMNS)
    .eq("ward_id", wardId)
    .order("activity_name");

  if (error) {
    console.error(`Could not list activity profiles — ${error.message}`, { wardId });
    throw new Error(`Could not load the youth activities: ${error.message}`);
  }

  return (data ?? []).map(mapActivityProfileRow);
}

// Null, not an error, for a profile this caller cannot see — which after migration 054 means
// "not in your ward", since reads stay ward-wide. The route turns that into a 404 with a
// sentence.
export async function getActivityProfile(
  wardId: string,
  profileId: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityProfile | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("youth_activity_profiles")
    .select(ACTIVITY_PROFILE_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read an activity profile — ${error.message}`, {
      wardId,
      profileId,
    });
    throw new Error(`Could not load that activity: ${error.message}`);
  }

  return data === null ? null : mapActivityProfileRow(data);
}

// `orgId` and `userId` are separate parameters rather than fields on `input`, because neither
// comes from the request body — the route resolves both from the session (conventions.md
// §Validation). A null orgId is a WARD-WIDE profile, which policy 054d explicitly permits and
// which is the ordinary case for a ward council member.
export async function createActivityProfile(
  wardId: string,
  orgId: string | null,
  userId: string,
  input: CreateActivityProfileInput,
  client?: SupabaseClient<Database>,
): Promise<ActivityProfile> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("youth_activity_profiles")
    .insert({
      ward_id: wardId,
      org_id: orgId,
      member_id: input.memberId,
      activity_name: input.activityName,
      activity_type: input.activityType,
      school_org: input.schoolOrg ?? null,
      season_schedule: input.seasonSchedule ?? null,
      notes: input.notes ?? null,
      entered_by: userId,
    })
    .select(ACTIVITY_PROFILE_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create an activity profile — ${error.message}`, { wardId, orgId });
    throw new Error(`Could not save that activity: ${error.message}`);
  }

  return mapActivityProfileRow(data);
}

// Returns null when the row did not change, which from here is indistinguishable from a row RLS
// refused — an RLS-denied UPDATE is a zero-row success, not an error
// (plans/retros/foundation-c-services.md). The route turns that into a 404.
export async function updateActivityProfile(
  wardId: string,
  profileId: string,
  input: UpdateActivityProfileInput,
  client?: SupabaseClient<Database>,
): Promise<ActivityProfile | null> {
  const supabase = await resolveClient(client);

  const patch: Database["public"]["Tables"]["youth_activity_profiles"]["Update"] = {};
  if (input.activityName !== undefined) patch.activity_name = input.activityName;
  if (input.activityType !== undefined) patch.activity_type = input.activityType;
  if (input.schoolOrg !== undefined) patch.school_org = input.schoolOrg;
  if (input.seasonSchedule !== undefined) patch.season_schedule = input.seasonSchedule;
  if (input.notes !== undefined) patch.notes = input.notes;

  const { data, error } = await supabase
    .from("youth_activity_profiles")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", profileId)
    .select(ACTIVITY_PROFILE_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update an activity profile — ${error.message}`, {
      wardId,
      profileId,
    });
    throw new Error(`Could not save that activity: ${error.message}`);
  }

  return data === null ? null : mapActivityProfileRow(data);
}

// False when nothing was deleted, which is again a refused row rather than an error. Deleting a
// profile CASCADES to its events (migration 009), and that is correct: a game has no meaning
// without the season it belongs to.
export async function deleteActivityProfile(
  wardId: string,
  profileId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("youth_activity_profiles")
    .delete()
    .eq("ward_id", wardId)
    .eq("id", profileId)
    .select("id");

  if (error) {
    console.error(`Could not delete an activity profile — ${error.message}`, {
      wardId,
      profileId,
    });
    throw new Error(`Could not remove that activity: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

export type ListActivityEventsOptions = {
  profileId?: string;
  from?: string;
  to?: string;
  includePast?: boolean;
  // The clock enters as a PARAMETER rather than as a fresh Date inside the filter, so one render
  // judges every event against the same instant — the rule lib/visits/progress.ts and
  // appointmentViewState() both follow.
  asOf?: Date;
};

// UPCOMING FIRST AND UPCOMING ONLY, unless asked otherwise. A module whose landing page opens on
// last season's games is a module nobody opens twice (08-youth-activities.md §Step 2).
export async function listActivityEvents(
  wardId: string,
  options: ListActivityEventsOptions = {},
  client?: SupabaseClient<Database>,
): Promise<ActivityEvent[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("activity_events")
    .select(ACTIVITY_EVENT_COLUMNS)
    .eq("ward_id", wardId);

  if (options.profileId !== undefined) query = query.eq("profile_id", options.profileId);
  if (options.from !== undefined) query = query.gte("event_date", options.from);
  if (options.to !== undefined) query = query.lte("event_date", options.to);

  // Filtered in the DATABASE, not after the fetch. A list narrowed in the client answers a
  // different question from the one the count beside it claims to answer
  // (plans/retros/roster-b-picker-and-orgs.md).
  if (options.includePast !== true) {
    query = query.gte("event_date", (options.asOf ?? new Date()).toISOString());
  }

  // Ascending, because "upcoming" reads soonest-first. The widened list keeps the same order
  // rather than reversing, so includePast extends what is on screen backwards instead of
  // rearranging it.
  const { data, error } = await query.order("event_date", { ascending: true });

  if (error) {
    console.error(`Could not list activity events — ${error.message}`, { wardId });
    throw new Error(`Could not load the activity events: ${error.message}`);
  }

  return (data ?? []).map(mapActivityEventRow);
}

export async function getActivityEvent(
  wardId: string,
  eventId: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityEvent | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_events")
    .select(ACTIVITY_EVENT_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read an activity event — ${error.message}`, { wardId, eventId });
    throw new Error(`Could not load that event: ${error.message}`);
  }

  return data === null ? null : mapActivityEventRow(data);
}

// `calendar_id` IS ALWAYS NULL HERE. A hand-entered event belongs to no calendar, and slice B's
// idempotent re-import matches rows against the calendar they came from — so a manual entry must
// never look like something a feed produced, or re-importing would silently overwrite work
// somebody typed in by hand.
//
// `status` is always 'upcoming' on creation. Nothing else is a fact at the moment of entry: a
// cancellation has not happened yet, and "completed" is the clock's business.
export async function createActivityEvent(
  wardId: string,
  input: CreateActivityEventInput,
  client?: SupabaseClient<Database>,
): Promise<ActivityEvent> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_events")
    .insert({
      ward_id: wardId,
      calendar_id: null,
      profile_id: input.profileId,
      title: input.title,
      event_type: input.eventType,
      event_date: input.eventDate,
      location: input.location ?? null,
      status: "upcoming",
    })
    .select(ACTIVITY_EVENT_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create an activity event — ${error.message}`, {
      wardId,
      profileId: input.profileId,
    });
    throw new Error(`Could not save that event: ${error.message}`);
  }

  return mapActivityEventRow(data);
}

export async function updateActivityEvent(
  wardId: string,
  eventId: string,
  input: UpdateActivityEventInput,
  client?: SupabaseClient<Database>,
): Promise<ActivityEvent | null> {
  const supabase = await resolveClient(client);

  const patch: Database["public"]["Tables"]["activity_events"]["Update"] = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.eventDate !== undefined) patch.event_date = input.eventDate;
  if (input.location !== undefined) patch.location = input.location;
  if (input.eventType !== undefined) patch.event_type = input.eventType;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await supabase
    .from("activity_events")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", eventId)
    .select(ACTIVITY_EVENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update an activity event — ${error.message}`, { wardId, eventId });
    throw new Error(`Could not save that event: ${error.message}`);
  }

  return data === null ? null : mapActivityEventRow(data);
}

export async function deleteActivityEvent(
  wardId: string,
  eventId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_events")
    .delete()
    .eq("ward_id", wardId)
    .eq("id", eventId)
    .select("id");

  if (error) {
    console.error(`Could not delete an activity event — ${error.message}`, { wardId, eventId });
    throw new Error(`Could not remove that event: ${error.message}`);
  }

  return (data ?? []).length > 0;
}
