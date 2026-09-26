// @vitest-environment node
//
// Sacrament slice f2: when a Sunday's conductor changes, its open talk asks follow the new
// conductor — by hand, and through the re-shift a type change applies to later Sundays.
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so every query runs as a
// genuinely authenticated user against the hosted project. Every assertion about a write re-reads
// the row with the service client.
//
// The tests run IN ORDER. Each step starts from the state the previous one left.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listMyAppointmentSources } from "@/lib/appointments/queries";
import {
  generateSundayRange,
  listSundays,
  replaceConductingRotation,
} from "@/lib/calendar/queries";
import { asRole } from "@/tests/helpers/asRole";
import { actAs, actingClient, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type FixtureHandle, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api";
const BISHOPRIC: readonly FixtureHandle[] = ["bishop", "counselor1", "counselor2"];
const FROM = "2027-07-01";
const TO = "2027-09-30";

// Changed by hand.
const MANUAL_DATE = "2027-07-04";
// Turned into a stake conference, which re-shifts who conducts on every later Sunday.
const EDITED_DATE = "2027-08-15";
const RESHIFTED_DATE = "2027-08-22";

const OWNERS_OWN_WORDS = "OWNER'S OWN WORDS — call after 6pm";
const SCHEDULED_FOR = "2027-07-01T01:30:00.000Z";

async function sendAsks(sundayId: string) {
  const { POST } = await import("@/app/api/sundays/[id]/asks/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/sundays/${sundayId}/asks`, { method: "POST" }), {
      params: Promise.resolve({ id: sundayId }),
    }),
  );
}

async function patchSunday(sundayId: string, body: unknown, confirm = false) {
  const { PATCH } = await import("@/app/api/sundays/[id]/route");
  const url = `${BASE}/sundays/${sundayId}${confirm ? "?confirm=true" : ""}`;
  return readResponse(
    await PATCH(jsonRequest(url, { method: "PATCH", body }), {
      params: Promise.resolve({ id: sundayId }),
    }),
  );
}

async function patchTodo(todoId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/todos/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/todos/${todoId}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

describe("Conductor handover — Sacrament slice f2", () => {
  let fixtures: Fixtures;
  let wardId = "";

  let manualSundayId = "";
  let editedSundayId = "";
  let reshiftedSundayId = "";
  let mariaTalkId = "";
  let visitorTalkId = "";
  let reshiftedTalkId = "";
  let mariaId = "";

  let firstConductorId = "";
  let secondConductorId = "";

  type AskRow = {
    id: string;
    user_id: string;
    assigned_by: string | null;
    notes: string | null;
    do_date: string | null;
    completed_at: string | null;
    closed_reason: string | null;
    scheduled_for: string | null;
    scheduled_with_member_id: string | null;
  };

  async function asksFor(assignmentId: string): Promise<AskRow[]> {
    const { data, error } = await fixtures.service
      .from("todos")
      .select(
        "id, user_id, assigned_by, notes, do_date, completed_at, closed_reason, scheduled_for, scheduled_with_member_id",
      )
      .eq("ward_id", wardId)
      .eq("ask_assignment_id", assignmentId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function openAsksFor(assignmentId: string): Promise<AskRow[]> {
    return (await asksFor(assignmentId)).filter((row) => row.completed_at === null);
  }

  async function logLines(todoId: string) {
    const { data, error } = await fixtures.service
      .from("todo_log_entries")
      .select("kind, body")
      .eq("todo_id", todoId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function conductorOf(sundayId: string): Promise<string | null> {
    const { data, error } = await fixtures.service
      .from("sundays")
      .select("conducting_user_id")
      .eq("id", sundayId)
      .single();
    if (error) throw new Error(error.message);
    return data.conducting_user_id;
  }

  async function nameOf(userId: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("users")
      .select("first_name, last_name")
      .eq("id", userId)
      .single();
    if (error) throw new Error(error.message);
    return `${data.first_name} ${data.last_name}`;
  }

  async function latestSundayAudit(): Promise<Record<string, unknown>> {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", wardId)
      .eq("action", "sunday_updated")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (error) throw new Error(error.message);
    return data.detail as Record<string, unknown>;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2"]);
    wardId = fixtures.wardAId;
    const service = fixtures.service;
    const bishop = await asRole(fixtures, "bishop");

    await replaceConductingRotation(
      wardId,
      {
        effectiveFrom: FROM,
        orgId: null,
        cadence: "weekly",
        positions: [
          { position: 1, userId: fixtures.user("bishop").id },
          { position: 2, userId: fixtures.user("counselor1").id },
          { position: 3, userId: fixtures.user("counselor2").id },
        ],
      },
      bishop,
    );
    await generateSundayRange(wardId, FROM, TO, bishop);

    const sundays = await listSundays(wardId, { from: FROM, to: TO }, bishop);
    const idOn = (date: string) => sundays.find((sunday) => sunday.date === date)!.id;
    manualSundayId = idOn(MANUAL_DATE);
    editedSundayId = idOn(EDITED_DATE);
    reshiftedSundayId = idOn(RESHIFTED_DATE);

    const { error: skipError } = await service
      .from("sundays")
      .update({ references_skipped_at: new Date().toISOString() })
      .in("id", [manualSundayId, reshiftedSundayId]);
    if (skipError) throw new Error(skipError.message);

    const { data: maria, error: mariaError } = await service
      .from("members")
      .insert({
        ward_id: wardId,
        first_name: "Maria",
        last_name: `Handover${fixtures.runId}`,
        category: "adult",
        phone: "801-555-0101",
      })
      .select("id")
      .single();
    if (mariaError) throw new Error(mariaError.message);
    mariaId = maria.id;

    const seedTalk = async (
      sundayId: string,
      slotNumber: number,
      speaker: { memberId: string } | { externalName: string },
    ) => {
      const { data, error } = await service
        .from("assignments")
        .insert({
          ward_id: wardId,
          sunday_id: sundayId,
          assignment_type: "sacrament_talk",
          slot_number: slotNumber,
          member_id: "memberId" in speaker ? speaker.memberId : null,
          external_speaker_name: "externalName" in speaker ? speaker.externalName : null,
          pipeline_stage: "plan",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    mariaTalkId = await seedTalk(manualSundayId, 1, { memberId: mariaId });
    visitorTalkId = await seedTalk(manualSundayId, 2, { externalName: "Brother Visitor" });
    reshiftedTalkId = await seedTalk(reshiftedSundayId, 1, { memberId: mariaId });
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("a conductor changed by hand", () => {
    it("starts with the asks on the rotation's conductor", async () => {
      firstConductorId = (await conductorOf(manualSundayId))!;
      expect(firstConductorId).toBeTruthy();

      await actAs(fixtures, "bishop");
      expect((await sendAsks(manualSundayId)).status).toBe(201);

      const [ask] = await openAsksFor(mariaTalkId);
      expect(ask.user_id).toBe(firstConductorId);

      // The conductor schedules the ask and writes on it.
      const handle = BISHOPRIC.find((role) => fixtures.user(role).id === firstConductorId)!;
      await actAs(fixtures, handle);
      const edited = await patchTodo(ask.id, {
        notes: OWNERS_OWN_WORDS,
        scheduledFor: SCHEDULED_FOR,
        scheduledWithMemberId: mariaId,
      });
      expect(edited.status).toBe(200);
    });

    it("moves every open ask to the new conductor as a clean copy, and closes the old one", async () => {
      secondConductorId = BISHOPRIC.map((role) => fixtures.user(role).id).find(
        (id) => id !== firstConductorId,
      )!;

      await actAs(fixtures, "bishop");
      const { status } = await patchSunday(manualSundayId, {
        conductingUserId: secondConductorId,
      });
      expect(status).toBe(200);

      const newOwnersName = await nameOf(secondConductorId);

      for (const talkId of [mariaTalkId, visitorTalkId]) {
        const rows = await asksFor(talkId);
        const old = rows.find((row) => row.user_id === firstConductorId)!;
        const copy = rows.find((row) => row.user_id === secondConductorId)!;

        // Closed, never deleted, with a line naming who took it over.
        expect(old.completed_at).not.toBeNull();
        expect(old.closed_reason).toBe("handed_over");
        expect(await logLines(old.id)).toContainEqual({
          kind: "handed_over",
          body: newOwnersName,
        });

        expect(copy.completed_at).toBeNull();
        expect(copy.assigned_by).toBe(fixtures.user("bishop").id);
        expect(copy.do_date).not.toBeNull();
      }

      // The appointment follows the work; the old owner's words do not (U6).
      const [mariaCopy] = await openAsksFor(mariaTalkId);
      expect(mariaCopy.user_id).toBe(secondConductorId);
      expect(mariaCopy.scheduled_for).toBe("2027-07-01T01:30:00+00:00");
      expect(mariaCopy.scheduled_with_member_id).toBe(mariaId);
      expect(mariaCopy.notes).toContain("Phone: 801-555-0101");
      expect(mariaCopy.notes).not.toContain(OWNERS_OWN_WORDS);

      const oldMaria = (await asksFor(mariaTalkId)).find(
        (row) => row.user_id === firstConductorId,
      )!;
      expect(oldMaria.notes).toBe(OWNERS_OWN_WORDS);

      const audit = await latestSundayAudit();
      expect(audit.asksHandedOver).toMatchObject({
        complete: true,
        sundayIds: [manualSundayId],
      });
      const handedOver = audit.asksHandedOver as {
        createdTodoIds: string[];
        closedTodoIds: string[];
      };
      expect(handedOver.createdTodoIds).toHaveLength(2);
      expect(handedOver.closedTodoIds).toHaveLength(2);
    });

    // Walking scenario 079 found the old copy still on the old owner's My Appointments, marked
    // "Done", beside the new owner's copy of the same meeting.
    it("moves the appointment off the old owner's My Appointments and onto the new owner's", async () => {
      const appointmentIds = async (handle: FixtureHandle) => {
        await actAs(fixtures, handle);
        const sources = await listMyAppointmentSources(
          actingClient(),
          wardId,
          fixtures.user(handle).id,
          new Date("2027-06-01T00:00:00Z"),
        );
        return sources.filter((source) => source.kind === "todo").map((source) => source.id);
      };
      const handleOf = (userId: string) =>
        BISHOPRIC.find((role) => fixtures.user(role).id === userId)!;

      const [mariaCopy] = await openAsksFor(mariaTalkId);
      expect(await appointmentIds(handleOf(secondConductorId))).toEqual([mariaCopy.id]);
      expect(await appointmentIds(handleOf(firstConductorId))).toEqual([]);
    });

    it("repairs a half-finished move on the next save, without a second copy", async () => {
      // What a run that stopped after the copy and before the close leaves: the old owner still
      // holds an open ask beside the new owner's.
      const { data: stray, error } = await fixtures.service
        .from("todos")
        .insert({
          ward_id: wardId,
          user_id: firstConductorId,
          assigned_by: fixtures.user("bishop").id,
          title: "Ask Maria to speak",
          tag: "Sacrament",
          ask_assignment_id: mariaTalkId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await actAs(fixtures, "bishop");
      const { status } = await patchSunday(manualSundayId, { notes: "Retry" });
      expect(status).toBe(200);

      const open = await openAsksFor(mariaTalkId);
      expect(open.map((row) => row.user_id)).toEqual([secondConductorId]);

      const closed = (await asksFor(mariaTalkId)).find((row) => row.id === stray.id)!;
      expect(closed.closed_reason).toBe("handed_over");

      const audit = await latestSundayAudit();
      expect(audit.asksHandedOver).toMatchObject({
        complete: true,
        createdTodoIds: [],
        closedTodoIds: [stray.id],
      });
    });

    it("adds nothing to the audit row when no ask had to move", async () => {
      await actAs(fixtures, "bishop");
      expect((await patchSunday(manualSundayId, { notes: "Nothing to move" })).status).toBe(200);

      const audit = await latestSundayAudit();
      expect(audit).not.toHaveProperty("asksHandedOver");
    });

    it("leaves the asks where they are when nobody conducts", async () => {
      await actAs(fixtures, "bishop");
      expect((await patchSunday(manualSundayId, { conductingUserId: null })).status).toBe(200);

      for (const talkId of [mariaTalkId, visitorTalkId]) {
        const open = await openAsksFor(talkId);
        expect(open.map((row) => row.user_id)).toEqual([secondConductorId]);
      }
    });
  });

  describe("a conductor moved by a re-shift", () => {
    it("moves the later Sunday's asks to whoever the re-shift made its conductor", async () => {
      const before = (await conductorOf(reshiftedSundayId))!;

      await actAs(fixtures, "bishop");
      expect((await sendAsks(reshiftedSundayId)).status).toBe(201);
      expect((await openAsksFor(reshiftedTalkId)).map((row) => row.user_id)).toEqual([before]);

      const { status, body } = await patchSunday(
        editedSundayId,
        { type: "stake_conference" },
        true,
      );
      expect(status).toBe(200);
      expect(body.conductingReshiftCount).toBeGreaterThan(0);

      const after = await conductorOf(reshiftedSundayId);
      expect(after).not.toBeNull();
      expect(after).not.toBe(before);

      const rows = await asksFor(reshiftedTalkId);
      expect(rows.filter((row) => row.completed_at === null).map((row) => row.user_id)).toEqual([
        after,
      ]);
      expect(rows.find((row) => row.user_id === before)?.closed_reason).toBe("handed_over");

      const audit = await latestSundayAudit();
      expect(audit.asksHandedOver).toMatchObject({
        complete: true,
        sundayIds: [reshiftedSundayId],
      });
    });
  });
});
