// @vitest-environment node
//
// POST and PATCH /api/callings — the route that makes MULTI-WARD REACHABLE BY HAND.
//
// Migrations 068–071 built the model and scenario 066 could only reach a second calling by
// SEEDING one. This route is the first thing in the app that can create one, so the assertions
// below are about WHO may create it rather than about whether the row lands.
//
// ---------------------------------------------------------------------------
// TWO GUARDS, AND WHICH APPLIES DEPENDS ON WHICH WARD THE BODY NAMES
// ---------------------------------------------------------------------------
// The body NAMES a ward, which no other schema in this app permits — and it is correct here and
// only here, because the whole purpose is writing a calling in a ward that is not the one the
// caller is acting in. The body may NAME a ward; it may not AUTHORIZE one:
//
//   * the ward this session is acting in → `admin.manage_users`
//   * any other ward                     → `super_admin`, held in `unit_assignments`
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user and a
// pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const URL = "http://localhost/api/callings";

async function post(body: unknown) {
  const { POST } = await import("@/app/api/callings/route");
  return readResponse(await POST(jsonRequest(URL, { method: "POST", body })));
}

async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/callings/route");
  return readResponse(await PATCH(jsonRequest(URL, { method: "PATCH", body })));
}

describe("POST/PATCH /api/callings", () => {
  let fixtures: Fixtures;
  const created: string[] = [];

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "superAdmin",
      "musicCoordinator",
      "wardBBishop",
      "eqPresident",
    ]);
  });

  afterAll(async () => {
    if (created.length > 0) {
      await createServiceSupabaseClient()
        .from("ward_role_assignments")
        .delete()
        .in("id", created);
    }
    await fixtures?.cleanup();
  });

  // ---------------------------------------------------------------------------
  // THE CASE THE WHOLE PHASE WAS FOR
  // ---------------------------------------------------------------------------

  it("lets a super admin give somebody a calling in a second ward", async () => {
    await actAs(fixtures, "superAdmin");

    const { status, body } = await post({
      userId: fixtures.user("musicCoordinator").id,
      wardId: fixtures.wardBId,
      role: "ward_secretary",
    });

    expect(status).toBe(201);

    const calling = body.calling as { id: string; wardId: string; role: string };
    expect(calling.wardId).toBe(fixtures.wardBId);
    expect(calling.role).toBe("ward_secretary");

    created.push(calling.id);
  });

  // A BISHOP MAY STAFF THEIR OWN WARD AND NOBODY ELSE'S. This is the guard that keeps the route
  // from being a way into another ward, and it is the reason the body naming a ward is safe.
  it("refuses a ward admin assigning into another ward", async () => {
    await actAs(fixtures, "bishop");

    const { status } = await post({
      userId: fixtures.user("musicCoordinator").id,
      wardId: fixtures.wardBId,
      role: "ward_council_member",
    });

    expect(status).toBe(403);
  });

  it("refuses somebody with no admin permission in their own ward", async () => {
    // `org_president` does not hold `admin.manage_users`. Checked against the matrix rather than
    // assumed — CLAUDE.md §8 warns it is not always the intuitive answer.
    await actAs(fixtures, "eqPresident");

    const { status } = await post({
      userId: fixtures.user("musicCoordinator").id,
      wardId: fixtures.wardAId,
      role: "ward_council_member",
    });

    expect(status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // THE SCHEMA REFUSES WHAT NO GUARD SHOULD HAVE TO CATCH
  // ---------------------------------------------------------------------------

  // `super_admin` bypasses the access matrix entirely, so a ward-scoped route must never be the
  // ordinary path to one — the same refusal lib/validation/adminUser.ts makes.
  it("refuses super_admin as a calling role, even from a super admin", async () => {
    await actAs(fixtures, "superAdmin");

    const { status } = await post({
      userId: fixtures.user("musicCoordinator").id,
      wardId: fixtures.wardAId,
      role: "super_admin",
    });

    expect(status).toBe(400);
  });

  // A stake officer's authority is a `unit_assignments` row over a unit, not a calling in a ward.
  it("refuses a stake role as a calling", async () => {
    await actAs(fixtures, "superAdmin");

    const { status } = await post({
      userId: fixtures.user("musicCoordinator").id,
      wardId: fixtures.wardAId,
      role: "stake_president",
    });

    expect(status).toBe(400);
  });

  // ONE ACTIVE CALLING PER WARD — the partial unique index that keeps current_user_role()
  // single-valued. It is a refusal with a sentence, not a 500.
  it("refuses a second active calling in the same ward", async () => {
    await actAs(fixtures, "superAdmin");

    const { status, body } = await post({
      userId: fixtures.user("bishop").id,
      wardId: fixtures.wardAId,
      role: "ward_council_member",
    });

    expect(status).toBe(409);
    expect(body.error).toMatch(/already holds a calling/i);
  });

  // ---------------------------------------------------------------------------
  // RELEASING, AND THE LAST-BISHOP GUARD
  // ---------------------------------------------------------------------------

  // ⚠️ The ward must never be able to leave itself with no bishop and therefore no admin surface.
  // Ending a bishop's calling is the same lockout risk as demoting them, which
  // lib/auth/adminUsers.ts already refuses.
  it("refuses releasing a ward's only active bishop", async () => {
    await actAs(fixtures, "superAdmin");

    const { status, body } = await patch({
      userId: fixtures.user("bishop").id,
      wardId: fixtures.wardAId,
      isActive: false,
    });

    expect(status).toBe(409);
    expect(body.error).toMatch(/only active bishop/i);

    // The calling is still active — asserted from the row, because a refusal that did not
    // actually stop the write would look identical from the status code alone.
    const { data } = await createServiceSupabaseClient()
      .from("ward_role_assignments")
      .select("is_active")
      .eq("user_id", fixtures.user("bishop").id)
      .eq("ward_id", fixtures.wardAId)
      .eq("is_active", true)
      .maybeSingle();

    expect(data?.is_active).toBe(true);
  });

  it("releases an ordinary calling, and never deletes the row", async () => {
    await actAs(fixtures, "superAdmin");

    const { status } = await patch({
      userId: fixtures.user("musicCoordinator").id,
      wardId: fixtures.wardAId,
      isActive: false,
    });

    expect(status).toBe(200);

    // NEVER A DELETE. A calling somebody held is a record of what happened, and the partial
    // unique index is on `where is_active` precisely so the released row can stay.
    const { data } = await createServiceSupabaseClient()
      .from("ward_role_assignments")
      .select("is_active, ended_on")
      .eq("user_id", fixtures.user("musicCoordinator").id)
      .eq("ward_id", fixtures.wardAId)
      .maybeSingle();

    expect(data).not.toBeNull();
    expect(data?.is_active).toBe(false);
    expect(data?.ended_on).not.toBeNull();
  });

  it("answers 404 when the person holds no active calling in that ward", async () => {
    await actAs(fixtures, "superAdmin");

    const { status } = await patch({
      userId: fixtures.user("wardBBishop").id,
      wardId: fixtures.wardAId,
      isActive: false,
    });

    expect(status).toBe(404);
  });
});
