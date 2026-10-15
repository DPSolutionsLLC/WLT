// @vitest-environment node
//
// POST /api/units for a WARD unit provisions the ward behind it (ITER-041 slice a), and a rename
// of a ward unit renames that ward. Before this, "Add a unit → Ward" made a `units` row and
// nothing else, so the new ward could not be held a calling in or switched to.
//
// Everything the walk creates is outside the fixtures' two wards, so it is cleaned up explicitly:
// the calling, then the ward (organizations and notification settings cascade), then the unit.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_TRIGGER_DEFAULTS } from "@/lib/notifications/triggerDefaults";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const URL = "http://localhost/api/units";

async function post(body: unknown) {
  const { POST } = await import("@/app/api/units/route");
  return readResponse(await POST(jsonRequest(URL, { method: "POST", body })));
}

async function patch(unitId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/units/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${URL}/${unitId}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id: unitId }),
    }),
  );
}

describe("POST /api/units provisions a ward", () => {
  let fixtures: Fixtures;
  const createdUnitIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedFixtures(["superAdmin", "bishop"]);
  });

  afterAll(async () => {
    const service = fixtures?.service;
    if (service && createdUnitIds.length > 0) {
      const { data: wards } = await service
        .from("wards")
        .select("id")
        .in("unit_id", createdUnitIds);
      const wardIds = (wards ?? []).map((ward) => ward.id);
      if (wardIds.length > 0) {
        await service.from("ward_role_assignments").delete().in("ward_id", wardIds);
        await service.from("wards").delete().in("id", wardIds);
      }
      await service.from("units").delete().in("id", createdUnitIds);
    }
    await fixtures?.cleanup();
  });

  it("creates the ward, its organizations, its notification settings and the creator's calling", async () => {
    await actAs(fixtures, "superAdmin");
    const name = `Provisioned ward ${fixtures.runId}`;

    const { status, body } = await post({
      type: "ward",
      name,
      parentId: fixtures.stakeUnitId,
      callingRole: "bishop",
    });

    expect(status).toBe(201);
    const unit = body.unit as { id: string };
    createdUnitIds.push(unit.id);
    expect(body.callingCreated).toBe(true);

    const { data: ward } = await fixtures.service
      .from("wards")
      .select("id, name, unit_id, settings")
      .eq("unit_id", unit.id)
      .single();
    expect(ward?.name).toBe(name);
    expect((body.ward as { id: string }).id).toBe(ward?.id);
    expect(ward?.settings).toMatchObject({ timezone: "America/Denver" });

    const wardId = ward?.id as string;

    const { data: organizations } = await fixtures.service
      .from("organizations")
      .select("type")
      .eq("ward_id", wardId);
    expect((organizations ?? []).map((row) => row.type).sort()).toEqual(
      [
        "bishopric",
        "elders_quorum",
        "primary",
        "relief_society",
        "sunday_school",
        "young_men",
        "young_women",
      ].sort(),
    );

    const { data: settings } = await fixtures.service
      .from("notification_settings")
      .select("trigger_key")
      .eq("ward_id", wardId);
    expect((settings ?? []).map((row) => row.trigger_key).sort()).toEqual(
      NOTIFICATION_TRIGGER_DEFAULTS.map((trigger) => trigger.triggerKey).sort(),
    );

    const { data: callings } = await fixtures.service
      .from("ward_role_assignments")
      .select("user_id, role, is_active")
      .eq("ward_id", wardId);
    expect(callings).toEqual([
      { user_id: fixtures.user("superAdmin").id, role: "bishop", is_active: true },
    ]);

    const { data: audit } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("action", "unit_created")
      .eq("user_id", fixtures.user("superAdmin").id)
      .contains("detail", { unitId: unit.id });
    expect(audit?.[0]?.detail).toMatchObject({ wardId, callingCreated: true });
  });

  it("renames the ward when its unit is renamed", async () => {
    await actAs(fixtures, "superAdmin");
    const { body } = await post({ type: "ward", name: `Rename me ${fixtures.runId}` });
    const unitId = (body.unit as { id: string }).id;
    createdUnitIds.push(unitId);
    expect(body.callingCreated).toBe(false);

    const renamed = `Renamed ward ${fixtures.runId}`;
    const { status } = await patch(unitId, { name: renamed });
    expect(status).toBe(200);

    const { data: ward } = await fixtures.service
      .from("wards")
      .select("name")
      .eq("unit_id", unitId)
      .single();
    expect(ward?.name).toBe(renamed);
  });

  it("refuses a calling on a stake, with a sentence, and creates nothing", async () => {
    await actAs(fixtures, "superAdmin");
    const name = `Stake with calling ${fixtures.runId}`;

    const { status, body } = await post({ type: "stake", name, callingRole: "bishop" });

    expect(status).toBe(400);
    expect(errorMessage(body)).toMatch(/Only a ward can give you a calling/);
    const { data } = await fixtures.service.from("units").select("id").eq("name", name);
    expect(data).toEqual([]);
  });

  it("refuses somebody who is not a super admin, and creates nothing", async () => {
    await actAs(fixtures, "bishop");
    const name = `Not allowed ${fixtures.runId}`;

    const { status } = await post({ type: "ward", name, callingRole: "bishop" });

    expect(status).toBe(403);
    const { data: units } = await fixtures.service.from("units").select("id").eq("name", name);
    expect(units).toEqual([]);
    const { data: wards } = await fixtures.service.from("wards").select("id").eq("name", name);
    expect(wards).toEqual([]);
  });
});
