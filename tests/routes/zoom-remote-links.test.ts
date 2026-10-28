// @vitest-environment node
//
// The stream remote-link routes (ITER-051): PUT / DELETE /api/zoom/remote-links/[position] and the
// GET /api/zoom/remote-control redirect. Only the server client factory is mocked, so the redirect's
// read really runs as the acting user and RLS decides. See tests/helpers/routeClient.ts.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { endCalling, updateCalling } from "@/lib/callings/writeCalling";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type FixtureHandle, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api/zoom";
const FIRST_LINK = "https://example.org/remote/first-secret-7f3a";
const SECOND_LINK = "https://example.org/remote/second-secret-91bc";

async function put(position: string, body: unknown) {
  const { PUT } = await import("@/app/api/zoom/remote-links/[position]/route");
  return readResponse(
    await PUT(jsonRequest(`${BASE}/remote-links/${position}`, { method: "PUT", body }), {
      params: Promise.resolve({ position }),
    }),
  );
}

async function remove(position: string) {
  const { DELETE } = await import("@/app/api/zoom/remote-links/[position]/route");
  return readResponse(
    await DELETE(jsonRequest(`${BASE}/remote-links/${position}`, { method: "DELETE" }), {
      params: Promise.resolve({ position }),
    }),
  );
}

async function openRemote() {
  const { GET } = await import("@/app/api/zoom/remote-control/route");
  return GET(jsonRequest(`${BASE}/remote-control`));
}

describe("/api/zoom remote links", () => {
  let fixtures: Fixtures;

  async function linkRow(position: string) {
    const { data, error } = await fixtures.service
      .from("zoom_remote_links")
      .select("url, holder_calling_id, deactivated_at, deactivated_reason")
      .eq("ward_id", fixtures.wardAId)
      .eq("position", position)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async function callingIdOf(handle: FixtureHandle) {
    const { data, error } = await fixtures.service
      .from("ward_role_assignments")
      .select("id")
      .eq("user_id", fixtures.user(handle).id)
      .eq("ward_id", fixtures.wardAId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async function auditRows(action: string) {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail, module")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", action);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function allZoomAuditJson() {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("module", "zoom");
    if (error) throw new Error(error.message);
    return JSON.stringify(data ?? []);
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "counselor2",
      "wardSecretary",
      "executiveSecretary",
      "musicCoordinator",
      "eqPresident",
    ]);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("sets the 1st counselor's link as the bishop, bound to that calling, audited without the url", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await put("counselor_1", { url: FIRST_LINK });

    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("example.org");
    expect((body.row as { state: string }).state).toBe("live");

    const row = await linkRow("counselor_1");
    expect(row?.url).toBe(FIRST_LINK);
    expect(row?.holder_calling_id).toBe(await callingIdOf("counselor1"));

    const audits = await auditRows("zoom_remote_link_set");
    expect(audits).toHaveLength(1);
    expect(audits[0].module).toBe("zoom");
    expect(audits[0].detail).toMatchObject({
      position: "counselor_1",
      holderUserId: fixtures.user("counselor1").id,
    });
  });

  it("replaces the link on a second PUT and clears any turn-off", async () => {
    await actAs(fixtures, "counselor2");
    const { status } = await put("counselor_1", { url: SECOND_LINK });
    expect(status).toBe(200);

    const row = await linkRow("counselor_1");
    expect(row).toMatchObject({ url: SECOND_LINK, deactivated_at: null, deactivated_reason: null });
    expect(await auditRows("zoom_remote_link_replaced")).toHaveLength(1);
  });

  it("refuses the ward clerk, who holds zoom.view but not the right to manage links", async () => {
    await actAs(fixtures, "wardSecretary");
    const { status } = await put("bishop", { url: FIRST_LINK });
    expect(status).toBe(403);
    expect(await linkRow("bishop")).toBeNull();
  });

  it("refuses the music coordinator", async () => {
    await actAs(fixtures, "musicCoordinator");
    const { status } = await put("bishop", { url: FIRST_LINK });
    expect(status).toBe(403);
  });

  it("refuses an http:// link with a sentence", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await put("bishop", { url: "http://example.org/remote" });
    expect(status).toBe(400);
    expect(errorMessage(body)).toBe("Paste the full link, starting with https://.");
  });

  it("refuses a position that does not exist", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await put("primary_president", { url: FIRST_LINK });
    expect(status).toBe(400);
    expect(errorMessage(body)).toContain("five remote-link positions");
  });

  it("refuses to set a link for a vacant position with 409", async () => {
    const callingId = await callingIdOf("executiveSecretary");
    await fixtures.service
      .from("ward_role_assignments")
      .update({ is_active: false })
      .eq("id", callingId);
    try {
      await actAs(fixtures, "bishop");
      const { status, body } = await put("executive_secretary", { url: FIRST_LINK });
      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("No one holds this calling");
      expect(await linkRow("executive_secretary")).toBeNull();
    } finally {
      await fixtures.service
        .from("ward_role_assignments")
        .update({ is_active: true })
        .eq("id", callingId);
    }
  });

  it("opens the holder's own link with a no-store 303", async () => {
    await actAs(fixtures, "counselor1");
    const response = await openRemote();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(SECOND_LINK);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("sends a holder with no live link back to the Zoom page", async () => {
    await actAs(fixtures, "wardSecretary");
    const response = await openRemote();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost/zoom?remote=none");
  });

  it("refuses the remote-control redirect to an org president", async () => {
    await actAs(fixtures, "eqPresident");
    const response = await openRemote();
    expect(response.status).toBe(403);
  });

  it("turns a link off as a counselor, then answers 404 when nothing is live", async () => {
    await actAs(fixtures, "bishop");
    expect((await put("counselor_2", { url: FIRST_LINK })).status).toBe(200);

    await actAs(fixtures, "counselor1");
    const first = await remove("counselor_2");
    expect(first.status).toBe(200);
    expect((first.body.row as { state: string }).state).toBe("turned_off");
    expect(await linkRow("counselor_2")).toMatchObject({
      url: null,
      deactivated_reason: "turned_off",
    });
    expect(await auditRows("zoom_remote_link_turned_off")).toHaveLength(1);

    const second = await remove("counselor_2");
    expect(second.status).toBe(404);
  });

  it("turns the link off when the real writer swaps the counselor number, and never revives it", async () => {
    const actorUserId = fixtures.user("bishop").id;
    const counselor = fixtures.user("counselor1");
    try {
      await updateCalling(
        { userId: counselor.id, wardId: fixtures.wardAId, changes: { counselorPosition: 2 }, actorUserId },
        fixtures.service,
      );
      expect(await linkRow("counselor_1")).toMatchObject({
        url: null,
        deactivated_reason: "holder_changed",
      });
      const retired = await auditRows("zoom_remote_link_turned_off");
      expect(
        retired.some(
          (row) => (row.detail as { reason?: string }).reason === "holder_changed",
        ),
      ).toBe(true);

      await updateCalling(
        { userId: counselor.id, wardId: fixtures.wardAId, changes: { counselorPosition: 1 }, actorUserId },
        fixtures.service,
      );
      expect((await linkRow("counselor_1"))?.url).toBeNull();
    } finally {
      await updateCalling(
        { userId: counselor.id, wardId: fixtures.wardAId, changes: { counselorPosition: 1 }, actorUserId },
        fixtures.service,
      );
    }
  });

  it("keeps the bishop's link off after a release and a reinstatement", async () => {
    await actAs(fixtures, "bishop");
    expect((await put("bishop", { url: FIRST_LINK })).status).toBe(200);

    const bishop = fixtures.user("bishop");
    const callingId = await callingIdOf("bishop");
    try {
      await endCalling(
        { userId: bishop.id, wardId: fixtures.wardAId, actorUserId: bishop.id },
        fixtures.service,
      );
      expect(await linkRow("bishop")).toMatchObject({
        url: null,
        deactivated_reason: "holder_changed",
      });
    } finally {
      await fixtures.service
        .from("ward_role_assignments")
        .update({ is_active: true, ended_on: null })
        .eq("id", callingId);
    }

    expect((await linkRow("bishop"))?.url).toBeNull();
    const response = await openRemote();
    expect(response.headers.get("location")).toBe("http://localhost/zoom?remote=none");
  });

  it("never writes any part of a link into an audit row", async () => {
    const json = await allZoomAuditJson();
    expect(json).not.toContain("example.org");
    expect(json).not.toContain("secret");
  });
});
