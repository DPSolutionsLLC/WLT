// @vitest-environment node
//
// GET and PUT /api/visit-sharing (ITER-055, migration 099).
//
// PUT is the ONLY writer of visit_org_sharing, on the service role, so its check —
// visits.manage_sharing AND a bishopric calling — is the write boundary and is asserted from both
// sides. Bishopric authority is shared (CLAUDE.md §7): a counselor does exactly what the bishop
// does. Every admin change notifies the other two.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const URL = "http://localhost/api/visit-sharing";

async function getSharing() {
  const { GET } = await import("@/app/api/visit-sharing/route");
  return readResponse(await GET());
}

async function putSharing(body: unknown) {
  const { PUT } = await import("@/app/api/visit-sharing/route");
  return readResponse(await PUT(jsonRequest(URL, { method: "PUT", body })));
}

type Grant = { ownerOrgId: string; viewerOrgId: string };

describe("/api/visit-sharing", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let bishopricOrgId: string;

  const storedGrants = async (): Promise<Grant[]> => {
    const { data, error } = await fixtures.service
      .from("visit_org_sharing")
      .select("owner_org_id, viewer_org_id")
      .eq("ward_id", wardId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      ownerOrgId: row.owner_org_id,
      viewerOrgId: row.viewer_org_id,
    }));
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "counselor1", "counselor2", "eqPresident", "rsPresident"],
      {
        notificationTriggers: [
          { triggerKey: "admin_setting_changed", defaultRoles: ["bishop", "counselor"] },
        ],
      },
    );
    wardId = fixtures.wardAId;

    const { data, error } = await fixtures.service
      .from("organizations")
      .insert({ ward_id: wardId, name: "Bishopric", type: "bishopric" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    bishopricOrgId = data.id;
  }, 90_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("lets the bishop share the Bishopric's visits with the Elders Quorum", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await putSharing({
      grants: [{ ownerOrgId: bishopricOrgId, viewerOrgId: fixtures.eldersQuorumId }],
    });

    expect(status).toBe(200);
    expect(body.grants).toEqual([
      { ownerOrgId: bishopricOrgId, viewerOrgId: fixtures.eldersQuorumId },
    ]);
    expect(await storedGrants()).toEqual(body.grants);
  });

  it("writes an audit row naming what changed", async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("action, detail")
      .eq("ward_id", wardId)
      .eq("action", "visit_sharing_updated")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    expect(error).toBeNull();
    expect((data?.detail as { grantCount: number }).grantCount).toBe(1);
  });

  it("notifies the other two bishopric members and not the bishop", async () => {
    const { data, error } = await fixtures.service
      .from("notifications")
      .select("recipient_user_id, title")
      .eq("ward_id", wardId)
      .eq("title", "Visit sharing changed");

    expect(error).toBeNull();
    const recipients = (data ?? []).map((row) => row.recipient_user_id);
    expect(recipients).toContain(fixtures.user("counselor1").id);
    expect(recipients).toContain(fixtures.user("counselor2").id);
    expect(recipients).not.toContain(fixtures.user("bishop").id);
  });

  it("lets a counselor replace the set, exactly as the bishop can", async () => {
    await actAs(fixtures, "counselor2");
    const { status } = await putSharing({
      grants: [{ ownerOrgId: fixtures.eldersQuorumId, viewerOrgId: fixtures.reliefSocietyId }],
    });

    expect(status).toBe(200);
    expect(await storedGrants()).toEqual([
      { ownerOrgId: fixtures.eldersQuorumId, viewerOrgId: fixtures.reliefSocietyId },
    ]);
  });

  it("refuses an org president and leaves the grants as they were", async () => {
    await actAs(fixtures, "eqPresident");
    const { status } = await putSharing({ grants: [] });

    expect(status).toBe(403);
    expect(await storedGrants()).toHaveLength(1);
  });

  it("lets an org president read the grants", async () => {
    await actAs(fixtures, "rsPresident");
    const { status, body } = await getSharing();

    expect(status).toBe(200);
    expect(body.grants).toHaveLength(1);
  });

  it("refuses the Bishopric as a viewer with a sentence", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await putSharing({
      grants: [{ ownerOrgId: fixtures.eldersQuorumId, viewerOrgId: bishopricOrgId }],
    });

    expect(status).toBe(400);
    expect(body.error).toContain("already sees every organization");
    expect(await storedGrants()).toHaveLength(1);
  });

  it("refuses an organization from another ward", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await putSharing({
      grants: [{ ownerOrgId: fixtures.wardBOrgId, viewerOrgId: fixtures.eldersQuorumId }],
    });

    expect(status).toBe(400);
  });

  it("clears every grant with an empty set", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await putSharing({ grants: [] });

    expect(status).toBe(200);
    expect(await storedGrants()).toEqual([]);
  });
});
