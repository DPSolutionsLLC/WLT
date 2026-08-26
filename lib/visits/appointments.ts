import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { appointmentViewState } from "@/lib/visits/appointmentStatus";
import type {
  CreateAppointmentInput,
  ListAppointmentsQuery,
} from "@/lib/validation/visit";
import type { Database } from "@/types/database";
import {
  APPOINTMENT_STATUSES,
  type AppointmentStatus,
  type AppointmentViewState,
} from "@/types/domain";

// Appointments — a visit ARRANGED, as distinct from a visit that happened.
//
// THIS MODULE NEVER SELECTS FROM `visit_private_notes`, AND NEVER IMPORTS THE MODULE THAT DOES.
// The same rule lib/visits/queries.ts states, for the same reason: "did this response include a
// private note?" stays answerable by reading an import list rather than a query body
// (CLAUDE.md rule 5).
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. The one piece
// a client component needs — appointmentViewState — lives in lib/visits/appointmentStatus.ts for
// exactly that reason; its header explains the split.

export type VisitAppointment = {
  id: string;
  orgId: string | null;
  householdId: string | null;
  scheduledFor: string;
  // The STORED status. Never `missed` — see appointmentViewState below.
  status: AppointmentStatus;
  visitLogId: string | null;
  madeBy: string | null;
  notes: string | null;
  createdAt: string;
};

export type VisitAppointmentWithContext = VisitAppointment & {
  householdName: string | null;
  madeByName: string | null;
  viewState: AppointmentViewState;
};

type VisitAppointmentRow = {
  id: string;
  org_id: string | null;
  household_id: string | null;
  scheduled_for: string;
  status: string;
  visit_log_id: string | null;
  made_by: string | null;
  notes: string | null;
  created_at: string;
};

type VisitAppointmentJoinedRow = VisitAppointmentRow & {
  households: { id: string; family_name: string } | null;
  users: { id: string; first_name: string | null; last_name: string | null } | null;
};

// One string literal on ONE line, never a `+` concatenation — concatenation widens the type to
// `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md). And never `select("*")`.
const APPOINTMENT_COLUMNS =
  "id, org_id, household_id, scheduled_for, status, visit_log_id, made_by, notes, created_at";

const APPOINTMENT_JOINED_COLUMNS = `${APPOINTMENT_COLUMNS}, households (id, family_name), users (id, first_name, last_name)` as const;

function toAppointmentStatus(value: string): AppointmentStatus {
  if (!(APPOINTMENT_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `visit_appointments.status holds "${value}", which is not a known value. The CHECK ` +
        "constraint and types/domain.ts have drifted.",
    );
  }
  return value as AppointmentStatus;
}

// Builds an explicit object rather than spreading the row: a column added to the table later
// cannot ride along into a response nobody reviewed.
export function mapAppointmentRow(row: VisitAppointmentRow): VisitAppointment {
  return {
    id: row.id,
    orgId: row.org_id,
    householdId: row.household_id,
    scheduledFor: row.scheduled_for,
    status: toAppointmentStatus(row.status),
    visitLogId: row.visit_log_id,
    madeBy: row.made_by,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function mapAppointmentJoinedRow(
  row: VisitAppointmentJoinedRow,
  asOf: Date,
): VisitAppointmentWithContext {
  const appointment = mapAppointmentRow(row);
  const maker = row.users;
  const madeByName =
    maker === null ? null : `${maker.first_name ?? ""} ${maker.last_name ?? ""}`.trim() || null;

  return {
    ...appointment,
    householdName: row.households?.family_name ?? null,
    madeByName,
    viewState: appointmentViewState(appointment, asOf),
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// Every function below takes the CALLER'S session client. RLS does the org scoping, and there is
// deliberately no belt-and-braces `org_id` filter on top of it — a redundant filter would mask a
// policy regression by hiding rows the policy had started letting through.

export async function listAppointments(
  wardId: string,
  filter: ListAppointmentsQuery,
  asOf: Date,
  client?: SupabaseClient<Database>,
): Promise<VisitAppointmentWithContext[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("visit_appointments")
    .select(APPOINTMENT_JOINED_COLUMNS)
    .eq("ward_id", wardId);

  if (filter.householdId !== undefined) query = query.eq("household_id", filter.householdId);
  if (filter.from !== undefined) query = query.gte("scheduled_for", filter.from);
  if (filter.to !== undefined) query = query.lte("scheduled_for", filter.to);
  // Filters on the STORED status. `missed` is not a value this column holds, so it is not a
  // filter this endpoint offers — a caller wanting missed appointments reads the view state.
  if (filter.status !== undefined) query = query.eq("status", filter.status);

  // Ordered explicitly, because these tables are shared by every suite running against the
  // hosted project and heap order shifts under them (plans/retros/route-tests-and-realtime.md).
  const { data, error } = await query
    .order("scheduled_for", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`Could not read visit appointments — ${error.message}`, { wardId });
    throw new Error(`Could not load the appointments: ${error.message}`);
  }

  return (data ?? []).map((row) =>
    mapAppointmentJoinedRow(row as unknown as VisitAppointmentJoinedRow, asOf),
  );
}

export async function getAppointment(
  wardId: string,
  appointmentId: string,
  client?: SupabaseClient<Database>,
): Promise<VisitAppointment | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_appointments")
    .select(APPOINTMENT_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", appointmentId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a visit appointment — ${error.message}`, {
      wardId,
      appointmentId,
    });
    throw new Error(`Could not load that appointment: ${error.message}`);
  }

  return data === null ? null : mapAppointmentRow(data);
}

// `orgId` and `madeBy` are parameters rather than fields on the input, for the same reason
// createVisitLog takes them: both come from the session and neither is expressible in
// createAppointmentSchema.
export async function createAppointment(
  wardId: string,
  orgId: string | null,
  userId: string,
  input: CreateAppointmentInput,
  client?: SupabaseClient<Database>,
): Promise<VisitAppointment> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_appointments")
    .insert({
      ward_id: wardId,
      org_id: orgId,
      household_id: input.householdId,
      scheduled_for: input.scheduledFor,
      notes: input.notes ?? null,
      made_by: userId,
    })
    .select(APPOINTMENT_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a visit appointment — ${error.message}`, { wardId, orgId });
    throw new Error(`Could not save that appointment: ${error.message}`);
  }

  return mapAppointmentRow(data);
}

export type AppointmentPatch = {
  status?: AppointmentStatus;
  scheduledFor?: string;
  visitLogId?: string | null;
};

// Returns null when the row did not change, which from here is indistinguishable from a row RLS
// refused — an RLS-denied UPDATE is a zero-row success, not an error
// (plans/retros/foundation-c-services.md). The route turns that into a 404.
export async function updateAppointment(
  wardId: string,
  appointmentId: string,
  patch: AppointmentPatch,
  client?: SupabaseClient<Database>,
): Promise<VisitAppointment | null> {
  const supabase = await resolveClient(client);

  const row: Database["public"]["Tables"]["visit_appointments"]["Update"] = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.scheduledFor !== undefined) row.scheduled_for = patch.scheduledFor;
  if (patch.visitLogId !== undefined) row.visit_log_id = patch.visitLogId;

  const { data, error } = await supabase
    .from("visit_appointments")
    .update(row)
    .eq("ward_id", wardId)
    .eq("id", appointmentId)
    .select(APPOINTMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update a visit appointment — ${error.message}`, {
      wardId,
      appointmentId,
    });
    throw new Error(`Could not save that appointment: ${error.message}`);
  }

  return data === null ? null : mapAppointmentRow(data);
}
