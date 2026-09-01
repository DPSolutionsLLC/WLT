import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  CreateActivityEventInput,
  CreateActivityProfileInput,
  UpdateActivityEventInput,
  UpdateActivityProfileInput,
} from "@/lib/validation/youth";
import type { Database } from "@/types/database";
import { isPolicyRefusal } from "@/lib/youth/policyRefusal";
import type { RosterMember } from "@/lib/youth/roster";
import {
  addRosterMember,
  listRosterForProfile,
  listRosterForWard,
} from "@/lib/youth/rosterQueries";
import type {
  ActivitySourceType,
  ActivityType,
  EventStatus,
  EventType,
} from "@/types/domain";

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

// `eventId` and `loggedBy` are NOT NULL as of migration 057a. They were nullable in migration 009
// only because Foundation B created every table before anything wrote to one — a log with no event
// is not a follow-up, and a log with no author cannot be edited by anybody, since every write
// policy names `logged_by`.
export type ActivityLog = {
  id: string;
  eventId: string;
  // WHO TYPED IT IN. `activity_logs` has no participants table and no equivalent of
  // `visit_participants`, so unlike a visit there is no separate record of who was actually
  // there. A feed tile must not present this under the same label a visit's "who went" uses
  // (lib/reports/types.ts).
  loggedBy: string;
  sharedNotes: string | null;
  flaggedForWardCouncil: boolean;
  // NEVER SET FROM A REQUEST BODY. lib/youth/activityLogs.ts takes it as a separate parameter to
  // its update for that reason: a body that could stamp its own would be able to silence the
  // ward-council notification. It is on the read shape because the route needs it to decide
  // whether a re-flag notifies again (07-visits.md §Step 3).
  flagSentAt: string | null;
  createdAt: string;
};

type ActivityLogRow = {
  id: string;
  event_id: string;
  logged_by: string;
  shared_notes: string | null;
  flagged_for_ward_council: boolean;
  flag_sent_at: string | null;
  created_at: string;
};

// One string literal on ONE line, never a `+` concatenation — concatenation widens the type to
// `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md).
const ACTIVITY_LOG_COLUMNS =
  "id, event_id, logged_by, shared_notes, flagged_for_ward_council, flag_sent_at, created_at";

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

// Null, not an error, for a log this caller cannot see. This header anticipated slice D and slice
// D is what happened: migration 057c replaced migration 019's plain ward-scoped select with
// `is_bishopric() or logged_by = auth.uid() or activity_event_is_in_caller_org(event_id) or
// ward_allows_cross_org_visibility()`, and NOT A LINE OF THIS FUNCTION CHANGED — the caller's
// session client is what runs the query, so the narrower policy narrows this for free.
//
// That is also what makes app/api/reports/read-status/route.ts's `youth_activity` entry correct
// after the narrowing rather than merely still compiling: "may this caller see this report?" is
// answered by the policy, through this call.
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

// ---------------------------------------------------------------------------
// THIS ROW IS A **TEAM** NOW, NOT ONE YOUNG PERSON'S COPY OF ONE (migration 062)
// ---------------------------------------------------------------------------
// It used to hold `member_id`: one row per (member, activity), so eight players on a twelve-game
// season meant eight profiles, eight imports of the same file and 96 rows for 12 real games. The
// column is gone and `activity_roster` answers "who is on this" instead — import once, assign
// each youth once, and everything after that is an exception (ITER-033).
//
// THE TABLE IS NOT RENAMED, and a reader of `git log` should know that is deliberate rather than
// half-finished: 191 references across 34 source files make a rename pure churn that would bury
// the real change in a diff nobody can read (migration 062's header).
export type ActivityProfile = {
  id: string;
  // WHO IS ON THIS TEAM, and the window each of them was on it for. Attached by the MAPPER from
  // lib/youth/rosterQueries.ts rather than fetched as a nested two-level PostgREST embed: the
  // ward-wide roster list is needed WHOLE by /youth, /youth/profiles and /youth/calendar anyway,
  // so one query serves all three, and a nested embed under an existing aggregate embed is
  // markedly harder to type than the flat one it would replace.
  roster: RosterMember[];
  orgId: string | null;
  activityName: string;
  schoolOrg: string | null;
  activityType: ActivityType;
  seasonSchedule: string | null;
  notes: string | null;
  enteredBy: string | null;
  // Migration 060. NULL MEANS THE SEASON IS RUNNING, which is the ordinary state of every profile
  // and the state every row already in the database reads as — the same absent-means-default
  // idiom as `org_id` (054a) and `occasion_id` (059b), so no ward's /youth moved when it shipped.
  //
  // A TIMESTAMP RATHER THAN A BOOLEAN, because the history page asks WHEN the season ended: the
  // final percentage is recomputed against this instant rather than stored. Setting it back to
  // null reopens the season, which is what makes a mistake recoverable and is why closing is
  // offered where deleting used to be.
  closedAt: string | null;
  // THE TRUE COUNT OF EVENTS ON THIS ACTIVITY, past ones included — an embedded PostgREST count,
  // not the length of whatever list the page happened to load.
  //
  // IT IS WHAT GATES `Remove`. ActivityProfileList renders that control only at zero, and the gate
  // is EXACT rather than approximate: `activity_logs.event_id` has been NOT NULL since migration
  // 057a and references `activity_events`, so no events implies no follow-ups. The comment in
  // ActivityProfileList predicted this field by name — "a true count means an embedded count on a
  // shared query plus its type, mapper and route" — and deferred it to ITER-031, which is here.
  eventCount: number;
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
  // Migration 055. An all-day entry is stored at ward midnight because `event_date` is a
  // timestamptz and there is nowhere else to put it — and a midnight instant read back without
  // this flag is indistinguishable from a 7:30pm game converted through the wrong zone. The
  // marker is what keeps a real timezone bug legible.
  allDay: boolean;
  // Null on a hand-entered event, and that is the whole point: slice B's re-import matches on
  // (calendar_id, source_uid, source_recurrence_id), so a manual entry can never be overwritten
  // by a feed. `sourceRecurrenceId` is the occurrence's own DTSTART for an expanded series and
  // null for a one-off.
  sourceUid: string | null;
  sourceRecurrenceId: string | null;
  // Migration 059. NULL MEANS THIS GAME IS ONLY THIS YOUNG PERSON'S, and that is the ordinary
  // state of nearly every row — the same absent-means-default idiom as `org_id` on a profile.
  // A non-null id says two or more rows are the SAME EVENING, recorded explicitly by a person
  // rather than inferred from a matching title and date.
  occasionId: string | null;
  // `youthAttended` IS GONE FROM HERE — MOVED, NOT DELETED (migrations 062d/062e/063).
  //
  // Migration 061 put it on this row, which was correct only while an event belonged to exactly
  // ONE young person. A team's event serves a whole roster, so marking one player absent would
  // have marked everybody at the same game. The fact now lives on
  // `activity_event_participation` — one row per (young person, event), with the ABSENCE of a row
  // meaning "nobody has said". lib/youth/roster.ts derives it per young person.
  createdAt: string;
};

// A schedule feed, hanging off one activity profile. One row per profile per source type, which
// is what makes "re-import" mean something without asking a leader which of three calendars they
// meant (slice B, Decision 5).
export type ActivityCalendar = {
  id: string;
  profileId: string;
  sourceType: ActivitySourceType;
  sourceUrl: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
};

// `member_id` AND ITS `members!…` EMBED ARE GONE (migration 062/063). The team's people come from
// `activity_roster`, attached by the mapper — see ActivityProfile.roster for why that rather than
// a nested embed.
//
// ONE STRING LITERAL ON ONE LINE. A concatenation widens the type to `string` and defeats
// supabase-js's literal parsing of the select list, degrading every row to something untyped
// (plans/retros/calendar-a-rules-and-api.md).
//
// THE EMBEDDED COUNT IS NAMED, and it STAYS: there is exactly one foreign key from
// `activity_events` to this table today, and a second one added later would make an inferred
// embed silently mean something else. It counts EVERY event on the profile, past ones included,
// because that is what the `Remove` gate has to be exact about (youth-h).
const ACTIVITY_PROFILE_COLUMNS =
  "id, org_id, activity_name, school_org, activity_type, season_schedule, notes, entered_by, closed_at, created_at, activity_events!activity_events_profile_id_ward_id_fkey (count)";

// ONE STRING LITERAL ON ONE LINE, still, now that it has grown four columns. A `+`
// concatenation widens the type to `string` and defeats supabase-js's literal parsing of the
// select list, silently degrading every row to something untyped
// (plans/retros/calendar-a-rules-and-api.md).
const ACTIVITY_EVENT_COLUMNS =
  "id, profile_id, calendar_id, title, event_type, event_date, location, status, all_day, source_uid, source_recurrence_id, occasion_id, created_at";

const ACTIVITY_CALENDAR_COLUMNS =
  "id, profile_id, source_type, source_url, last_synced_at, created_at";

type ActivityProfileRow = {
  id: string;
  org_id: string | null;
  activity_name: string;
  school_org: string | null;
  activity_type: string;
  season_schedule: string | null;
  notes: string | null;
  entered_by: string | null;
  closed_at: string | null;
  created_at: string;
  // PostgREST returns an aggregate embed as an ARRAY of one object, and as an EMPTY ARRAY for a
  // profile with no events at all. Both shapes are spelled out here so the mapper handles the
  // empty case on purpose rather than by a `?? 0` that would also swallow a shape change.
  activity_events: { count: number }[];
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
  all_day: boolean;
  source_uid: string | null;
  source_recurrence_id: string | null;
  occasion_id: string | null;
  created_at: string;
};

type ActivityCalendarRow = {
  id: string;
  profile_id: string;
  source_type: string;
  source_url: string | null;
  last_synced_at: string | null;
  created_at: string;
};

// snake_case to camelCase happens HERE and nowhere else (CLAUDE.md §6).
//
// THE ROSTER IS PASSED IN RATHER THAN READ OFF THE ROW, because it comes from a different table
// and a different query. Every caller below resolves it once and hands it here, so there is one
// place a profile becomes an ActivityProfile and no caller assembles a partial one.
//
// AN EMPTY ROSTER IS A REAL AND EXPECTED ANSWER — a team imported but not yet assigned — so the
// default is `[]` rather than something that would read as missing data. What must never happen
// is that emptiness being read as "nobody is expected"; lib/youth/roster.ts's branch 5 is where
// that is refused, and this default is deliberately not the place to second-guess it.
function mapActivityProfileRow(
  row: ActivityProfileRow,
  roster: RosterMember[] = [],
): ActivityProfile {
  return {
    id: row.id,
    roster,
    orgId: row.org_id,
    activityName: row.activity_name,
    schoolOrg: row.school_org,
    activityType: row.activity_type as ActivityType,
    seasonSchedule: row.season_schedule,
    notes: row.notes,
    enteredBy: row.entered_by,
    closedAt: row.closed_at,
    // MAPPED EXPLICITLY FROM THE EMPTY ARRAY RATHER THAN DEFAULTED. An activity with no events
    // yields `[]`, which is a real and expected answer — the one this field exists to detect —
    // and writing it out means a change in PostgREST's aggregate shape surfaces as a wrong number
    // here rather than as a silent zero that unlocks a destructive control.
    eventCount: row.activity_events[0]?.count ?? 0,
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
    allDay: row.all_day,
    sourceUid: row.source_uid,
    sourceRecurrenceId: row.source_recurrence_id,
    occasionId: row.occasion_id,
    createdAt: row.created_at,
  };
}

function mapActivityCalendarRow(row: ActivityCalendarRow): ActivityCalendar {
  return {
    id: row.id,
    profileId: row.profile_id,
    sourceType: row.source_type as ActivitySourceType,
    sourceUrl: row.source_url,
    lastSyncedAt: row.last_synced_at,
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
//
// EVERY PROFILE, RUNNING AND CLOSED, and it must stay that way. Filtering closed seasons out here
// would remove them from every caller at once — and a young person whose every season is finished
// would then produce no group on /youth and VANISH FROM THE WARD, which is the one thing ITER-028
// says must not happen. The READ PATH decides what to show: YouthOverview groups from all of them
// and computes from the running ones (lib/youth/profileNeed.ts).
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

  // ONE ROSTER QUERY FOR THE WHOLE WARD, grouped here — not one per profile, which would be a
  // round trip per team on a page that renders every team (lib/youth/rosterQueries.ts).
  const roster = await listRosterForWard(wardId, supabase);
  const rosterByProfile = new Map<string, RosterMember[]>();

  for (const membership of roster) {
    const existing = rosterByProfile.get(membership.profileId);
    if (existing) existing.push(membership);
    else rosterByProfile.set(membership.profileId, [membership]);
  }

  return (data ?? []).map((row) =>
    mapActivityProfileRow(row, rosterByProfile.get(row.id) ?? []),
  );
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

  if (data === null) return null;

  return mapActivityProfileRow(data, await listRosterForProfile(wardId, profileId, supabase));
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

  // ---------------------------------------------------------------------
  // THE ROSTER ROWS, AFTER THE PROFILE — TWO TABLES, AND NOT A STORED PROCEDURE
  // ---------------------------------------------------------------------
  // lib/youth/ics/applyImport.ts's reasoning applies unchanged: a partial write leaves a team with
  // a SHORT ROSTER, which the roster panel makes visible and one tap fixes. That is a recoverable
  // state a person can see, which is worth more than the atomicity a procedure would buy — and a
  // procedure would move this logic out of TypeScript and out of RLS's reach.
  //
  // A FAILURE IS SURFACED, NEVER SWALLOWED (CLAUDE.md rule 7). Reporting success on a team whose
  // players were not saved is exactly the silent failure that rule exists to forbid: the leader
  // would walk away believing the assignment was done.
  //
  // AN EMPTY `memberIds` IS NORMAL AND WRITES NOTHING. ITER-033's flow is import once, then
  // assign, so a team with no roster yet is a state every ward passes through — it is made LOUD
  // on the roster panel and on the calendar rather than refused here.
  for (const memberId of input.memberIds) {
    const added = await addRosterMember(
      wardId,
      { profileId: data.id, memberId, startedOn: null, addedBy: userId },
      supabase,
    );

    if (!added.ok) {
      console.error(`Could not add a young person to a new activity — ${added.reason}`, {
        wardId,
        profileId: data.id,
        memberId,
      });
      throw new Error(
        "The activity was saved, but not everybody could be added to it. Open it and add the " +
          "missing young people.",
      );
    }
  }

  return mapActivityProfileRow(data, await listRosterForProfile(wardId, data.id, supabase));
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

  // The WITH CHECK refusal joins the zero-row one rather than becoming a 500 — see
  // isPolicyRefusal(). Logged before it is swallowed, so a policy change still leaves a trace.
  if (isPolicyRefusal(error)) {
    console.warn(`Policy refused an activity profile update`, { wardId, profileId });
    return null;
  }

  if (error) {
    console.error(`Could not update an activity profile — ${error.message}`, {
      wardId,
      profileId,
    });
    throw new Error(`Could not save that activity: ${error.message}`);
  }

  if (data === null) return null;

  return mapActivityProfileRow(data, await listRosterForProfile(wardId, profileId, supabase));
}

// CLOSING A SEASON, AND REOPENING ONE — the same function and the same route, which is what makes
// a mistake recoverable.
//
// `closedAt` is an ISO string to close and NULL to reopen. There is no boolean anywhere on this
// path: the history page recomputes a closed season's final percentage against this instant, so
// the moment is the value rather than a fact about it.
//
// FOLLOWS updateActivityProfile()'S SHAPE EXACTLY, including the zero-row handling — an RLS-denied
// UPDATE is a zero-row success, not an error (plans/retros/foundation-c-services.md), and the
// route turns the null into a 404. Migration 054d's policy is what decides WHICH profiles this
// reaches; there is no branch here and there must not be one (CLAUDE.md rule 2).
export async function closeActivityProfile(
  wardId: string,
  profileId: string,
  closedAt: string | null,
  client?: SupabaseClient<Database>,
): Promise<ActivityProfile | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("youth_activity_profiles")
    .update({ closed_at: closedAt })
    .eq("ward_id", wardId)
    .eq("id", profileId)
    .select(ACTIVITY_PROFILE_COLUMNS)
    .maybeSingle();

  if (isPolicyRefusal(error)) {
    console.warn(`Policy refused an activity profile close`, {
      wardId,
      profileId,
      closing: closedAt !== null,
    });
    return null;
  }

  if (error) {
    console.error(`Could not close an activity profile — ${error.message}`, {
      wardId,
      profileId,
      closing: closedAt !== null,
    });
    throw new Error(`Could not save that activity: ${error.message}`);
  }

  if (data === null) return null;

  return mapActivityProfileRow(data, await listRosterForProfile(wardId, profileId, supabase));
}

// HOW MANY PASTORAL FOLLOW-UPS ARE WRITTEN AGAINST THIS ACTIVITY — the one question the DELETE
// route has to answer before it destroys anything.
//
// IT IS AN RPC RATHER THAN A QUERY, AND THAT IS THE WHOLE POINT. The DELETE policy (054d) and the
// log SELECT policy (057c) are scoped differently — `entered_by = auth.uid()` admits a delete and
// appears nowhere in the read — so a leader who created an activity and has since been recalled to
// a different organization may delete it while being unable to read one follow-up written on it.
// Counting through their client would return zero. Beyond that one case, whether an activity may
// be destroyed is a fact about the ACTIVITY and must not depend on who is looking (migration 056c's
// uniform-evaluability rule). Migration 060b's `security definer` function answers it the same way
// for everybody, returns a COUNT and never a row, and is ward-scoped by `current_ward_id()`.
//
// THE NUMBER IS NEVER DISCLOSED. The route turns "greater than zero" into a 409 naming Close as
// the alternative and stops there: the deleter may not be entitled to know whose follow-ups those
// are or how many (CLAUDE.md rule 5).
export async function countActivityProfileFollowUps(
  profileId: string,
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase.rpc("activity_profile_followup_count", {
    target_profile_id: profileId,
  });

  if (error) {
    console.error(`Could not count follow-ups on an activity — ${error.message}`, { profileId });
    throw new Error(`Could not check that activity's follow-ups: ${error.message}`);
  }

  return data ?? 0;
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
  // Slice B. Narrows to the events one schedule feed produced, which is what the import preview
  // diffs against — a hand-entered event (calendar_id null) is invisible to this filter by
  // construction, and that is exactly the guarantee the re-import needs.
  calendarId?: string;
  // Slice G. Narrows to the rows sharing ONE OCCASION — every young person at the same game.
  // Filtered in the DATABASE like the others below, and carried by
  // listActivityEventsQuerySchema too: a filter parameter the route's schema does not carry is
  // silently ignored, and the page looks filtered without being
  // (plans/retros/roster-b-picker-and-orgs.md).
  occasionId?: string;
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
  if (options.calendarId !== undefined) query = query.eq("calendar_id", options.calendarId);
  if (options.occasionId !== undefined) query = query.eq("occasion_id", options.occasionId);
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
// cancellation has not happened yet, and follow-up is `activity_logs`' business — migration 056a
// removed `completed` from the column for that reason.
//
// `eventType` ARRIVES ALREADY RESOLVED, as a separate parameter rather than off `input`. Slice C
// made it optional on the schema (absent means "decide from the location"), and the route is what
// runs classifyEventLocation over the ward's home venues. Taking it here rather than reading
// `input.eventType` means EXACTLY ONE PLACE decides classification, and a caller that forgot is a
// type error rather than a row silently written `tbd`.
//
// `occasionId` ARRIVES ALREADY RESOLVED TOO, and for exactly that reason. The schema carries
// `occasionWithEventId` — the id of ANOTHER EVENT to share a game with — and the route is what
// turns that into an occasion, creating one and stamping the source row when there is none. Null
// means this game is only this young person's, which is the ordinary case.
export async function createActivityEvent(
  wardId: string,
  input: CreateActivityEventInput,
  eventType: EventType,
  occasionId: string | null,
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
      event_type: eventType,
      event_date: input.eventDate,
      location: input.location ?? null,
      status: "upcoming",
      occasion_id: occasionId,
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
  // NO `youthAttended` HERE ANY MORE. It moved to activity_event_participation (migration 062d)
  // and to PATCH /api/youth/events/[id]/participation, because it is a fact about a YOUNG PERSON
  // AT AN EVENT rather than about the event: a team's game serves a whole roster, and writing it
  // here would have marked everybody at the same game.

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

// ===========================================================================
// Phase 8 slice B — schedule feeds
// ===========================================================================
//
// The SQL for the ICS import lives HERE, following how every other module in this repo splits
// data access from logic. lib/youth/ics/applyImport.ts decides WHAT to write; these four
// functions are the only place that writes it.
//
// `activity_calendars` keeps migration 019's ward-wide policies (migration 055c says why), so
// every one of these runs under the caller's own client and the database decides.

// ONE ICS CALENDAR PER PROFILE (Decision 5). A team has one schedule feed, and that is what makes
// "re-import" a well-defined action rather than a question about which of three calendars was
// meant. `.maybeSingle()` rather than `.single()`: no calendar yet is the ordinary state of a
// first import, not an error.
export async function getIcsCalendarForProfile(
  wardId: string,
  profileId: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityCalendar | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_calendars")
    .select(ACTIVITY_CALENDAR_COLUMNS)
    .eq("ward_id", wardId)
    .eq("profile_id", profileId)
    .eq("source_type", "ics_upload")
    .maybeSingle();

  if (error) {
    console.error(`Could not read an activity calendar — ${error.message}`, {
      wardId,
      profileId,
    });
    throw new Error(`Could not load that activity's schedule feed: ${error.message}`);
  }

  return data === null ? null : mapActivityCalendarRow(data);
}

// `source_url` IS ALWAYS NULL. Slice B uploads a file; it never fetches a URL server-side, which
// would be SSRF surface for no gain 08-youth-activities.md asks for. The column stays for a
// future slice that decides otherwise, and writing null is what says nothing has.
export async function createIcsCalendar(
  wardId: string,
  profileId: string,
  syncedAt: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityCalendar> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_calendars")
    .insert({
      ward_id: wardId,
      profile_id: profileId,
      source_type: "ics_upload",
      source_url: null,
      last_synced_at: syncedAt,
    })
    .select(ACTIVITY_CALENDAR_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create an activity calendar — ${error.message}`, {
      wardId,
      profileId,
    });
    throw new Error(`Could not save that schedule feed: ${error.message}`);
  }

  return mapActivityCalendarRow(data);
}

// WHEN A PERSON LAST IMPORTED, never when a machine did. There is no cron and no scheduled
// re-sync in this project, so this column records a human action or nothing at all.
export async function touchCalendarSyncedAt(
  wardId: string,
  calendarId: string,
  syncedAt: string,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const supabase = await resolveClient(client);

  const { error } = await supabase
    .from("activity_calendars")
    .update({ last_synced_at: syncedAt })
    .eq("ward_id", wardId)
    .eq("id", calendarId);

  if (error) {
    console.error(`Could not stamp an activity calendar — ${error.message}`, {
      wardId,
      calendarId,
    });
    throw new Error(`Could not record that import: ${error.message}`);
  }
}

export type ImportedEventInsert = {
  profileId: string;
  calendarId: string;
  title: string;
  eventDate: string;
  location: string | null;
  allDay: boolean;
  sourceUid: string;
  sourceRecurrenceId: string | null;
  // Slice C. Classified from the location by lib/youth/classifyLocation.ts and carried down from
  // the preview, so the row is written with the home/away the leader READ before confirming —
  // rather than one derived a second time here, where the two could disagree.
  //
  // It is `home` or `tbd` and NEVER `away`: an unmatched location is a question for a person, not
  // evidence of an away game (that function's header argues it in full).
  eventType: EventType;
};

// `status: 'upcoming'` on every imported row — a cancellation has not happened, and it is not
// something a file can assert.
//
// `event_type` IS WRITTEN HERE AND ON NO OTHER PATH. This is an INSERT, which is the only place
// slice C's classification is allowed to reach the column: updateImportedEvent() below never
// touches it, so a correction a person made by hand survives every future re-import (Decision 6).
export async function insertImportedEvents(
  wardId: string,
  rows: readonly ImportedEventInsert[],
  client?: SupabaseClient<Database>,
): Promise<ActivityEvent[]> {
  if (rows.length === 0) return [];

  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_events")
    .insert(
      rows.map((row) => ({
        ward_id: wardId,
        profile_id: row.profileId,
        calendar_id: row.calendarId,
        title: row.title,
        event_type: row.eventType,
        event_date: row.eventDate,
        location: row.location,
        status: "upcoming",
        all_day: row.allDay,
        source_uid: row.sourceUid,
        source_recurrence_id: row.sourceRecurrenceId,
      })),
    )
    .select(ACTIVITY_EVENT_COLUMNS);

  if (error) {
    console.error(`Could not insert imported activity events — ${error.message}`, {
      wardId,
      count: rows.length,
    });
    throw new Error(`Could not save the imported events: ${error.message}`);
  }

  return (data ?? []).map(mapActivityEventRow);
}

export type ImportedEventPatch = {
  title: string;
  eventDate: string;
  location: string | null;
  allDay: boolean;
};

// FOUR COLUMNS AND NO OTHERS (Decision 6). `status` is never touched, so a hand-cancelled game
// stays cancelled; `event_type` is never touched, so a correction a person made by hand survives
// every future re-import. The absence is the feature, which is why the patch is written out field
// by field rather than spread from an input object, and tests/routes/youthCalendarImport.test.ts
// asserts it rather than trusting the shape.
//
// THE PARTICIPATION GUARANTEE IS NOW STRUCTURAL RATHER THAN A DISCIPLINE ABOUT THIS COLUMN LIST.
// Migration 061 put "is the young person taking part?" on `activity_events`, so keeping it out of
// this patch was a rule somebody had to remember. It now lives on a DIFFERENT TABLE
// (activity_event_participation, migration 062d) that this statement cannot reach at all, so a
// young person recorded as not taking part survives every future import of the same file by
// construction.
export async function updateImportedEvent(
  wardId: string,
  eventId: string,
  patch: ImportedEventPatch,
  client?: SupabaseClient<Database>,
): Promise<ActivityEvent | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_events")
    .update({
      title: patch.title,
      event_date: patch.eventDate,
      location: patch.location,
      all_day: patch.allDay,
    })
    .eq("ward_id", wardId)
    .eq("id", eventId)
    .select(ACTIVITY_EVENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update an imported activity event — ${error.message}`, {
      wardId,
      eventId,
    });
    throw new Error(`Could not update that event: ${error.message}`);
  }

  // Null is a row RLS refused, which is a zero-row success rather than an error
  // (plans/retros/foundation-c-services.md). The caller counts what actually changed.
  return data === null ? null : mapActivityEventRow(data);
}
