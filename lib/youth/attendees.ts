import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// Who is going to an event.
//
// THIS MODULE NEVER SELECTS FROM `activity_private_notes`, AND NEVER IMPORTS THE MODULE THAT
// WILL. Migration 009 gives that table the same author-only shape as visit_private_notes, and
// being down for the same game as somebody changes nothing about CLAUDE.md rule 5. The sentence
// lib/youth/queries.ts and lib/visits/participants.ts both carry applies here unchanged.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. The COVERAGE
// arithmetic that reads these counts is in lib/youth/coverage.ts, which is client-importable on
// purpose — do not merge the two files.
//
// ---------------------------------------------------------------------------
// AN ATTENDEE IS A USER, NOT A MEMBER
// ---------------------------------------------------------------------------
// `users` and `members` are UNRELATED ROWS in this schema — there is no users.member_id, and a
// leader and their own member record are two different things. lib/visits/participants.ts's
// header states this and calls it the single most common wrong assumption in this codebase.
// `activity_attendees.user_id` references `users`, so the picker for it is a list of ACCOUNTS,
// and MemberPicker is the wrong control however convenient it looks.
//
// Every write below runs under the CALLER'S OWN CLIENT, so migration 056c's policies decide.
// Nothing here branches on a role: a bishopric member and an org secretary run the same statement
// and the database answers differently (CLAUDE.md rule 2).

export type ActivityAttendee = {
  id: string;
  eventId: string;
  userId: string;
  displayName: string;
  // Null means the person added THEMSELVES. A name here means somebody asked them, and the card
  // says which — "asked by Bishop Reyes" reads differently from a volunteer, and a leader
  // deciding whether to step in needs the difference.
  assignedBy: string | null;
  assignedByName: string | null;
  // Slice D. NULL MEANS NOBODY HAS SAID EITHER WAY, and it is a third state rather than a
  // defaulted false: "did not go" is a fact somebody stated, and reading it out of an unanswered
  // column would put words in their mouth on a tile that renders "Did not attend" in a warning
  // tone. The column has existed with no writer since Foundation B; migration 056c narrowed its
  // UPDATE policy in advance, naming this slice.
  confirmedAttendance: boolean | null;
};

// ONE STRING LITERAL ON ONE LINE. A `+` concatenation widens the type to `string` and defeats
// supabase-js's literal parsing of the select list, degrading every row to something untyped
// (plans/retros/calendar-a-rules-and-api.md).
//
// BOTH EMBEDS ARE NAMED, and naming them is REQUIRED rather than tidy: there are two foreign keys
// from this table to `users` (`user_id` and `assigned_by`), so an inferred embed is ambiguous and
// PostgREST refuses it. visits-d recorded the same trap.
//
// ONLY THE ID AND THE NAME COME BACK FROM `users`. Not an email, not a phone, not a role. A
// visit_participants rule that applies here unchanged: this is a display of who is going, and
// every other column on `users` has its own read path and its own permission behind it.
const ATTENDEE_COLUMNS =
  "id, event_id, user_id, assigned_by, confirmed_attendance, assigned_by_user:users!activity_attendees_assigned_by_ward_id_fkey (id, first_name, last_name), attending_user:users!activity_attendees_user_id_ward_id_fkey (id, first_name, last_name)";

type AttendeeUserEmbed = {
  id: string;
  first_name: string | null;
  last_name: string | null;
} | null;

type ActivityAttendeeRow = {
  id: string;
  event_id: string;
  user_id: string;
  assigned_by: string | null;
  confirmed_attendance: boolean | null;
  attending_user: AttendeeUserEmbed;
  assigned_by_user: AttendeeUserEmbed;
};

// A row whose join came back empty is a person whose `users` row was deleted since. "Someone"
// beats a blank: the event still records that a person was going, and losing that would quietly
// change what the record says. mapParticipantRow does exactly this.
const UNKNOWN_ATTENDEE = "Someone";

function fullName(embed: AttendeeUserEmbed): string {
  return `${embed?.first_name ?? ""} ${embed?.last_name ?? ""}`.trim();
}

function mapAttendeeRow(row: ActivityAttendeeRow): ActivityAttendee {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    displayName: fullName(row.attending_user) || UNKNOWN_ATTENDEE,
    assignedBy: row.assigned_by,
    assignedByName:
      row.assigned_by === null ? null : fullName(row.assigned_by_user) || UNKNOWN_ATTENDEE,
    confirmedAttendance: row.confirmed_attendance,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// ONE QUERY FOR A WHOLE SCREEN, keyed back by event. Not one per card: /youth/calendar renders a
// month and /youth renders the upcoming season, so an N+1 here is the whole page rather than one
// row of it. MonthGrid's header records the same rule — "a grid that fetches per cell is six
// round trips to draw one month".
//
// An empty `eventIds` returns an empty Map WITHOUT QUERYING: `.in("event_id", [])` is a round
// trip to learn nothing.
export async function listAttendeesForEvents(
  wardId: string,
  eventIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<Map<string, ActivityAttendee[]>> {
  const byEvent = new Map<string, ActivityAttendee[]>();
  if (eventIds.length === 0) return byEvent;

  const supabase = await resolveClient(client);

  // Ordered explicitly, because these tables are shared by every suite running against the hosted
  // project and heap order shifts under them (plans/retros/route-tests-and-realtime.md).
  const { data, error } = await supabase
    .from("activity_attendees")
    .select(ATTENDEE_COLUMNS)
    .eq("ward_id", wardId)
    .in("event_id", eventIds as string[])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`Could not read activity attendees — ${error.message}`, { wardId });
    throw new Error(`Could not load who is going: ${error.message}`);
  }

  for (const row of (data ?? []) as unknown as ActivityAttendeeRow[]) {
    const attendee = mapAttendeeRow(row);
    const existing = byEvent.get(row.event_id);

    if (existing) existing.push(attendee);
    else byEvent.set(row.event_id, [attendee]);
  }

  return byEvent;
}

export type AddAttendeeInput = {
  eventId: string;
  userId: string;
  // Null on a self-add, and that null is the RECORD OF HOW THE ROW CAME TO EXIST. No policy reads
  // it (migration 056c says why); the route writes it and the card renders it.
  assignedBy: string | null;
};

const UNIQUE_VIOLATION = "23505";

// NULL MEANS "ALREADY DOWN FOR THIS ONE", NOT AN ERROR. Migration 056b's unique index is what
// makes a double tap on a slow phone — the ordinary case in this module — into a refused second
// row rather than a doubled coverage count. The route turns this null into a 200 with a plain
// sentence, because being already down for an event is the state the caller wanted.
export async function addAttendee(
  wardId: string,
  input: AddAttendeeInput,
  client?: SupabaseClient<Database>,
): Promise<ActivityAttendee | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_attendees")
    .insert({
      ward_id: wardId,
      event_id: input.eventId,
      user_id: input.userId,
      assigned_by: input.assignedBy,
    })
    .select(ATTENDEE_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;

    console.error(`Could not add an activity attendee — ${error.message}`, {
      wardId,
      eventId: input.eventId,
    });
    throw new Error(`Could not save who is going: ${error.message}`);
  }

  return mapAttendeeRow(data as unknown as ActivityAttendeeRow);
}

// FALSE MEANS REFUSED, NOT "NOTHING TO DO". An RLS-denied DELETE is a zero-row success rather
// than an error (CLAUDE.md §8), so the route must say so plainly instead of reporting a success
// that did not happen. A caller removing a row that was never there gets the same false, which is
// the right answer to show them too — the screen they were looking at was stale.
export async function removeAttendee(
  wardId: string,
  eventId: string,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_attendees")
    .delete()
    .eq("ward_id", wardId)
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.error(`Could not remove an activity attendee — ${error.message}`, {
      wardId,
      eventId,
    });
    throw new Error(`Could not update who is going: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

// "I went" / "I did not go", written after the game.
//
// FALSE MEANS REFUSED, NOT "NOTHING TO DO", exactly as removeAttendee has it: an RLS-denied UPDATE
// is a zero-row success rather than an error (CLAUDE.md §8), so the route must say so plainly
// instead of reporting a success that did not happen. A caller with no attendee row for the event
// gets the same false, which is also the right answer to show them — the screen they were looking
// at was stale.
//
// NOTHING HERE BRANCHES ON A ROLE. Migration 056c's UPDATE policy is
// `is_bishopric() or user_id = auth.uid()`, and it decides: a bishopric member and an org
// secretary run the same statement and the database answers differently (CLAUDE.md rule 2).
export async function setConfirmedAttendance(
  wardId: string,
  eventId: string,
  userId: string,
  confirmed: boolean,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_attendees")
    .update({ confirmed_attendance: confirmed })
    .eq("ward_id", wardId)
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.error(`Could not record attendance — ${error.message}`, { wardId, eventId });
    throw new Error(`Could not record whether you went: ${error.message}`);
  }

  return (data ?? []).length > 0;
}
