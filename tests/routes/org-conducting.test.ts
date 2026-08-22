// @vitest-environment node
//
// PATCH /api/sundays/[id]/org-conducting refusing a write on a Sunday that holds no meeting.
//
// This is not a convenience check. `sundays` has a CHECK constraint for the equivalent rule;
// sunday_org_conducting deliberately has NONE, because a constraint there cannot see the Sunday's
// type and this repo has no triggers (migration 027, Part 3). This route and
// lib/calendar/queries.ts are the only things keeping that half of the rule, which is why the
// refusal is asserted here AND by re-reading the table afterwards.
//
// 409 rather than 403: the caller's permissions are fine — the Sunday's STATE is what refuses.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  generateSundayRange,
  listSundays,
  replaceConductingRotation,
  updateSunday,
  type Sunday,
} from "@/lib/calendar/queries";
import { asRole } from "@/tests/helpers/asRole";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const FROM = "2027-05-01";
const TO = "2027-05-31";

async function callPatch(sundayId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/sundays/[id]/org-conducting/route");
  const request = jsonRequest(
    `http://localhost/api/sundays/${sundayId}/org-conducting`,
    { method: "PATCH", body },
  );
  return readResponse(
    await PATCH(request, { params: Promise.resolve({ id: sundayId }) }),
  );
}

describe("PATCH /api/sundays/[id]/org-conducting on a Sunday with no meeting", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let orgId: string;

  let cancelledSundayId = "";
  let ordinarySundayId = "";

  const rowsFor = async (sundayId: string) => {
    const { data, error } = await fixtures.service
      .from("sunday_org_conducting")
      .select("id, user_id")
      .eq("ward_id", wardId)
      .eq("sunday_id", sundayId);

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "counselor2",
      "eqPresident",
      "eqCounselor",
      "eqSecretary",
    ]);
    wardId = fixtures.wardAId;
    orgId = fixtures.eldersQuorumId;

    const bishop = await asRole(fixtures, "bishop");

    await replaceConductingRotation(
      wardId,
      {
        effectiveFrom: FROM,
        orgId: null,
        cadence: "weekly",
        positions: [
          { position: 1, userId: fixtures.user("bishop").id },
          { position: 2, userId: fixtures.user("counselor1").id },
          { position: 3, userId: fixtures.user("counselor2").id },
        ],
      },
      bishop,
    );

    await replaceConductingRotation(
      wardId,
      {
        effectiveFrom: FROM,
        orgId,
        cadence: "weekly",
        positions: [
          { position: 1, userId: fixtures.user("eqPresident").id },
          { position: 2, userId: fixtures.user("eqCounselor").id },
          { position: 3, userId: fixtures.user("eqSecretary").id },
        ],
      },
      bishop,
    );

    await generateSundayRange(wardId, FROM, TO, bishop);

    const may: Sunday[] = await listSundays(wardId, { from: FROM, to: TO }, bishop);
    const onDate = (date: string) => may.find((sunday) => sunday.date === date)!;

    ordinarySundayId = onDate("2027-05-09").id;
    cancelledSundayId = onDate("2027-05-16").id;

    const applied = await updateSunday(
      wardId,
      cancelledSundayId,
      { type: "stake_conference" },
      { confirm: true },
      bishop,
    );
    if (applied?.status !== "applied") {
      throw new Error("Could not set up the cancelled Sunday.");
    }
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("has no organization conducting rows on the cancelled Sunday to begin with", async () => {
    expect(await rowsFor(cancelledSundayId)).toHaveLength(0);
  });

  it("refuses with 409 and a sentence naming the reason", async () => {
    await actAs(fixtures, "bishop");

    const { status, body } = await callPatch(cancelledSundayId, {
      orgId,
      userId: fixtures.user("eqPresident").id,
    });

    expect(status).toBe(409);
    expect(errorMessage(body)).toBe(
      "That Sunday holds no meeting, so no organization conducts.",
    );
  });

  // The refusal has to have actually prevented the write, not merely reported one. There is no
  // constraint behind this route to catch it if the check is ever removed.
  it("wrote no row at all", async () => {
    expect(await rowsFor(cancelledSundayId)).toHaveLength(0);
  });

  // The organization's own president is refused for the same reason a bishop is: it is the
  // Sunday's state that refuses, not the caller's permissions.
  it("refuses the organization's own president too", async () => {
    await actAs(fixtures, "eqPresident");

    const { status } = await callPatch(cancelledSundayId, {
      orgId,
      userId: fixtures.user("eqCounselor").id,
    });

    expect(status).toBe(409);
    expect(await rowsFor(cancelledSundayId)).toHaveLength(0);
  });

  it("still accepts a write on a Sunday that holds a meeting", async () => {
    await actAs(fixtures, "bishop");

    const { status, body } = await callPatch(ordinarySundayId, {
      orgId,
      userId: fixtures.user("eqSecretary").id,
    });

    expect(status).toBe(200);
    expect(body.orgConducting).toBeTruthy();

    const rows = await rowsFor(ordinarySundayId);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(fixtures.user("eqSecretary").id);
  });
});
