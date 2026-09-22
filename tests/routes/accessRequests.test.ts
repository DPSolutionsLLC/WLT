// @vitest-environment node
//
// POST and GET /api/access-requests, and PATCH /api/access-requests/[id].
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
//   1. A WARD ADMIN CANNOT APPROVE THEIR OWN REQUEST. tests/rls/access-requests.test.ts proves
//      the database refuses it; this proves the ROUTE refuses it too, with a 403 rather than a
//      silent no-op. Both, because the route check is the one a person sees and the policy is the
//      one that holds when somebody forgets it.
//   2. A REQUEST CANNOT ASK FOR SOMETHING AN APPROVAL COULD NOT GRANT. `admin.*` and
//      `sacrament.*` are non-overridable in both directions, so such a request would be accepted,
//      approved, written and silently have no effect — and a granted permission that does not
//      arrive is worse than a refusal, because nobody goes looking for it.
//   3. AN APPROVAL LANDS AS A MERGED DELTA. The ward's other settings survive it.
//   4. A DENIAL CARRIES A NOTE, because the requester reads it.
//
// `params` IS A PROMISE IN NEXT 16 — `PATCH(request, { params: Promise.resolve({ id }) })`.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const URL = "http://localhost/api/access-requests";

async function postRequest(body: unknown) {
  const { POST } = await import("@/app/api/access-requests/route");
  return readResponse(await POST(jsonRequest(URL, { method: "POST", body })));
}

async function listRequests() {
  const { GET } = await import("@/app/api/access-requests/route");
  return readResponse(await GET());
}

async function decide(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/access-requests/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${URL}/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

async function readWardSettings(wardId: string): Promise<Record<string, unknown>> {
  const { data } = await createServiceSupabaseClient()
    .from("wards")
    .select("settings")
    .eq("id", wardId)
    .maybeSingle();

  const settings = data?.settings;
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return {};
  return settings as Record<string, unknown>;
}

describe("/api/access-requests", () => {
  let fixtures: Fixtures;
  const createdRequests: string[] = [];

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "superAdmin", "eqPresident"]);
  });

  afterAll(async () => {
    if (createdRequests.length > 0) {
      await createServiceSupabaseClient()
        .from("access_requests")
        .delete()
        .in("id", createdRequests);
    }
    await fixtures?.cleanup();
  });

  async function fileRequest(permission = "agendas.manage"): Promise<string> {
    await actAs(fixtures, "bishop");
    const { status, body } = await postRequest({
      role: "org_president",
      permission,
      level: "F",
      reason: "Our presidents build most of the agenda before the meeting anyway.",
    });

    expect(status).toBe(201);
    const { id } = body.request as { id: string };
    createdRequests.push(id);
    return id;
  }

  // ---------------------------------------------------------------------------
  // ASKING
  // ---------------------------------------------------------------------------

  it("lets a ward admin file a request and read it back", async () => {
    const id = await fileRequest();

    const { status, body } = await listRequests();
    expect(status).toBe(200);
    expect(
      (body.requests as { id: string; status: string }[]).find((row) => row.id === id)?.status,
    ).toBe("pending");
  });

  it("refuses somebody without admin.manage_roles", async () => {
    await actAs(fixtures, "eqPresident");

    const { status } = await postRequest({
      role: "org_president",
      permission: "agendas.manage",
      level: "F",
      reason: "A reason long enough to pass the schema's minimum length.",
    });

    expect(status).toBe(403);
  });

  it("refuses a request with no written reason", async () => {
    await actAs(fixtures, "bishop");

    const { status } = await postRequest({
      role: "org_president",
      permission: "agendas.manage",
      level: "F",
      reason: "no",
    });

    expect(status).toBe(400);
  });

  // ⚠️ THE SILENT-NO-OP REFUSAL. Approving one of these would write a delta that
  // `mergeRoleAccess` then discards, so the ward would believe it had been given something it
  // does not have.
  it("refuses a request for a non-overridable permission", async () => {
    await actAs(fixtures, "bishop");

    for (const permission of ["admin.manage_users", "sacrament.manage_pools"]) {
      const { status } = await postRequest({
        role: "org_president",
        permission,
        level: "F",
        reason: "A reason long enough to pass the schema's minimum length.",
      });

      expect(status, `${permission} should be refused at the boundary`).toBe(400);
    }
  });

  // ---------------------------------------------------------------------------
  // DECIDING
  // ---------------------------------------------------------------------------

  // ⚠️ THE CASE THE WHOLE FLOW TURNS ON.
  it("refuses a ward admin deciding their own request", async () => {
    const id = await fileRequest();

    await actAs(fixtures, "bishop");
    const { status } = await decide(id, {
      status: "approved_ward",
      decisionNote: "Approving my own request.",
    });

    expect(status).toBe(403);

    const { data } = await createServiceSupabaseClient()
      .from("access_requests")
      .select("status, decided_by")
      .eq("id", id)
      .single();

    expect(data?.status).toBe("pending");
    expect(data?.decided_by).toBeNull();
  });

  it("requires a note on a denial", async () => {
    const id = await fileRequest();

    await actAs(fixtures, "superAdmin");
    const { status } = await decide(id, { status: "denied" });

    expect(status).toBe(400);
  });

  it("lets a super admin deny with a note the requester can read", async () => {
    const id = await fileRequest();

    await actAs(fixtures, "superAdmin");
    const { status } = await decide(id, {
      status: "denied",
      decisionNote: "Editing the agenda stays with the executive secretary for now.",
    });

    expect(status).toBe(200);

    // READ BACK AS THE REQUESTER, not as the decider. The whole point is that the ward can see
    // the outcome; a note only the super admin can read is the gap the prototype shipped.
    await actAs(fixtures, "bishop");
    const { body } = await listRequests();
    const row = (body.requests as { id: string; decisionNote: string | null }[]).find(
      (entry) => entry.id === id,
    );

    expect(row?.decisionNote).toMatch(/executive secretary/);
  });

  // ---------------------------------------------------------------------------
  // AN APPROVAL IS A MERGED DELTA
  // ---------------------------------------------------------------------------

  it("writes an add-delta and leaves the ward's other settings alone", async () => {
    const before = await readWardSettings(fixtures.wardAId);
    const id = await fileRequest("topics.manage");

    await actAs(fixtures, "superAdmin");
    const { status } = await decide(id, { status: "approved_ward" });
    expect(status).toBe(200);

    const after = await readWardSettings(fixtures.wardAId);
    const roleAccess = after.role_access as Record<string, { add?: string[] }> | undefined;

    expect(roleAccess?.org_president?.add).toContain("topics.manage");

    // EVERY OTHER KEY SURVIVED. A wholesale write is invisible from the delta alone.
    for (const key of Object.keys(before)) {
      if (key === "role_access") continue;
      expect(after[key], `wards.settings.${key} was changed by an approval`).toEqual(
        before[key],
      );
    }
  });

  // Re-deciding would move `decided_by` onto whoever pressed last and re-run the grant under a
  // new name, so it is refused rather than silently re-stamped.
  it("refuses deciding the same request twice", async () => {
    const id = await fileRequest("knowledge.manage");

    await actAs(fixtures, "superAdmin");
    expect((await decide(id, { status: "approved_ward" })).status).toBe(200);

    const { status, body } = await decide(id, {
      status: "denied",
      decisionNote: "Changing my mind after the fact.",
    });

    expect(status).toBe(409);
    expect(body.error).toMatch(/already been answered/i);
  });

  it("answers 404 for a request that is not there", async () => {
    await actAs(fixtures, "superAdmin");

    const { status } = await decide("00000000-0000-4000-8000-00000000dead", {
      status: "approved_ward",
    });

    expect(status).toBe(404);
  });
});
