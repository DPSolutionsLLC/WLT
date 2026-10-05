// @vitest-environment node
//
// ITER-038 slice mc: FINALIZING TOPICS TELLS THE MUSIC COORDINATOR.
//
// PATCH /api/sundays/[id]/topics-finalized puts "Choose the music" on every active coordinator's
// To Do, writes a notification row, and emails whoever switched email on. Un-finalizing returns
// submitted music to draft ("Topics changed"); finalizing again tells them the topics changed.
//
// Only the server client factory is mocked for auth (tests/helpers/routeClient.ts). Two more
// modules are wrapped, never replaced wholesale:
//   - lib/email/resend.ts — nothing may reach a real inbox from a test, and "is email set up" must
//     be switchable;
//   - lib/music/musicCoordinators.ts — passes through to the real query, and throws on demand so the
//     "finalize stands when the handoff fails" rule can be proved.
//
// The tests run IN ORDER; each starts from the state the one before left.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

const state = vi.hoisted(() => ({
  configured: true,
  failCoordinators: false,
  sends: [] as { to: string[]; subject: string; text: string }[],
}));

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

vi.mock("@/lib/email/resend", () => ({
  emailConfiguration: () =>
    state.configured
      ? { configured: true, fromAddress: "music@example.org" }
      : { configured: false, reason: "Not configured in this test." },
  getResendClient: () => ({
    emails: {
      send: async (message: { to: string[]; subject: string; text: string }) => {
        state.sends.push({ to: message.to, subject: message.subject, text: message.text });
        return { data: { id: "test" }, error: null };
      },
    },
  }),
}));

vi.mock("@/lib/music/musicCoordinators", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/music/musicCoordinators")>();
  return {
    listMusicCoordinatorIds: async (
      ...args: Parameters<typeof actual.listMusicCoordinatorIds>
    ) => {
      if (state.failCoordinators) throw new Error("Simulated coordinator lookup failure");
      return actual.listMusicCoordinatorIds(...args);
    },
  };
});

const BASE = "http://localhost/api";
const SEND_BACK_NOTE = "Please choose a closing hymn about the Savior.";

async function finalize(sundayId: string, finalized: boolean) {
  const { PATCH } = await import("@/app/api/sundays/[id]/topics-finalized/route");
  return readResponse(
    await PATCH(
      jsonRequest(`${BASE}/sundays/${sundayId}/topics-finalized`, {
        method: "PATCH",
        body: { finalized },
      }),
      { params: Promise.resolve({ id: sundayId }) },
    ),
  );
}

async function submit(sundayId: string) {
  const { POST } = await import("@/app/api/sundays/[id]/music/submit/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/sundays/${sundayId}/music/submit`, { method: "POST" }), {
      params: Promise.resolve({ id: sundayId }),
    }),
  );
}

async function review(sundayId: string, body: unknown) {
  const { POST } = await import("@/app/api/sundays/[id]/music/review/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/sundays/${sundayId}/music/review`, { method: "POST", body }), {
      params: Promise.resolve({ id: sundayId }),
    }),
  );
}

async function patchSunday(sundayId: string, body: unknown, confirm: boolean) {
  const { PATCH } = await import("@/app/api/sundays/[id]/route");
  const url = `${BASE}/sundays/${sundayId}${confirm ? "?confirm=true" : ""}`;
  return readResponse(
    await PATCH(jsonRequest(url, { method: "PATCH", body }), {
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

function musicSummary(body: unknown): { message: string | null; error: string | null } {
  return (body as { music: { message: string | null; error: string | null } }).music;
}

type ChooseRow = {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  completed_at: string | null;
};

describe("Finalizing topics tells the music coordinator — ITER-038 mc", () => {
  let fixtures: Fixtures;
  let wardId = "";
  let coordinatorId = "";
  let secondCoordinatorId = "";
  let conductorId = "";

  let sundayId = "";
  let deactivatedSundayId = "";
  let notConfiguredSundayId = "";
  let noCoordinatorSundayId = "";
  let failingSundayId = "";
  let fastSundayId = "";
  let assignmentId = "";
  let topicTitle = "";
  let speakerLastName = "";

  async function chooseTodos(forSundayId: string): Promise<ChooseRow[]> {
    const { data, error } = await fixtures.service
      .from("todos")
      .select("id, user_id, title, notes, completed_at")
      .eq("ward_id", wardId)
      .eq("music_sunday_id", forSundayId)
      .eq("music_role", "choose")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function notificationCount(triggerKey: string) {
    const { count, error } = await fixtures.service
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("trigger_key", triggerKey);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async function musicRow(forSundayId: string) {
    const { data, error } = await fixtures.service
      .from("sunday_music")
      .select("status, returned_reason")
      .eq("sunday_id", forSundayId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async function logKinds(todoId: string) {
    const { data, error } = await fixtures.service
      .from("todo_log_entries")
      .select("kind, body")
      .eq("todo_id", todoId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function stamp(forSundayId: string) {
    const { data, error } = await fixtures.service
      .from("sundays")
      .select("topics_finalized_at")
      .eq("id", forSundayId)
      .single();
    if (error) throw new Error(error.message);
    return data.topics_finalized_at;
  }

  async function setUserActive(userId: string, isActive: boolean) {
    const { error } = await fixtures.service.from("users").update({ is_active: isActive }).eq("id", userId);
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["musicCoordinator", "wardCouncilMember", "bishop", "counselor1", "counselor2"],
      {
        notificationTriggers: [
          { triggerKey: "music_topics_ready", defaultRoles: ["music_coordinator"] },
          { triggerKey: "music_submitted", defaultRoles: ["bishop", "counselor"] },
          { triggerKey: "music_sent_back", defaultRoles: ["music_coordinator"] },
        ],
      },
    );
    const service = fixtures.service;
    wardId = fixtures.wardAId;
    coordinatorId = fixtures.user("musicCoordinator").id;
    secondCoordinatorId = fixtures.user("wardCouncilMember").id;
    conductorId = fixtures.user("counselor1").id;

    // A SECOND coordinator: the ward council member's calling becomes music_coordinator, so "every
    // active coordinator" means two people.
    const { error: callingError } = await service
      .from("ward_role_assignments")
      .update({ role: "music_coordinator" })
      .eq("user_id", secondCoordinatorId)
      .eq("ward_id", wardId);
    if (callingError) throw new Error(callingError.message);

    // Only the first coordinator wants email — both rows, as the toggle writes them.
    const { error: prefError } = await service.from("notification_user_prefs").insert(
      ["music_topics_ready", "music_sent_back"].map((triggerKey) => ({
        ward_id: wardId,
        user_id: coordinatorId,
        trigger_key: triggerKey,
        email_enabled: true,
      })),
    );
    if (prefError) throw new Error(prefError.message);

    // Not the first Sunday of any month, so none is a Fast Sunday.
    const seedSunday = async (date: string) => {
      const { data, error } = await service
        .from("sundays")
        .insert({
          ward_id: wardId,
          date,
          type: "standard",
          speaking_slots: 3,
          conducting_user_id: conductorId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    sundayId = await seedSunday("2027-06-13");
    deactivatedSundayId = await seedSunday("2027-06-20");
    notConfiguredSundayId = await seedSunday("2027-06-27");
    noCoordinatorSundayId = await seedSunday("2027-07-11");
    failingSundayId = await seedSunday("2027-07-18");
    fastSundayId = await seedSunday("2027-08-08");

    speakerLastName = `Speaker${fixtures.runId}`;
    const { data: member, error: memberError } = await service
      .from("members")
      .insert({ ward_id: wardId, first_name: "Hidden", last_name: speakerLastName, category: "adult" })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);

    topicTitle = `Gratitude ${fixtures.runId}`;
    const { data: assignment, error: assignmentError } = await service
      .from("assignments")
      .insert({
        ward_id: wardId,
        sunday_id: sundayId,
        member_id: member.id,
        assignment_type: "sacrament_talk",
        slot_number: 1,
        topic_title: topicTitle,
        pipeline_stage: "plan",
      })
      .select("id")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);
    assignmentId = assignment.id;

    const { error: fastTalkError } = await service.from("assignments").insert({
      ward_id: wardId,
      sunday_id: fastSundayId,
      member_id: member.id,
      assignment_type: "sacrament_talk",
      slot_number: 1,
      topic_title: topicTitle,
      pipeline_stage: "plan",
    });
    if (fastTalkError) throw new Error(fastTalkError.message);

    // Complete music on the main Sunday and the Fast Sunday one, so the coordinator can submit.
    for (const [offset, musicSundayId] of [sundayId, fastSundayId].entries()) {
      const { error: hymnError } = await service.from("hymn_selections").insert(
        ["opening", "sacrament", "closing"].map((hymnType, index) => ({
          ward_id: wardId,
          sunday_id: musicSundayId,
          hymn_type: hymnType,
          hymn_number: 20 + offset * 3 + index,
          hymn_title: `Hymn ${20 + offset * 3 + index}`,
        })),
      );
      if (hymnError) throw new Error(hymnError.message);
      const { error: peopleError } = await service.from("sunday_music").insert({
        ward_id: wardId,
        sunday_id: musicSundayId,
        chorister_name: "Sister Hale",
        organist_name: "Brother Visiting",
      });
      if (peopleError) throw new Error(peopleError.message);
    }
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("gives every active coordinator one Choose the music to-do carrying the topic titles only", async () => {
    await actAs(fixtures, "counselor1");
    const { status, body } = await finalize(sundayId, true);

    expect(status).toBe(200);
    expect(musicSummary(body)).toEqual({
      message: "Told 2 music coordinators (emailed 1).",
      error: null,
    });

    const todos = await chooseTodos(sundayId);
    expect(todos.map((todo) => todo.user_id).sort()).toEqual(
      [coordinatorId, secondCoordinatorId].sort(),
    );
    for (const todo of todos) {
      expect(todo.title).toBe("Choose the music for Sunday, June 13, 2027");
      expect(todo.completed_at).toBeNull();
      expect(todo.notes).toContain(topicTitle);
      expect(todo.notes).not.toContain(speakerLastName);
    }
    expect(await notificationCount("music_topics_ready")).toBe(2);
  });

  it("emails only the coordinator who switched it on", () => {
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].to).toEqual([fixtures.user("musicCoordinator").email]);
    expect(state.sends[0].subject).toBe("Choose the music for Sunday, June 13, 2027");
    expect(state.sends[0].text).toContain(topicTitle);
    expect(state.sends[0].text).not.toContain(speakerLastName);
  });

  it("adds nothing and tells nobody when the Sunday was already finalized", async () => {
    const { status, body } = await finalize(sundayId, true);

    expect(status).toBe(200);
    expect(musicSummary(body)).toEqual({ message: null, error: null });
    expect(await chooseTodos(sundayId)).toHaveLength(2);
    expect(await notificationCount("music_topics_ready")).toBe(2);
    expect(state.sends).toHaveLength(1);
  });

  it("returns submitted music to draft when the topics are un-finalized, and closes the review", async () => {
    await actAs(fixtures, "musicCoordinator");
    expect((await submit(sundayId)).status).toBe(200);
    expect((await musicRow(sundayId))?.status).toBe("submitted");

    await actAs(fixtures, "counselor1");
    const { status, body } = await finalize(sundayId, false);

    expect(status).toBe(200);
    expect(musicSummary(body)).toEqual({ message: null, error: null });
    expect(await musicRow(sundayId)).toEqual({ status: "draft", returned_reason: "topics_changed" });

    const { data: reviews, error } = await fixtures.service
      .from("todos")
      .select("completed_at, closed_reason")
      .eq("music_sunday_id", sundayId)
      .eq("music_role", "review");
    if (error) throw new Error(error.message);
    expect(reviews).toHaveLength(1);
    expect(reviews?.[0].completed_at).not.toBeNull();
    expect(reviews?.[0].closed_reason).toBe("music_reopened");
  });

  it("tells every coordinator the topics changed when they are finalized again", async () => {
    const { status, body } = await finalize(sundayId, true);

    expect(status).toBe(200);
    expect(musicSummary(body).message).toBe(
      "Told 2 music coordinators the topics changed (emailed 1).",
    );

    const todos = await chooseTodos(sundayId);
    expect(todos).toHaveLength(2);
    for (const todo of todos) {
      expect(todo.completed_at).toBeNull();
      expect(todo.title).toBe("Topics changed — check the music for Sunday, June 13, 2027");
      expect((await logKinds(todo.id)).map((line) => line.kind)).toContain("topics_changed");
    }
    expect(await notificationCount("music_topics_ready")).toBe(4);
    expect(state.sends).toHaveLength(2);
    expect(state.sends[1].subject).toBe(
      "Topics changed — check the music for Sunday, June 13, 2027",
    );
  });

  it("returns submitted music to draft when a talk's topic is edited", async () => {
    await actAs(fixtures, "musicCoordinator");
    expect((await submit(sundayId)).status).toBe(200);

    await actAs(fixtures, "bishop");
    const { status } = await patchAssignment(assignmentId, {
      action: "update",
      fields: { topicTitle: `Faith ${fixtures.runId}` },
    });

    expect(status).toBe(200);
    expect(await stamp(sundayId)).toBeNull();
    expect(await musicRow(sundayId)).toEqual({ status: "draft", returned_reason: "topics_changed" });
  });

  it("emails the coordinator who submitted when the music is sent back", async () => {
    await actAs(fixtures, "counselor1");
    expect((await finalize(sundayId, true)).status).toBe(200);
    await actAs(fixtures, "musicCoordinator");
    expect((await submit(sundayId)).status).toBe(200);
    const sendsBefore = state.sends.length;

    await actAs(fixtures, "counselor2");
    const { status, body } = await review(sundayId, { decision: "return", note: SEND_BACK_NOTE });

    expect(status).toBe(200);
    expect((body as { emailProblem: string | null }).emailProblem).toBeNull();
    const sent = state.sends.slice(sendsBefore);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([fixtures.user("musicCoordinator").email]);
    expect(sent[0].subject).toBe("Music sent back for Sunday, June 13, 2027");
    expect(sent[0].text).toContain(SEND_BACK_NOTE);
  });

  it("gives a deactivated coordinator nothing", async () => {
    await setUserActive(secondCoordinatorId, false);
    try {
      await actAs(fixtures, "counselor1");
      const { status, body } = await finalize(deactivatedSundayId, true);

      expect(status).toBe(200);
      expect(musicSummary(body).message).toBe("Told the music coordinator (emailed 1).");
      expect((await chooseTodos(deactivatedSundayId)).map((todo) => todo.user_id)).toEqual([
        coordinatorId,
      ]);
    } finally {
      await setUserActive(secondCoordinatorId, true);
    }
  });

  it("says so, rather than failing, when email is not set up", async () => {
    state.configured = false;
    try {
      const sendsBefore = state.sends.length;
      const { status, body } = await finalize(notConfiguredSundayId, true);

      expect(status).toBe(200);
      expect(musicSummary(body).message).toBe(
        "Told 2 music coordinators. Email isn't set up for this ward yet, so nobody was emailed.",
      );
      expect(await chooseTodos(notConfiguredSundayId)).toHaveLength(2);
      expect(state.sends).toHaveLength(sendsBefore);
    } finally {
      state.configured = true;
    }
  });

  it("keeps the finalize and reports it when the handoff fails", async () => {
    state.failCoordinators = true;
    try {
      const { status, body } = await finalize(failingSundayId, true);

      expect(status).toBe(200);
      expect(musicSummary(body).error).toBe(
        "Topics are finalized, but the music coordinator couldn't be told. Undo and finalize again to retry.",
      );
      expect(await stamp(failingSundayId)).not.toBeNull();
      expect(await chooseTodos(failingSundayId)).toEqual([]);
    } finally {
      state.failCoordinators = false;
    }
  });

  // The meeting stays, every talk goes, and cancelSundayWork() clears the stamp itself — so it is the
  // save-time reconcile, not lib/topics/finalize.ts, that must return the music to draft.
  it("returns submitted music to draft when the Sunday becomes Fast Sunday", async () => {
    await actAs(fixtures, "counselor1");
    expect((await finalize(fastSundayId, true)).status).toBe(200);
    await actAs(fixtures, "musicCoordinator");
    expect((await submit(fastSundayId)).status).toBe(200);

    await actAs(fixtures, "bishop");
    const { status } = await patchSunday(fastSundayId, { type: "fast_sunday" }, true);

    expect(status).toBe(200);
    expect(await stamp(fastSundayId)).toBeNull();
    expect(await musicRow(fastSundayId)).toEqual({ status: "draft", returned_reason: "topics_changed" });
  });

  it("finalizes, and says nobody was told, when no music coordinator holds a calling", async () => {
    const { error } = await fixtures.service
      .from("ward_role_assignments")
      .update({ is_active: false })
      .eq("ward_id", wardId)
      .eq("role", "music_coordinator");
    if (error) throw new Error(error.message);

    const { status, body } = await finalize(noCoordinatorSundayId, true);

    expect(status).toBe(200);
    expect(musicSummary(body).message).toBe(
      "No music coordinator holds a calling in this ward, so nobody was told.",
    );
    expect(await stamp(noCoordinatorSundayId)).not.toBeNull();
    expect(await chooseTodos(noCoordinatorSundayId)).toEqual([]);
  });
});
