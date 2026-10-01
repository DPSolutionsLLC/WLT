// @vitest-environment node
//
// ITER-036: FINALIZING A SUNDAY'S SPEAKERS IS WHAT ASKS THEM (lib/sacrament/finalizePeople.ts).
//
// D1/D6  finalize puts one ask per speaker on the CONDUCTOR's To Do; a second finalize asks nobody
// D5     References undecided does not stop it
// D2     a speaker change un-finalizes; re-finalizing asks only the new person
// D3     a withdrawn ask is deleted when untouched, closed with a line when touched
// D4     a scheduled ask stays (unlinked on a speaker change); GET names who is affected
//        a DECLINE never un-finalizes
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so every query runs as a real
// user against the hosted project. Writes are asserted by re-reading with the service client. The
// tests run IN ORDER over one Sunday, each from the state the previous one left.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api";
// 7:00 PM on Saturday the 2nd in Denver, which is the 3rd in UTC.
const SCHEDULED_FOR = "2027-10-03T01:00:00.000Z";

async function finalize(sundayId: string, finalized: boolean) {
  const { PATCH } = await import("@/app/api/sundays/[id]/speakers-finalized/route");
  return readResponse(
    await PATCH(
      jsonRequest(`${BASE}/sundays/${sundayId}/speakers-finalized`, {
        method: "PATCH",
        body: { finalized },
      }),
      { params: Promise.resolve({ id: sundayId }) },
    ),
  );
}

async function preview(sundayId: string) {
  const { GET } = await import("@/app/api/sundays/[id]/speakers-finalized/route");
  return readResponse(
    await GET(jsonRequest(`${BASE}/sundays/${sundayId}/speakers-finalized`), {
      params: Promise.resolve({ id: sundayId }),
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

async function createAssignment(body: unknown) {
  const { POST } = await import("@/app/api/assignments/route");
  return readResponse(await POST(jsonRequest(`${BASE}/assignments`, { method: "POST", body })));
}

async function answer(todoId: string, body: unknown) {
  const { POST } = await import("@/app/api/todos/[id]/answer/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/todos/${todoId}/answer`, { method: "POST", body }), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

describe("Finalize speakers — ITER-036", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let noConductorSundayId = "";
  let newTalkSundayId = "";
  let mariaTalkId = "";
  let tomasTalkId = "";
  let anaTalkId = "";
  let rosaId = "";
  let lucasId = "";
  let ninaId = "";

  type AskRow = {
    id: string;
    user_id: string;
    completed_at: string | null;
    closed_reason: string | null;
    scheduled_for: string | null;
    ask_assignment_id: string | null;
  };

  async function asksFor(assignmentId: string): Promise<AskRow[]> {
    const { data, error } = await fixtures.service
      .from("todos")
      .select("id, user_id, completed_at, closed_reason, scheduled_for, ask_assignment_id")
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

  async function readTodo(todoId: string): Promise<AskRow | null> {
    const { data, error } = await fixtures.service
      .from("todos")
      .select("id, user_id, completed_at, closed_reason, scheduled_for, ask_assignment_id")
      .eq("id", todoId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async function logKinds(todoId: string): Promise<string[]> {
    const { data, error } = await fixtures.service
      .from("todo_log_entries")
      .select("kind")
      .eq("todo_id", todoId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.kind);
  }

  async function stampOf(id: string): Promise<string | null> {
    const { data, error } = await fixtures.service
      .from("sundays")
      .select("speakers_finalized_at")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data.speakers_finalized_at;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2", "eqPresident"]);
    const service = fixtures.service;

    const { error: zoneError } = await service
      .from("wards")
      .update({ settings: { timezone: "America/Denver" } })
      .eq("id", fixtures.wardAId);
    if (zoneError) throw new Error(zoneError.message);

    const seedSunday = async (date: string, conductor: string | null, slots = 3) => {
      const { data, error } = await service
        .from("sundays")
        .insert({
          ward_id: fixtures.wardAId,
          date,
          type: "standard",
          speaking_slots: slots,
          conducting_user_id: conductor,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    // References are NEVER decided on these Sundays — D5.
    sundayId = await seedSunday("2027-10-10", fixtures.user("counselor1").id);
    noConductorSundayId = await seedSunday("2027-10-17", null);
    newTalkSundayId = await seedSunday("2027-10-24", fixtures.user("counselor2").id, 2);

    const seedMember = async (firstName: string) => {
      const { data, error } = await service
        .from("members")
        .insert({
          ward_id: fixtures.wardAId,
          first_name: firstName,
          last_name: `Final${fixtures.runId}`,
          category: "adult",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    const mariaId = await seedMember("Maria");
    const tomasId = await seedMember("Tomas");
    const anaId = await seedMember("Ana");
    rosaId = await seedMember("Rosa");
    lucasId = await seedMember("Lucas");
    ninaId = await seedMember("Nina");

    const seedTalk = async (sunday: string, slotNumber: number, memberId: string) => {
      const { data, error } = await service
        .from("assignments")
        .insert({
          ward_id: fixtures.wardAId,
          sunday_id: sunday,
          assignment_type: "sacrament_talk",
          slot_number: slotNumber,
          topic_title: `Hope ${fixtures.runId}`,
          member_id: memberId,
          pipeline_stage: "plan",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    mariaTalkId = await seedTalk(sundayId, 1, mariaId);
    tomasTalkId = await seedTalk(sundayId, 2, tomasId);
    anaTalkId = await seedTalk(sundayId, 3, anaId);
    await seedTalk(noConductorSundayId, 1, mariaId);
    await seedTalk(newTalkSundayId, 1, tomasId);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("is refused without talks.request", async () => {
    await actAs(fixtures, "eqPresident");
    expect((await finalize(sundayId, true)).status).toBe(403);
    expect(await stampOf(sundayId)).toBeNull();
  });

  it("is refused with a sentence when nobody is conducting (D6)", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await finalize(noConductorSundayId, true);
    expect(status).toBe(400);
    expect(errorMessage(body)).toMatch(/Nobody is conducting this Sunday yet/);
    expect(await stampOf(noConductorSundayId)).toBeNull();
  });

  it("previews whose To Do the asks go to, by name, when that is somebody else (D6)", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await preview(sundayId);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      finalized: false,
      hasConductor: true,
      conductorIsYou: false,
      conductorName: `counselor1 Fixture${fixtures.runId}`,
      toAsk: 3,
      unfinalizeWarning: null,
    });
  });

  it("puts one ask per speaker on the CONDUCTOR's To Do, with References undecided (D1, D5)", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await finalize(sundayId, true);
    expect(status).toBe(200);
    expect(body.asked).toBe(3);
    expect(await stampOf(sundayId)).not.toBeNull();

    for (const talkId of [mariaTalkId, tomasTalkId, anaTalkId]) {
      expect((await openAskFor(talkId)).user_id).toBe(fixtures.user("counselor1").id);
    }
  });

  it("asks nobody again on a second finalize, and keeps the instant it was decided", async () => {
    const stamp = await stampOf(sundayId);
    await actAs(fixtures, "bishop");
    const { status, body } = await finalize(sundayId, true);
    expect(status).toBe(200);
    expect(body.asked).toBe(0);
    expect(await stampOf(sundayId)).toBe(stamp);
    for (const talkId of [mariaTalkId, tomasTalkId, anaTalkId]) {
      expect(await asksFor(talkId)).toHaveLength(1);
    }
  });

  it("un-finalizes on a speaker change and DELETES the old person's untouched ask (D2, D3)", async () => {
    const old = await openAskFor(mariaTalkId);
    await actAs(fixtures, "bishop");

    const { status } = await patchAssignment(mariaTalkId, {
      action: "update",
      fields: { memberId: rosaId },
    });
    expect(status).toBe(200);
    expect(await stampOf(sundayId)).toBeNull();
    expect(await readTodo(old.id)).toBeNull();
    // The others' asks are untouched by somebody else's speaker change.
    expect(await asksFor(tomasTalkId)).toHaveLength(1);
  });

  it("CLOSES a touched ask on a speaker change, keeping what its holder wrote (D3)", async () => {
    const old = await openAskFor(tomasTalkId);
    const { error } = await fixtures.service.from("todo_steps").insert({
      ward_id: fixtures.wardAId,
      todo_id: old.id,
      label: "Call after work",
      position: 0,
    });
    if (error) throw new Error(error.message);
    await actAs(fixtures, "bishop");

    expect(
      (await patchAssignment(tomasTalkId, { action: "update", fields: { memberId: lucasId } }))
        .status,
    ).toBe(200);

    const closed = await readTodo(old.id);
    expect(closed?.completed_at).not.toBeNull();
    expect(closed?.closed_reason).toBe("speaker_changed");
    expect(await logKinds(old.id)).toEqual(["speaker_changed"]);
  });

  it("re-finalizing asks only the new people (D2)", async () => {
    const anaAsk = await openAskFor(anaTalkId);
    await actAs(fixtures, "bishop");
    const { body } = await finalize(sundayId, true);
    expect(body.asked).toBe(2);

    expect((await openAskFor(mariaTalkId)).user_id).toBe(fixtures.user("counselor1").id);
    expect((await openAskFor(tomasTalkId)).user_id).toBe(fixtures.user("counselor1").id);
    expect((await openAskFor(anaTalkId)).id).toBe(anaAsk.id);
  });

  it("names who is scheduled and who accepted before an un-finalize (D4)", async () => {
    const anaAsk = await openAskFor(anaTalkId);
    const { error } = await fixtures.service
      .from("todos")
      .update({ scheduled_for: SCHEDULED_FOR })
      .eq("id", anaAsk.id);
    if (error) throw new Error(error.message);

    await actAs(fixtures, "counselor1");
    const rosaAsk = await openAskFor(mariaTalkId);
    expect((await answer(rosaAsk.id, { outcome: "accepted" })).status).toBe(200);

    await actAs(fixtures, "bishop");
    const { body } = await preview(sundayId);
    const warning = String(body.unfinalizeWarning);
    expect(warning).toContain(
      `counselor1 Fixture${fixtures.runId} has an appointment with Ana Final${fixtures.runId} on Sat, Oct 2, 2027, 7:00`,
    );
    expect(warning).toContain(`Rosa Final${fixtures.runId} has already accepted`);
    expect(warning).not.toContain("Lucas");
  });

  it("un-finalizing deletes the unscheduled asks and KEEPS the scheduled one (D3, D4)", async () => {
    const lucasAsk = await openAskFor(tomasTalkId);
    const anaAsk = await openAskFor(anaTalkId);
    await actAs(fixtures, "bishop");

    const { status } = await finalize(sundayId, false);
    expect(status).toBe(200);
    expect(await stampOf(sundayId)).toBeNull();
    expect(await readTodo(lucasAsk.id)).toBeNull();

    const kept = await readTodo(anaAsk.id);
    expect(kept?.completed_at).toBeNull();
    expect(kept?.ask_assignment_id).toBe(anaTalkId);
  });

  it("a DECLINE does not un-finalize the Sunday", async () => {
    await actAs(fixtures, "bishop");
    expect((await finalize(sundayId, true)).body.asked).toBe(1);
    const stamp = await stampOf(sundayId);

    await actAs(fixtures, "counselor1");
    const lucasAsk = await openAskFor(tomasTalkId);
    expect(
      (await answer(lucasAsk.id, { outcome: "declined", declineReason: "not_available" })).status,
    ).toBe(200);

    expect(await stampOf(sundayId)).toBe(stamp);
  });

  it("UNLINKS a scheduled ask on a speaker change, so the new speaker can be asked (D4)", async () => {
    const anaAsk = await openAskFor(anaTalkId);
    await actAs(fixtures, "bishop");

    expect(
      (await patchAssignment(anaTalkId, { action: "update", fields: { memberId: ninaId } })).status,
    ).toBe(200);

    const kept = await readTodo(anaAsk.id);
    expect(kept?.completed_at).toBeNull();
    expect(kept?.scheduled_for).not.toBeNull();
    expect(kept?.ask_assignment_id).toBeNull();
    expect(await logKinds(anaAsk.id)).toEqual(["speaker_changed"]);

    expect((await finalize(sundayId, true)).body.asked).toBe(1);
    expect((await openAskFor(anaTalkId)).id).not.toBe(anaAsk.id);
  });

  it("un-finalizes when a new talk with a speaker is added", async () => {
    await actAs(fixtures, "bishop");
    expect((await finalize(newTalkSundayId, true)).status).toBe(200);
    expect(await stampOf(newTalkSundayId)).not.toBeNull();

    const { status } = await createAssignment({
      sundayId: newTalkSundayId,
      assignmentType: "sacrament_talk",
      slotNumber: 2,
      memberId: rosaId,
    });
    expect(status).toBe(201);
    expect(await stampOf(newTalkSundayId)).toBeNull();
  });

  it("keeps titles and notes out of every audit row", async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("action, detail")
      .eq("ward_id", fixtures.wardAId)
      .in("action", ["sunday_speakers_finalized", "sunday_speakers_unfinalized"]);
    if (error) throw new Error(error.message);

    expect(new Set((data ?? []).map((row) => row.action))).toEqual(
      new Set(["sunday_speakers_finalized", "sunday_speakers_unfinalized"]),
    );
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("to speak");
    expect(serialized).not.toContain(`Final${fixtures.runId}`);
  });
});
