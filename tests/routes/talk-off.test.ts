// @vitest-environment node
//
// Sacrament slices f2b and f2c: when a Sunday stops holding sacrament meeting — or a talk loses its
// slot — its work is CANCELLED: kept as a record, never deleted, and taken off the Sunday. Whoever
// asked each person gets a "Let ___ know it's cancelled" to-do and confirms with Told them. If the
// Sunday holds a meeting again, planning simply starts over.
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so every query runs as a
// genuinely authenticated user against the hosted project. Every assertion about a write re-reads
// the row with the service client.
//
// The tests run IN ORDER over one Sunday. Each step starts from the state the previous one left.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api";
// Not the first Sunday of its month. The month's first Sunday is seeded as a PINNED Fast Sunday,
// so no save of this one can move Fast Sunday onto it (the defect walking scenario 079 found).
const FAST_DATE = "2027-07-04";
const SUNDAY_DATE = "2027-07-18";
const SUNDAY_LABEL = "Sunday, July 18, 2027";

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

async function answer(todoId: string, body: unknown) {
  const { POST } = await import("@/app/api/todos/[id]/answer/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/todos/${todoId}/answer`, { method: "POST", body }), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

async function getTodo(todoId: string) {
  const { GET } = await import("@/app/api/todos/[id]/route");
  return readResponse(
    await GET(jsonRequest(`${BASE}/todos/${todoId}`), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

async function createTalk(body: unknown) {
  const { POST } = await import("@/app/api/assignments/route");
  return readResponse(await POST(jsonRequest(`${BASE}/assignments`, { method: "POST", body })));
}

async function upsertPrayer(body: unknown) {
  const { POST } = await import("@/app/api/prayers/route");
  return readResponse(await POST(jsonRequest(`${BASE}/prayers`, { method: "POST", body })));
}

describe("A Sunday's work is cancelled — Sacrament slices f2b and f2c", () => {
  let fixtures: Fixtures;
  let wardId = "";
  let sundayId = "";
  let mariaId = "";
  let anaId = "";
  let tomasId = "";
  let mariaTalkId = "";
  let anaTalkId = "";
  let visitorTalkId = "";
  let invocationId = "";
  let benedictionId = "";
  let musicalNumberId = "";
  let conductorName = "";

  type TodoRow = {
    id: string;
    user_id: string;
    title: string;
    completed_at: string | null;
    closed_reason: string | null;
    talk_off_at: string | null;
  };

  const TODO_COLUMNS = "id, user_id, title, completed_at, closed_reason, talk_off_at";

  async function todosLinked(
    column: "ask_assignment_id" | "ask_prayer_id" | "musical_number_id",
    id: string,
  ): Promise<TodoRow[]> {
    const { data, error } = await fixtures.service
      .from("todos")
      .select(TODO_COLUMNS)
      .eq("ward_id", wardId)
      .eq(column, id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  const todosFor = (assignmentId: string) => todosLinked("ask_assignment_id", assignmentId);
  const openFor = async (assignmentId: string) =>
    (await todosFor(assignmentId)).filter((row) => row.completed_at === null);

  async function logLines(todoId: string) {
    const { data, error } = await fixtures.service
      .from("todo_log_entries")
      .select("kind, body")
      .eq("todo_id", todoId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function readRow(table: "assignments" | "prayer_assignments", id: string) {
    const { data, error } = await fixtures.service
      .from(table)
      .select("cancelled_at, cancelled_reason")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function talk(assignmentId: string) {
    const { data, error } = await fixtures.service
      .from("assignments")
      .select("member_id, request_outcome, pipeline_stage, cancelled_at, cancelled_reason")
      .eq("id", assignmentId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function cancelledHistory(assignmentId: string) {
    const { data, error } = await fixtures.service
      .from("assignment_history")
      .select("outcome, cancellation_days_notice")
      .eq("assignment_id", assignmentId);
    if (error) throw new Error(error.message);
    return (data ?? []).filter((row) => row.outcome === "cancelled");
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
    conductorName = `counselor1 Fixture${fixtures.runId}`;

    const { error: fastError } = await service.from("sundays").insert({
      ward_id: wardId,
      date: FAST_DATE,
      type: "fast_sunday",
      speaking_slots: 0,
      fast_sunday_pinned: true,
    });
    if (fastError) throw new Error(fastError.message);

    const { data: sunday, error: sundayError } = await service
      .from("sundays")
      .insert({
        ward_id: wardId,
        date: SUNDAY_DATE,
        type: "standard",
        speaking_slots: 3,
        conducting_user_id: fixtures.user("counselor1").id,
        topics_finalized_at: new Date().toISOString(),
        references_skipped_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (sundayError) throw new Error(sundayError.message);
    sundayId = sunday.id;

    const seedMember = async (firstName: string) => {
      const { data, error } = await service
        .from("members")
        .insert({
          ward_id: wardId,
          first_name: firstName,
          last_name: `Off${fixtures.runId}`,
          category: "adult",
          phone: "801-555-0101",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    mariaId = await seedMember("Maria");
    anaId = await seedMember("Ana");
    tomasId = await seedMember("Tomas");

    const seedTalk = async (
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
    mariaTalkId = await seedTalk(1, { memberId: mariaId });
    anaTalkId = await seedTalk(2, { memberId: anaId });
    visitorTalkId = await seedTalk(3, { externalName: "Brother Visitor" });

    // Tomas was ASKED to give the invocation, by counselor2. Ana is only ASSIGNED the benediction:
    // nobody has asked her, so nobody has anyone to tell.
    const { data: prayers, error: prayerError } = await service
      .from("prayer_assignments")
      .insert([
        {
          ward_id: wardId,
          sunday_id: sundayId,
          prayer_type: "invocation",
          member_id: tomasId,
          stage: "ask",
          asked_by: fixtures.user("counselor2").id,
          asked_at: new Date().toISOString(),
        },
        {
          ward_id: wardId,
          sunday_id: sundayId,
          prayer_type: "benediction",
          member_id: anaId,
          stage: "assign",
        },
      ])
      .select("id, prayer_type");
    if (prayerError) throw new Error(prayerError.message);
    invocationId = prayers.find((row) => row.prayer_type === "invocation")!.id;
    benedictionId = prayers.find((row) => row.prayer_type === "benediction")!.id;

    const { error: hymnError } = await service.from("hymn_selections").insert({
      ward_id: wardId,
      sunday_id: sundayId,
      hymn_type: "opening",
      hymn_number: 2,
      hymn_title: "The Spirit of God",
    });
    if (hymnError) throw new Error(hymnError.message);

    const { data: number, error: numberError } = await service
      .from("musical_numbers")
      .insert({ ward_id: wardId, sunday_id: sundayId, performer: "Ward choir", piece_title: "Abide" })
      .select("id")
      .single();
    if (numberError) throw new Error(numberError.message);
    musicalNumberId = number.id;

    // Three asks for the conductor; Ana accepts hers.
    await actAs(fixtures, "bishop");
    const sent = await sendAsks(sundayId);
    if (sent.status !== 201) throw new Error(`Send asks answered ${sent.status}`);

    await actAs(fixtures, "counselor1");
    const [anaAsk] = await openFor(anaTalkId);
    const accepted = await answer(anaAsk.id, { outcome: "accepted" });
    if (accepted.status !== 200) throw new Error(`Accept answered ${accepted.status}`);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("the meeting is cancelled", () => {
    it("warns what will be cancelled, and who will be told", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await patchSunday(sundayId, { type: "stake_conference" });

      expect(status).toBe(409);
      const message = (body.warning as { message: string }).message;
      expect(message).toContain("Confirming cancels them");
      expect(message).toContain("Its 2 prayer assignments and 2 music choices will be cancelled too.");
      expect(message).toContain(
        `Maria Off${fixtures.runId}, Ana Off${fixtures.runId} and Brother Visitor have been asked to speak that day.`,
      );
      expect(message).toContain(
        `${conductorName} will get a to-do to let them know they're not needed.`,
      );
    });

    it("cancels every talk, prayer and piece of music, deleting nothing", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await patchSunday(sundayId, { type: "stake_conference" }, true);

      expect(status).toBe(200);
      expect(body.workCancelled).toEqual({ assignments: 3, prayers: 2, music: 2 });

      for (const talkId of [mariaTalkId, anaTalkId, visitorTalkId]) {
        const row = await talk(talkId);
        expect(row.cancelled_reason).toBe("no_meeting");
        // The record keeps the stage it reached; it is not sent back to planning.
        expect(row.pipeline_stage).toBe("plan");
      }
      expect((await talk(anaTalkId)).request_outcome).toBe("accepted");
      expect((await talk(mariaTalkId)).member_id).toBe(mariaId);

      for (const prayerId of [invocationId, benedictionId]) {
        expect((await readRow("prayer_assignments", prayerId)).cancelled_reason).toBe("no_meeting");
      }

      const { data: music } = await fixtures.service
        .from("hymn_selections")
        .select("cancelled_reason")
        .eq("sunday_id", sundayId);
      expect(music?.map((row) => row.cancelled_reason)).toEqual(["no_meeting"]);

      const { data: sunday } = await fixtures.service
        .from("sundays")
        .select("topics_finalized_at, references_finalized_at, references_skipped_at")
        .eq("id", sundayId)
        .single();
      expect(sunday).toEqual({
        topics_finalized_at: null,
        references_finalized_at: null,
        references_skipped_at: null,
      });
    });

    it("writes a cancelled speaker-history row for each member, never a late cancellation", async () => {
      for (const talkId of [mariaTalkId, anaTalkId]) {
        const rows = await cancelledHistory(talkId);
        expect(rows).toEqual([{ outcome: "cancelled", cancellation_days_notice: null }]);
      }
      // A visitor has no history row (migration 005: member_id not null).
      expect(await cancelledHistory(visitorTalkId)).toEqual([]);
    });

    it("keeps each open ask with its owner, marked, and tells whoever asked the rest", async () => {
      const counselorId = fixtures.user("counselor1").id;
      for (const talkId of [mariaTalkId, visitorTalkId]) {
        const [ask] = await openFor(talkId);
        expect(ask.user_id).toBe(counselorId);
        expect(ask.talk_off_at).not.toBeNull();
        expect(await logLines(ask.id)).toContainEqual({ kind: "talk_off", body: SUNDAY_LABEL });
      }

      const [tell] = await openFor(anaTalkId);
      expect(tell.user_id).toBe(counselorId);
      expect(tell.title).toBe(`Let Ana Off${fixtures.runId} know the talk is cancelled`);

      // The invocation's asker is told; the benediction was never asked.
      const [prayerTell] = await todosLinked("ask_prayer_id", invocationId);
      expect(prayerTell.user_id).toBe(fixtures.user("counselor2").id);
      expect(prayerTell.title).toBe(`Let Tomas Off${fixtures.runId} know the prayer is cancelled`);
      expect(prayerTell.talk_off_at).not.toBeNull();
      expect(await todosLinked("ask_prayer_id", benedictionId)).toEqual([]);

      // Nothing records who arranged the musical number, so the person who cancelled is told.
      const [musicTell] = await todosLinked("musical_number_id", musicalNumberId);
      expect(musicTell.user_id).toBe(fixtures.user("bishop").id);
      expect(musicTell.title).toBe("Let Ward choir know the musical number is cancelled");

      const audit = await latestSundayAudit();
      expect(audit.workCancelled).toEqual({ assignments: 3, prayers: 2, music: 2 });
      const talkAsks = audit.talkAsks as {
        markedOffTodoIds: string[];
        tellTodoIds: string[];
        historyWrittenAssignmentIds: string[];
      };
      expect(talkAsks.markedOffTodoIds).toHaveLength(2);
      expect(talkAsks.tellTodoIds).toHaveLength(3);
      expect(talkAsks.historyWrittenAssignmentIds.sort()).toEqual([mariaTalkId, anaTalkId].sort());
    });

    it("shows the owner that the talk is off, and refuses Accepted", async () => {
      await actAs(fixtures, "counselor1");
      const [ask] = await openFor(mariaTalkId);

      const { body } = await getTodo(ask.id);
      expect((body.todo as { askSource: { talkOff: boolean } }).askSource.talkOff).toBe(true);

      const { status, body: refusal } = await answer(ask.id, { outcome: "accepted" });
      expect(status).toBe(400);
      expect(errorMessage(refusal)).toMatch(/press Told them/);
    });

    it("closes a to-do with Told them and leaves the cancelled record as it was", async () => {
      await actAs(fixtures, "counselor1");
      const [tell] = await openFor(anaTalkId);
      expect((await answer(tell.id, { outcome: "told" })).status).toBe(200);

      const closed = (await todosFor(anaTalkId)).find((row) => row.id === tell.id)!;
      expect(closed.closed_reason).toBe("told_not_needed");
      expect(await logLines(tell.id)).toContainEqual({ kind: "told_not_needed", body: null });
      expect((await talk(anaTalkId)).request_outcome).toBe("accepted");

      // A prayer's to-do closes on its own.
      await actAs(fixtures, "counselor2");
      const [prayerTell] = await todosLinked("ask_prayer_id", invocationId);
      expect((await answer(prayerTell.id, { outcome: "told" })).status).toBe(200);
      const [closedPrayer] = await todosLinked("ask_prayer_id", invocationId);
      expect(closedPrayer.closed_reason).toBe("told_not_needed");
    });

    it("writes nothing twice on the next save, and never brings a told to-do back", async () => {
      await actAs(fixtures, "bishop");
      expect((await patchSunday(sundayId, { notes: "Stake conference" })).status).toBe(200);

      expect(await todosFor(anaTalkId)).toHaveLength(2);
      expect(await openFor(anaTalkId)).toHaveLength(0);
      expect(await todosLinked("ask_prayer_id", invocationId)).toHaveLength(1);
      expect(await todosLinked("musical_number_id", musicalNumberId)).toHaveLength(1);
      expect(await cancelledHistory(mariaTalkId)).toHaveLength(1);
      expect(await latestSundayAudit()).not.toHaveProperty("talkAsks");
    });
  });

  describe("the meeting comes back", () => {
    it("reads as an empty Sunday, and leaves the unfinished to-dos open", async () => {
      await actAs(fixtures, "bishop");
      // A Sunday with no meeting has no conductor, and this ward has no rotation to refill it, so
      // the bishopric names one as the meeting comes back.
      const { status } = await patchSunday(
        sundayId,
        { type: "standard", speakingSlots: 3, conductingUserId: fixtures.user("counselor1").id },
        true,
      );
      expect(status).toBe(200);

      // The user's decision C6: the cancellation happened, so these people still need telling.
      expect(await openFor(mariaTalkId)).toHaveLength(1);
      expect(await openFor(visitorTalkId)).toHaveLength(1);
      expect((await talk(mariaTalkId)).cancelled_reason).toBe("no_meeting");
    });

    it("lets planning start over in the same slots", async () => {
      await actAs(fixtures, "bishop");
      const created = await createTalk({
        sundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 1,
        memberId: tomasId,
      });
      expect(created.status).toBe(201);

      const prayer = await upsertPrayer({ sundayId, prayerType: "invocation", memberId: mariaId });
      expect(prayer.status).toBeLessThan(300);

      const { data: live } = await fixtures.service
        .from("prayer_assignments")
        .select("id")
        .eq("sunday_id", sundayId)
        .eq("prayer_type", "invocation")
        .is("cancelled_at", null);
      expect(live).toHaveLength(1);
      expect(live?.[0].id).not.toBe(invocationId);
    });
  });

  describe("a slot is cut", () => {
    it("cancels only the talk whose slot is gone, and leaves prayers alone", async () => {
      const { data: third, error } = await fixtures.service
        .from("assignments")
        .insert({
          ward_id: wardId,
          sunday_id: sundayId,
          assignment_type: "sacrament_talk",
          slot_number: 3,
          member_id: anaId,
          pipeline_stage: "plan",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await actAs(fixtures, "bishop");
      const { status, body } = await patchSunday(sundayId, { speakingSlots: 2 }, true);
      expect(status).toBe(200);
      expect(body.workCancelled).toEqual({ assignments: 1, prayers: 0, music: 0 });

      expect((await readRow("assignments", third.id)).cancelled_reason).toBe("slot_removed");

      const { data: liveTalks } = await fixtures.service
        .from("assignments")
        .select("slot_number")
        .eq("sunday_id", sundayId)
        .is("cancelled_at", null);
      expect(liveTalks?.map((row) => row.slot_number)).toEqual([1]);
    });

    it("refuses Told them on a to-do whose talk is still on", async () => {
      await actAs(fixtures, "bishop");
      const { error } = await fixtures.service
        .from("sundays")
        .update({ references_skipped_at: new Date().toISOString() })
        .eq("id", sundayId);
      if (error) throw new Error(error.message);
      expect((await sendAsks(sundayId)).status).toBe(201);

      const { data: tomasTalk } = await fixtures.service
        .from("assignments")
        .select("id")
        .eq("sunday_id", sundayId)
        .eq("member_id", tomasId)
        .is("cancelled_at", null)
        .single();
      await actAs(fixtures, "counselor1");
      const [ask] = await openFor(tomasTalk!.id);
      const { status, body } = await answer(ask.id, { outcome: "told" });

      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/still on/);
    });
  });
});
