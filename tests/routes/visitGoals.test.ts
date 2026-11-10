// @vitest-environment node
//
// /api/visit-goals and /api/visit-goals/[id] — ITER-055 bv4: sweep goals, one active goal per
// organization, and ending a goal (never deleting it). Plus the Bishopric's own progress, read from
// the visits stored with no organization (P1).
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so every query runs as the
// signed-in user and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const GOALS_URL = "http://localhost/api/visit-goals";
const DAY_MS = 86_400_000;

async function createGoal(body: unknown) {
  const { POST } = await import("@/app/api/visit-goals/route");
  return readResponse(await POST(jsonRequest(GOALS_URL, { method: "POST", body })));
}

async function patchGoal(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/visit-goals/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${GOALS_URL}/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

async function readProgress(orgId: string) {
  const { GET } = await import("@/app/api/visits/progress/route");
  return readResponse(
    await GET(jsonRequest(`http://localhost/api/visits/progress?orgId=${orgId}`)),
  );
}

type GoalBody = {
  id: string;
  kind: string;
  startedOn: string;
  endedAt: string | null;
  endReason: string | null;
  cadence: unknown;
};

describe("/api/visit-goals — sweep goals and ending a goal", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let bishopricOrgId: string;
  let sweepGoalId: string;
  let visitedHouseholdId: string;

  const storedGoal = async (id: string) => {
    const { data, error } = await fixtures.service
      .from("visit_goals")
      .select("kind, ended_at, end_reason, title, cadence_amount")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  };

  const activeGoalCount = async (orgId: string) => {
    const { count, error } = await fixtures.service
      .from("visit_goals")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("org_id", orgId)
      .is("ended_at", null);
    if (error) throw new Error(error.message);
    return count;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "eqPresident"]);
    wardId = fixtures.wardAId;

    const { data: organization, error: organizationError } = await fixtures.service
      .from("organizations")
      .insert({ ward_id: wardId, name: "Bishopric", type: "bishopric" })
      .select("id")
      .single();
    if (organizationError) throw new Error(organizationError.message);
    bishopricOrgId = organization.id;

    const { data: households, error: householdError } = await fixtures.service
      .from("households")
      .insert([
        { ward_id: wardId, family_name: "Sweep Visited" },
        { ward_id: wardId, family_name: "Sweep Waiting" },
      ])
      .select("id, family_name");
    if (householdError) throw new Error(householdError.message);
    visitedHouseholdId = households.find((row) => row.family_name === "Sweep Visited")!.id;

    const { error: memberError } = await fixtures.service.from("members").insert(
      households.map((row) => ({
        ward_id: wardId,
        household_id: row.id,
        first_name: "A",
        last_name: row.family_name,
        status: "active",
      })),
    );
    if (memberError) throw new Error(memberError.message);

    // A BISHOPRIC visit, stored with no organization (P1), yesterday — inside a sweep that starts
    // a week ago. And an Elders Quorum visit to the other household, which is not the bishopric's.
    const { error: logError } = await fixtures.service.from("visit_logs").insert([
      {
        ward_id: wardId,
        org_id: null,
        household_id: visitedHouseholdId,
        recorded_by: fixtures.user("bishop").id,
        visit_date: new Date(Date.now() - DAY_MS).toISOString().slice(0, 10),
        visit_type: "in_home",
        outcome: "completed",
      },
      {
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        household_id: households.find((row) => row.family_name === "Sweep Waiting")!.id,
        recorded_by: fixtures.user("eqPresident").id,
        visit_date: new Date(Date.now() - DAY_MS).toISOString().slice(0, 10),
        visit_type: "in_home",
        outcome: "completed",
      },
    ]);
    if (logError) throw new Error(logError.message);
  }, 90_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("lets the bishop set a sweep for the Bishopric, starting on the ward's today", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await createGoal({
      title: "Every household this year",
      orgId: bishopricOrgId,
      targetType: "all_households",
      kind: "sweep",
    });

    expect(status).toBe(201);
    const goal = body.goal as GoalBody;
    expect(goal.kind).toBe("sweep");
    expect(goal.cadence).toBeNull();
    expect(goal.endedAt).toBeNull();
    expect(goal.startedOn).toBe(
      wardDateOnly(new Date(), await readWardTimezone(wardId, fixtures.service)),
    );
    sweepGoalId = goal.id;
  });

  it("measures the Bishopric from its own visits — the ones with no organization", async () => {
    // Started a week ago, so yesterday's visit is inside it.
    const { error } = await fixtures.service
      .from("visit_goals")
      .update({ started_on: new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10) })
      .eq("id", sweepGoalId);
    if (error) throw new Error(error.message);

    await actAs(fixtures, "bishop");
    const { status, body } = await readProgress(bishopricOrgId);

    expect(status).toBe(200);
    const progress = body.progress as {
      sweep: { total: number; done: number; partlyReached: number; notYet: number } | null;
      activeGoal: { id: string; kind: string } | null;
    };
    expect(progress.activeGoal).toMatchObject({ id: sweepGoalId, kind: "sweep" });
    expect(progress.sweep?.done).toBe(1);
    // The Elders Quorum's visit to the other household is not the bishopric's.
    expect(progress.sweep?.notYet).toBe(progress.sweep!.total - 1);
  });

  it("refuses a second active goal for the same organization, with a sentence", async () => {
    await actAs(fixtures, "counselor1");
    const { status, body } = await createGoal({
      title: "Another one",
      orgId: bishopricOrgId,
      targetType: "all_households",
      kind: "sweep",
    });

    expect(status).toBe(409);
    expect(errorMessage(body)).toContain("End it first");
    expect(await activeGoalCount(bishopricOrgId)).toBe(1);
  });

  it("refuses a schedule on a sweep", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await patchGoal(sweepGoalId, { cadenceAmount: 1, cadenceUnit: "year" });

    expect(status).toBe(400);
    expect(errorMessage(body)).toContain("no schedule");
    expect((await storedGoal(sweepGoalId)).cadence_amount).toBeNull();
  });

  it("does not let an Elders Quorum president end the Bishopric's goal", async () => {
    await actAs(fixtures, "eqPresident");
    const { status } = await patchGoal(sweepGoalId, { end: "completed" });

    expect(status).toBe(404);
    // Re-read: a refused UPDATE is a zero-row success, not an error (CLAUDE.md §8).
    expect((await storedGoal(sweepGoalId)).ended_at).toBeNull();
  });

  it("lets a counselor end it as set aside, keeping the row", async () => {
    await actAs(fixtures, "counselor1");
    const { status, body } = await patchGoal(sweepGoalId, { end: "set_aside" });

    expect(status).toBe(200);
    expect((body.goal as GoalBody).endReason).toBe("set_aside");

    const stored = await storedGoal(sweepGoalId);
    expect(stored.ended_at).not.toBeNull();
    expect(stored.end_reason).toBe("set_aside");
    expect(stored.kind).toBe("sweep");
  });

  it("writes an audit row for the end", async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", wardId)
      .eq("action", "visit_goal_ended")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    expect(error).toBeNull();
    expect(data?.detail).toMatchObject({ visitGoalId: sweepGoalId, endReason: "set_aside" });
  });

  it("refuses any change to an ended goal", async () => {
    await actAs(fixtures, "bishop");
    const again = await patchGoal(sweepGoalId, { end: "completed" });
    const rename = await patchGoal(sweepGoalId, { title: "Renamed afterwards" });

    expect(again.status).toBe(409);
    expect(errorMessage(again.body)).toContain("has ended");
    expect(rename.status).toBe(409);

    const stored = await storedGoal(sweepGoalId);
    expect(stored.end_reason).toBe("set_aside");
    expect(stored.title).toBe("Every household this year");
  });

  it("allows a new goal once the old one has ended", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await createGoal({
      title: "A fresh start",
      orgId: bishopricOrgId,
      targetType: "all_households",
      kind: "cadence",
      cadenceAmount: 1,
      cadenceUnit: "year",
      noticeAmount: 2,
      noticeUnit: "month",
    });

    expect(status).toBe(201);
    expect(await activeGoalCount(bishopricOrgId)).toBe(1);
  });
});
