import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyAppointmentSource } from "@/lib/appointments/myAppointments";
import { appointmentViewState } from "@/lib/visits/appointmentStatus";
import type { Database } from "@/types/database";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/types/domain";

// My Appointments — the three sources, each read for ONE PERSON through the caller's own client.
//
// ---------------------------------------------------------------------------
// THE `user_id` / `made_by` FILTERS HERE ARE THE MEANING, NOT A SECOND COPY OF A POLICY
// ---------------------------------------------------------------------------
// lib/todos/queries.ts deliberately does NOT filter to the owner, because RLS already admits only
// the owner and a redundant filter would mask a policy regression. The visit and youth reads here
// are different: `visit_appointments` and `activity_attendees` are readable well beyond the caller
// (org-wide and ward-wide), and "appointments I made" / "events I signed up for" is the QUESTION,
// not a security boundary. So those two filter to the caller explicitly; the to-do read does not.
//
// Cancelled commitments are excluded here, because a cancelled appointment or a called-off game is
// not something anybody is going to — a fact a person stated, not one the clock decided. Everything
// else reaches buildMyAppointments(), which drops nothing.
//
// All three run together, and ANY error throws: a partial list rendered without saying so would
// tell a leader they are free when they are not (rule 7).
//
// SERVER-ONLY in practice — it takes the server client as a parameter from the page.

type Client = SupabaseClient<Database>;

// One string literal on ONE line each — concatenation widens the type and defeats supabase-js's
// literal parsing of the select list (plans/retros/calendar-a-rules-and-api.md).
const VISIT_COLUMNS =
  "id, scheduled_for, status, households!visit_appointments_household_id_ward_id_fkey (family_name)";
const TODO_COLUMNS =
  "id, title, scheduled_for, completed_at, scheduled_member:members!todos_scheduled_with_member_id_ward_id_fkey (first_name, last_name)";
const YOUTH_COLUMNS =
  "id, activity_events!activity_attendees_event_id_ward_id_fkey (id, title, event_date, all_day, status, youth_activity_profiles!activity_events_profile_id_ward_id_fkey (activity_name))";

type VisitRow = {
  id: string;
  scheduled_for: string;
  status: string;
  households: { family_name: string } | null;
};

type TodoRow = {
  id: string;
  title: string;
  scheduled_for: string | null;
  completed_at: string | null;
  scheduled_member: { first_name: string | null; last_name: string | null } | null;
};

type YouthRow = {
  id: string;
  activity_events: {
    id: string;
    title: string;
    event_date: string;
    all_day: boolean;
    status: string;
    youth_activity_profiles: { activity_name: string } | null;
  } | null;
};

function toAppointmentStatus(value: string): AppointmentStatus {
  if (!(APPOINTMENT_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `visit_appointments.status holds "${value}", which is not a known value. The CHECK ` +
        "constraint and types/domain.ts have drifted.",
    );
  }
  return value as AppointmentStatus;
}

function fullName(row: { first_name: string | null; last_name: string | null } | null): string | null {
  if (row === null) return null;
  const name = [row.first_name, row.last_name].filter((part) => part !== null && part !== "").join(" ");
  return name === "" ? null : name;
}

async function readVisitAppointments(
  supabase: Client,
  wardId: string,
  userId: string,
  asOf: Date,
): Promise<MyAppointmentSource[]> {
  const { data, error } = await supabase
    .from("visit_appointments")
    .select(VISIT_COLUMNS)
    .eq("ward_id", wardId)
    .eq("made_by", userId)
    .neq("status", "cancelled");

  if (error) {
    console.error(`Could not read my visit appointments — ${error.message}`, { wardId });
    throw new Error(`Could not load your visit appointments: ${error.message}`);
  }

  return ((data ?? []) as unknown as VisitRow[]).map((row) => {
    const status = toAppointmentStatus(row.status);
    return {
      kind: "visit",
      id: row.id,
      startsAt: row.scheduled_for,
      allDay: false,
      title:
        row.households === null
          ? "Visit"
          : `Visit — ${row.households.family_name} family`,
      detail: null,
      href: "/visits",
      viewState: appointmentViewState({ status, scheduledFor: row.scheduled_for }, asOf),
    };
  });
}

async function readScheduledTodos(supabase: Client, wardId: string): Promise<MyAppointmentSource[]> {
  // No owner filter — migration 081 admits only the owner (see the header).
  const { data, error } = await supabase
    .from("todos")
    .select(TODO_COLUMNS)
    .eq("ward_id", wardId)
    .not("scheduled_for", "is", null);

  if (error) {
    console.error(`Could not read my scheduled to-dos — ${error.message}`, { wardId });
    throw new Error(`Could not load your scheduled to-dos: ${error.message}`);
  }

  return ((data ?? []) as unknown as TodoRow[])
    .filter((row): row is TodoRow & { scheduled_for: string } => row.scheduled_for !== null)
    .map((row) => {
      const withName = fullName(row.scheduled_member);
      return {
        kind: "todo",
        id: row.id,
        startsAt: row.scheduled_for,
        allDay: false,
        title: row.title,
        detail: withName === null ? null : `With ${withName}`,
        href: `/todos#todo-${row.id}`,
        // A completed scheduled to-do still appears — the commitment happened.
        completed: row.completed_at !== null,
      };
    });
}

async function readYouthSignUps(
  supabase: Client,
  wardId: string,
  userId: string,
): Promise<MyAppointmentSource[]> {
  const { data, error } = await supabase
    .from("activity_attendees")
    .select(YOUTH_COLUMNS)
    .eq("ward_id", wardId)
    .eq("user_id", userId);

  if (error) {
    console.error(`Could not read my youth sign-ups — ${error.message}`, { wardId });
    throw new Error(`Could not load the youth events you signed up for: ${error.message}`);
  }

  const sources: MyAppointmentSource[] = [];

  for (const row of (data ?? []) as unknown as YouthRow[]) {
    const event = row.activity_events;
    // A called-off game is not an appointment. An event row gone missing under the join cannot
    // be placed in time at all, so it has nothing to show.
    if (event === null || event.status === "cancelled") continue;

    sources.push({
      kind: "youth",
      id: row.id,
      startsAt: event.event_date,
      allDay: event.all_day,
      title: event.title,
      detail: event.youth_activity_profiles?.activity_name ?? null,
      href: `/youth/events/${event.id}`,
    });
  }

  return sources;
}

export async function listMyAppointmentSources(
  supabase: Client,
  wardId: string,
  userId: string,
  asOf: Date,
): Promise<MyAppointmentSource[]> {
  const [visits, todos, youth] = await Promise.all([
    readVisitAppointments(supabase, wardId, userId, asOf),
    readScheduledTodos(supabase, wardId),
    readYouthSignUps(supabase, wardId, userId),
  ]);

  return [...visits, ...todos, ...youth];
}
