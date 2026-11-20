// @vitest-environment node
//
// A follow-up from a visit (ITER-055 bv7, P14, migration 108a).
//
// POST /api/visits/[id]/follow-ups writes onto ANOTHER bishopric member's To Do through the service
// role, so its check — visits.assign AND a bishopric calling — is the write boundary, asserted from
// both sides. `ownerUserId` is a SUBJECT column from the body (CLAUDE.md §7): somebody outside the
// bishopric, or in another ward, is a 400 with a sentence. The to-do is asserted by RE-READING
// `todos` with the service client. Once given it is the owner's own: they can delete it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

async function addFollowUp(visitId: string, body: unknown) {
  const { POST } = await import("@/app/api/visits/[id]/follow-ups/route");
  const url = `http://localhost/api/visits/${visitId}/follow-ups`;
  return readResponse(
    await POST(jsonRequest(url, { method: "POST", body }), { params: Promise.resolve({ id: visitId }) }),
  );
}

describe("POST /api/visits/[id]/follow-ups", () => {
  let fixtures: Fixtures;
  let visitId: string;
  let wardBVisitId: string;

  const followUpsFor = async (id: string) => {
    const { data, error } = await fixtures.service
      .from("todos")
      .select("id, user_id, title, assigned_by, due_date, completed_at, visit_log_id")
      .eq("visit_log_id", id)
      .order("created_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const auditRows = async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "visit_follow_up_created");
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "eqPresident", "wardBBishop"]);

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardAId, family_name: `Ellis ${fixtures.runId}` })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    const { data: visit, error: visitError } = await fixtures.service
      .from("visit_logs")
      .insert({
        ward_id: fixtures.wardAId,
        org_id: null,
        household_id: household.id,
        recorded_by: fixtures.user("bishop").id,
        visit_date: "2026-11-01",
        visit_type: "in_home",
        shared_notes: "They asked about the youth temple trip.",
      })
      .select("id")
      .single();
    if (visitError) throw new Error(visitError.message);
    visitId = visit.id;

    const { data: wardBHousehold, error: wardBHouseholdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardBId, family_name: `Elsewhere ${fixtures.runId}` })
      .select("id")
      .single();
    if (wardBHouseholdError) throw new Error(wardBHouseholdError.message);

    const { data: wardBVisit, error: wardBVisitError } = await fixtures.service
      .from("visit_logs")
      .insert({
        ward_id: fixtures.wardBId,
        org_id: null,
        household_id: wardBHousehold.id,
        recorded_by: fixtures.user("wardBBishop").id,
        visit_date: "2026-11-01",
        visit_type: "in_home",
      })
      .select("id")
      .single();
    if (wardBVisitError) throw new Error(wardBVisitError.message);
    wardBVisitId = wardBVisit.id;
  }, 90_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("puts a follow-up on a counselor's To Do, linked to the visit", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await addFollowUp(visitId, {
      ownerUserId: fixtures.user("counselor1").id,
      title: "Ask about the temple trip",
      dueDate: "2026-12-01",
    });

    expect(status).toBe(201);
    const [todo] = await followUpsFor(visitId);
    expect(todo.id).toBe(body.todoId);
    expect(todo.user_id).toBe(fixtures.user("counselor1").id);
    expect(todo.assigned_by).toBe(fixtures.user("bishop").id);
    expect(todo.title).toBe("Ask about the temple trip");
    expect(todo.due_date).toBe("2026-12-01");
    expect(todo.completed_at).toBeNull();
  });

  it("records ids only in the audit row — never the title", async () => {
    const rows = await auditRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("temple trip");
  });

  it("a follow-up for yourself carries no assigner", async () => {
    await actAs(fixtures, "counselor1");
    const { status } = await addFollowUp(visitId, {
      ownerUserId: fixtures.user("counselor1").id,
      title: "Drop off the casserole dish",
    });

    expect(status).toBe(201);
    const mine = (await followUpsFor(visitId)).find((todo) => todo.title === "Drop off the casserole dish");
    expect(mine?.assigned_by).toBeNull();
  });

  it("refuses an owner outside the bishopric with a sentence, and writes nothing", async () => {
    await actAs(fixtures, "bishop");
    const before = (await followUpsFor(visitId)).length;
    const { status, body } = await addFollowUp(visitId, {
      ownerUserId: fixtures.user("eqPresident").id,
      title: "Not theirs to do",
    });

    expect(status).toBe(400);
    expect(body.error).toMatch(/only go to the bishop or one of the counselors/);
    expect(await followUpsFor(visitId)).toHaveLength(before);
  });

  it("refuses an owner from another ward", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await addFollowUp(visitId, {
      ownerUserId: fixtures.user("wardBBishop").id,
      title: "Another ward",
    });
    expect(status).toBe(400);
  });

  it("refuses somebody outside the bishopric with 403", async () => {
    await actAs(fixtures, "eqPresident");
    const before = (await followUpsFor(visitId)).length;
    const { status } = await addFollowUp(visitId, {
      ownerUserId: fixtures.user("counselor1").id,
      title: "Trying anyway",
    });
    expect(status).toBe(403);
    expect(await followUpsFor(visitId)).toHaveLength(before);
  });

  it("answers 404 for a visit in another ward", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await addFollowUp(wardBVisitId, {
      ownerUserId: fixtures.user("bishop").id,
      title: "Not our visit",
    });
    expect(status).toBe(404);
    expect(await followUpsFor(wardBVisitId)).toHaveLength(0);
  });

  it("refuses an empty title", async () => {
    await actAs(fixtures, "bishop");
    const { status } = await addFollowUp(visitId, {
      ownerUserId: fixtures.user("bishop").id,
      title: "   ",
    });
    expect(status).toBe(400);
  });

  it("is the owner's own once given: they can delete it", async () => {
    const [todo] = await followUpsFor(visitId);
    await actAs(fixtures, "counselor1");
    const { DELETE } = await import("@/app/api/todos/[id]/route");
    const response = await DELETE(
      jsonRequest(`http://localhost/api/todos/${todo.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: todo.id }) },
    );
    expect(response.status).toBeLessThan(300);

    const { data } = await fixtures.service.from("todos").select("id").eq("id", todo.id);
    expect(data ?? []).toHaveLength(0);
  });
});
