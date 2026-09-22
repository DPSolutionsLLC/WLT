// @vitest-environment node
//
// GET and PUT /api/session/quick-links.
//
// ---------------------------------------------------------------------------
// THE ASSERTION THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// THE MERGE. `users.settings` is ONE jsonb column, and today it holds exactly one key — which is
// precisely when a wholesale write is easiest to get wrong and hardest to notice, because there
// is nothing else in there yet to go missing. tests/routes/homeVenues.test.ts and
// tests/routes/crossOrgVisibility.test.ts guard `wards.settings` the same way, where the same bug
// would silently delete a ward's permission overrides.
//
// So a second key is SEEDED before the pins are ever written, and asserted after.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const QUICK_LINKS_URL = "http://localhost/api/session/quick-links";

// A key nothing in this suite touches. If the write replaced the object instead of merging into
// it, this is what disappears.
const OTHER_SETTINGS_KEY = "a_later_preference";

async function getQuickLinks() {
  const { GET } = await import("@/app/api/session/quick-links/route");
  return readResponse(await GET());
}

async function putQuickLinks(body: unknown) {
  const { PUT } = await import("@/app/api/session/quick-links/route");
  return readResponse(await PUT(jsonRequest(QUICK_LINKS_URL, { method: "PUT", body })));
}

describe("/api/session/quick-links", () => {
  let fixtures: Fixtures;
  let selfId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop"]);
    selfId = fixtures.user("bishop").id;

    const { error } = await fixtures.service
      .from("users")
      .update({ settings: { [OTHER_SETTINGS_KEY]: "do not lose me" } })
      .eq("id", selfId);

    if (error) throw new Error(`Could not seed the user's settings: ${error.message}`);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("starts with no pins", async () => {
    await actAs(fixtures, "bishop");

    const { status, body } = await getQuickLinks();

    expect(status).toBe(200);
    expect(body.quickLinks).toEqual([]);
  });

  it("saves the pins in the order they were given", async () => {
    await actAs(fixtures, "bishop");

    const { status, body } = await putQuickLinks({
      quickLinks: ["/visits", "/roster", "/music"],
    });

    expect(status).toBe(200);
    // ORDER IS MEANING — the list is reorderable, so this is a sequence rather than a set.
    expect(body.quickLinks).toEqual(["/visits", "/roster", "/music"]);

    const { body: read } = await getQuickLinks();
    expect(read.quickLinks).toEqual(["/visits", "/roster", "/music"]);
  });

  // THE HEADLINE ASSERTION.
  it("merges into settings rather than replacing the whole object", async () => {
    await actAs(fixtures, "bishop");

    await putQuickLinks({ quickLinks: ["/roster"] });

    const { data } = await fixtures.service
      .from("users")
      .select("settings")
      .eq("id", selfId)
      .single();

    const settings = data?.settings as Record<string, unknown>;
    expect(settings[OTHER_SETTINGS_KEY]).toBe("do not lose me");
    expect(settings.quick_links).toEqual(["/roster"]);
  });

  it("rejects an href that is not a module in this app", async () => {
    await actAs(fixtures, "bishop");

    const { status, body } = await putQuickLinks({
      quickLinks: ["/roster", "/not-a-module"],
    });

    expect(status).toBe(400);
    expect(errorMessage(body)).toMatch(/not a module in this app/);
  });

  it("rejects the same module pinned twice", async () => {
    await actAs(fixtures, "bishop");

    const { status, body } = await putQuickLinks({ quickLinks: ["/roster", "/roster"] });

    expect(status).toBe(400);
    expect(errorMessage(body)).toMatch(/same module twice/);
  });

  it("accepts an empty list, which is how the last pin is removed", async () => {
    await actAs(fixtures, "bishop");

    const { status, body } = await putQuickLinks({ quickLinks: [] });

    expect(status).toBe(200);
    expect(body.quickLinks).toEqual([]);

    // AND THE OTHER KEY IS STILL THERE. Clearing the pins is the write most likely to be
    // implemented as "write an empty object".
    const { data } = await fixtures.service
      .from("users")
      .select("settings")
      .eq("id", selfId)
      .single();

    expect((data?.settings as Record<string, unknown>)[OTHER_SETTINGS_KEY]).toBe(
      "do not lose me",
    );
  });

  it("writes an audit row for the save", async () => {
    await actAs(fixtures, "bishop");

    await putQuickLinks({ quickLinks: ["/calendar"] });

    const { data } = await fixtures.service
      .from("audit_log")
      .select("action, module, detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "quick_links_updated")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(data?.[0]?.module).toBe("admin");
    expect((data?.[0]?.detail as { quickLinks?: string[] })?.quickLinks).toEqual(["/calendar"]);
  });
});
