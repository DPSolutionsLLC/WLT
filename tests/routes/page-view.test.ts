// @vitest-environment node
//
// PUT /api/session/page-view — remembering how a person left a page (the user's standing rule,
// 2026-09-24; My Appointments is the first page to use it).
//
// THE MERGE, AT BOTH LEVELS. `users.settings` is one jsonb column shared with the quick links, and
// `page_views` is one object shared by every page. A wholesale write at either level would delete
// the other keys with nothing failing, so a sibling settings key AND a sibling page's view are
// seeded before anything is written, and asserted after.
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so the write runs as the
// genuinely authenticated user and a pass means `users_update_self` and migration 077's column
// grant both allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readPageView } from "@/lib/users/userSettings";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const URL = "http://localhost/api/session/page-view";

async function putPageView(body: unknown) {
  const { PUT } = await import("@/app/api/session/page-view/route");
  return readResponse(await PUT(jsonRequest(URL, { method: "PUT", body })));
}

describe("/api/session/page-view", () => {
  let fixtures: Fixtures;
  let selfId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["eqPresident"]);
    selfId = fixtures.user("eqPresident").id;

    const { error } = await fixtures.service
      .from("users")
      .update({
        settings: {
          quick_links: ["/roster"],
          page_views: { some_later_page: { open: true } },
        },
      })
      .eq("id", selfId);

    if (error) throw new Error(`Could not seed the user's settings: ${error.message}`);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("saves the view, merging into the other settings and the other pages' views", async () => {
    await actAs(fixtures, "eqPresident");

    const view = { collapsed: true, toggledDays: ["2026-09-25"], showPast: true };
    const { status } = await putPageView({ page: "appointments", view });
    expect(status).toBe(200);

    const { data } = await fixtures.service
      .from("users")
      .select("settings")
      .eq("id", selfId)
      .single();
    const settings = data?.settings as Record<string, unknown>;

    expect(settings.quick_links).toEqual(["/roster"]);
    expect(settings.page_views).toEqual({
      some_later_page: { open: true },
      appointments: view,
    });

    // The page reads it back through the same helper it renders with.
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    expect(await readPageView(selfId, "appointments", await createServerSupabaseClient())).toEqual(
      view,
    );

    const { data: audit } = await fixtures.service
      .from("audit_log")
      .select("action, detail")
      .eq("user_id", selfId)
      .eq("action", "page_view_saved");
    expect(audit?.map((row) => row.detail)).toEqual([{ page: "appointments" }]);
  });

  it("refuses a page that does not remember its view, with a sentence", async () => {
    await actAs(fixtures, "eqPresident");

    const { status, body } = await putPageView({ page: "not-a-page", view: {} });

    expect(status).toBe(400);
    expect(errorMessage(body)).toBeTruthy();
  });

  it("refuses a view in the wrong shape", async () => {
    await actAs(fixtures, "eqPresident");

    const { status } = await putPageView({
      page: "appointments",
      view: { collapsed: "yes", toggledDays: [], showPast: false },
    });

    expect(status).toBe(400);
  });
});
