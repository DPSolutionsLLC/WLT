// @vitest-environment node
//
// ITER-036 fb: FINALIZING A SUNDAY'S PRAYERS IS WHAT ASKS THEM (lib/sacrament/finalizePeople.ts).
//
// D1/D6  finalize puts one ask per prayer on the CONDUCTOR's To Do; a second finalize asks nobody
//        Accepted moves the prayer to Confirmed; Declined frees it; neither un-finalizes
// D2     a change of person un-finalizes and starts the prayer over; re-finalizing asks only them
// D3     a withdrawn ask is deleted when untouched, closed with a line when touched
// D4     a scheduled ask stays; GET names who is affected, in the ward's zone
//        a board move to Confirmed closes the open ask as Accepted (the user's decision)
//        prayer asks follow a conductor change, and a cancelled prayer's ask is marked, never
//        doubled — and a prayer whose ask was ANSWERED is still told (listToldPrayerIds' fix)
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so every query runs as a real
// user against the hosted project. Writes are asserted by re-reading with the service client. The
// tests run IN ORDER, each from the state the previous one left.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api";
// 7:00 PM on Friday the 19th in Denver (MST, UTC-7), which is the 20th in UTC.
const SCHEDULED_FOR = "2027-11-20T02:00:00.000Z";

async function finalize(sundayId: string, finalized: boolean) {
  const { PATCH } = await import("@/app/api/sundays/[id]/prayers-finalized/route");
  return readResponse(
    await PATCH(
      jsonRequest(`${BASE}/sundays/${sundayId}/prayers-finalized`, {
        method: "PATCH",
        body: { finalized },
      }),
      { params: Promise.resolve({ id: sundayId }) },
    ),
  );
}

async function preview(sundayId: string) {
  const { GET } = await import("@/app/api/sundays/[id]/prayers-finalized/route");
  return readResponse(
    await GET(jsonRequest(`${BASE}/sundays/${sundayId}/prayers-finalized`), {
      params: Promise.resolve({ id: sundayId }),
    }),
  );
}

async function upsertPrayer(body: unknown) {
  const { POST } = await import("@/app/api/prayers/route");
  return readResponse(await POST(jsonRequest(`${BASE}/prayers`, { method: "POST", body })));
}

async function patchPrayer(prayerId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/prayers/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/prayers/${prayerId}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id: prayerId }),
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

describe("Finalize prayers — ITER-036 fb", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let noConductorSundayId = "";
  let handoverSundayId = "";
  let invocationId = "";
  let benedictionId = "";
  let ninaPrayerId = "";
  let anaPrayerId = "";
  let rosaId = "";
  let lucasId = "";

  type AskRow = {
    id: string;
    user_id: string;
    title: string;
    completed_at: string | null;
    closed_reason: string | null;
    scheduled_for: string | null;
    talk_off_at: string | null;
    ask_prayer_id: string | null;
  };
  const ASK_COLUMNS =
    "id, user_id, title, completed_at, closed_reason, scheduled_for, talk_off_at, ask_prayer_id";

  async function asksFor(prayerId: string): Promise<AskRow[]> {
    const { data, error } = await fixtures.service
      .from("todos")
      .select(ASK_COLUMNS)
      .eq("ward_id", fixtures.wardAId)
      .eq("ask_prayer_id", prayerId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function openAskFor(prayerId: string): Promise<AskRow> {
    const open = (await asksFor(prayerId)).filter((row) => row.completed_at === null);
    expect(open).toHaveLength(1);
    return open[0];
  }

  async function readTodo(todoId: string): Promise<AskRow | null> {
    const { data, error } = await fixtures.service
      .from("todos")
      .select(ASK_COLUMNS)
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
      .select("prayers_finalized_at")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data.prayers_finalized_at;
  }

  async function prayerRow(id: string) {
    const { data, error } = await fixtures.service
      .from("prayer_assignments")
      .select("member_id, stage, asked_by")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const lastName = () => `Prayer${fixtures.runId}`;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2", "eqPresident"]);
    const service = fixtures.service;

    const { error: zoneError } = await service
      .from("wards")
      .update({ settings: { timezone: "America/Denver" } })
      .eq("id", fixtures.wardAId);
    if (zoneError) throw new Error(zoneError.message);

    const seedSunday = async (date: string, conductor: string | null) => {
      const { data, error } = await service
        .from("sundays")
        .insert({
          ward_id: fixtures.wardAId,
          date,
          type: "standard",
          speaking_slots: 3,
          conducting_user_id: conductor,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    sundayId = await seedSunday("2027-11-07", fixtures.user("counselor1").id);
    noConductorSundayId = await seedSunday("2027-11-14", null);
    handoverSundayId = await seedSunday("2027-11-21", fixtures.user("counselor1").id);

    const seedMember = async (firstName: string) => {
      const { data, error } = await service
        .from("members")
        .insert({
          ward_id: fixtures.wardAId,
          first_name: firstName,
          last_name: lastName(),
          category: "adult",
          phone: "555-0100",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    const mariaId = await seedMember("Maria");
    const tomasId = await seedMember("Tomas");
    const ninaId = await seedMember("Nina");
    const anaId = await seedMember("Ana");
    rosaId = await seedMember("Rosa");
    lucasId = await seedMember("Lucas");

    const seedPrayer = async (sunday: string, prayerType: string, memberId: string) => {
      const { data, error } = await service
        .from("prayer_assignments")
        .insert({
          ward_id: fixtures.wardAId,
          sunday_id: sunday,
          prayer_type: prayerType,
          member_id: memberId,
          stage: "assign",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    invocationId = await seedPrayer(sundayId, "invocation", mariaId);
    benedictionId = await seedPrayer(sundayId, "benediction", tomasId);
    await seedPrayer(noConductorSundayId, "invocation", mariaId);
    ninaPrayerId = await seedPrayer(handoverSundayId, "invocation", ninaId);
    anaPrayerId = await seedPrayer(handoverSundayId, "benediction", anaId);
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

  it("previews whose To Do the asks go to and how many (D6)", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await preview(sundayId);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      finalized: false,
      hasConductor: true,
      conductorIsYou: false,
      conductorName: `counselor1 Fixture${fixtures.runId}`,
      toAsk: 2,
      unfinalizeWarning: null,
    });
  });

  it("puts one ask per prayer on the CONDUCTOR's To Do, worded for each prayer (D1)", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await finalize(sundayId, true);
    expect(status).toBe(200);
    expect(body.asked).toBe(2);
    expect(await stampOf(sundayId)).not.toBeNull();

    const opening = await openAskFor(invocationId);
    expect(opening.user_id).toBe(fixtures.user("counselor1").id);
    expect(opening.title).toBe(`Ask Maria ${lastName()} to give the opening prayer`);
    const closing = await openAskFor(benedictionId);
    expect(closing.title).toBe(`Ask Tomas ${lastName()} to give the closing prayer`);
  });

  it("asks nobody again on a second finalize, and keeps the instant it was decided", async () => {
    const stamp = await stampOf(sundayId);
    await actAs(fixtures, "bishop");
    const { body } = await finalize(sundayId, true);
    expect(body.asked).toBe(0);
    expect(await stampOf(sundayId)).toBe(stamp);
    expect(await asksFor(invocationId)).toHaveLength(1);
  });

  it("shows the conductor which prayer it is and how to reach them", async () => {
    await actAs(fixtures, "counselor1");
    const ask = await openAskFor(invocationId);
    const { status, body } = await getTodo(ask.id);
    expect(status).toBe(200);
    expect((body.todo as { askSource: unknown }).askSource).toMatchObject({
      kind: "prayer",
      prayerId: invocationId,
      prayerType: "invocation",
      speakerName: `Maria ${lastName()}`,
      phone: "555-0100",
      isOpen: true,
      talkOff: false,
    });
  });

  it("refuses to let an open prayer ask be ticked off — it is answered", async () => {
    await actAs(fixtures, "counselor1");
    const ask = await openAskFor(invocationId);
    const { PATCH } = await import("@/app/api/todos/[id]/route");
    const { status } = await readResponse(
      await PATCH(
        jsonRequest(`${BASE}/todos/${ask.id}`, { method: "PATCH", body: { complete: true } }),
        { params: Promise.resolve({ id: ask.id }) },
      ),
    );
    expect(status).toBe(400);
    expect((await readTodo(ask.id))?.completed_at).toBeNull();
  });

  it("Accepted moves the prayer to Confirmed, stamped as asked by the ask's owner", async () => {
    const stamp = await stampOf(sundayId);
    await actAs(fixtures, "counselor1");
    const ask = await openAskFor(invocationId);

    const { status } = await answer(ask.id, { outcome: "accepted" });
    expect(status).toBe(200);

    expect(await prayerRow(invocationId)).toMatchObject({
      stage: "confirm",
      asked_by: fixtures.user("counselor1").id,
    });
    const closed = await readTodo(ask.id);
    expect(closed?.completed_at).not.toBeNull();
    expect(closed?.closed_reason).toBeNull();
    expect(await logKinds(ask.id)).toEqual(["ask_accepted"]);
    expect(await stampOf(sundayId)).toBe(stamp);
  });

  it("Declined frees the prayer, needs no reason, and does NOT un-finalize", async () => {
    const stamp = await stampOf(sundayId);
    await actAs(fixtures, "counselor1");
    const ask = await openAskFor(benedictionId);

    const { status } = await answer(ask.id, { outcome: "declined" });
    expect(status).toBe(200);

    expect(await prayerRow(benedictionId)).toMatchObject({ member_id: null, stage: "assign" });
    expect(await logKinds(ask.id)).toEqual(["ask_declined"]);
    expect(await stampOf(sundayId)).toBe(stamp);
  });

  it("choosing somebody new un-finalizes, and re-finalizing asks only them (D2)", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await upsertPrayer({ sundayId, prayerType: "benediction", memberId: rosaId });
    expect(status).toBe(201);
    expect(await stampOf(sundayId)).toBeNull();

    const { body } = await finalize(sundayId, true);
    expect(body.asked).toBe(1);
    expect((await openAskFor(benedictionId)).title).toBe(
      `Ask Rosa ${lastName()} to give the closing prayer`,
    );
  });

  it("CLOSES a touched ask on a change of person, keeping what its holder wrote (D3)", async () => {
    const old = await openAskFor(benedictionId);
    const { error } = await fixtures.service.from("todo_steps").insert({
      ward_id: fixtures.wardAId,
      todo_id: old.id,
      label: "Call after work",
      position: 0,
    });
    if (error) throw new Error(error.message);

    await actAs(fixtures, "bishop");
    expect((await patchPrayer(benedictionId, { action: "assign", memberId: lucasId })).status).toBe(
      200,
    );

    const closed = await readTodo(old.id);
    expect(closed?.completed_at).not.toBeNull();
    expect(closed?.closed_reason).toBe("speaker_changed");
    expect(await logKinds(old.id)).toEqual(["speaker_changed"]);
    expect(await stampOf(sundayId)).toBeNull();
  });

  it("starts the prayer over when somebody new replaces a confirmed person", async () => {
    await actAs(fixtures, "bishop");
    expect((await patchPrayer(benedictionId, { action: "transition", to: "ask" })).status).toBe(200);
    expect((await patchPrayer(benedictionId, { action: "transition", to: "confirm" })).status).toBe(
      200,
    );
    expect((await prayerRow(benedictionId)).stage).toBe("confirm");

    expect((await patchPrayer(benedictionId, { action: "assign", memberId: rosaId })).status).toBe(
      200,
    );
    expect(await prayerRow(benedictionId)).toMatchObject({ member_id: rosaId, stage: "assign" });
  });

  it("a board move to Confirmed closes the open ask as Accepted; a move to Asked does not", async () => {
    await actAs(fixtures, "bishop");
    expect((await finalize(sundayId, true)).body.asked).toBe(1);
    const ask = await openAskFor(benedictionId);

    expect((await patchPrayer(benedictionId, { action: "transition", to: "ask" })).status).toBe(200);
    expect((await readTodo(ask.id))?.completed_at).toBeNull();

    expect((await patchPrayer(benedictionId, { action: "transition", to: "confirm" })).status).toBe(
      200,
    );
    expect((await readTodo(ask.id))?.completed_at).not.toBeNull();
    expect(await logKinds(ask.id)).toEqual(["ask_accepted"]);
  });

  it("names who is scheduled and who confirmed before an un-finalize (D4)", async () => {
    await actAs(fixtures, "bishop");
    expect((await finalize(handoverSundayId, true)).body.asked).toBe(2);

    const ninaAsk = await openAskFor(ninaPrayerId);
    const { error } = await fixtures.service
      .from("todos")
      .update({ scheduled_for: SCHEDULED_FOR })
      .eq("id", ninaAsk.id);
    if (error) throw new Error(error.message);

    const { body } = await preview(handoverSundayId);
    const warning = String(body.unfinalizeWarning);
    expect(warning).toContain(
      `counselor1 Fixture${fixtures.runId} has an appointment with Nina ${lastName()} on Fri, Nov 19, 2027, 7:00`,
    );
    expect(warning).toContain("to ask them to give the opening prayer");
    expect(warning).not.toContain("Ana");

    const { body: confirmed } = await preview(sundayId);
    expect(String(confirmed.unfinalizeWarning)).toContain(
      `Maria ${lastName()} has already accepted`,
    );
  });

  it("un-finalizing deletes the unscheduled ask and KEEPS the scheduled one (D3, D4)", async () => {
    const anaAsk = await openAskFor(anaPrayerId);
    const ninaAsk = await openAskFor(ninaPrayerId);
    await actAs(fixtures, "bishop");

    expect((await finalize(handoverSundayId, false)).status).toBe(200);
    expect(await stampOf(handoverSundayId)).toBeNull();
    expect(await readTodo(anaAsk.id)).toBeNull();
    const kept = await readTodo(ninaAsk.id);
    expect(kept?.completed_at).toBeNull();
    expect(kept?.ask_prayer_id).toBe(ninaPrayerId);
  });

  it("hands the prayer asks to a new conductor, with no appointment inherited", async () => {
    await actAs(fixtures, "bishop");
    expect((await finalize(handoverSundayId, true)).body.asked).toBe(1);
    const oldNina = await openAskFor(ninaPrayerId);
    const oldAna = await openAskFor(anaPrayerId);

    const { status } = await patchSunday(handoverSundayId, {
      conductingUserId: fixtures.user("counselor2").id,
    });
    expect(status).toBe(200);

    for (const [prayerId, old] of [
      [ninaPrayerId, oldNina],
      [anaPrayerId, oldAna],
    ] as const) {
      expect((await readTodo(old.id))?.closed_reason).toBe("handed_over");
      const fresh = await openAskFor(prayerId);
      expect(fresh.user_id).toBe(fixtures.user("counselor2").id);
      expect(fresh.scheduled_for).toBeNull();
    }
  });

  it("marks an open prayer ask on a cancelled Sunday, and never adds a second to-do beside it", async () => {
    // Moved to Asked on the board, so the old rule would ALSO have told whoever asked.
    await actAs(fixtures, "bishop");
    expect((await patchPrayer(anaPrayerId, { action: "transition", to: "ask" })).status).toBe(200);

    const { status } = await patchSunday(handoverSundayId, { type: "stake_conference" }, true);
    expect(status).toBe(200);

    const open = (await asksFor(anaPrayerId)).filter((row) => row.completed_at === null);
    expect(open).toHaveLength(1);
    expect(open[0].user_id).toBe(fixtures.user("counselor2").id);
    expect(open[0].talk_off_at).not.toBeNull();

    await actAs(fixtures, "counselor2");
    const { status: toldStatus } = await answer(open[0].id, { outcome: "told" });
    expect(toldStatus).toBe(200);
    expect((await readTodo(open[0].id))?.closed_reason).toBe("told_not_needed");
  });

  it("still tells whoever asked a prayer whose ask was ANSWERED, when its Sunday is cancelled", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await patchSunday(sundayId, { type: "stake_conference" }, true);
    expect(status).toBe(200);

    const tells = (await asksFor(invocationId)).filter((row) => row.talk_off_at !== null);
    expect(tells).toHaveLength(1);
    expect(tells[0].user_id).toBe(fixtures.user("counselor1").id);
    expect(tells[0].title).toBe(`Let Maria ${lastName()} know the prayer is cancelled`);
  });

  it("keeps titles and names out of every audit row", async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("action, detail")
      .eq("ward_id", fixtures.wardAId)
      .in("action", ["sunday_prayers_finalized", "sunday_prayers_unfinalized", "prayer_ask_answered"]);
    if (error) throw new Error(error.message);

    expect(new Set((data ?? []).map((row) => row.action))).toEqual(
      new Set(["sunday_prayers_finalized", "sunday_prayers_unfinalized", "prayer_ask_answered"]),
    );
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("to give the");
    expect(serialized).not.toContain(lastName());
  });
});
