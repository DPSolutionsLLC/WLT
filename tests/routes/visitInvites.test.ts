// @vitest-environment node
//
// Booking a visit with companions, and answering the invite (ITER-055 bv6).
//
// POST /api/visit-appointments INVITES a leader (pending row + a `visit_companion_invited`
// notification) and RECORDS a typed name; it refuses the booker inviting themselves and a leader
// from another ward with a sentence. POST /api/visit-invites/[id] lets ONLY the invitee answer, once.
// A decline on a visit booked from a "Visit the ___ family" to-do writes a line on that to-do.
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so every query runs as a
// genuinely authenticated user and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listMyAppointmentSources } from "@/lib/appointments/queries";
import { asRole } from "@/tests/helpers/asRole";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const FAR_FUTURE = "2099-06-01T01:30:00.000Z";

async function book(body: unknown) {
  const { POST } = await import("@/app/api/visit-appointments/route");
  return readResponse(
    await POST(jsonRequest("http://localhost/api/visit-appointments", { method: "POST", body })),
  );
}

async function answer(companionId: string, accept: boolean) {
  const { POST } = await import("@/app/api/visit-invites/[id]/route");
  const request = jsonRequest(`http://localhost/api/visit-invites/${companionId}`, {
    method: "POST",
    body: { accept },
  });
  return readResponse(await POST(request, { params: Promise.resolve({ id: companionId }) }));
}

type CompanionBody = { id: string; userId: string | null; status: string | null; displayName: string };

describe("visit companions and invites", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let householdId: string;
  let assignmentId: string;
  let visitTodoId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "counselor1", "counselor2", "eqPresident", "rsPresident", "wardBBishop"],
      {
        notificationTriggers: [
          { triggerKey: "visit_companion_invited", defaultRoles: ["bishop", "counselor"] },
        ],
      },
    );
    wardId = fixtures.wardAId;

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: wardId, family_name: `Invite ${fixtures.runId}` })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);
    householdId = household.id;

    // A Bishopric goal, an assignment to the 2nd counselor and its to-do, as bv5 would make them.
    const { data: organization, error: organizationError } = await fixtures.service
      .from("organizations")
      .insert({ ward_id: wardId, name: "Bishopric", type: "bishopric" })
      .select("id")
      .single();
    if (organizationError) throw new Error(organizationError.message);

    const { data: goal, error: goalError } = await fixtures.service
      .from("visit_goals")
      .insert({
        ward_id: wardId,
        org_id: organization.id,
        title: "Visit everyone",
        target_type: "all_households",
        kind: "sweep",
      })
      .select("id")
      .single();
    if (goalError) throw new Error(goalError.message);

    const { data: assignment, error: assignmentError } = await fixtures.service
      .from("visit_assignments")
      .insert({
        ward_id: wardId,
        org_id: organization.id,
        household_id: householdId,
        goal_id: goal.id,
        assigned_to: fixtures.user("counselor2").id,
        assigned_by: fixtures.user("bishop").id,
      })
      .select("id")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);
    assignmentId = assignment.id;

    const { data: todo, error: todoError } = await fixtures.service
      .from("todos")
      .insert({
        ward_id: wardId,
        user_id: fixtures.user("counselor2").id,
        title: "Visit the Invite family",
        visit_assignment_id: assignmentId,
      })
      .select("id")
      .single();
    if (todoError) throw new Error(todoError.message);
    visitTodoId = todo.id;
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("booking", () => {
    let appointmentId: string;
    let inviteId: string;

    it("invites a leader, records a typed name, and notifies only the leader", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await book({
        householdId,
        scheduledFor: FAR_FUTURE,
        companions: [
          { kind: "user", userId: fixtures.user("eqPresident").id },
          { kind: "label", label: "A neighbour" },
        ],
      });

      expect(status).toBe(201);
      const companions = body.companions as CompanionBody[];
      const invited = companions.find((companion) => companion.userId !== null);
      expect(invited?.status).toBe("pending");
      expect(companions.find((companion) => companion.userId === null)?.status).toBeNull();
      appointmentId = (body.appointment as { id: string }).id;
      inviteId = invited!.id;

      const { data, error } = await fixtures.service
        .from("notifications")
        .select("recipient_user_id")
        .eq("ward_id", wardId)
        .eq("trigger_key", "visit_companion_invited");
      if (error) throw new Error(error.message);
      expect(data.map((row) => row.recipient_user_id)).toEqual([fixtures.user("eqPresident").id]);
    });

    it("writes an audit row with counts and no names", async () => {
      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", wardId)
        .eq("action", "appointment_booked")
        .contains("detail", { appointmentId });
      if (error) throw new Error(error.message);
      expect(data).toHaveLength(1);
      expect(data[0].detail).toMatchObject({ invitedCount: 1, recordedCompanionCount: 1 });
      expect(JSON.stringify(data[0].detail)).not.toContain("neighbour");
    });

    it("refuses the booker inviting themselves, with a sentence and no appointment", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await book({
        householdId,
        scheduledFor: "2099-07-01T01:30:00.000Z",
        companions: [{ kind: "user", userId: fixtures.user("bishop").id }],
      });
      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/invite yourself/);

      const { data } = await fixtures.service
        .from("visit_appointments")
        .select("id")
        .eq("ward_id", wardId)
        .eq("scheduled_for", "2099-07-01T01:30:00.000Z");
      expect(data).toEqual([]);
    });

    it("refuses a leader from another ward", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await book({
        householdId,
        scheduledFor: "2099-07-02T01:30:00.000Z",
        companions: [{ kind: "user", userId: fixtures.user("wardBBishop").id }],
      });
      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/does not hold a calling in this ward/);
    });

    it("lets only the invitee answer — anybody else gets a 404", async () => {
      await actAs(fixtures, "rsPresident");
      const { status } = await answer(inviteId, true);
      expect(status).toBe(404);
    });

    it("accepts once, and puts the visit on the invitee's My Appointments", async () => {
      await actAs(fixtures, "eqPresident");
      const first = await answer(inviteId, true);
      expect(first.status).toBe(200);
      expect(first.body.status).toBe("accepted");

      const second = await answer(inviteId, false);
      expect(second.status).toBe(409);

      const client = await asRole(fixtures, "eqPresident");
      const sources = await listMyAppointmentSources(client, wardId, fixtures.user("eqPresident").id, new Date());
      const visit = sources.find((source) => source.id === appointmentId);
      expect(visit).toMatchObject({ kind: "visit", role: "companion" });
    });

    it("shows the booker who is coming", async () => {
      const client = await asRole(fixtures, "bishop");
      const sources = await listMyAppointmentSources(client, wardId, fixtures.user("bishop").id, new Date());
      const visit = sources.find((source) => source.id === appointmentId);
      expect(visit).toMatchObject({ role: "booker" });
      expect(visit?.detail).toMatch(/\(coming\)/);
    });
  });

  describe("from a visit to-do", () => {
    it("refuses an assignment from a booker outside the bishopric", async () => {
      await actAs(fixtures, "eqPresident");
      const { status } = await book({ householdId, scheduledFor: FAR_FUTURE, assignmentId });
      expect(status).toBe(403);
    });

    it("links the appointment, and a decline puts a line on the to-do", async () => {
      await actAs(fixtures, "counselor2");
      const booked = await book({
        householdId,
        scheduledFor: "2099-08-01T01:30:00.000Z",
        assignmentId,
        companions: [{ kind: "user", userId: fixtures.user("counselor1").id }],
      });
      expect(booked.status).toBe(201);
      expect((booked.body.appointment as { assignmentId: string }).assignmentId).toBe(assignmentId);
      const inviteId = (booked.body.companions as CompanionBody[])[0].id;

      await actAs(fixtures, "counselor1");
      const declined = await answer(inviteId, false);
      expect(declined.status).toBe(200);
      expect(declined.body.warning).toBeNull();

      const { data, error } = await fixtures.service
        .from("todo_log_entries")
        .select("kind, body")
        .eq("todo_id", visitTodoId)
        .eq("kind", "visit_companion_declined");
      if (error) throw new Error(error.message);
      expect(data).toHaveLength(1);
    });
  });
});
