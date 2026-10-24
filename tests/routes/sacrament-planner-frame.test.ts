// @vitest-environment node
//
// GET /api/sacrament-planner/frame — the Sacrament Planner's page, assembled per request with the
// ward's member list and agenda history (ITER-045). Seeded with fake names only.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

async function getFrame() {
  const { GET } = await import("@/app/api/sacrament-planner/frame/route");
  return GET();
}

describe("GET /api/sacrament-planner/frame", () => {
  let fixtures: Fixtures;
  const lastName = () => `Plannerfixture${fixtures.runId}`;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "musicCoordinator", "wardBBishop"]);

    const { error } = await fixtures.service.from("members").insert([
      {
        ward_id: fixtures.wardAId,
        first_name: "Quill",
        last_name: lastName(),
        category: "adult",
        status: "active",
      },
      {
        ward_id: fixtures.wardAId,
        first_name: "Moved",
        last_name: lastName(),
        category: "adult",
        status: "moved_out",
      },
    ]);
    if (error) throw new Error(`Could not seed members: ${error.message}`);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("serves the bishop the Planner with the ward's members in Last, First form", async () => {
    await actAs(fixtures, "bishop");
    const response = await getFrame();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(html).toContain(`${lastName()}, Quill`);
    expect(html).not.toContain(`${lastName()}, Moved`);
    expect(html).not.toContain("__DATA__");
    expect(html).toContain("window.parent.__wltPlannerBridge");
    expect(html).toContain("Sacrament Planner");
  });

  it("opens with empty history when the ward was never imported", async () => {
    await actAs(fixtures, "bishop");
    const html = await (await getFrame()).text();
    expect(html).toMatch(/const DATA = \{"rows":\[\],"meetings":\{\},"ward":\[/);
  });

  it("refuses the music coordinator with a 403 that carries no member data", async () => {
    await actAs(fixtures, "musicCoordinator");
    const response = await getFrame();
    const html = await response.text();

    expect(response.status).toBe(403);
    expect(html).toContain("only open to the bishopric");
    expect(html).not.toContain(lastName());
  });

  it("never serves ward A's members to ward B's bishop", async () => {
    await actAs(fixtures, "wardBBishop");
    const html = await (await getFrame()).text();
    expect(html).not.toContain(lastName());
  });
});
