import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { isPolicyRefusal } from "@/lib/youth/policyRefusal";
import type { EventParticipation, RosterMember } from "@/lib/youth/roster";

// Data access for `activity_roster` and `activity_event_participation` (migration 062).
//
// ---------------------------------------------------------------------------
// SERVER-ONLY. THE PURE HALF IS lib/youth/roster.ts AND THE SPLIT IS THE POINT.
// ---------------------------------------------------------------------------
// This file imports createServerSupabaseClient, which imports next/headers. YouthOverview,
// EventList and ActivityCalendar all render the WINDOW ARITHMETIC in the browser, so that half
// lives in lib/youth/roster.ts and imports nothing from here. One import in the wrong direction
// pulls next/headers into the client bundle and breaks the page — youth-c recorded that
// `npm run build` caught exactly that where lint, typecheck and 2982 tests did not.
// Do not merge the two files. lib/youth/coverage.ts and lib/youth/attendees.ts are the same pair.
//
// ---------------------------------------------------------------------------
// EVERY FUNCTION TAKES THE CALLER'S SESSION CLIENT, AND NOTHING BRANCHES ON A ROLE
// ---------------------------------------------------------------------------
// Migration 062f's policies are ward-wide on all four verbs for both tables, and they are what
// decide. A bishopric member and an org secretary run the same statement and the database answers
// the same way — which is the point of 062f's second reason: NO POLICY MOVED, so anybody who
// could record an absence yesterday can record one today (CLAUDE.md rule 2).
//
// THIS MODULE NEVER SELECTS FROM `activity_private_notes`, AND NEVER IMPORTS THE MODULE THAT
// DOES. Being on the same roster as somebody changes nothing about CLAUDE.md rule 5 — the
// sentence lib/youth/queries.ts and lib/youth/attendees.ts both carry applies here unchanged.

// ONE STRING LITERAL ON ONE LINE. A `+` concatenation widens the type to `string` and defeats
// supabase-js's literal parsing of the select list, silently degrading every row to something
// untyped (plans/retros/calendar-a-rules-and-api.md).
//
// THE MEMBER EMBED IS NAMED, which is required rather than tidy: naming the foreign key says
// which join this column follows, so a second one added to `members` later cannot silently change
// what it means. visits-d and ACTIVITY_PROFILE_COLUMNS both record the same trap.
const ROSTER_COLUMNS =
  "id, profile_id, member_id, started_on, ended_on, added_by, created_at, members!activity_roster_member_id_ward_id_fkey (first_name, last_name)";

// No embed at all: participation is read by the thousand across a whole schedule, and the only
// thing any caller does with it is match a member id it already has.
const PARTICIPATION_COLUMNS = "id, event_id, member_id, taking_part, recorded_by, created_at";

type RosterMemberRow = {
  id: string;
  profile_id: string;
  member_id: string;
  started_on: string | null;
  ended_on: string | null;
  added_by: string | null;
  created_at: string;
  members: { first_name: string; last_name: string } | null;
};

type ParticipationRow = {
  id: string;
  event_id: string;
  member_id: string;
  taking_part: boolean;
  recorded_by: string | null;
  created_at: string;
};

// A truthful placeholder rather than an empty string, so a name that DID go missing reads as
// missing rather than as a blank line — mapActivityProfileRow's rule. The embed is null only when
// RLS hid the member row, which the ward-scoped `members` policy makes impossible for anybody who
// could read the roster row.
const UNKNOWN_MEMBER = "A member";

function mapRosterRow(row: RosterMemberRow): RosterMember {
  const member = row.members;

  return {
    rosterId: row.id,
    profileId: row.profile_id,
    memberId: row.member_id,
    memberName:
      member === null ? UNKNOWN_MEMBER : `${member.first_name} ${member.last_name}`.trim(),
    startedOn: row.started_on,
    endedOn: row.ended_on,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// EVERY ROSTER ROW IN THE WARD, IN ONE QUERY.
//
// /youth, /youth/profiles and /youth/calendar each need the WHOLE set — /youth groups its cards by
// membership, /youth/profiles renders a panel per team, and the calendar derives an expected list
// per card — so a per-profile query would be one round trip per team on every one of them. That is
// listAttendeesForEvents()'s reasoning, and MonthGrid's: "a grid that fetches per cell is six
// round trips to draw one month".
//
// Ordered explicitly. These tables are shared by every suite running against the hosted project
// and heap order shifts under them (plans/retros/route-tests-and-realtime.md).
export async function listRosterForWard(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<RosterMember[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_roster")
    .select(ROSTER_COLUMNS)
    .eq("ward_id", wardId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`Could not list the activity roster — ${error.message}`, { wardId });
    throw new Error(`Could not load who is on each activity: ${error.message}`);
  }

  return ((data ?? []) as unknown as RosterMemberRow[]).map(mapRosterRow);
}

// One team's roster. A convenience over the ward-wide read for the routes, which need to know
// whether one member is already on one team — never used by a PAGE, which wants the whole set.
export async function listRosterForProfile(
  wardId: string,
  profileId: string,
  client?: SupabaseClient<Database>,
): Promise<RosterMember[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_roster")
    .select(ROSTER_COLUMNS)
    .eq("ward_id", wardId)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`Could not list a team's roster — ${error.message}`, { wardId, profileId });
    throw new Error(`Could not load who is on that activity: ${error.message}`);
  }

  return ((data ?? []) as unknown as RosterMemberRow[]).map(mapRosterRow);
}

// Null for a row this caller cannot see, which after migration 062f means "not in your ward". The
// route turns that into a 404 with a sentence.
export async function getRosterMember(
  wardId: string,
  rosterId: string,
  client?: SupabaseClient<Database>,
): Promise<RosterMember | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_roster")
    .select(ROSTER_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", rosterId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a roster row — ${error.message}`, { wardId, rosterId });
    throw new Error(`Could not load that roster entry: ${error.message}`);
  }

  return data === null ? null : mapRosterRow(data as unknown as RosterMemberRow);
}

// ONE QUERY FOR A WHOLE SCREEN, keyed back by event — exactly as lib/youth/attendees.ts reads its
// rows, and for the same reason: /youth/calendar renders a month and /youth renders a season, so
// an N+1 here is the whole page rather than one row of it.
//
// An empty `eventIds` returns an empty Map WITHOUT QUERYING: `.in("event_id", [])` is a round trip
// to learn nothing.
export async function listParticipationForEvents(
  wardId: string,
  eventIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<Map<string, EventParticipation[]>> {
  const byEvent = new Map<string, EventParticipation[]>();
  if (eventIds.length === 0) return byEvent;

  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_event_participation")
    .select(PARTICIPATION_COLUMNS)
    .eq("ward_id", wardId)
    .in("event_id", eventIds as string[])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`Could not read activity participation — ${error.message}`, { wardId });
    throw new Error(`Could not load who is taking part: ${error.message}`);
  }

  for (const row of (data ?? []) as unknown as ParticipationRow[]) {
    const entry: EventParticipation = { memberId: row.member_id, takingPart: row.taking_part };
    const existing = byEvent.get(row.event_id);

    if (existing) existing.push(entry);
    else byEvent.set(row.event_id, [entry]);
  }

  return byEvent;
}

const UNIQUE_VIOLATION = "23505";

// A DUPLICATE MUST REACH THE ROUTE AS A SENTENCE, NOT AS A CONSTRAINT VIOLATION.
//
// Migration 062a's unique index on `(profile_id, member_id)` is what stops a double tap on a slow
// phone doubling a young person in every denominator on /youth. What a leader needs to be told is
// "they are already on this team", which is a fact they can act on; "duplicate key value violates
// unique constraint" is not (CLAUDE.md rule 7). So the two failures are DISCRIMINATED rather than
// both throwing, and the route answers 409 on one and 404 on the other.
export type AddRosterMemberResult =
  | { ok: true; member: RosterMember }
  | { ok: false; reason: "already_on_roster" }
  | { ok: false; reason: "refused" };

export async function addRosterMember(
  wardId: string,
  input: {
    profileId: string;
    memberId: string;
    startedOn: string | null;
    // From the SESSION, never from a request body — the rule lib/validation/youth.ts's header
    // states for `wardId` and `enteredBy`. Nullable for 062a's reason: a leader being released
    // must not take the roster with them.
    addedBy: string | null;
  },
  client?: SupabaseClient<Database>,
): Promise<AddRosterMemberResult> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_roster")
    .insert({
      ward_id: wardId,
      profile_id: input.profileId,
      member_id: input.memberId,
      started_on: input.startedOn,
      added_by: input.addedBy,
    })
    .select(ROSTER_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: "already_on_roster" };

    // Unlike an UPDATE or a DELETE, a REFUSED INSERT RAISES — there is no zero-row shape to
    // detect. 42501 is mapped here so "the policy said no" reaches the caller as the same 404 a
    // missing row gets, rather than as a 500 reading "Please try again", which would be untrue:
    // trying again cannot work (defect 060-D2, and isPolicyRefusal's header argues it in full).
    if (isPolicyRefusal(error)) {
      console.warn(`Policy refused a roster insert`, { wardId, profileId: input.profileId });
      return { ok: false, reason: "refused" };
    }

    console.error(`Could not add a roster member — ${error.message}`, {
      wardId,
      profileId: input.profileId,
    });
    throw new Error(`Could not add them to that activity: ${error.message}`);
  }

  return { ok: true, member: mapRosterRow(data as unknown as RosterMemberRow) };
}

export type RosterWindowPatch = {
  startedOn?: string | null;
  endedOn?: string | null;
};

// Returns null when the row did not change, which from here is indistinguishable from a row RLS
// refused — an RLS-denied UPDATE is a zero-row success, not an error
// (plans/retros/foundation-c-services.md). The route turns that into a 404.
//
// isPolicyRefusal() puts a 42501 RAISE on the same path, so both kinds of "not yours" give the
// caller one sentence. Migration 062f's UPDATE policy carries the same predicate in USING and
// WITH CHECK, so there is no divergent shape here today — but the mapping is applied anyway,
// because defect 060-D2 was exactly a write that had never needed it until a policy changed.
export async function updateRosterMember(
  wardId: string,
  rosterId: string,
  patch: RosterWindowPatch,
  client?: SupabaseClient<Database>,
): Promise<RosterMember | null> {
  const supabase = await resolveClient(client);

  const update: Database["public"]["Tables"]["activity_roster"]["Update"] = {};
  if (patch.startedOn !== undefined) update.started_on = patch.startedOn;
  if (patch.endedOn !== undefined) update.ended_on = patch.endedOn;

  const { data, error } = await supabase
    .from("activity_roster")
    .update(update)
    .eq("ward_id", wardId)
    .eq("id", rosterId)
    .select(ROSTER_COLUMNS)
    .maybeSingle();

  if (isPolicyRefusal(error)) {
    console.warn(`Policy refused a roster update`, { wardId, rosterId });
    return null;
  }

  if (error) {
    console.error(`Could not update a roster row — ${error.message}`, { wardId, rosterId });
    throw new Error(`Could not save that change: ${error.message}`);
  }

  return data === null ? null : mapRosterRow(data as unknown as RosterMemberRow);
}

// FALSE MEANS REFUSED, NOT "NOTHING TO DO", exactly as removeAttendee has it: an RLS-denied DELETE
// is a zero-row success rather than an error (CLAUDE.md §8), so the route must say so plainly
// instead of reporting a success that did not happen.
//
// THE ONLY CASCADE IS PARTICIPATION MARKERS. Unlike youth-h's `Remove` on a whole activity, this
// destroys NOTHING A PERSON WROTE: follow-ups (`activity_logs`) and private notes hang off
// EVENTS, not off a roster row, so they survive untouched. The route's header states this at
// length, because it is why this delete needs no 409 where that one does.
export async function deleteRosterMember(
  wardId: string,
  rosterId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_roster")
    .delete()
    .eq("ward_id", wardId)
    .eq("id", rosterId)
    .select("id");

  if (error) {
    console.error(`Could not remove a roster row — ${error.message}`, { wardId, rosterId });
    throw new Error(`Could not take them off that activity: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

// AN UPSERT ON THE `(event_id, member_id)` UNIQUE INDEX, so a double tap on a slow phone writes
// ONE row rather than raising on the second — 056b's reason for its unique index, restated on a
// control a leader presses from a card in a list.
//
// It also means "they are not taking part" and "they are taking part after all" are ONE statement
// rather than an insert and an update the caller has to choose between.
export async function setParticipation(
  wardId: string,
  input: {
    eventId: string;
    memberId: string;
    takingPart: boolean;
    recordedBy: string | null;
  },
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_event_participation")
    .upsert(
      {
        ward_id: wardId,
        event_id: input.eventId,
        member_id: input.memberId,
        taking_part: input.takingPart,
        recorded_by: input.recordedBy,
      },
      { onConflict: "event_id,member_id" },
    )
    .select("id");

  if (isPolicyRefusal(error)) {
    console.warn(`Policy refused a participation write`, { wardId, eventId: input.eventId });
    return false;
  }

  if (error) {
    console.error(`Could not record participation — ${error.message}`, {
      wardId,
      eventId: input.eventId,
    });
    throw new Error(`Could not record whether they are taking part: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

// THE DELETE THAT MEANS "NOBODY HAS SAID", and it breaks no rule.
//
// Migration 060a's "never a delete" protects A RECORD SOMEBODY WROTE. This row holds no text, no
// account and no author's words — it is a MARKER, and removing it is precisely the third state
// (migration 062d). It is what gives the control a way back that is not the OPPOSITE CLAIM:
// pressing the active answer again clears to "nobody has said" rather than asserting they were
// there, which is migration 061's reversibility rule kept verbatim.
//
// TRUE EVEN WHEN THERE WAS NO ROW. Clearing an answer nobody gave is the state the caller wanted,
// so it is a success rather than a 404 — the same reading addAttendee gives its unique violation.
export async function clearParticipation(
  wardId: string,
  eventId: string,
  memberId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { error } = await supabase
    .from("activity_event_participation")
    .delete()
    .eq("ward_id", wardId)
    .eq("event_id", eventId)
    .eq("member_id", memberId);

  if (error) {
    console.error(`Could not clear participation — ${error.message}`, { wardId, eventId });
    throw new Error(`Could not clear that answer: ${error.message}`);
  }

  return true;
}
