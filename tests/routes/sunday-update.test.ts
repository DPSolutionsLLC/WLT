// @vitest-environment node
//
// PATCH /api/sundays/[id] — the 409 shape when a single edit carries BOTH consequences at once:
// speakers about to be returned to planning, and later Sundays about to change conductor.
//
// The two must arrive in ONE warning. The route shows one warning at a time because confirming
// applies the whole patch, so a re-shift the user was not told about would break that promise —
// hence the re-shift sentence is appended to whichever warning is shown rather than queued
// behind it.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  generateSundayRange,
  listSundays,
  replaceConductingRotation,
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

const FROM = "2027-07-01";
const TO = "2027-09-30";

// A Sunday with speakers on it, comfortably in the future so the re-shift horizon is non-empty.
const EDITED_DATE = "2027-08-15";

async function callPatch(sundayId: string, body: unknown, confirm = false) {
  const { PATCH } = await import("@/app/api/sundays/[id]/route");
  const url = `http://localhost/api/sundays/${sundayId}${confirm ? "?confirm=true" : ""}`;
  const request = jsonRequest(url, { method: "PATCH", body });

  return readResponse(
    await PATCH(request, { params: Promise.resolve({ id: sundayId }) }),
  );
}

describe("PATCH /api/sundays/[id] — assignments plus a conducting re-shift", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let editedSundayId = "";

  const auditRows = async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("action, detail, created_at")
      .eq("ward_id", wardId)
      .eq("action", "sunday_updated")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2"]);
    wardId = fixtures.wardAId;

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

    await generateSundayRange(wardId, FROM, TO, bishop);

    const sundays: Sunday[] = await listSundays(wardId, { from: FROM, to: TO }, bishop);
    editedSundayId = sundays.find((sunday) => sunday.date === EDITED_DATE)!.id;

    // Seeded through the service client so the fixture does not depend on the assignment-creation
    // route. Two speakers, so the warning has something to count.
    const { error } = await fixtures.service.from("assignments").insert([
      {
        ward_id: wardId,
        sunday_id: editedSundayId,
        assignment_type: "sacrament_talk",
        pipeline_stage: "request",
        slot_number: 1,
      },
      {
        ward_id: wardId,
        sunday_id: editedSundayId,
        assignment_type: "sacrament_talk",
        pipeline_stage: "request",
        slot_number: 2,
      },
    ]);

    if (error) throw new Error(`Could not seed the assignments: ${error.message}`);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("returns 409 naming BOTH the speakers at risk and the later Sundays", async () => {
    await actAs(fixtures, "bishop");

    const { status, body } = await callPatch(editedSundayId, { type: "stake_conference" });

    expect(status).toBe(409);

    const warning = body.warning as Record<string, unknown>;
    expect(warning).toBeTruthy();

    // The speakers are the headline: that is the change the user actually made.
    expect(warning.reason).toBe("meeting_cancelled");
    expect(warning.assignmentCount).toBe(2);

    // And the re-shift rides inside the SAME warning rather than arriving as a second one.
    expect(warning.conductingReshiftCount).toBeGreaterThan(0);

    const message = errorMessage(body);
    expect(message).toContain("no longer hold a sacrament meeting");
    expect(message).toContain("2 speaking assignments");
    expect(message).toContain("Who conducts will also change on");
  });

  it("wrote nothing at all while warning", async () => {
    const { data } = await fixtures.service
      .from("sundays")
      .select("type")
      .eq("ward_id", wardId)
      .eq("id", editedSundayId)
      .single();

    expect(data?.type).toBe("standard");

    const { data: assignments } = await fixtures.service
      .from("assignments")
      .select("pipeline_stage")
      .eq("ward_id", wardId)
      .eq("sunday_id", editedSundayId);

    expect(assignments?.every((row) => row.pipeline_stage === "request")).toBe(true);
  });

  it("applies both consequences on confirm and reports both counts", async () => {
    await actAs(fixtures, "bishop");

    const { status, body } = await callPatch(
      editedSundayId,
      { type: "stake_conference" },
      true,
    );

    expect(status).toBe(200);
    expect(body.assignmentsReverted).toBe(2);
    expect(body.conductingReshiftCount).toBeGreaterThan(0);
    expect(body.orgConductingReshiftCount).toBe(0);

    // Reverted, never deleted (03-calendar.md §Pitfall 5).
    const { data: assignments } = await fixtures.service
      .from("assignments")
      .select("pipeline_stage")
      .eq("ward_id", wardId)
      .eq("sunday_id", editedSundayId);

    expect(assignments).toHaveLength(2);
    expect(assignments?.every((row) => row.pipeline_stage === "plan")).toBe(true);
  });

  // A re-shift can overwrite a conducting override a human typed — there is no is_override flag
  // (migration 024) — so the audit row is the only durable record of how far one edit reached.
  it("carries both re-shift counts into the audit row", async () => {
    const rows = await auditRows();
    expect(rows.length).toBeGreaterThan(0);

    const detail = rows[0].detail as Record<string, unknown>;

    expect(detail.assignmentsReverted).toBe(2);
    expect(typeof detail.conductingReshiftCount).toBe("number");
    expect(detail.conductingReshiftCount as number).toBeGreaterThan(0);
    expect(detail.orgConductingReshiftCount).toBe(0);
  });
});
