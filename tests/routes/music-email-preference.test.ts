// @vitest-environment node
//
// PUT /api/session/music-email — a person's own "email me about the music" switch (ITER-038 mc).
//
// One switch, two rows: `email_enabled` on the person's `notification_user_prefs` row for each of
// `music_topics_ready` and `music_sent_back`. The in-app opt-out (`is_enabled`) must never move.
// Every write is re-read with the service client.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

async function put(body: unknown) {
  const { PUT } = await import("@/app/api/session/music-email/route");
  return readResponse(
    await PUT(jsonRequest("http://localhost/api/session/music-email", { method: "PUT", body })),
  );
}

describe("PUT /api/session/music-email", () => {
  let fixtures: Fixtures;
  let coordinatorId = "";

  async function prefs(userId: string) {
    const { data, error } = await fixtures.service
      .from("notification_user_prefs")
      .select("trigger_key, email_enabled, is_enabled")
      .eq("user_id", userId)
      .in("trigger_key", ["music_topics_ready", "music_sent_back"])
      .order("trigger_key", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["musicCoordinator", "eqSecretary"]);
    coordinatorId = fixtures.user("musicCoordinator").id;

    // An existing IN-APP opt-out on one trigger, which switching email on must not undo.
    const { error } = await fixtures.service.from("notification_user_prefs").insert({
      ward_id: fixtures.wardAId,
      user_id: coordinatorId,
      trigger_key: "music_sent_back",
      is_enabled: false,
    });
    if (error) throw new Error(error.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("switches email on for both triggers, for the caller only, leaving the in-app opt-out alone", async () => {
    await actAs(fixtures, "musicCoordinator");
    const { status, body } = await put({ enabled: true });

    expect(status).toBe(200);
    expect(body).toEqual({ enabled: true });
    expect(await prefs(coordinatorId)).toEqual([
      { trigger_key: "music_sent_back", email_enabled: true, is_enabled: false },
      { trigger_key: "music_topics_ready", email_enabled: true, is_enabled: true },
    ]);
  });

  it("switches it off again", async () => {
    const { status } = await put({ enabled: false });

    expect(status).toBe(200);
    expect((await prefs(coordinatorId)).map((row) => row.email_enabled)).toEqual([false, false]);
  });

  it("writes an audit row naming the triggers and the value", async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("user_id", coordinatorId)
      .eq("action", "notification_email_preference_changed")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);

    expect(data?.[0]?.detail).toEqual({
      triggers: ["music_topics_ready", "music_sent_back"],
      enabled: false,
    });
  });

  it("refuses a body that is not a boolean", async () => {
    const { status } = await put({ enabled: "yes" });
    expect(status).toBe(400);
  });

  // An org secretary holds no `music.view` — this negative path passes the body check first.
  it("refuses a role with no music screen", async () => {
    await actAs(fixtures, "eqSecretary");
    const { status } = await put({ enabled: true });

    expect(status).toBe(403);
    expect(await prefs(fixtures.user("eqSecretary").id)).toEqual([]);
  });
});
