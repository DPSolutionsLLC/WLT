// @vitest-environment node
//
// GET /api/visits/progress.
//
// ---------------------------------------------------------------------------
// THE ASSERTION THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// An organization leader cannot name another organization's progress into existence. Their
// `?orgId=` is IGNORED rather than honoured — RLS would return no logs for anybody else's goal
// anyway, and a dashboard reading "0 of 12 visited" for the Relief Society is a confusing way for
// the Elders Quorum to be told "not yours": it looks like a Relief Society that has done nothing.
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

// PINNED, not computed from today. A fixture whose period is relative to the clock changes
// meaning as the suite ages, and every status below depends on a precise distance from it.
const PERIOD_START = "2026-01-01";
const PERIOD_END = "2026-12-31";
const VISIT_IN_PERIOD = "2026-02-10";
const ATTEMPT_IN_PERIOD = "2026-03-14";

type ProgressRow = {
  householdId: string;
  familyName: string;
  lastVisitedOn: string | null;
  lastAttemptedOn: string | null;
  visitCountThisPeriod: number;
  attemptCountThisPeriod: number;
  status: string | null;
  conductedBy: string | null;
};

type ProgressBody = {
  orgId: string;
  rows: ProgressRow[];
  banner: { visitedCount: number; total: number; remaining: number } | null;
  goal: { id: string } | null;
  goalHasNoCadence: boolean;
};

async function callProgress(url: string) {
  const { GET } = await import("@/app/api/visits/progress/route");
  return readResponse(await GET(jsonRequest(url)));
}

const PROGRESS_URL = "http://localhost/api/visits/progress";

describe("GET /api/visits/progress", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let visitedHouseholdId: string;
  let attemptedHouseholdId: string;
  let movedOutHouseholdId: string;

  const progressFrom = (body: Record<string, unknown>): ProgressBody =>
    body.progress as ProgressBody;

  const rowFor = (progress: ProgressBody, householdId: string): ProgressRow | undefined =>
    progress.rows.find((row) => row.householdId === householdId);

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
      "wardSecretary",
      "musicCoordinator",
    ]);
    wardId = fixtures.wardAId;

    const { data: households, error: householdError } = await fixtures.service
      .from("households")
      .insert([
        { ward_id: wardId, family_name: "Progress Visited" },
        { ward_id: wardId, family_name: "Progress Attempted" },
        { ward_id: wardId, family_name: "Progress Never" },
        { ward_id: wardId, family_name: "Progress MovedOut" },
      ])
      .select("id, family_name");
    if (householdError) throw new Error(householdError.message);

    const idOf = (name: string) => households.find((row) => row.family_name === name)!.id;

    visitedHouseholdId = idOf("Progress Visited");
    attemptedHouseholdId = idOf("Progress Attempted");
    const neverHouseholdId = idOf("Progress Never");
    movedOutHouseholdId = idOf("Progress MovedOut");

    // THE DENOMINATOR FIXTURE. Three households with an active member each, and one whose only
    // member has moved out — listHouseholds() returns all four and attaches members to three.
    const { error: memberError } = await fixtures.service.from("members").insert([
      {
        ward_id: wardId,
        household_id: visitedHouseholdId,
        first_name: "Ada",
        last_name: "Visited",
        status: "active",
      },
      {
        ward_id: wardId,
        household_id: attemptedHouseholdId,
        first_name: "Bo",
        last_name: "Attempted",
        status: "active",
      },
      {
        ward_id: wardId,
        household_id: neverHouseholdId,
        first_name: "Cy",
        last_name: "Never",
        status: "active",
      },
      {
        ward_id: wardId,
        household_id: movedOutHouseholdId,
        first_name: "Dee",
        last_name: "Gone",
        status: "moved_out",
      },
    ]);
    if (memberError) throw new Error(memberError.message);

    const { error: goalError } = await fixtures.service.from("visit_goals").insert({
      ward_id: wardId,
      org_id: fixtures.eldersQuorumId,
      title: "Visit every household this year",
      target_type: "all_households",
      cadence: "annual",
      goal_period_start: PERIOD_START,
      goal_period_end: PERIOD_END,
      created_by: fixtures.user("eqPresident").id,
    });
    if (goalError) throw new Error(goalError.message);

    const { data: logs, error: logError } = await fixtures.service
      .from("visit_logs")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          household_id: visitedHouseholdId,
          recorded_by: fixtures.user("eqSecretary").id,
          visit_date: VISIT_IN_PERIOD,
          visit_type: "in_home",
          outcome: "completed",
          arrangement: "appointment",
        },
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          household_id: attemptedHouseholdId,
          recorded_by: fixtures.user("eqSecretary").id,
          visit_date: ATTEMPT_IN_PERIOD,
          visit_type: "in_home",
          outcome: "attempted",
          arrangement: "drop_in",
        },
      ])
      .select("id, household_id");
    if (logError) throw new Error(logError.message);

    // WHO WENT, on the completed one only. The recorder above is the SECRETARY and the
    // participant is the PRESIDENT, so a `conductedBy` that ever fell back to the recorder would
    // name the wrong person and this suite would say so.
    const completedLogId = logs.find((row) => row.household_id === visitedHouseholdId)!.id;

    const { error: participantError } = await fixtures.service
      .from("visit_participants")
      .insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        visit_log_id: completedLogId,
        user_id: fixtures.user("eqPresident").id,
      });
    if (participantError) throw new Error(participantError.message);
  }, 60_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("scoping", () => {
    it("gives an org president their own organization's progress", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callProgress(PROGRESS_URL);
      const progress = progressFrom(body);

      expect(status).toBe(200);
      expect(progress.orgId).toBe(fixtures.eldersQuorumId);
      expect(progress.goal).not.toBeNull();
      expect(rowFor(progress, visitedHouseholdId)?.status).toBe("visited");
    });

    // The assertion this suite exists for. Naming the Relief Society does not produce the Relief
    // Society's dashboard, and it does not produce an empty one either — it produces the caller's
    // own, unchanged.
    it("ignores another organization's orgId rather than answering with it", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callProgress(
        `${PROGRESS_URL}?orgId=${fixtures.reliefSocietyId}`,
      );

      expect(status).toBe(200);
      expect(progressFrom(body).orgId).toBe(fixtures.eldersQuorumId);
    });

    it("lets the bishop read any organization", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callProgress(
        `${PROGRESS_URL}?orgId=${fixtures.eldersQuorumId}`,
      );

      expect(status).toBe(200);
      expect(progressFrom(body).orgId).toBe(fixtures.eldersQuorumId);
      expect(progressFrom(body).banner).not.toBeNull();
    });

    // There is no ward-wide visit goal — migration 019 makes an `org_id = null` goal
    // bishopric-only and FEATURES.md §Module 9 describes progress per organization — so a
    // ward-level denominator would have to be invented. The route asks instead.
    it("asks the bishopric which organization rather than inventing a ward-wide total", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callProgress(PROGRESS_URL);

      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/which organization/i);
    });

    // The Relief Society has no goal in this fixture, so the bishop reading it gets an honest
    // absence rather than a zero denominator.
    it("returns a null banner for an organization with no goal", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callProgress(
        `${PROGRESS_URL}?orgId=${fixtures.reliefSocietyId}`,
      );
      const progress = progressFrom(body);

      expect(status).toBe(200);
      expect(progress.banner).toBeNull();
      expect(progress.goal).toBeNull();
      expect(progress.goalHasNoCadence).toBe(false);
      expect(progress.rows.every((row) => row.status === null)).toBe(true);
    });
  });

  describe("the numbers", () => {
    it("leaves a household with no active members out of the denominator", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callProgress(PROGRESS_URL);
      const progress = progressFrom(body);

      expect(rowFor(progress, movedOutHouseholdId)).toBeUndefined();

      // Only the three seeded by this suite are asserted by id — these tables are shared by every
      // suite running against the hosted project, so an absolute total would be a race
      // (plans/retros/route-tests-and-realtime.md).
      const seeded = [visitedHouseholdId, attemptedHouseholdId].filter(
        (id) => rowFor(progress, id) !== undefined,
      );
      expect(seeded).toHaveLength(2);
    });

    it("shows an attempt without counting it as a visit", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callProgress(PROGRESS_URL);
      const row = rowFor(progressFrom(body), attemptedHouseholdId);

      expect(row?.status).toBe("attempted_never_reached");
      expect(row?.lastAttemptedOn).toBe(ATTEMPT_IN_PERIOD);
      expect(row?.attemptCountThisPeriod).toBe(1);

      // Nothing an attempt touches leaks into the visited side.
      expect(row?.lastVisitedOn).toBeNull();
      expect(row?.visitCountThisPeriod).toBe(0);
    });

    // The recorder is the SECRETARY and the participant is the PRESIDENT. A fallback from one to
    // the other would credit a visit to the person who typed it up.
    it("names who went, never who typed it in", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callProgress(PROGRESS_URL);
      const row = rowFor(progressFrom(body), visitedHouseholdId);
      const president = fixtures.user("eqPresident");
      const secretary = fixtures.user("eqSecretary");

      expect(row?.conductedBy).not.toBeNull();
      expect(row?.conductedBy).not.toBe(secretary.email);
      expect(row?.conductedBy?.toLowerCase()).not.toContain("secretary");
      expect(president.id).not.toBe(secretary.id);
    });

    // No private note can reach this response — VisitProgressRow has no field one could occupy —
    // and the serialized body is asserted so a future widening is caught even if the types were
    // changed to allow it.
    it("carries no note of any kind on a progress row", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callProgress(PROGRESS_URL);
      const serialized = JSON.stringify(body);

      expect(serialized).not.toContain("privateNotes");
      expect(serialized).not.toContain("sharedNotes");
      expect(serialized).not.toContain("private_notes");
    });
  });

  describe("permission", () => {
    // Checked against lib/auth/permissions.ts rather than intuition: an org secretary HOLDS
    // visits.view — they log visits and read the board, they just cannot configure the goals.
    it("lets an org secretary read the dashboard", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status, body } = await callProgress(PROGRESS_URL);

      expect(status).toBe(200);
      expect(progressFrom(body).orgId).toBe(fixtures.eldersQuorumId);
    });

    it("refuses a ward secretary, who does not hold visits.view", async () => {
      await actAs(fixtures, "wardSecretary");

      const { status } = await callProgress(PROGRESS_URL);

      expect(status).toBe(403);
    });

    it("refuses a music coordinator", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callProgress(PROGRESS_URL);

      expect(status).toBe(403);
    });
  });
});
