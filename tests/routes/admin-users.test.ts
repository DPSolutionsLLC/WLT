// @vitest-environment node
//
// PATCH /api/admin/users/[id] after ITER-058 cr2: it changes an account's active flag and nothing
// else. A body naming a role is refused by the schema, and nobody deactivates themselves.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SELF_DEACTIVATE_MESSAGE } from "@/lib/auth/adminUsers";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

async function patchUser(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/admin/users/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`http://localhost/api/admin/users/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

describe("PATCH /api/admin/users/[id]", () => {
  let fixtures: Fixtures;

  async function readState(userId: string) {
    const { data: account, error: accountError } = await fixtures.service
      .from("users")
      .select("is_active")
      .eq("id", userId)
      .single();
    if (accountError) throw new Error(accountError.message);
    const { data: calling, error: callingError } = await fixtures.service
      .from("ward_role_assignments")
      .select("role")
      .eq("user_id", userId)
      .eq("ward_id", fixtures.wardAId)
      .eq("is_active", true)
      .single();
    if (callingError) throw new Error(callingError.message);
    return { isActive: account.is_active, role: calling.role };
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "musicCoordinator"]);
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("refuses a body that tries to set a role", async () => {
    await actAs(fixtures, "bishop");
    const target = fixtures.user("musicCoordinator").id;
    const { status } = await patchUser(target, { role: "ward_secretary" });
    expect(status).toBe(400);
    expect((await readState(target)).role).toBe("music_coordinator");
  });

  it("refuses a role smuggled in beside a valid change", async () => {
    await actAs(fixtures, "bishop");
    const target = fixtures.user("musicCoordinator").id;
    const { status } = await patchUser(target, { isActive: true, role: "super_admin" });
    expect(status).toBe(400);
    expect((await readState(target)).role).toBe("music_coordinator");
  });

  // Counselor 1 holds admin.manage_users and is not the last bishop, so only the self rule applies.
  it("refuses deactivating your own account", async () => {
    await actAs(fixtures, "counselor1");
    const self = fixtures.user("counselor1").id;
    const { status, body } = await patchUser(self, { isActive: false });
    expect(status).toBe(400);
    expect(body).toEqual({ error: SELF_DEACTIVATE_MESSAGE });
    expect((await readState(self)).isActive).toBe(true);
  });

  it("still deactivates somebody else", async () => {
    await actAs(fixtures, "counselor1");
    const target = fixtures.user("musicCoordinator").id;
    const { status } = await patchUser(target, { isActive: false });
    expect(status).toBe(200);
    expect((await readState(target)).isActive).toBe(false);
  });
});
