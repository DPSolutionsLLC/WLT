// @vitest-environment node
//
// The Zoom join-link pool routes (ITER-053): GET / POST /api/zoom/join-links and
// DELETE /api/zoom/join-links/[id]. Only the server client factory is mocked, so every query runs
// as the acting user. See tests/helpers/routeClient.ts.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api/zoom/join-links";

const pasteOf = (labels: string[]) =>
  labels
    .map((label) => `Guest ${label}, sacrament+${label}@example.org, https://example.org/j/secret-${label}`)
    .join("\n");

async function getPool() {
  const { GET } = await import("@/app/api/zoom/join-links/route");
  return readResponse(await GET());
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/zoom/join-links/route");
  return readResponse(await POST(jsonRequest(BASE, { method: "POST", body })));
}

async function remove(id: string) {
  const { DELETE } = await import("@/app/api/zoom/join-links/[id]/route");
  return readResponse(
    await DELETE(jsonRequest(`${BASE}/${id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    }),
  );
}

describe("/api/zoom/join-links", () => {
  let fixtures: Fixtures;

  async function poolEmails(): Promise<string[]> {
    const { data, error } = await fixtures.service
      .from("zoom_join_links")
      .select("placeholder_email")
      .eq("ward_id", fixtures.wardAId)
      .order("placeholder_email");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.placeholder_email);
  }

  async function linkIdFor(email: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("zoom_join_links")
      .select("id")
      .eq("ward_id", fixtures.wardAId)
      .eq("placeholder_email", email)
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "wardSecretary"]);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("previews a paste without writing anything, and returns no URL", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await post({ text: pasteOf(["p1", "p2"]), apply: false });
    expect(status).toBe(200);
    expect(body).toMatchObject({ problems: [] });
    expect((body as { lines: unknown[] }).lines).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain("https://");
    expect(await poolEmails()).toEqual([]);
  });

  it("adds a paste, audits counts only, and reports nobody waiting", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await post({ text: pasteOf(["a1", "a2", "a3"]), apply: true });
    expect(status).toBe(200);
    expect(body).toEqual({ addedCount: 3, alreadyInPool: [], waitingCount: 0 });
    expect(await poolEmails()).toEqual([
      "sacrament+a1@example.org",
      "sacrament+a2@example.org",
      "sacrament+a3@example.org",
    ]);

    const { data: audit } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "zoom_join_links_added");
    expect(audit?.[0]?.detail).toEqual({ addedCount: 3, alreadyInPoolCount: 0 });
    expect(JSON.stringify(audit)).not.toContain("https://");
  });

  it("reports links already in the pool by line number on a re-paste", async () => {
    await actAs(fixtures, "counselor1");
    const { status, body } = await post({ text: pasteOf(["a1", "a4"]), apply: true });
    expect(status).toBe(200);
    expect(body).toEqual({ addedCount: 1, alreadyInPool: [1], waitingCount: 0 });
  });

  it("refuses a paste with a bad line as a 400, and adds none of it", async () => {
    await actAs(fixtures, "bishop");
    const before = await poolEmails();
    const text = `${pasteOf(["b1"])}\nGuest b2, https://example.org/j/secret-b2`;
    const { status, body } = await post({ text, apply: true });
    expect(status).toBe(400);
    expect(errorMessage(body)).toContain("Line 2");
    expect(await poolEmails()).toEqual(before);
  });

  it("returns the pool summary with no URL", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await getPool();
    expect(status).toBe(200);
    expect((body as { pool: { freeCount: number } }).pool.freeCount).toBe(4);
    expect(JSON.stringify(body)).not.toContain("https://");
  });

  it("refuses the clerk on GET, POST and DELETE, writing nothing", async () => {
    await actAs(fixtures, "wardSecretary");
    const before = await poolEmails();
    expect((await getPool()).status).toBe(403);
    expect((await post({ text: pasteOf(["c1"]), apply: true })).status).toBe(403);
    const freeId = await linkIdFor("sacrament+a2@example.org");
    expect((await remove(freeId)).status).toBe(403);
    expect(await poolEmails()).toEqual(before);
  });

  it("removes a free link and audits its id", async () => {
    await actAs(fixtures, "bishop");
    const freeId = await linkIdFor("sacrament+a3@example.org");
    const { status } = await remove(freeId);
    expect(status).toBe(200);
    expect(await poolEmails()).not.toContain("sacrament+a3@example.org");

    const { data: audit } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "zoom_join_link_removed");
    expect(audit?.[0]?.detail).toEqual({ joinLinkId: freeId });
  });

  it("refuses to remove a given link with a 409, and the row survives", async () => {
    const givenId = await linkIdFor("sacrament+a1@example.org");
    const { error: seedError } = await fixtures.service.from("zoom_invitees").insert({
      ward_id: fixtures.wardAId,
      display_name: "Ann Holder",
      join_link_id: givenId,
      link_given_at: new Date().toISOString(),
    });
    if (seedError) throw new Error(seedError.message);

    await actAs(fixtures, "bishop");
    const { status, body } = await remove(givenId);
    expect(status).toBe(409);
    expect(errorMessage(body)).toBe("That link has been given to someone, so it can't be removed.");
    expect(await poolEmails()).toContain("sacrament+a1@example.org");
  });

  it("reports a waiting person in the add result", async () => {
    const { error } = await fixtures.service
      .from("zoom_invitees")
      .insert({ ward_id: fixtures.wardAId, display_name: "Waiting Wendy" });
    if (error) throw new Error(error.message);

    await actAs(fixtures, "bishop");
    const { body } = await post({ text: pasteOf(["w1"]), apply: true });
    expect(body).toEqual({ addedCount: 1, alreadyInPool: [], waitingCount: 1 });
  });

  it("refuses a malformed id with a 400 before reaching the database", async () => {
    await actAs(fixtures, "bishop");
    expect((await remove("not-a-uuid")).status).toBe(400);
  });
});
