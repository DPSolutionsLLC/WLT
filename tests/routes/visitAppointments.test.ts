// @vitest-environment node
//
// The appointment routes.
//
// ---------------------------------------------------------------------------
// "MISSED" IS NEVER IN THE COLUMN
// ---------------------------------------------------------------------------
// The assertion this suite exists for: an appointment reads `missed` while its STORED status is
// still `scheduled`. Both halves matter. If the stored value ever became `missed`, the state
// would be a snapshot of whenever somebody last wrote to the row rather than a fact about now —
// and this project has no pg_cron and no triggers to keep such a column fresh.
//
// ---------------------------------------------------------------------------
// 404, NOT 403
// ---------------------------------------------------------------------------
// Another organization's appointment answers 404, the same reasoning the private-note route
// uses: a 403 confirms the row exists, and "the Relief Society has an appointment with the
// Andersens on Tuesday" is not a fact this app confirms to somebody who cannot read it.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked —
// only the client factory, so every query below still runs as a genuinely authenticated user
// against the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

// Pinned, not relative to today. A fixture whose "past" is computed from the clock is one that
// changes meaning as the suite ages.
const LONG_PAST = "2020-03-01T19:00:00.000Z";
const FAR_FUTURE = "2099-03-01T19:00:00.000Z";

async function callGetAppointments(url: string) {
  const { GET } = await import("@/app/api/visit-appointments/route");
  return readResponse(await GET(jsonRequest(url)));
}

async function callPostAppointment(body: unknown) {
  const { POST } = await import("@/app/api/visit-appointments/route");
  return readResponse(
    await POST(
      jsonRequest("http://localhost/api/visit-appointments", { method: "POST", body }),
    ),
  );
}

async function callPatchAppointment(appointmentId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/visit-appointments/[id]/route");
  const request = jsonRequest(`http://localhost/api/visit-appointments/${appointmentId}`, {
    method: "PATCH",
    body,
  });
  return readResponse(
    await PATCH(request, { params: Promise.resolve({ id: appointmentId }) }),
  );
}

async function callPostVisit(body: unknown) {
  const { POST } = await import("@/app/api/visits/route");
  return readResponse(
    await POST(jsonRequest("http://localhost/api/visits", { method: "POST", body })),
  );
}

type AppointmentBody = {
  id: string;
  orgId: string | null;
  madeBy: string | null;
  status: string;
  visitLogId: string | null;
  scheduledFor: string;
};

describe("visit appointment routes", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let householdId: string;
  let otherHouseholdId: string;
  let rsAppointmentId: string;
  let missedAppointmentId: string;

  const storedStatusOf = async (appointmentId: string): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("visit_appointments")
      .select("status")
      .eq("id", appointmentId)
      .single();

    if (error) throw new Error(error.message);
    return data.status;
  };

  const auditActions = async (): Promise<string[]> => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("action")
      .eq("ward_id", wardId)
      .like("action", "appointment_%");

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.action);
  };

  const appointmentFrom = (body: Record<string, unknown>): AppointmentBody =>
    body.appointment as AppointmentBody;

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
    ]);
    wardId = fixtures.wardAId;

    const { data: households, error: householdError } = await fixtures.service
      .from("households")
      .insert([
        { ward_id: wardId, family_name: "Appointment Family" },
        { ward_id: wardId, family_name: "Other Family" },
      ])
      .select("id, family_name");
    if (householdError) throw new Error(householdError.message);

    householdId = households.find((row) => row.family_name === "Appointment Family")!.id;
    otherHouseholdId = households.find((row) => row.family_name === "Other Family")!.id;

    // A Relief Society appointment the Elders Quorum must not reach. Cross-org visibility is off
    // by default in the fixtures, so it is invisible as well as unwritable.
    const { data: rsAppointment, error: rsError } = await fixtures.service
      .from("visit_appointments")
      .insert({
        ward_id: wardId,
        org_id: fixtures.reliefSocietyId,
        household_id: householdId,
        scheduled_for: FAR_FUTURE,
        made_by: fixtures.user("rsPresident").id,
      })
      .select("id")
      .single();
    if (rsError) throw new Error(rsError.message);
    rsAppointmentId = rsAppointment.id;

    // THE MISSED ONE: long past, and still `scheduled`. This state cannot be reached by
    // clicking — nothing writes `missed` — so it has to be seeded.
    const { data: missed, error: missedError } = await fixtures.service
      .from("visit_appointments")
      .insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        household_id: householdId,
        scheduled_for: LONG_PAST,
        made_by: fixtures.user("eqPresident").id,
      })
      .select("id")
      .single();
    if (missedError) throw new Error(missedError.message);
    missedAppointmentId = missed.id;
  }, 60_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("POST /api/visit-appointments", () => {
    it("stamps org_id and made_by from the session and ignores both if sent", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPostAppointment({
        householdId,
        scheduledFor: FAR_FUTURE,
        // Both ignored. A request that could name its own organization could put an appointment
        // on another organization's board.
        orgId: fixtures.reliefSocietyId,
        org_id: fixtures.reliefSocietyId,
        madeBy: fixtures.user("rsPresident").id,
        made_by: fixtures.user("rsPresident").id,
      });

      expect(status).toBe(201);

      const appointment = appointmentFrom(body);

      expect(appointment.orgId).toBe(fixtures.eldersQuorumId);
      expect(appointment.madeBy).toBe(fixtures.user("eqPresident").id);
      expect(appointment.status).toBe("scheduled");
    });

    // A PAST appointment is allowed, unlike a past-dated visit log. Somebody writing down on
    // Wednesday the visit they arranged for Tuesday is a real thing, and refusing it would push
    // that record into a notes field where nothing can count it.
    it("accepts an appointment for a time already past", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPostAppointment({
        householdId,
        scheduledFor: LONG_PAST,
      });

      expect(status).toBe(201);
      expect(appointmentFrom(body).status).toBe("scheduled");
    });

    // Checked against the permission matrix, not against intuition: an org secretary logs visits
    // and books appointments; they just cannot configure the goals.
    it("lets an org secretary book one — they hold visits.create", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPostAppointment({
        householdId,
        scheduledFor: FAR_FUTURE,
      });

      expect(status).toBe(201);
    });

    it("refuses a household from another ward with a sentence, not a 500", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPostAppointment({
        householdId: "11111111-1111-4111-8111-111111111111",
        scheduledFor: FAR_FUTURE,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("household");
    });

    it("refuses a scheduledFor that is not a timestamp", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPostAppointment({
        householdId,
        scheduledFor: "next Tuesday-ish",
      });

      expect(status).toBe(400);
    });
  });

  describe("GET /api/visit-appointments", () => {
    it("reports missed for a past scheduled appointment whose stored status is scheduled", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGetAppointments(
        "http://localhost/api/visit-appointments",
      );

      expect(status).toBe(200);

      const appointments = body.appointments as Array<{
        id: string;
        status: string;
        viewState: string;
      }>;

      const missed = appointments.find((row) => row.id === missedAppointmentId);

      expect(missed).toBeDefined();
      expect(missed?.viewState).toBe("missed");

      // BOTH HALVES. The computed state says missed; the column still says scheduled.
      expect(missed?.status).toBe("scheduled");
      expect(await storedStatusOf(missedAppointmentId)).toBe("scheduled");
    });

    it("reports scheduled for one still ahead", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callGetAppointments("http://localhost/api/visit-appointments");
      const appointments = body.appointments as Array<{
        scheduledFor: string;
        viewState: string;
      }>;

      // Compared as INSTANTS. Postgres renders a timestamptz as "2099-03-01 19:00:00+00", which
      // is the same moment as the ISO string sent in and not the same string — a string equality
      // here passes only by luck of formatting.
      const ahead = appointments.filter(
        (row) => Date.parse(row.scheduledFor) === Date.parse(FAR_FUTURE),
      );

      expect(ahead.length).toBeGreaterThan(0);
      expect(ahead.every((row) => row.viewState === "scheduled")).toBe(true);
    });

    it("shows an Elders Quorum leader none of the Relief Society's appointments", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callGetAppointments("http://localhost/api/visit-appointments");
      const appointments = body.appointments as Array<{ id: string }>;

      expect(appointments.some((row) => row.id === rsAppointmentId)).toBe(false);
    });

    it("filters by household", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGetAppointments(
        `http://localhost/api/visit-appointments?householdId=${otherHouseholdId}`,
      );

      expect(status).toBe(200);
      expect(body.appointments).toEqual([]);
    });

    // A parameter this handler does not read gets no error, just a silently ignored filter
    // (plans/retros/roster-b-picker-and-orgs.md) — so an unparseable one must be a 400.
    it("answers 400 for an unparseable filter rather than ignoring it", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callGetAppointments(
        "http://localhost/api/visit-appointments?householdId=not-a-uuid",
      );

      expect(status).toBe(400);
    });
  });

  describe("PATCH /api/visit-appointments/[id]", () => {
    let appointmentId: string;
    let visitLogId: string;

    beforeAll(async () => {
      await actAs(fixtures, "eqPresident");

      const { body: appointmentBody } = await callPostAppointment({
        householdId,
        scheduledFor: FAR_FUTURE,
      });
      appointmentId = appointmentFrom(appointmentBody).id;

      const { body: visitBody } = await callPostVisit({
        householdId,
        visitDate: "2026-04-05",
        visitType: "in_home",
      });
      visitLogId = (visitBody.visit as { id: string }).id;
    });

    it("keeps an appointment and links the visit log", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatchAppointment(appointmentId, {
        action: "keep",
        visitLogId,
      });

      expect(status).toBe(200);

      const appointment = appointmentFrom(body);

      expect(appointment.status).toBe("kept");
      expect(appointment.visitLogId).toBe(visitLogId);
      expect(await storedStatusOf(appointmentId)).toBe("kept");
    });

    // An appointment with the Andersens is not evidence of a visit to the Bryants.
    it("refuses to keep an appointment with a visit to a different household", async () => {
      await actAs(fixtures, "eqPresident");

      const { body: appointmentBody } = await callPostAppointment({
        householdId: otherHouseholdId,
        scheduledFor: FAR_FUTURE,
      });
      const mismatched = appointmentFrom(appointmentBody).id;

      const { status, body } = await callPatchAppointment(mismatched, {
        action: "keep",
        visitLogId,
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("household");
      expect(await storedStatusOf(mismatched)).toBe("scheduled");
    });

    // CANCELLING DOES NOT DELETE. That an appointment was made and called off is part of the
    // record of how a ward has tried to reach a household.
    it("cancels without deleting the row", async () => {
      await actAs(fixtures, "eqPresident");

      const { body: created } = await callPostAppointment({
        householdId,
        scheduledFor: FAR_FUTURE,
      });
      const id = appointmentFrom(created).id;

      const { status } = await callPatchAppointment(id, { action: "cancel" });

      expect(status).toBe(200);
      expect(await storedStatusOf(id)).toBe("cancelled");

      const { data, error } = await fixtures.service
        .from("visit_appointments")
        .select("id")
        .eq("id", id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
    });

    it("reschedules and leaves the status alone", async () => {
      await actAs(fixtures, "eqPresident");

      const { body: created } = await callPostAppointment({
        householdId,
        scheduledFor: FAR_FUTURE,
      });
      const id = appointmentFrom(created).id;

      const later = "2099-04-01T19:00:00.000Z";
      const { status, body } = await callPatchAppointment(id, {
        action: "reschedule",
        scheduledFor: later,
      });

      expect(status).toBe(200);
      expect(appointmentFrom(body).status).toBe("scheduled");
      expect(Date.parse(appointmentFrom(body).scheduledFor)).toBe(Date.parse(later));
    });

    // Rescheduling into the past leaves it scheduled in the column and missed on read — the
    // computed state follows the clock without anybody writing it.
    it("reads as missed after being rescheduled into the past", async () => {
      await actAs(fixtures, "eqPresident");

      const { body: created } = await callPostAppointment({
        householdId,
        scheduledFor: FAR_FUTURE,
      });
      const id = appointmentFrom(created).id;

      await callPatchAppointment(id, { action: "reschedule", scheduledFor: LONG_PAST });

      expect(await storedStatusOf(id)).toBe("scheduled");

      const { body } = await callGetAppointments("http://localhost/api/visit-appointments");
      const appointments = body.appointments as Array<{ id: string; viewState: string }>;

      expect(appointments.find((row) => row.id === id)?.viewState).toBe("missed");
    });

    // Three actions, three audit rows. The point of the discriminated union: a ward can tell
    // afterwards which of the three happened, and "cancelled" is not reachable as a side effect
    // of rescheduling.
    it("writes a distinct audit action for each of the three", async () => {
      const actions = await auditActions();

      expect(actions).toContain("appointment_booked");
      expect(actions).toContain("appointment_kept");
      expect(actions).toContain("appointment_cancelled");
      expect(actions).toContain("appointment_rescheduled");
    });

    it("answers 404 rather than 403 for another organization's appointment", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatchAppointment(rsAppointmentId, { action: "cancel" });

      expect(status).toBe(404);
      // Proven by re-reading: an RLS-denied UPDATE is a zero-row success, not an error.
      expect(await storedStatusOf(rsAppointmentId)).toBe("scheduled");
    });

    it("answers 404 for an appointment that does not exist", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatchAppointment(
        "11111111-1111-4111-8111-111111111111",
        { action: "cancel" },
      );

      expect(status).toBe(404);
    });

    it("refuses an action it does not know", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatchAppointment(appointmentId, { action: "postpone" });

      expect(status).toBe(400);
    });
  });

  // Logging a visit against an appointment marks it kept in one action, so "log the visit we
  // arranged" is not two screens and a household chosen twice.
  describe("POST /api/visits with an appointmentId", () => {
    it("marks the appointment kept and links the new visit", async () => {
      await actAs(fixtures, "eqPresident");

      const { body: created } = await callPostAppointment({
        householdId,
        scheduledFor: FAR_FUTURE,
      });
      const id = appointmentFrom(created).id;

      const { status, body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-06",
        visitType: "in_home",
        arrangement: "appointment",
        appointmentId: id,
      });

      expect(status).toBe(201);

      const visitId = (body.visit as { id: string }).id;

      const { data, error } = await fixtures.service
        .from("visit_appointments")
        .select("status, visit_log_id")
        .eq("id", id)
        .single();

      expect(error).toBeNull();
      expect(data?.status).toBe("kept");
      expect(data?.visit_log_id).toBe(visitId);
    });

    it("refuses an appointment arranged with a different household", async () => {
      await actAs(fixtures, "eqPresident");

      const { body: created } = await callPostAppointment({
        householdId: otherHouseholdId,
        scheduledFor: FAR_FUTURE,
      });
      const id = appointmentFrom(created).id;

      const { status, body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-07",
        visitType: "in_home",
        appointmentId: id,
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("household");
      expect(await storedStatusOf(id)).toBe("scheduled");
    });

    it("answers 404 for another organization's appointment", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPostVisit({
        householdId,
        visitDate: "2026-04-08",
        visitType: "in_home",
        appointmentId: rsAppointmentId,
      });

      expect(status).toBe(404);
      expect(await storedStatusOf(rsAppointmentId)).toBe("scheduled");
    });
  });
});
