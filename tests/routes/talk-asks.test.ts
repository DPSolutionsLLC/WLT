// @vitest-environment node
//
// Sacrament slice f1: Send asks, answering an ask on the conductor's To Do, and what a speaker
// change does to an ask.
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so every query runs as a
// genuinely authenticated user against the hosted project. A 404 for somebody else's ask therefore
// means RLS hid it (migration 081). Each assertion about a write re-reads the row with the service
// client rather than trusting the response.
//
// The tests run IN ORDER over one Sunday. Each step starts from the state the previous one left,
// which is how a bishopric actually works through a Sunday.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NO_CONTACT_LINE, VISITOR_CONTACT_LINE } from "@/lib/sacrament/talkAsks";
import { listMyAppointmentSources } from "@/lib/appointments/queries";
import {
  actAs,
  actingClient,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api";
const PRIVATE_NOTE = "PRIVATE DECLINE NOTE — travelling to see her mother";

async function getAsks(sundayId: string) {
  const { GET } = await import("@/app/api/sundays/[id]/asks/route");
  return readResponse(
    await GET(jsonRequest(`${BASE}/sundays/${sundayId}/asks`), {
      params: Promise.resolve({ id: sundayId }),
    }),
  );
}

async function sendAsks(sundayId: string) {
  const { POST } = await import("@/app/api/sundays/[id]/asks/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/sundays/${sundayId}/asks`, { method: "POST" }), {
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

async function patchTodo(todoId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/todos/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/todos/${todoId}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

async function deleteTodo(todoId: string) {
  const { DELETE } = await import("@/app/api/todos/[id]/route");
  return readResponse(
    await DELETE(jsonRequest(`${BASE}/todos/${todoId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

async function patchAssignment(assignmentId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/assignments/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/assignments/${assignmentId}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id: assignmentId }),
    }),
  );
}

describe("Talk asks — Sacrament slice f1", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let lockedSundayId = "";
  let withPhoneTalkId = "";
  let noPhoneTalkId = "";
  let visitorTalkId = "";
  let withPhoneMemberId = "";
  let noPhoneMemberId = "";
  let replacementMemberId = "";

  type AskRow = {
    id: string;
    user_id: string;
    assigned_by: string | null;
    title: string;
    notes: string | null;
    tag: string | null;
    completed_at: string | null;
    closed_reason: string | null;
    ask_assignment_id: string | null;
  };

  async function asksFor(assignmentId: string): Promise<AskRow[]> {
    const { data, error } = await fixtures.service
      .from("todos")
      .select("id, user_id, assigned_by, title, notes, tag, completed_at, closed_reason, ask_assignment_id")
      .eq("ward_id", fixtures.wardAId)
      .eq("ask_assignment_id", assignmentId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function openAskFor(assignmentId: string): Promise<AskRow> {
    const open = (await asksFor(assignmentId)).filter((row) => row.completed_at === null);
    expect(open).toHaveLength(1);
    return open[0];
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

  async function readTalk(assignmentId: string) {
    const { data, error } = await fixtures.service
      .from("assignments")
      .select("member_id, external_speaker_name, request_outcome, request_notes, pipeline_stage")
      .eq("id", assignmentId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function setSunday(id: string, patch: Database["public"]["Tables"]["sundays"]["Update"]) {
    const { error } = await fixtures.service.from("sundays").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2"]);
    const service = fixtures.service;

    const seedSunday = async (date: string) => {
      const { data, error } = await service
        .from("sundays")
        .insert({ ward_id: fixtures.wardAId, date, type: "standard", speaking_slots: 3 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    sundayId = await seedSunday("2027-07-04");
    lockedSundayId = await seedSunday("2027-07-11");

    const seedMember = async (firstName: string, phone: string | null) => {
      const { data, error } = await service
        .from("members")
        .insert({
          ward_id: fixtures.wardAId,
          first_name: firstName,
          last_name: `Asks${fixtures.runId}`,
          category: "adult",
          phone,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    withPhoneMemberId = await seedMember("Maria", "801-555-0101");
    noPhoneMemberId = await seedMember("Tomas", null);
    replacementMemberId = await seedMember("Ana", "801-555-0199");

    const { data: topic, error: topicError } = await service
      .from("topics")
      .insert({ ward_id: fixtures.wardAId, title: `Faith ${fixtures.runId}`, source: "manual" })
      .select("id")
      .single();
    if (topicError) throw new Error(topicError.message);

    const seedTalk = async (
      sunday: string,
      slotNumber: number,
      speaker: { memberId: string } | { externalName: string },
      stage: "plan" | "approve" = "plan",
    ) => {
      const { data, error } = await service
        .from("assignments")
        .insert({
          ward_id: fixtures.wardAId,
          sunday_id: sunday,
          assignment_type: "sacrament_talk",
          slot_number: slotNumber,
          topic_id: topic.id,
          member_id: "memberId" in speaker ? speaker.memberId : null,
          external_speaker_name: "externalName" in speaker ? speaker.externalName : null,
          pipeline_stage: stage,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    withPhoneTalkId = await seedTalk(sundayId, 1, { memberId: withPhoneMemberId });
    // At `approve`, so the decline below proves the talk is moved BACK to plan, not left there.
    noPhoneTalkId = await seedTalk(sundayId, 2, { memberId: noPhoneMemberId }, "approve");
    visitorTalkId = await seedTalk(sundayId, 3, { externalName: "Brother Visitor" });
    await seedTalk(lockedSundayId, 1, { memberId: withPhoneMemberId });

    const { error: referenceError } = await service.from("talk_references").insert({
      ward_id: fixtures.wardAId,
      assignment_id: withPhoneTalkId,
      kind: "scripture",
      citation: "Alma 32:21",
      source: "manual",
    });
    if (referenceError) throw new Error(referenceError.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("sending", () => {
    it("is refused, and says why, before References is decided", async () => {
      await actAs(fixtures, "bishop");

      const state = await getAsks(lockedSundayId);
      expect(state.status).toBe(200);
      expect(state.body.state).toEqual({ kind: "locked", reason: "references_open" });

      const { status, body } = await sendAsks(lockedSundayId);
      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Finalize or skip References first");
    });

    it("is refused while nobody is conducting", async () => {
      await setSunday(sundayId, { references_skipped_at: new Date().toISOString() });
      await actAs(fixtures, "bishop");

      const { status, body } = await sendAsks(sundayId);
      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/nobody is conducting/i);
      expect(await asksFor(withPhoneTalkId)).toHaveLength(0);
    });

    it("gives the conductor one open ask per speaker, a visitor included", async () => {
      await setSunday(sundayId, { conducting_user_id: fixtures.user("counselor1").id });
      await actAs(fixtures, "bishop");

      const { status, body } = await sendAsks(sundayId);
      expect(status).toBe(201);
      expect(body.sent).toBe(3);

      const counselorId = fixtures.user("counselor1").id;
      const withPhone = await openAskFor(withPhoneTalkId);
      const noPhone = await openAskFor(noPhoneTalkId);
      const visitor = await openAskFor(visitorTalkId);

      for (const ask of [withPhone, noPhone, visitor]) {
        expect(ask.user_id).toBe(counselorId);
        expect(ask.assigned_by).toBe(fixtures.user("bishop").id);
        expect(ask.tag).toBe("Sacrament");
      }

      expect(withPhone.title).toBe(`Ask Maria Asks${fixtures.runId} to speak`);
      expect(withPhone.notes).toContain("Phone: 801-555-0101");
      expect(withPhone.notes).toContain("- Alma 32:21");
      expect(noPhone.notes).toContain(NO_CONTACT_LINE);
      expect(visitor.title).toBe("Ask Brother Visitor to speak");
      expect(visitor.notes).toContain(VISITOR_CONTACT_LINE);
    });

    it("sends nothing the second time", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await sendAsks(sundayId);
      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Everyone on this Sunday has been asked.");

      expect(await asksFor(withPhoneTalkId)).toHaveLength(1);
      expect(await asksFor(noPhoneTalkId)).toHaveLength(1);
      expect(await asksFor(visitorTalkId)).toHaveLength(1);

      const state = await getAsks(sundayId);
      expect(state.body.state).toEqual({ kind: "pending" });
    });
  });

  // The card, "Schedule this" and My Appointments show these, read live from the talk (the user's
  // request walking scenario 078).
  describe("what an ask carries to the card and to My Appointments", () => {
    it("returns the topic, the phone and the speaker's member id on the conductor's list", async () => {
      await actAs(fixtures, "counselor1");
      const { GET } = await import("@/app/api/todos/route");
      const { status, body } = await readResponse(
        await GET(jsonRequest(`${BASE}/todos?status=open`)),
      );
      expect(status).toBe(200);

      const todos = body.todos as { askSource: Record<string, unknown> | null }[];
      const bySpeaker = new Map(
        todos.flatMap((todo) =>
          todo.askSource === null ? [] : [[todo.askSource.assignmentId, todo.askSource] as const],
        ),
      );

      expect(bySpeaker.get(withPhoneTalkId)).toMatchObject({
        topicTitle: `Faith ${fixtures.runId}`,
        phone: "801-555-0101",
        onRoster: true,
        speakerMemberId: withPhoneMemberId,
        sundayDate: "2027-07-04",
        isOpen: true,
      });
      expect(bySpeaker.get(noPhoneTalkId)).toMatchObject({ phone: null, onRoster: true });
      expect(bySpeaker.get(visitorTalkId)).toMatchObject({
        speakerName: "Brother Visitor",
        speakerMemberId: null,
        onRoster: false,
      });
    });

    it("carries the same details onto My Appointments once the ask is scheduled", async () => {
      const ask = await openAskFor(withPhoneTalkId);
      await actAs(fixtures, "counselor1");

      const scheduled = await patchTodo(ask.id, {
        scheduledFor: "2027-07-01T01:30:00.000Z",
        scheduledWithMemberId: withPhoneMemberId,
      });
      expect(scheduled.status).toBe(200);

      const sources = await listMyAppointmentSources(
        actingClient(),
        fixtures.wardAId,
        fixtures.user("counselor1").id,
        new Date("2027-06-01T00:00:00Z"),
      );
      const row = sources.find((source) => source.id === ask.id);

      expect(row).toMatchObject({
        kind: "todo",
        ask: { topicTitle: `Faith ${fixtures.runId}`, phone: "801-555-0101", isOpen: true },
      });
    });
  });

  describe("refusals on an open ask", () => {
    it("hides the conductor's ask from another bishopric member entirely", async () => {
      const ask = await openAskFor(withPhoneTalkId);
      await actAs(fixtures, "bishop");

      expect((await answer(ask.id, { outcome: "accepted" })).status).toBe(404);
      expect((await deleteTodo(ask.id)).status).toBe(404);
      expect((await openAskFor(withPhoneTalkId)).id).toBe(ask.id);
    });

    it("refuses its owner a delete, naming the alternative", async () => {
      const ask = await openAskFor(withPhoneTalkId);
      await actAs(fixtures, "counselor1");

      const { status, body } = await deleteTodo(ask.id);
      expect(status).toBe(409);
      expect(errorMessage(body)).toBe("Record their answer instead — Accepted or Declined.");
      expect((await openAskFor(withPhoneTalkId)).id).toBe(ask.id);
    });

    it("refuses its owner a plain tick", async () => {
      const ask = await openAskFor(withPhoneTalkId);
      await actAs(fixtures, "counselor1");

      const { status, body } = await patchTodo(ask.id, { complete: true });
      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Record their answer — Accepted or Declined.");
      expect((await openAskFor(withPhoneTalkId)).completed_at).toBeNull();
    });

    it("refuses a decline with no reason", async () => {
      const ask = await openAskFor(withPhoneTalkId);
      await actAs(fixtures, "counselor1");

      const { status } = await answer(ask.id, { outcome: "declined" });
      expect(status).toBe(400);
      expect((await readTalk(withPhoneTalkId)).request_outcome).toBeNull();
    });
  });

  describe("answering", () => {
    it("records an acceptance on the talk and closes the ask with an Accepted line", async () => {
      const ask = await openAskFor(withPhoneTalkId);
      await actAs(fixtures, "counselor1");

      const { status } = await answer(ask.id, { outcome: "accepted" });
      expect(status).toBe(200);

      const talk = await readTalk(withPhoneTalkId);
      expect(talk.request_outcome).toBe("accepted");
      expect(talk.member_id).toBe(withPhoneMemberId);

      const [closed] = await asksFor(withPhoneTalkId);
      expect(closed.completed_at).not.toBeNull();
      expect(closed.closed_reason).toBeNull();
      // Scheduled above, so answered from what would be the meeting on My Appointments.
      expect(await logLines(ask.id)).toEqual([
        { kind: "scheduled", body: null },
        { kind: "ask_accepted", body: null },
      ]);
    });

    it("records a decline: slot reopened, speaker cleared, history with its reason", async () => {
      const ask = await openAskFor(noPhoneTalkId);
      await actAs(fixtures, "counselor1");

      const { status } = await answer(ask.id, {
        outcome: "declined",
        declineReason: "not_available",
        note: PRIVATE_NOTE,
      });
      expect(status).toBe(200);

      const talk = await readTalk(noPhoneTalkId);
      expect(talk.request_outcome).toBe("declined");
      expect(talk.member_id).toBeNull();
      expect(talk.pipeline_stage).toBe("plan");
      expect(talk.request_notes).toBe(PRIVATE_NOTE);

      const { data: history, error } = await fixtures.service
        .from("assignment_history")
        .select("member_id, outcome, decline_reason")
        .eq("assignment_id", noPhoneTalkId);
      if (error) throw new Error(error.message);
      expect(history).toEqual([
        { member_id: noPhoneMemberId, outcome: "declined", decline_reason: "not_available" },
      ]);

      // The reason's LABEL is on the timeline. The note is not.
      expect(await logLines(ask.id)).toEqual([{ kind: "ask_declined", body: "Not available" }]);
    });

    it("records a visitor's decline on the talk and writes no history row", async () => {
      const ask = await openAskFor(visitorTalkId);
      await actAs(fixtures, "counselor1");

      const { status } = await answer(ask.id, { outcome: "declined", declineReason: "other" });
      expect(status).toBe(200);

      expect((await readTalk(visitorTalkId)).request_outcome).toBe("declined");

      const { data: history } = await fixtures.service
        .from("assignment_history")
        .select("id")
        .eq("assignment_id", visitorTalkId);
      expect(history).toEqual([]);
    });

    it("refuses to answer an ask twice", async () => {
      const [answered] = await asksFor(withPhoneTalkId);
      await actAs(fixtures, "counselor1");

      const { status } = await answer(answered.id, { outcome: "declined", declineReason: "other" });
      expect(status).toBe(400);
      expect((await readTalk(withPhoneTalkId)).request_outcome).toBe("accepted");
    });

    it("refuses to reopen an answered ask, naming how to ask again", async () => {
      const [answered] = await asksFor(withPhoneTalkId);
      await actAs(fixtures, "counselor1");

      const { status, body } = await patchTodo(answered.id, { complete: false });
      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/change the speaker on the talk and press Send asks/);

      const [still] = await asksFor(withPhoneTalkId);
      expect(still.completed_at).not.toBeNull();
    });

    it("lets its owner delete an ask once it is answered", async () => {
      const { data: extra, error } = await fixtures.service
        .from("todos")
        .select("id")
        .eq("ask_assignment_id", visitorTalkId)
        .single();
      if (error) throw new Error(error.message);
      await actAs(fixtures, "counselor1");

      expect((await deleteTodo(extra.id)).status).toBe(200);
    });

    it("shows the pill's declined state with its count", async () => {
      await actAs(fixtures, "bishop");
      const { body } = await getAsks(sundayId);
      expect(body.state).toEqual({ kind: "declined", count: 2 });
    });
  });

  describe("a speaker change", () => {
    it("makes a new speaker on a declined slot one to ask, and only them", async () => {
      await actAs(fixtures, "bishop");

      const changed = await patchAssignment(noPhoneTalkId, {
        action: "update",
        fields: { memberId: replacementMemberId },
      });
      expect(changed.status).toBe(200);
      const reset = await readTalk(noPhoneTalkId);
      expect(reset.request_outcome).toBeNull();
      // 078-D2: the old speaker's decline note goes with their answer.
      expect(reset.request_notes).toBeNull();

      const { status, body } = await sendAsks(sundayId);
      expect(status).toBe(201);
      expect(body.sent).toBe(1);

      const fresh = await openAskFor(noPhoneTalkId);
      expect(fresh.title).toBe(`Ask Ana Asks${fixtures.runId} to speak`);
    });

    it("closes the open ask with a line, never deleting it, and clears the outcome", async () => {
      const ask = await openAskFor(noPhoneTalkId);
      await actAs(fixtures, "bishop");

      const changed = await patchAssignment(noPhoneTalkId, {
        action: "update",
        fields: { externalSpeaker: { name: "Sister Guest" } },
      });
      expect(changed.status).toBe(200);

      const { data: closed, error } = await fixtures.service
        .from("todos")
        .select("completed_at, closed_reason")
        .eq("id", ask.id)
        .single();
      if (error) throw new Error(error.message);
      expect(closed.completed_at).not.toBeNull();
      expect(closed.closed_reason).toBe("speaker_changed");
      expect(await logLines(ask.id)).toEqual([{ kind: "speaker_changed", body: null }]);

      const state = await getAsks(sundayId);
      expect(state.body.state).toEqual({ kind: "declined", count: 1 });
    });

    it("leaves an ask alone when only the topic or a contact field changes", async () => {
      await actAs(fixtures, "bishop");
      expect((await sendAsks(sundayId)).status).toBe(201);
      const ask = await openAskFor(noPhoneTalkId);

      const changed = await patchAssignment(noPhoneTalkId, {
        action: "update",
        fields: { slotLengthMinutes: 12 },
      });
      expect(changed.status).toBe(200);
      expect((await openAskFor(noPhoneTalkId)).id).toBe(ask.id);
    });
  });

  describe("an answer from the talk's own panel", () => {
    it("closes the conductor's ask too", async () => {
      const ask = await openAskFor(noPhoneTalkId);
      await actAs(fixtures, "bishop");

      const { status } = await patchAssignment(noPhoneTalkId, {
        action: "record_outcome",
        outcome: "accepted",
      });
      expect(status).toBe(200);
      expect((await readTalk(noPhoneTalkId)).request_outcome).toBe("accepted");

      const { data: closed } = await fixtures.service
        .from("todos")
        .select("completed_at")
        .eq("id", ask.id)
        .single();
      expect(closed?.completed_at).not.toBeNull();
      expect(await logLines(ask.id)).toEqual([{ kind: "ask_accepted", body: null }]);
    });

    it("no longer accepts an outcome through a plain field update", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await patchAssignment(withPhoneTalkId, {
        action: "update",
        fields: { requestOutcome: "declined" },
      });
      expect(status).toBe(400);
      expect((await readTalk(withPhoneTalkId)).request_outcome).toBe("accepted");
    });
  });

  describe("privacy", () => {
    it("keeps titles and notes out of every audit row", async () => {
      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("action, detail")
        .eq("ward_id", fixtures.wardAId)
        .in("action", ["talk_asks_sent", "talk_ask_answered", "assignment_outcome_recorded"]);
      if (error) throw new Error(error.message);

      const actions = new Set((data ?? []).map((row) => row.action));
      expect(actions).toEqual(
        new Set(["talk_asks_sent", "talk_ask_answered", "assignment_outcome_recorded"]),
      );

      const serialized = JSON.stringify(data);
      expect(serialized).not.toContain("PRIVATE DECLINE NOTE");
      expect(serialized).not.toContain("to speak");
      expect(serialized).not.toContain("801-555");
    });
  });
});
