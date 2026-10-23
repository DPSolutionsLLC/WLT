// @vitest-environment node
//
// PUT /api/wards/[id]/released-modules (ITER-041), and a module route refusing a bishop in a
// ward that has not released it. Only the client factory is mocked (tests/helpers/routeClient.ts),
// so every query runs as a genuinely authenticated user.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

function url(wardId: string): string {
  return `http://localhost/api/wards/${wardId}/released-modules`;
}

async function put(wardId: string, body: unknown) {
  const { PUT } = await import("@/app/api/wards/[id]/released-modules/route");
  return readResponse(
    await PUT(jsonRequest(url(wardId), { method: "PUT", body }), {
      params: Promise.resolve({ id: wardId }),
    }),
  );
}

describe("PUT /api/wards/[id]/released-modules", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "superAdmin"]);
  });

  afterAll(async () => {
    await fixtures?.service.from("ward_release_settings").delete().eq("ward_id", fixtures.wardBId);
    await fixtures?.service.from("ward_release_settings").delete().eq("ward_id", fixtures.wardAId);
    await fixtures?.cleanup();
  });

  async function readList(wardId: string) {
    const { data } = await fixtures.service
      .from("ward_release_settings")
      .select("released_modules")
      .eq("ward_id", wardId)
      .maybeSingle();
    return data?.released_modules ?? null;
  }

  // A valid body, so the refusal is for WHO is asking and nothing earlier.
  it("refuses a bishop, and writes nothing", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await put(fixtures.wardAId, { modules: ["tithing"] });

    expect(status).toBe(403);
    expect(await readList(fixtures.wardAId)).toBeNull();
  });

  it("lets a super admin set another ward's list, and audits it", async () => {
    await actAs(fixtures, "superAdmin");
    const { status, body } = await put(fixtures.wardBId, { modules: ["sacrament", "tithing"] });

    expect(status).toBe(200);
    expect(body).toEqual({ wardId: fixtures.wardBId, modules: ["sacrament", "tithing"] });
    expect(await readList(fixtures.wardBId)).toEqual(["sacrament", "tithing"]);

    const { data: audit } = await fixtures.service
      .from("audit_log")
      .select("ward_id, detail")
      .eq("action", "released_modules_updated")
      .eq("user_id", fixtures.user("superAdmin").id);
    expect(audit).toEqual([
      {
        ward_id: fixtures.wardAId,
        detail: { targetWardId: fixtures.wardBId, modules: ["sacrament", "tithing"] },
      },
    ]);
  });

  it("removes the list when sent null, which means everything", async () => {
    await actAs(fixtures, "superAdmin");
    const { status } = await put(fixtures.wardBId, { modules: null });

    expect(status).toBe(200);
    expect(await readList(fixtures.wardBId)).toBeNull();
  });

  it("refuses a module key the app does not have", async () => {
    await actAs(fixtures, "superAdmin");
    const { status } = await put(fixtures.wardBId, { modules: ["tithing", "zoom"] });

    expect(status).toBe(400);
    expect(await readList(fixtures.wardBId)).toBeNull();
  });

  // The narrowed can() at a real route: the bishop holds agendas.view, and ward A has not
  // released it. The control is the same GET answering 200 before the list exists.
  it("answers 403 from a module route the ward has not released", async () => {
    const { GET } = await import("@/app/api/agendas/route");

    await actAs(fixtures, "bishop");
    const before = await readResponse(await GET(jsonRequest("http://localhost/api/agendas")));
    expect(before.status).toBe(200);

    await fixtures.service
      .from("ward_release_settings")
      .insert({ ward_id: fixtures.wardAId, released_modules: ["tithing"] });

    await actAs(fixtures, "bishop");
    const after = await readResponse(await GET(jsonRequest("http://localhost/api/agendas")));
    expect(after.status).toBe(403);
  });
});
