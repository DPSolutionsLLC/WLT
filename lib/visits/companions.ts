import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidInputError } from "@/lib/auth/errors";
import { findUsersOutsideWard } from "@/lib/callings/queries";
import type { VisitParticipantInput } from "@/lib/validation/visit";
import { compareCompanions } from "@/lib/visits/companionText";
import type { Database } from "@/types/database";
import {
  VISIT_INVITE_STATUSES,
  type VisitCompanion,
  type VisitInvite,
  type VisitInviteStatus,
} from "@/types/domain";

// WHO IS GOING ALONG ON A VISIT APPOINTMENT — ITER-055 bv6, migration 104b. The ONLY writer of
// `visit_appointment_companions` (tests/lib/visitTodoSites.test.ts reads the source to hold that).
//
// ---------------------------------------------------------------------------
// INVITED OR RECORDED, NEVER SILENTLY ADDED
// ---------------------------------------------------------------------------
// A leader with an account is INVITED (`pending`, then accepted or declined, once). A roster member
// or a typed name is RECORDED with no status — a roster member has no account to answer with. The
// booker is never a row: they are the appointment's `made_by`.
//
// ---------------------------------------------------------------------------
// THE SERVICE ROLE, AND WHAT STANDS IN FOR RLS HERE
// ---------------------------------------------------------------------------
// The table has a SELECT policy and no write policy. Every write below runs on the service role
// after one of:
//   1. the caller's OWN client inserted the appointment, so visit_appointments_insert proved they
//      may book it (inviteCompanions);
//   2. the caller read the invite through their own client as its invitee (answerInvite).
// The service role has no RLS behind it, so every write sets and filters `ward_id` (rule 1).
//
// THIS MODULE NEVER SELECTS FROM `visit_private_notes` OR `visit_logs`. A companion is invited to an
// appointment, and reads nothing about the visit that comes of it.

type Client = SupabaseClient<Database>;

const COMPANION_COLUMNS =
  "id, appointment_id, user_id, member_id, label, status, users (first_name, last_name), members!visit_appointment_companions_member_fkey (first_name, last_name)";

const INVITE_COLUMNS =
  "id, status, visit_appointments!visit_appointment_companions_appointment_fkey (id, scheduled_for, status, households (family_name), users (first_name, last_name))";

type NameRow = { first_name: string | null; last_name: string | null } | null;

type CompanionRow = {
  id: string;
  appointment_id: string;
  user_id: string | null;
  member_id: string | null;
  label: string | null;
  status: string | null;
  users: NameRow;
  members: NameRow;
};

type InviteRow = {
  id: string;
  status: string | null;
  visit_appointments: {
    id: string;
    scheduled_for: string;
    status: string;
    households: { family_name: string } | null;
    users: NameRow;
  } | null;
};

export class CompanionWriteError extends Error {
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "CompanionWriteError";
    this.cause = cause;
  }
}

function fullName(row: NameRow): string | null {
  if (row === null) return null;
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return name === "" ? null : name;
}

function toInviteStatus(value: string | null): VisitInviteStatus | null {
  if (value === null) return null;
  if (!(VISIT_INVITE_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `visit_appointment_companions.status holds "${value}", which is not a known value. The ` +
        "CHECK constraint and types/domain.ts have drifted.",
    );
  }
  return value as VisitInviteStatus;
}

// "Someone" beats a blank, for a person whose row was deleted since (lib/visits/participants.ts).
function mapCompanionRow(row: CompanionRow): VisitCompanion {
  const kind = row.user_id !== null ? "user" : row.member_id !== null ? "member" : "label";
  const displayName =
    kind === "user"
      ? fullName(row.users)
      : kind === "member"
        ? fullName(row.members)
        : row.label;

  return {
    id: row.id,
    appointmentId: row.appointment_id,
    kind,
    userId: row.user_id,
    memberId: row.member_id,
    displayName: displayName ?? "Someone",
    status: toInviteStatus(row.status),
  };
}

// ---------------------------------------------------------------------------
// Checks, before anything is written
// ---------------------------------------------------------------------------
// ⚠️ `user_id` and `member_id` are SUBJECT columns written from a request body. The user key is
// single-column since 069, so a leader from another ward would be silently accepted; the member key
// is composite, so a member from another ward would be a 23503 — a 500 for the caller's bad id.
// Both are refused here with a sentence that names a count and never a person.
export async function assertCompanionsAllowed(
  params: {
    wardId: string;
    bookerUserId: string;
    companions: readonly VisitParticipantInput[];
  },
  client: Client,
  service: Client,
): Promise<void> {
  const userIds = params.companions.flatMap((companion) =>
    companion.kind === "user" ? [companion.userId] : [],
  );
  const memberIds = params.companions.flatMap((companion) =>
    companion.kind === "member" ? [companion.memberId] : [],
  );

  if (userIds.includes(params.bookerUserId)) {
    throw new InvalidInputError(
      "You don't need to invite yourself — you're going because you booked it.",
    );
  }

  const outsiders = await findUsersOutsideWard(params.wardId, userIds, client);
  if (outsiders.length > 0) {
    throw new InvalidInputError(
      outsiders.length === 1
        ? "One of the people you invited does not hold a calling in this ward."
        : `${outsiders.length} of the people you invited do not hold a calling in this ward.`,
    );
  }

  if (memberIds.length === 0) return;

  const { data, error } = await service
    .from("members")
    .select("id")
    .eq("ward_id", params.wardId)
    .in("id", memberIds);

  if (error) {
    console.error(`Could not check visit companions — ${error.message}`, { wardId: params.wardId });
    throw new Error(`Could not check who is going on that visit: ${error.message}`);
  }

  const found = new Set((data ?? []).map((row) => row.id));
  const missing = memberIds.filter((memberId) => !found.has(memberId));
  if (missing.length > 0) {
    throw new InvalidInputError(
      missing.length === 1
        ? "One of the members you chose is not on this ward's roster."
        : `${missing.length} of the members you chose are not on this ward's roster.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// ONE INSERT STATEMENT, so the companions land together or not at all. The route deletes the
// appointment it just made if this throws (visits-d's pitfall: never a half invite).
export async function inviteCompanions(
  params: {
    wardId: string;
    appointmentId: string;
    companions: readonly VisitParticipantInput[];
  },
  service: Client,
): Promise<VisitCompanion[]> {
  if (params.companions.length === 0) return [];

  const { error } = await service.from("visit_appointment_companions").insert(
    params.companions.map((companion) => ({
      ward_id: params.wardId,
      appointment_id: params.appointmentId,
      user_id: companion.kind === "user" ? companion.userId : null,
      member_id: companion.kind === "member" ? companion.memberId : null,
      label: companion.kind === "label" ? companion.label : null,
      status: companion.kind === "user" ? "pending" : null,
    })),
  );

  if (error) {
    console.error(`Could not save visit companions — ${error.message}`, {
      wardId: params.wardId,
      appointmentId: params.appointmentId,
    });
    throw new CompanionWriteError("Could not save who is going on that visit.", error);
  }

  const byAppointment = await listCompanionsForAppointments(
    params.wardId,
    [params.appointmentId],
    service,
  );
  return byAppointment.get(params.appointmentId) ?? [];
}

// Pending → accepted or declined, once. Conditional on the row still being pending AND still the
// caller's, so a double tap or a stale page cannot answer twice. Null when nothing changed.
export async function answerInvite(
  params: { wardId: string; companionId: string; userId: string; accept: boolean },
  service: Client,
): Promise<VisitInviteStatus | null> {
  const status: VisitInviteStatus = params.accept ? "accepted" : "declined";

  const { data, error } = await service
    .from("visit_appointment_companions")
    .update({ status, responded_at: new Date().toISOString() })
    .eq("ward_id", params.wardId)
    .eq("id", params.companionId)
    .eq("user_id", params.userId)
    .eq("status", "pending")
    .select("status")
    .maybeSingle();

  if (error) {
    console.error(`Could not answer a visit invite — ${error.message}`, {
      wardId: params.wardId,
      companionId: params.companionId,
    });
    throw new CompanionWriteError("Could not save your answer. Please try again.", error);
  }

  return data === null ? null : toInviteStatus(data.status);
}

// ---------------------------------------------------------------------------
// Reads — through whichever client the caller passes. With the caller's own, RLS decides.
// ---------------------------------------------------------------------------

export async function listCompanionsForAppointments(
  wardId: string,
  appointmentIds: readonly string[],
  client: Client,
): Promise<Map<string, VisitCompanion[]>> {
  const byAppointment = new Map<string, VisitCompanion[]>();
  if (appointmentIds.length === 0) return byAppointment;

  const { data, error } = await client
    .from("visit_appointment_companions")
    .select(COMPANION_COLUMNS)
    .eq("ward_id", wardId)
    .in("appointment_id", [...appointmentIds])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`Could not read visit companions — ${error.message}`, { wardId });
    throw new Error(`Could not load who is going on these visits: ${error.message}`);
  }

  for (const row of (data ?? []) as unknown as CompanionRow[]) {
    const companion = mapCompanionRow(row);
    const existing = byAppointment.get(companion.appointmentId);
    if (existing) existing.push(companion);
    else byAppointment.set(companion.appointmentId, [companion]);
  }

  for (const companions of byAppointment.values()) companions.sort(compareCompanions);

  return byAppointment;
}

// The invite as its invitee sees it. Read through the caller's client: the row is theirs, and the
// appointment it names is readable to them through migration 104d's `is_visit_companion()` arm.
export async function readOwnInvite(
  wardId: string,
  companionId: string,
  userId: string,
  client: Client,
): Promise<{ id: string; appointmentId: string; status: VisitInviteStatus | null } | null> {
  const { data, error } = await client
    .from("visit_appointment_companions")
    .select("id, appointment_id, status")
    .eq("ward_id", wardId)
    .eq("id", companionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a visit invite — ${error.message}`, { wardId, companionId });
    throw new Error(`Could not load that invite: ${error.message}`);
  }

  return data === null
    ? null
    : { id: data.id, appointmentId: data.appointment_id, status: toInviteStatus(data.status) };
}

type InvitedAppointment = {
  companionId: string;
  status: VisitInviteStatus;
  appointmentId: string;
  scheduledFor: string;
  householdName: string | null;
  madeByName: string | null;
};

// Every invite this person holds in one status, on an appointment that is still scheduled. A
// cancelled or kept appointment is not somewhere anybody is going any more.
export async function listInvitedAppointments(
  wardId: string,
  userId: string,
  status: "pending" | "accepted",
  client: Client,
): Promise<InvitedAppointment[]> {
  const { data, error } = await client
    .from("visit_appointment_companions")
    .select(INVITE_COLUMNS)
    .eq("ward_id", wardId)
    .eq("user_id", userId)
    .eq("status", status);

  if (error) {
    console.error(`Could not read visit invites — ${error.message}`, { wardId });
    throw new Error(`Could not load your visit invites: ${error.message}`);
  }

  return ((data ?? []) as unknown as InviteRow[]).flatMap((row) => {
    const appointment = row.visit_appointments;
    if (appointment === null || appointment.status !== "scheduled") return [];
    return [
      {
        companionId: row.id,
        status,
        appointmentId: appointment.id,
        scheduledFor: appointment.scheduled_for,
        householdName: appointment.households?.family_name ?? null,
        madeByName: fullName(appointment.users),
      },
    ];
  });
}

// The panel at the top of My Appointments and of Visits: pending invites whose time has not yet
// passed, soonest first. A past one is not a decision anybody can still make.
export async function listPendingInvitesFor(
  wardId: string,
  userId: string,
  asOf: Date,
  client: Client,
): Promise<VisitInvite[]> {
  const invites = await listInvitedAppointments(wardId, userId, "pending", client);

  return invites
    .filter((invite) => Date.parse(invite.scheduledFor) > asOf.getTime())
    .sort((left, right) => Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor))
    .map((invite) => ({
      companionId: invite.companionId,
      appointmentId: invite.appointmentId,
      scheduledFor: invite.scheduledFor,
      householdName: invite.householdName,
      madeByName: invite.madeByName,
    }));
}
