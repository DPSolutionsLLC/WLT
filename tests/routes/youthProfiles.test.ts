// @vitest-environment node
//
// GET, POST, PATCH and DELETE on /api/youth/profiles — where an activity's OWNERSHIP is decided.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. OWNERSHIP IS STAMPED FROM THE SESSION, NEVER FROM THE BODY. An org president's profile
//    carries their own org_id whether or not the body mentioned one, and a body naming a
//    DIFFERENT organization is refused with a sentence rather than silently overwritten — the
//    difference between "the API corrected me" and "I entered an activity for the Young Women and
//    it did not happen".
//
// 2. THE DEPARTURE FROM visit-goals. A ward council member with no organization gets 201 and a
//    null org_id, where visit-goals returns 409. A goal with no org is invisible to its author; a
//    PROFILE with no org is ward-wide and visible to everybody, which policy 054d permits on
//    purpose.
//
// 3. READS ARE WARD-WIDE. An org secretary — who holds `youth_activities.view` and `.log` but NOT
//    `.manage` — reads every organization's profiles and can write none of them. That role pair
//    was checked against lib/auth/permissions.ts rather than guessed; `music_coordinator` holds
//    none of the three and is the 403 case.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const PROFILES_URL = "http://localhost/api/youth/profiles";

type ProfileBody = {
  id: string;
  memberId: string;
  memberName: string;
  orgId: string | null;
  activityName: string;
  activityType: string;
};

async function callGet() {
  const { GET } = await import("@/app/api/youth/profiles/route");
  return readResponse(await GET());
}

async function callPost(body: unknown) {
  const { POST } = await import("@/app/api/youth/profiles/route");
  return readResponse(await POST(jsonRequest(PROFILES_URL, { method: "POST", body })));
}

async function callPatch(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/youth/profiles/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${PROFILES_URL}/${id}`, { method: "PATCH", body }), {
      // `params` is a PROMISE in Next 16, so the test has to hand the handler one.
      params: Promise.resolve({ id }),
    }),
  );
}

async function callDelete(id: string) {
  const { DELETE } = await import("@/app/api/youth/profiles/[id]/route");
  return readResponse(
    await DELETE(jsonRequest(`${PROFILES_URL}/${id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    }),
  );
}

describe("/api/youth/profiles", () => {
  let fixtures: Fixtures;
  let wardId: string;

  let youthId: string;
  let wardBYouthId: string;
  let rsProfileId: string;
  let wardBOrganizationId: string;

  // Every created row is tracked and removed, because this suite runs against the shared hosted
  // project alongside every other suite (CLAUDE.md §9).
  const created: string[] = [];

  const profileFrom = (body: Record<string, unknown>): ProfileBody =>
    body.profile as ProfileBody;

  const storedOrgId = async (profileId: string): Promise<string | null | undefined> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .select("org_id")
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data === null ? undefined : data.org_id;
  };

  const storedName = async (profileId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .select("activity_name")
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.activity_name ?? null;
  };

  const countAuditRows = async (action: string): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("action", action);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
      "wardCouncilMember",
      "musicCoordinator",
      "wardBBishop",
    ]);
    wardId = fixtures.wardAId;
    wardBOrganizationId = fixtures.wardBOrgId;

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: wardId,
          first_name: "Ada",
          last_name: `Youth${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: fixtures.wardBId,
          first_name: "Bo",
          last_name: `YouthB${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
      ])
      .select("id, ward_id");
    if (memberError) throw new Error(memberError.message);

    youthId = members!.find((row) => row.ward_id === wardId)!.id;
    wardBYouthId = members!.find((row) => row.ward_id === fixtures.wardBId)!.id;

    // A profile owned by an organization the Elders Quorum does not belong to, so the read
    // assertion has something that could only come from a ward-wide policy.
    const { data: rsProfile, error: rsError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: wardId,
        org_id: fixtures.reliefSocietyId,
        member_id: youthId,
        activity_name: `RS choir ${fixtures.runId}`,
        activity_type: "performance",
      })
      .select("id")
      .single();
    if (rsError) throw new Error(rsError.message);
    rsProfileId = rsProfile.id;
  }, 180_000);

  afterAll(async () => {
    if (created.length > 0) {
      await fixtures.service.from("youth_activity_profiles").delete().in("id", created);
    }
    await fixtures?.cleanup();
  });

  describe("reading", () => {
    it("returns every organization's profiles to an org secretary", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status, body } = await callGet();
      const profiles = body.profiles as ProfileBody[];

      expect(status).toBe(200);
      // The Elders Quorum's secretary reading a Relief Society profile IS the decision. An org
      // filter added to the GET later would fail exactly here.
      expect(profiles.some((profile) => profile.id === rsProfileId)).toBe(true);
    });

    it("carries the youth's name from the named embed", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callGet();
      const profiles = body.profiles as ProfileBody[];
      const found = profiles.find((profile) => profile.id === rsProfileId);

      expect(found?.memberName).toBe(`Ada Youth${fixtures.runId}`);
    });

    it("refuses a role holding none of the youth permissions", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callGet();

      expect(status).toBe(403);
    });
  });

  describe("creating", () => {
    it("stamps an org president's own organization when the body names none", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        memberId: youthId,
        activityName: `EQ basketball ${fixtures.runId}`,
        activityType: "sport",
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.orgId).toBe(fixtures.eldersQuorumId);
      expect(await storedOrgId(profile.id)).toBe(fixtures.eldersQuorumId);
    });

    it("accepts a body orgId that matches the author's own organization", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        memberId: youthId,
        activityName: `EQ track ${fixtures.runId}`,
        activityType: "sport",
        orgId: fixtures.eldersQuorumId,
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.orgId).toBe(fixtures.eldersQuorumId);
    });

    // REFUSED, NOT IGNORED. A leader who thinks they entered an activity for another organization
    // and did not is worse off than one who was told they may not.
    it("refuses a body orgId naming another organization, with a sentence", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        memberId: youthId,
        activityName: `Forged RS ${fixtures.runId}`,
        activityType: "performance",
        orgId: fixtures.reliefSocietyId,
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toContain("your own organization");
    });

    // THE DEPARTURE FROM visit-goals, which returns 409 here.
    it("writes a ward-wide profile for a ward council member with no organization", async () => {
      await actAs(fixtures, "wardCouncilMember");

      const { status, body } = await callPost({
        memberId: youthId,
        activityName: `Council debate ${fixtures.runId}`,
        activityType: "academic",
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.orgId).toBeNull();
      expect(await storedOrgId(profile.id)).toBeNull();
    });

    it("shows that profile back to its author immediately", async () => {
      // The talks-d hole from the outside: the INSERT succeeding proves nothing on its own.
      await actAs(fixtures, "wardCouncilMember");

      const { body } = await callGet();
      const profiles = body.profiles as ProfileBody[];

      expect(
        profiles.some((profile) => profile.activityName === `Council debate ${fixtures.runId}`),
      ).toBe(true);
    });

    it("lets the bishopric create for any organization in the ward", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        memberId: youthId,
        activityName: `Bishop for RS ${fixtures.runId}`,
        activityType: "performance",
        orgId: fixtures.reliefSocietyId,
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.orgId).toBe(fixtures.reliefSocietyId);
    });

    it("lets the bishopric create a ward-wide profile by omitting the organization", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        memberId: youthId,
        activityName: `Bishop ward-wide ${fixtures.runId}`,
        activityType: "community",
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.orgId).toBeNull();
    });

    // A SENTENCE, NOT A CONSTRAINT VIOLATION. The composite foreign key would answer "insert or
    // update on table violates foreign key constraint", which nobody can act on.
    it("returns 404 for an organization from another ward", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        memberId: youthId,
        activityName: `Cross ward ${fixtures.runId}`,
        activityType: "sport",
        orgId: wardBOrganizationId,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
    });

    it("refuses an org secretary, who may read but not manage", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPost({
        memberId: youthId,
        activityName: `Secretary ${fixtures.runId}`,
        activityType: "sport",
      });

      expect(status).toBe(403);
    });

    it("refuses a member from another ward", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPost({
        memberId: wardBYouthId,
        activityName: `Ward B youth ${fixtures.runId}`,
        activityType: "sport",
      });

      // RLS refuses the insert rather than writing a profile naming a member nobody here can see.
      expect(status).toBe(500);
    });

    it("writes an audit row for every created profile", async () => {
      const before = await countAuditRows("youth_activity_profile_created");

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callPost({
        memberId: youthId,
        activityName: `Audited ${fixtures.runId}`,
        activityType: "sport",
      });

      expect(status).toBe(201);
      created.push(profileFrom(body).id);

      expect(await countAuditRows("youth_activity_profile_created")).toBe(before + 1);
    });
  });

  describe("updating", () => {
    let ownProfileId: string;

    beforeAll(async () => {
      await actAs(fixtures, "eqPresident");
      const { body } = await callPost({
        memberId: youthId,
        activityName: `Editable ${fixtures.runId}`,
        activityType: "sport",
      });
      ownProfileId = profileFrom(body).id;
      created.push(ownProfileId);
    });

    it("saves a change to the author's own organization's profile", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(ownProfileId, {
        activityName: `Renamed ${fixtures.runId}`,
        seasonSchedule: "November to February",
      });

      expect(status).toBe(200);
      expect(await storedName(ownProfileId)).toBe(`Renamed ${fixtures.runId}`);
    });

    // The policy decides WHICH, not a branch in the route (CLAUDE.md rule 2). The 404 is the
    // route turning a zero-row update into an answer.
    it("returns 404 rather than editing another organization's profile", async () => {
      const before = await storedName(rsProfileId);
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatch(rsProfileId, {
        activityName: `Hijacked ${fixtures.runId}`,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("another organization");
      expect(await storedName(rsProfileId)).toBe(before);
    });

    it("refuses an empty patch with a sentence", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatch(ownProfileId, {});

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Nothing was changed.");
    });

    it("refuses an id that is not a uuid", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch("not-a-uuid", { activityName: "Anything" });

      expect(status).toBe(400);
    });

    it("writes an audit row on a successful update", async () => {
      const before = await countAuditRows("youth_activity_profile_updated");

      await actAs(fixtures, "eqPresident");
      const { status } = await callPatch(ownProfileId, { activityType: "community" });

      expect(status).toBe(200);
      expect(await countAuditRows("youth_activity_profile_updated")).toBe(before + 1);
    });
  });

  describe("deleting", () => {
    it("removes the author's own profile and audits it", async () => {
      await actAs(fixtures, "eqPresident");
      const { body } = await callPost({
        memberId: youthId,
        activityName: `Removable ${fixtures.runId}`,
        activityType: "sport",
      });
      const profileId = profileFrom(body).id;

      const before = await countAuditRows("youth_activity_profile_deleted");
      const { status } = await callDelete(profileId);

      expect(status).toBe(200);
      expect(await storedName(profileId)).toBeNull();
      expect(await countAuditRows("youth_activity_profile_deleted")).toBe(before + 1);
    });

    it("returns 404 rather than removing another organization's profile", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callDelete(rsProfileId);

      expect(status).toBe(404);
      expect(await storedName(rsProfileId)).not.toBeNull();
    });

    it("refuses an org secretary", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callDelete(rsProfileId);

      expect(status).toBe(403);
    });
  });
});
