// @vitest-environment node
//
// Sacrament slice f2b: when a talk is OFF — its Sunday holds no meeting, or its slot is gone —
// whoever asked the speaker is told to let them know, and if the talk comes back the speaker is
// asked again from scratch.
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

describe("A talk that is off — Sacrament slice f2b", () => {
  let fixtures: Fixtures;
  let wardId = "";
  let sundayId = "";
  let mariaTalkId = "";
  let anaTalkId = "";
  let visitorTalkId = "";
  let conductorName = "";

  type TodoRow = {
    id: string;
    user_id: string;
    title: string;
    completed_at: string | null;
    closed_reason: string | null;
    talk_off_at: string | null;
  };

  async function todosFor(assignmentId: string): Promise<TodoRow[]> {
    const { data, error } = await fixtures.service
      .from("todos")
      .select("id, user_id, title, completed_at, closed_reason, talk_off_at")
      .eq("ward_id", wardId)
      .eq("ask_assignment_id", assignmentId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function openFor(assignmentId: string): Promise<TodoRow[]> {
    return (await todosFor(assignmentId)).filter((row) => row.completed_at === null);
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

  async function outcomeOf(assignmentId: string) {
    const { data, error } = await fixtures.service
      .from("assignments")
      .select("request_outcome")
      .eq("id", assignmentId)
      .single();
    if (error) throw new Error(error.message);
    return data.request_outcome;
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
    const maria = await seedMember("Maria");
    const ana = await seedMember("Ana");

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
    mariaTalkId = await seedTalk(1, { memberId: maria });
    anaTalkId = await seedTalk(2, { memberId: ana });
    visitorTalkId = await seedTalk(3, { externalName: "Brother Visitor" });

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
    it("warns who was asked, and who will be told to let them know", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await patchSunday(sundayId, { type: "stake_conference" });

      expect(status).toBe(409);
      const message = (body.warning as { message: string }).message;
      expect(message).toContain(
        `Maria Off${fixtures.runId}, Ana Off${fixtures.runId} and Brother Visitor have been asked to speak that day.`,
      );
      expect(message).toContain(
        `${conductorName} will get a to-do to let them know they're not needed.`,
      );
    });

    it("keeps each open ask with its owner, marked, and gives an accepted speaker's asker a to-do", async () => {
      await actAs(fixtures, "bishop");
      expect((await patchSunday(sundayId, { type: "stake_conference" }, true)).status).toBe(200);

      const counselorId = fixtures.user("counselor1").id;
      for (const talkId of [mariaTalkId, visitorTalkId]) {
        const [ask] = await openFor(talkId);
        expect(ask.user_id).toBe(counselorId);
        expect(ask.talk_off_at).not.toBeNull();
        expect(await logLines(ask.id)).toContainEqual({ kind: "talk_off", body: SUNDAY_LABEL });
      }

      const [tell] = await openFor(anaTalkId);
      expect(tell.user_id).toBe(counselorId);
      expect(tell.title).toBe(`Let Ana Off${fixtures.runId} know there's no talk`);
      expect(tell.talk_off_at).not.toBeNull();
      expect(await logLines(tell.id)).toEqual([{ kind: "talk_off", body: SUNDAY_LABEL }]);

      const audit = await latestSundayAudit();
      const talkAsks = audit.talkAsks as { markedOffTodoIds: string[]; tellTodoIds: string[] };
      expect(talkAsks.markedOffTodoIds).toHaveLength(2);
      expect(talkAsks.tellTodoIds).toEqual([tell.id]);
    });

    it("shows the owner that the talk is off", async () => {
      await actAs(fixtures, "counselor1");
      const [ask] = await openFor(mariaTalkId);
      const { status, body } = await getTodo(ask.id);

      expect(status).toBe(200);
      expect((body.todo as { askSource: { talkOff: boolean } }).askSource.talkOff).toBe(true);
    });

    it("refuses Accepted while the talk is off, and says what to do instead", async () => {
      await actAs(fixtures, "counselor1");
      const [ask] = await openFor(mariaTalkId);
      const { status, body } = await answer(ask.id, { outcome: "accepted" });

      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/press Told them/);
      expect(await outcomeOf(mariaTalkId)).toBeNull();
    });

    it("closes the item with Told them and clears the talk's answer", async () => {
      await actAs(fixtures, "counselor1");
      const [tell] = await openFor(anaTalkId);
      const { status } = await answer(tell.id, { outcome: "told" });

      expect(status).toBe(200);
      const closed = (await todosFor(anaTalkId)).find((row) => row.id === tell.id)!;
      expect(closed.closed_reason).toBe("told_not_needed");
      expect(await logLines(tell.id)).toContainEqual({ kind: "told_not_needed", body: null });
      expect(await outcomeOf(anaTalkId)).toBeNull();
    });

    it("writes nothing twice on the next save", async () => {
      await actAs(fixtures, "bishop");
      expect((await patchSunday(sundayId, { notes: "Stake conference" })).status).toBe(200);

      expect(await openFor(mariaTalkId)).toHaveLength(1);
      expect(await openFor(anaTalkId)).toHaveLength(0);
      expect(await latestSundayAudit()).not.toHaveProperty("talkAsks");
    });
  });

  describe("the meeting comes back", () => {
    it("closes what was left open and asks everybody again from scratch", async () => {
      await actAs(fixtures, "bishop");
      // A Sunday with no meeting has no conductor, and this ward has no rotation to refill it, so
      // the bishopric names one as the meeting comes back.
      const { status } = await patchSunday(
        sundayId,
        { type: "standard", speakingSlots: 3, conductingUserId: fixtures.user("counselor1").id },
        true,
      );
      expect(status).toBe(200);

      for (const talkId of [mariaTalkId, visitorTalkId]) {
        expect(await openFor(talkId)).toHaveLength(0);
        const rows = await todosFor(talkId);
        expect(rows.at(-1)?.closed_reason).toBe("talk_back_on");
        expect(await logLines(rows.at(-1)!.id)).toContainEqual({
          kind: "talk_back_on",
          body: null,
        });
      }

      // Send asks offers all three again: Maria and the visitor were never answered, and Ana's
      // acceptance was cleared when the conductor told her.
      const sent = await sendAsks(sundayId);
      expect(sent.status).toBe(201);
      expect(sent.body.sent).toBe(3);
    });

    it("refuses Told them while the talk is on", async () => {
      await actAs(fixtures, "counselor1");
      const [ask] = await openFor(mariaTalkId);
      const { status, body } = await answer(ask.id, { outcome: "told" });

      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/still on/);
    });
  });

  describe("a slot is cut", () => {
    it("marks only the talk whose slot is gone", async () => {
      await actAs(fixtures, "bishop");
      expect((await patchSunday(sundayId, { speakingSlots: 2 }, true)).status).toBe(200);

      const [visitorAsk] = await openFor(visitorTalkId);
      expect(visitorAsk.talk_off_at).not.toBeNull();
      const [mariaAsk] = await openFor(mariaTalkId);
      expect(mariaAsk.talk_off_at).toBeNull();
    });
  });
});
