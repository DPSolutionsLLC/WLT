// @vitest-environment node
//
// ITER-038 slice ma: PATCH /api/sundays/[id]/music sets a Sunday's chorister and organist.
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so the Sunday and member reads
// run as a real user against the hosted project. `sunday_music` has no write policy, so the write
// is the service role and the route's checks are the WHOLE guard — every refusal below re-reads
// the table with the service client to prove nothing was written.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api";

async function patchMusic(sundayId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/sundays/[id]/music/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/sundays/${sundayId}/music`, { method: "PATCH", body }), {
      params: Promise.resolve({ id: sundayId }),
    }),
  );
}

describe("PATCH /api/sundays/[id]/music — ITER-038 ma", () => {
  let fixtures: Fixtures;
  let sundayId = "";
  let conferenceSundayId = "";
  let quietSundayId = "";
  let ruthId = "";
  let wardBMemberId = "";

  async function rowFor(id: string) {
    const { data, error } = await fixtures.service
      .from("sunday_music")
      .select("chorister_member_id, chorister_name, organist_member_id, organist_name, status")
      .eq("sunday_id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["musicCoordinator", "bishop", "eqPresident"]);
    const service = fixtures.service;

    const seedSunday = async (date: string, type: string) => {
      const { data, error } = await service
        .from("sundays")
        .insert({ ward_id: fixtures.wardAId, date, type, speaking_slots: 3 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    sundayId = await seedSunday("2027-10-03", "standard");
    conferenceSundayId = await seedSunday("2027-10-10", "stake_conference");
    quietSundayId = await seedSunday("2027-10-17", "standard");

    const seedMember = async (wardId: string, firstName: string) => {
      const { data, error } = await service
        .from("members")
        .insert({
          ward_id: wardId,
          first_name: firstName,
          last_name: `Music${fixtures.runId}`,
          category: "adult",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };
    ruthId = await seedMember(fixtures.wardAId, "Ruth");
    wardBMemberId = await seedMember(fixtures.wardBId, "Brenda");
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("sets a roster member as chorister and returns their name", async () => {
    await actAs(fixtures, "musicCoordinator");

    const { status, body } = await patchMusic(sundayId, { chorister: { memberId: ruthId } });

    expect(status).toBe(200);
    expect(body.sundayMusic).toMatchObject({
      status: "draft",
      chorister: { memberId: ruthId, name: `Ruth Music${fixtures.runId}` },
      organist: null,
    });
    expect(await rowFor(sundayId)).toMatchObject({
      chorister_member_id: ruthId,
      chorister_name: null,
    });
  });

  it("sets a typed organist and leaves the chorister alone", async () => {
    await actAs(fixtures, "musicCoordinator");

    const { status, body } = await patchMusic(sundayId, { organist: { name: "  Brother Hale  " } });

    expect(status).toBe(200);
    expect(body.sundayMusic).toMatchObject({
      chorister: { memberId: ruthId },
      organist: { memberId: null, name: "Brother Hale" },
    });
    expect(await rowFor(sundayId)).toMatchObject({
      chorister_member_id: ruthId,
      organist_member_id: null,
      organist_name: "Brother Hale",
    });
  });

  it("replaces a member with a typed name, so the row never holds both", async () => {
    await actAs(fixtures, "musicCoordinator");

    const { status } = await patchMusic(sundayId, { chorister: { name: "Sister Jansen" } });

    expect(status).toBe(200);
    expect(await rowFor(sundayId)).toMatchObject({
      chorister_member_id: null,
      chorister_name: "Sister Jansen",
    });
  });

  it("clears a person with null", async () => {
    await actAs(fixtures, "musicCoordinator");

    const { status } = await patchMusic(sundayId, { organist: null });

    expect(status).toBe(200);
    expect(await rowFor(sundayId)).toMatchObject({ organist_member_id: null, organist_name: null });
  });

  it("writes an audit row that names which people changed, never who they are", async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "sunday_music_people_updated");
    if (error) throw new Error(error.message);

    expect(data.length).toBeGreaterThanOrEqual(4);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toMatch(/Ruth|Hale|Jansen/);
    expect(data[0].detail).toMatchObject({ sundayId, date: "2027-10-03" });
  });

  // A real member, a real Sunday, a role that may write — the only thing wrong is that the member
  // belongs to ward B, so the refusal can only be the roster check.
  it("refuses a member from another ward with a sentence", async () => {
    await actAs(fixtures, "musicCoordinator");

    const { status, body } = await patchMusic(quietSundayId, {
      chorister: { memberId: wardBMemberId },
    });

    expect(status).toBe(400);
    expect(errorMessage(body)).toBe("That person isn't on your ward's roster.");
    expect(await rowFor(quietSundayId)).toBeNull();
  });

  it("refuses a Sunday that holds no sacrament meeting", async () => {
    await actAs(fixtures, "musicCoordinator");

    const { status, body } = await patchMusic(conferenceSundayId, { organist: { name: "Anyone" } });

    expect(status).toBe(422);
    expect(errorMessage(body)).toMatch(/no sacrament meeting/);
    expect(await rowFor(conferenceSundayId)).toBeNull();
  });

  it("refuses a body that changes nothing", async () => {
    await actAs(fixtures, "musicCoordinator");

    const { status } = await patchMusic(quietSundayId, {});

    expect(status).toBe(400);
    expect(await rowFor(quietSundayId)).toBeNull();
  });

  it("refuses a leader without music.manage", async () => {
    await actAs(fixtures, "eqPresident");

    const { status } = await patchMusic(quietSundayId, { organist: { name: "Anyone" } });

    expect(status).toBe(403);
    expect(await rowFor(quietSundayId)).toBeNull();
  });

  it("lets the bishop set them too — the bishopric holds music.manage", async () => {
    await actAs(fixtures, "bishop");

    const { status } = await patchMusic(quietSundayId, { organist: { name: "Sister Peake" } });

    expect(status).toBe(200);
    expect(await rowFor(quietSundayId)).toMatchObject({ organist_name: "Sister Peake" });
  });
});
