// @vitest-environment node
//
// ITER-038 slice mb: a Sunday's music is SUBMITTED by whoever chose it, REVIEWED by the bishopric
// (the to-do goes to the conductor), and goes back to draft on any change.
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so every read runs as a
// genuinely authenticated user against the hosted project. `sunday_music` has no write policy, so
// the routes' own checks are the whole guard — every assertion about a write re-reads the rows with
// the service client.
//
// The tests in each describe run IN ORDER; each starts from the state the previous one left.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api";
const SEND_BACK_NOTE = "Please swap the closing hymn for one about the Savior.";

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

async function selectHymn(sundayId: string, hymnType: string, hymnNumber: number) {
  const { POST } = await import("@/app/api/hymns/select/route");
  return readResponse(
    await POST(
      jsonRequest(`${BASE}/hymns/select`, {
        method: "POST",
        body: { sundayId, hymnType, hymnNumber, hymnTitle: `Hymn ${hymnNumber}` },
      }),
    ),
  );
}

async function patchPeople(sundayId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/sundays/[id]/music/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/sundays/${sundayId}/music`, { method: "PATCH", body }), {
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

async function deleteTodo(todoId: string) {
  const { DELETE } = await import("@/app/api/todos/[id]/route");
  return readResponse(
    await DELETE(jsonRequest(`${BASE}/todos/${todoId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: todoId }),
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

type MusicTodoRow = {
  id: string;
  user_id: string;
  title: string;
  music_role: string | null;
  completed_at: string | null;
  closed_reason: string | null;
};

describe("Music submit and review — ITER-038 mb", () => {
  let fixtures: Fixtures;
  let wardId = "";
  let coordinatorId = "";
  let bishopId = "";
  let conductorId = "";

  let readySundayId = "";
  let incompleteSundayId = "";
  let unfinalizedSundayId = "";
  let noConductorSundayId = "";
  let bishopSundayId = "";
  // The conductor's review that stays open across a send-back and takes the resubmission.
  let sentBackReviewId = "";

  async function musicRow(sundayId: string) {
    const { data, error } = await fixtures.service
      .from("sunday_music")
      .select("status, submitted_by, approved_at, returned_reason, return_note")
      .eq("sunday_id", sundayId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async function musicTodos(sundayId: string): Promise<MusicTodoRow[]> {
    const { data, error } = await fixtures.service
      .from("todos")
      .select("id, user_id, title, music_role, completed_at, closed_reason")
      .eq("ward_id", wardId)
      .eq("music_sunday_id", sundayId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function openReviews(sundayId: string) {
    return (await musicTodos(sundayId)).filter(
      (todo) => todo.music_role === "review" && todo.completed_at === null,
    );
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

  beforeAll(async () => {
    fixtures = await seedFixtures(["musicCoordinator", "bishop", "counselor1", "counselor2"]);
    const service = fixtures.service;
    wardId = fixtures.wardAId;
    coordinatorId = fixtures.user("musicCoordinator").id;
    bishopId = fixtures.user("bishop").id;
    conductorId = fixtures.user("counselor1").id;
    const finalizedAt = new Date().toISOString();

    // Not the first Sunday of any month, so none is a Fast Sunday with a different shape.
    const seedSunday = async (date: string, options: { finalized: boolean; conductor: string | null }) => {
      const { data, error } = await service
        .from("sundays")
        .insert({
          ward_id: wardId,
          date,
          type: "standard",
          speaking_slots: 3,
          topics_finalized_at: options.finalized ? finalizedAt : null,
          conducting_user_id: options.conductor,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    readySundayId = await seedSunday("2027-11-14", { finalized: true, conductor: conductorId });
    incompleteSundayId = await seedSunday("2027-11-21", { finalized: true, conductor: conductorId });
    unfinalizedSundayId = await seedSunday("2027-11-28", { finalized: false, conductor: conductorId });
    noConductorSundayId = await seedSunday("2027-12-12", { finalized: true, conductor: null });
    bishopSundayId = await seedSunday("2027-12-19", { finalized: true, conductor: conductorId });

    const seedMusic = async (sundayId: string, hymnTypes: readonly string[]) => {
      const { error } = await service.from("hymn_selections").insert(
        hymnTypes.map((hymnType, index) => ({
          ward_id: wardId,
          sunday_id: sundayId,
          hymn_type: hymnType,
          hymn_number: 10 + index,
          hymn_title: `Hymn ${10 + index}`,
        })),
      );
      if (error) throw new Error(error.message);
      const { error: peopleError } = await service.from("sunday_music").insert({
        ward_id: wardId,
        sunday_id: sundayId,
        chorister_name: "Sister Hale",
        organist_name: "Brother Visiting",
      });
      if (peopleError) throw new Error(peopleError.message);
    };

    const ALL = ["opening", "sacrament", "closing"];
    await seedMusic(readySundayId, ALL);
    await seedMusic(incompleteSundayId, ["opening", "sacrament"]);
    await seedMusic(unfinalizedSundayId, ALL);
    await seedMusic(noConductorSundayId, ALL);
    await seedMusic(bishopSundayId, ALL);

    // The coordinator's "Choose the music", as finalizing topics (slice mc) will leave it.
    const { error: todoError } = await service.from("todos").insert({
      ward_id: wardId,
      user_id: coordinatorId,
      title: "Choose the music for Sunday, November 14, 2027",
      tag: "Music",
      music_sunday_id: readySundayId,
      music_role: "choose",
    });
    if (todoError) throw new Error(todoError.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("submitting", () => {
    // Topics finalized and a conductor set, so the ONLY thing wrong is the missing hymn.
    it("refuses incomplete music with a sentence naming what is missing", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status, body } = await submit(incompleteSundayId);

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Still to pick: Closing hymn.");
      expect((await musicRow(incompleteSundayId))?.status).toBe("draft");
      expect(await musicTodos(incompleteSundayId)).toEqual([]);
    });

    // Complete music and a conductor — refused for the topics alone.
    it("refuses while the topics are not finalized", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status, body } = await submit(unfinalizedSundayId);

      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/hasn't finalized this Sunday's topics/);
      expect((await musicRow(unfinalizedSundayId))?.status).toBe("draft");
    });

    // Complete music and finalized topics — refused for the missing conductor alone.
    it("refuses when nobody conducts the Sunday", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status, body } = await submit(noConductorSundayId);

      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/Nobody is conducting this Sunday/);
      expect(await musicTodos(noConductorSundayId)).toEqual([]);
    });

    it("submits, gives the conductor one review to-do, and closes the coordinator's", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status, body } = await submit(readySundayId);

      expect(status).toBe(200);
      expect(body.sundayMusic).toMatchObject({ status: "submitted", submittedByUserId: coordinatorId });
      expect(await musicRow(readySundayId)).toMatchObject({
        status: "submitted",
        submitted_by: coordinatorId,
      });

      const reviews = await openReviews(readySundayId);
      expect(reviews).toHaveLength(1);
      expect(reviews[0]).toMatchObject({
        user_id: conductorId,
        title: "Review the music for Sunday, November 14, 2027",
      });

      const choose = (await musicTodos(readySundayId)).find((todo) => todo.music_role === "choose");
      expect(choose?.completed_at).not.toBeNull();
      expect(choose?.closed_reason).toBeNull();
      expect(await logLines(choose!.id)).toEqual([{ kind: "music_submitted", body: null }]);
    });

    it("adds nothing on a second press", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status } = await submit(readySundayId);

      expect(status).toBe(200);
      expect(await openReviews(readySundayId)).toHaveLength(1);
    });

    it("refuses to let the coordinator approve their own music — they lack topics.manage", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status } = await review(readySundayId, { decision: "approve" });

      expect(status).toBe(403);
      expect((await musicRow(readySundayId))?.status).toBe("submitted");
    });
  });

  describe("the music to-dos close themselves", () => {
    it("refuses a tick on an open review to-do", async () => {
      const [reviewTodo] = await openReviews(readySundayId);
      await actAs(fixtures, "counselor1");
      const { status, body } = await patchTodo(reviewTodo.id, { complete: true });

      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/closes itself when the music moves on/);
      expect(await openReviews(readySundayId)).toHaveLength(1);
    });

    it("refuses to delete an open review to-do", async () => {
      const [reviewTodo] = await openReviews(readySundayId);
      await actAs(fixtures, "counselor1");
      const { status, body } = await deleteTodo(reviewTodo.id);

      expect(status).toBe(409);
      expect(errorMessage(body)).toMatch(/comes from a Sunday's music/);
      expect(await openReviews(readySundayId)).toHaveLength(1);
    });
  });

  describe("sending back", () => {
    it("refuses a send-back with no note", async () => {
      await actAs(fixtures, "counselor2");
      const { status } = await review(readySundayId, { decision: "return", note: "   " });

      expect(status).toBe(400);
      expect((await musicRow(readySundayId))?.status).toBe("submitted");
    });

    it("returns the music to draft with the note, and reopens the coordinator's to-do with it", async () => {
      const [reviewBefore] = await openReviews(readySundayId);
      sentBackReviewId = reviewBefore.id;
      await actAs(fixtures, "counselor2");
      const { status } = await review(readySundayId, { decision: "return", note: SEND_BACK_NOTE });

      expect(status).toBe(200);
      expect(await musicRow(readySundayId)).toMatchObject({
        status: "draft",
        returned_reason: "sent_back",
        return_note: SEND_BACK_NOTE,
      });
      // The conductor's review STAYS OPEN, saying it was sent back (decided walking scenario 087).
      const reviews = await openReviews(readySundayId);
      expect(reviews.map((todo) => todo.id)).toEqual([sentBackReviewId]);
      expect((await logLines(sentBackReviewId)).at(-1)).toEqual({
        kind: "music_sent_back",
        body: SEND_BACK_NOTE,
      });

      const choose = (await musicTodos(readySundayId)).filter((todo) => todo.music_role === "choose");
      expect(choose).toHaveLength(1);
      expect(choose[0]).toMatchObject({ user_id: coordinatorId, completed_at: null });
      expect((await logLines(choose[0].id)).at(-1)).toEqual({
        kind: "music_sent_back",
        body: SEND_BACK_NOTE,
      });
    });

    it("records that a note was written, never the note", async () => {
      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", wardId)
        .eq("action", "sunday_music_sent_back");
      if (error) throw new Error(error.message);

      expect(data).toHaveLength(1);
      expect(data[0].detail).toMatchObject({ sundayId: readySundayId, returnedWithMessage: true });
      expect(JSON.stringify(data)).not.toContain("Savior");
    });

    it("keeps the note through the coordinator's next edit", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status, body } = await selectHymn(readySundayId, "closing", 99);

      expect(status).toBe(200);
      expect(body.reopened).toBe(false);
      expect(await musicRow(readySundayId)).toMatchObject({
        returned_reason: "sent_back",
        return_note: SEND_BACK_NOTE,
      });
    });
  });

  describe("approving, and reopening on a change", () => {
    it("resubmits, clearing the note, onto the conductor's same open review", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status } = await submit(readySundayId);

      expect(status).toBe(200);
      expect(await musicRow(readySundayId)).toMatchObject({
        status: "submitted",
        returned_reason: null,
        return_note: null,
      });
      const reviews = await openReviews(readySundayId);
      expect(reviews.map((todo) => todo.id)).toEqual([sentBackReviewId]);
      expect((await logLines(sentBackReviewId)).map((line) => line.kind)).toEqual([
        "music_sent_back",
        "music_submitted",
      ]);
    });

    it("approves through another member of the bishopric, closing the review", async () => {
      const [reviewTodo] = await openReviews(readySundayId);
      await actAs(fixtures, "counselor2");
      const { status, body } = await review(readySundayId, { decision: "approve" });

      expect(status).toBe(200);
      expect(body.sundayMusic).toMatchObject({ status: "approved" });
      expect((await musicRow(readySundayId))?.approved_at).not.toBeNull();
      expect(await openReviews(readySundayId)).toEqual([]);
      expect((await logLines(reviewTodo.id)).at(-1)).toEqual({ kind: "music_approved", body: null });
    });

    it("returns approved music to draft when a hymn changes", async () => {
      await actAs(fixtures, "musicCoordinator");
      const { status, body } = await selectHymn(readySundayId, "opening", 42);

      expect(status).toBe(200);
      expect(body).toMatchObject({ reopened: true, reopenProblem: null });
      expect(await musicRow(readySundayId)).toMatchObject({
        status: "draft",
        approved_at: null,
        returned_reason: "music_changed",
      });
    });

    it("closes the conductor's open review as no longer needed when the organist changes", async () => {
      await actAs(fixtures, "musicCoordinator");
      expect((await submit(readySundayId)).status).toBe(200);
      const [reviewTodo] = await openReviews(readySundayId);

      const { status, body } = await patchPeople(readySundayId, { organist: { name: "Sister Peake" } });

      expect(status).toBe(200);
      expect(body.sundayMusic).toMatchObject({ status: "draft", returnedReason: "music_changed" });
      expect(await openReviews(readySundayId)).toEqual([]);
      const closed = (await musicTodos(readySundayId)).find((todo) => todo.id === reviewTodo.id);
      expect(closed?.closed_reason).toBe("music_reopened");
      expect((await logLines(reviewTodo.id)).at(-1)).toEqual({ kind: "music_reopened", body: null });
    });
  });

  describe("nobody approves their own submission", () => {
    it("refuses the bishop who submitted it, with the reason", async () => {
      await actAs(fixtures, "bishop");
      expect((await submit(bishopSundayId)).status).toBe(200);

      const { status, body } = await review(bishopSundayId, { decision: "approve" });

      expect(status).toBe(403);
      expect(errorMessage(body)).toBe(
        "You submitted this music, so another member of the bishopric approves it.",
      );
      expect(await musicRow(bishopSundayId)).toMatchObject({ status: "submitted", submitted_by: bishopId });
    });

    it("lets the conductor approve it", async () => {
      await actAs(fixtures, "counselor1");
      const { status } = await review(bishopSundayId, { decision: "approve" });

      expect(status).toBe(200);
      expect((await musicRow(bishopSundayId))?.status).toBe("approved");
    });
  });

  describe("the save-time reconcile", () => {
    it("moves an open review to the new conductor", async () => {
      await actAs(fixtures, "musicCoordinator");
      expect((await submit(readySundayId)).status).toBe(200);
      const [before] = await openReviews(readySundayId);
      expect(before.user_id).toBe(conductorId);

      await actAs(fixtures, "bishop");
      const { status } = await patchSunday(readySundayId, {
        conductingUserId: fixtures.user("counselor2").id,
      });

      expect(status).toBe(200);
      const after = await openReviews(readySundayId);
      expect(after).toHaveLength(1);
      expect(after[0].user_id).toBe(fixtures.user("counselor2").id);
      const old = (await musicTodos(readySundayId)).find((todo) => todo.id === before.id);
      expect(old?.closed_reason).toBe("handed_over");
    });

    it("closes every music to-do and resets the submission when the meeting is lost", async () => {
      await actAs(fixtures, "bishop");
      const warned = await patchSunday(readySundayId, { type: "stake_conference" });
      const { status } =
        warned.status === 409
          ? await patchSunday(readySundayId, { type: "stake_conference" }, true)
          : warned;

      expect(status).toBe(200);
      expect(await musicRow(readySundayId)).toMatchObject({
        status: "draft",
        returned_reason: null,
        submitted_by: null,
      });
      const open = (await musicTodos(readySundayId)).filter((todo) => todo.completed_at === null);
      expect(open).toEqual([]);
      const cancelled = (await musicTodos(readySundayId)).filter(
        (todo) => todo.closed_reason === "meeting_cancelled",
      );
      expect(cancelled.length).toBeGreaterThanOrEqual(1);
    });

    it("writes nothing new on a second save", async () => {
      const before = await musicTodos(readySundayId);
      await actAs(fixtures, "bishop");
      expect((await patchSunday(readySundayId, { notes: "Nothing to move" })).status).toBe(200);
      expect(await musicTodos(readySundayId)).toEqual(before);
    });
  });
});
