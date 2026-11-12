// @vitest-environment node
//
// Dividing the bishopric's households (ITER-055 bv5, migration 103).
//
// POST / PATCH /api/visit-assignments are the ONLY writers of visit_assignments, on the service
// role, so their check — visits.assign AND a bishopric calling — is the write boundary, asserted
// from both sides. `assignedTo` is a SUBJECT column from the body (CLAUDE.md §7): somebody outside
// the bishopric, or in another ward, is a 400 with a sentence.
//
// The to-do half is asserted by RE-READING `todos` with the service client: an assignment puts
// "Visit the ___ family" on the assignee's list; reassigning, unassigning, a finished Bishopric
// visit and the goal ending each close it, with a line saying why. A visit that still needs a visit
// leaves it open with a line; another organization's visit does not touch it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const ASSIGN_URL = "http://localhost/api/visit-assignments";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function assign(body: unknown) {
  const { POST } = await import("@/app/api/visit-assignments/route");
  return readResponse(await POST(jsonRequest(ASSIGN_URL, { method: "POST", body })));
}

async function patchAssignment(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/visit-assignments/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${ASSIGN_URL}/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

async function logVisit(body: unknown) {
  const { POST } = await import("@/app/api/visits/route");
  return readResponse(await POST(jsonRequest("http://localhost/api/visits", { method: "POST", body })));
}

type TodoRow = {
  id: string;
  user_id: string;
  title: string;
  assigned_by: string | null;
  completed_at: string | null;
  closed_reason: string | null;
  visit_assignment_id: string | null;
};

describe("/api/visit-assignments", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let bishopricOrgId: string;
  let goalId: string;
  const household: Record<"ash" | "birch" | "cedar" | "dogwood", string> = {
    ash: "",
    birch: "",
    cedar: "",
    dogwood: "",
  };
  let wardBHouseholdId: string;

  const openAssignment = async (householdId: string) => {
    const { data, error } = await fixtures.service
      .from("visit_assignments")
      .select("id, assigned_to, ended_at, end_reason")
      .eq("household_id", householdId)
      .is("ended_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  const assignmentsFor = async (householdId: string) => {
    const { data, error } = await fixtures.service
      .from("visit_assignments")
      .select("id, assigned_to, ended_at, end_reason")
      .eq("household_id", householdId)
      .order("created_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const todosFor = async (assignmentIds: string[]): Promise<TodoRow[]> => {
    const { data, error } = await fixtures.service
      .from("todos")
      .select("id, user_id, title, assigned_by, completed_at, closed_reason, visit_assignment_id")
      .in("visit_assignment_id", assignmentIds);
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const linesFor = async (todoId: string) => {
    const { data, error } = await fixtures.service
      .from("todo_log_entries")
      .select("kind, body")
      .eq("todo_id", todoId)
      .order("created_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2", "eqPresident", "wardBBishop"]);
    wardId = fixtures.wardAId;

    const { data: organization, error: organizationError } = await fixtures.service
      .from("organizations")
      .insert({ ward_id: wardId, name: "Bishopric", type: "bishopric" })
      .select("id")
      .single();
    if (organizationError) throw new Error(organizationError.message);
    bishopricOrgId = organization.id;

    const { data: households, error: householdsError } = await fixtures.service
      .from("households")
      .insert(
        (Object.keys(household) as (keyof typeof household)[]).map((name) => ({
          ward_id: wardId,
          family_name: `${name[0].toUpperCase()}${name.slice(1)} ${fixtures.runId}`,
        })),
      )
      .select("id, family_name");
    if (householdsError) throw new Error(householdsError.message);
    for (const row of households ?? []) {
      const key = row.family_name.split(" ")[0].toLowerCase() as keyof typeof household;
      household[key] = row.id;
    }

    const { data: wardBHousehold, error: wardBError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardBId, family_name: `Elsewhere ${fixtures.runId}` })
      .select("id")
      .single();
    if (wardBError) throw new Error(wardBError.message);
    wardBHouseholdId = wardBHousehold.id;
  }, 90_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("refuses to assign while the Bishopric has no active goal, and names the way forward", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await assign({
      householdIds: [household.ash],
      assignedTo: fixtures.user("counselor1").id,
    });

    expect(status).toBe(409);
    expect(body.error).toMatch(/Set a visit goal for the Bishopric first/);
    expect(await openAssignment(household.ash)).toBeNull();
  });

  it("assigns households to a counselor and puts one to-do per household on their list", async () => {
    const { data: goal, error } = await fixtures.service
      .from("visit_goals")
      .insert({
        ward_id: wardId,
        org_id: bishopricOrgId,
        title: "Visit everyone",
        target_type: "all_households",
        kind: "sweep",
        started_on: daysAgo(30),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    goalId = goal.id;

    await actAs(fixtures, "bishop");
    const { status, body } = await assign({
      householdIds: [household.ash, household.birch],
      assignedTo: fixtures.user("counselor1").id,
    });

    expect(status).toBe(201);
    expect(body.assignedCount).toBe(2);

    const ash = await openAssignment(household.ash);
    const birch = await openAssignment(household.birch);
    expect(ash?.assigned_to).toBe(fixtures.user("counselor1").id);
    expect(birch?.assigned_to).toBe(fixtures.user("counselor1").id);

    const todos = await todosFor([ash!.id, birch!.id]);
    expect(todos).toHaveLength(2);
    for (const todo of todos) {
      expect(todo.user_id).toBe(fixtures.user("counselor1").id);
      expect(todo.assigned_by).toBe(fixtures.user("bishop").id);
      expect(todo.completed_at).toBeNull();
      expect(todo.title).toMatch(/^Visit the .+ family$/);
    }
  });

  it("writes an audit row with ids and counts, never a family name", async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", wardId)
      .eq("action", "visit_households_assigned")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    expect(error).toBeNull();
    const detail = data?.detail as Record<string, unknown>;
    expect(detail.goalId).toBe(goalId);
    expect(detail.assignedTo).toBe(fixtures.user("counselor1").id);
    expect(JSON.stringify(detail)).not.toContain(fixtures.runId);
  });

  it("leaves a household alone when it is assigned again to the same person", async () => {
    await actAs(fixtures, "counselor2");
    const { status, body } = await assign({
      householdIds: [household.ash],
      assignedTo: fixtures.user("counselor1").id,
    });

    expect(status).toBe(201);
    expect(body.unchangedCount).toBe(1);
    expect(await assignmentsFor(household.ash)).toHaveLength(1);
  });

  it("refuses an org president, and writes nothing", async () => {
    await actAs(fixtures, "eqPresident");
    const { status } = await assign({
      householdIds: [household.cedar],
      assignedTo: fixtures.user("counselor1").id,
    });

    expect(status).toBe(403);
    expect(await openAssignment(household.cedar)).toBeNull();
  });

  it("refuses to assign a household to somebody outside the bishopric", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await assign({
      householdIds: [household.cedar],
      assignedTo: fixtures.user("eqPresident").id,
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/bishop or one of the counselors/);
    expect(await openAssignment(household.cedar)).toBeNull();
  });

  it("refuses another ward's bishop as the assignee", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await assign({
      householdIds: [household.cedar],
      assignedTo: fixtures.user("wardBBishop").id,
    });

    expect(status).toBe(400);
    expect(await openAssignment(household.cedar)).toBeNull();
  });

  it("refuses a household from another ward", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await assign({
      householdIds: [wardBHouseholdId],
      assignedTo: fixtures.user("counselor1").id,
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/not in this ward/);
    expect(await openAssignment(wardBHouseholdId)).toBeNull();
  });

  it("reassigns: the old to-do closes with a line naming the new holder, the new one opens", async () => {
    const before = await openAssignment(household.ash);

    await actAs(fixtures, "bishop");
    const { status, body } = await assign({
      householdIds: [household.ash],
      assignedTo: fixtures.user("counselor2").id,
    });

    expect(status).toBe(201);
    expect(body.reassignedCount).toBe(1);

    const rows = await assignmentsFor(household.ash);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: before!.id, end_reason: "reassigned" });
    expect(rows[1]).toMatchObject({ assigned_to: fixtures.user("counselor2").id, ended_at: null });

    const [oldTodo] = await todosFor([before!.id]);
    expect(oldTodo.closed_reason).toBe("reassigned");
    expect(oldTodo.completed_at).not.toBeNull();
    const lines = await linesFor(oldTodo.id);
    expect(lines.at(-1)?.kind).toBe("visit_reassigned");
    expect(lines.at(-1)?.body).toBeTruthy();

    const [newTodo] = await todosFor([rows[1].id]);
    expect(newTodo.user_id).toBe(fixtures.user("counselor2").id);
    expect(newTodo.completed_at).toBeNull();
  });

  it("refuses to delete or tick an open visit to-do, and names why", async () => {
    const assignment = await openAssignment(household.ash);
    const [todo] = await todosFor([assignment!.id]);

    await actAs(fixtures, "counselor2");
    const routes = await import("@/app/api/todos/[id]/route");
    const deleted = await readResponse(
      await routes.DELETE(jsonRequest(`http://localhost/api/todos/${todo.id}`, { method: "DELETE" }), {
        params: Promise.resolve({ id: todo.id }),
      }),
    );
    expect(deleted.status).toBe(409);
    expect(deleted.body.error).toMatch(/closes itself once a finished visit/);

    const ticked = await readResponse(
      await routes.PATCH(
        jsonRequest(`http://localhost/api/todos/${todo.id}`, { method: "PATCH", body: { complete: true } }),
        { params: Promise.resolve({ id: todo.id }) },
      ),
    );
    expect(ticked.status).toBe(400);

    const [reread] = await todosFor([assignment!.id]);
    expect(reread.completed_at).toBeNull();
  });

  it("unassigns: the household goes back to nobody and the to-do closes", async () => {
    const birch = await openAssignment(household.birch);

    await actAs(fixtures, "counselor1");
    const { status } = await patchAssignment(birch!.id, { unassign: true });

    expect(status).toBe(200);
    expect(await openAssignment(household.birch)).toBeNull();
    const [todo] = await todosFor([birch!.id]);
    expect(todo.closed_reason).toBe("unassigned");
  });

  it("answers 409 when the assignment being changed has already ended", async () => {
    const [ended] = await assignmentsFor(household.birch);

    await actAs(fixtures, "bishop");
    const { status } = await patchAssignment(ended.id, { assignedTo: fixtures.user("bishop").id });

    expect(status).toBe(409);
    expect(await openAssignment(household.birch)).toBeNull();
  });

  it("a visit that still needs a visit keeps the to-do open and adds a line naming the reason", async () => {
    await actAs(fixtures, "bishop");
    await assign({ householdIds: [household.cedar], assignedTo: fixtures.user("bishop").id });
    const cedar = await openAssignment(household.cedar);

    const { status } = await logVisit({
      householdId: household.cedar,
      visitDate: daysAgo(2),
      visitType: "in_home",
      outcome: "completed",
      needsAnotherReason: "spouse_absent",
    });
    expect(status).toBe(201);

    expect(await openAssignment(household.cedar)).toMatchObject({ id: cedar!.id });
    const [todo] = await todosFor([cedar!.id]);
    expect(todo.completed_at).toBeNull();
    const lines = await linesFor(todo.id);
    expect(lines.at(-1)).toEqual({ kind: "visit_partly_reached", body: "Spouse absent" });
  });

  it("another organization's finished visit does not close the Bishopric's assignment", async () => {
    await actAs(fixtures, "eqPresident");
    const { status } = await logVisit({
      householdId: household.cedar,
      visitDate: daysAgo(1),
      visitType: "in_home",
      outcome: "completed",
    });
    expect(status).toBe(201);

    expect(await openAssignment(household.cedar)).not.toBeNull();
  });

  it("a finished Bishopric visit by anyone in the bishopric closes the assignment and its to-do", async () => {
    const ash = await openAssignment(household.ash);

    await actAs(fixtures, "bishop");
    const { status } = await logVisit({
      householdId: household.ash,
      visitDate: daysAgo(1),
      visitType: "in_home",
      outcome: "completed",
    });
    expect(status).toBe(201);

    expect(await openAssignment(household.ash)).toBeNull();
    const [ended] = (await assignmentsFor(household.ash)).filter((row) => row.id === ash!.id);
    expect(ended.end_reason).toBe("visited");

    const [todo] = await todosFor([ash!.id]);
    expect(todo.completed_at).not.toBeNull();
    expect(todo.closed_reason).toBeNull();
    expect((await linesFor(todo.id)).at(-1)).toEqual({ kind: "source_completed", body: "Visited." });
  });

  it("ending the goal releases every household still assigned and closes their to-dos", async () => {
    await actAs(fixtures, "bishop");
    await assign({ householdIds: [household.dogwood], assignedTo: fixtures.user("counselor1").id });
    const cedar = await openAssignment(household.cedar);
    const dogwood = await openAssignment(household.dogwood);

    const { PATCH } = await import("@/app/api/visit-goals/[id]/route");
    const { status } = await readResponse(
      await PATCH(
        jsonRequest(`http://localhost/api/visit-goals/${goalId}`, {
          method: "PATCH",
          body: { end: "set_aside" },
        }),
        { params: Promise.resolve({ id: goalId }) },
      ),
    );
    expect(status).toBe(200);

    expect(await openAssignment(household.cedar)).toBeNull();
    expect(await openAssignment(household.dogwood)).toBeNull();
    const todos = await todosFor([cedar!.id, dogwood!.id]);
    expect(todos).toHaveLength(2);
    for (const todo of todos) {
      expect(todo.closed_reason).toBe("goal_ended");
      expect((await linesFor(todo.id)).at(-1)?.kind).toBe("visit_goal_ended");
    }
  });
});
