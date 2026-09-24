// @vitest-environment node
//
// The To Do routes (P5 slice a).
//
// Only the client factory is mocked (tests/helpers/routeClient.ts), so every query below runs as a
// genuinely authenticated user against the hosted project — a pass means RLS allowed it, and a 404
// for somebody else's to-do means RLS hid it.
//
// THE PRIVACY ASSERTION: the audit log is readable by anyone holding `audit.view`, and a to-do is
// private to its owner (D2). So the audit detail must carry ids and field names, never a title, a
// step label or a note's text. That is asserted by reading the row back, not by trusting the route.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api";

async function createTodo(body: unknown) {
  const { POST } = await import("@/app/api/todos/route");
  return readResponse(await POST(jsonRequest(`${BASE}/todos`, { body })));
}

async function patchTodo(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/todos/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/todos/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

async function addStep(todoId: string, label: string) {
  const { POST } = await import("@/app/api/todos/[id]/steps/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/todos/${todoId}/steps`, { body: { label } }), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

async function patchStep(stepId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/todo-steps/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/todo-steps/${stepId}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id: stepId }),
    }),
  );
}

async function addNote(todoId: string, body: string) {
  const { POST } = await import("@/app/api/todos/[id]/notes/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/todos/${todoId}/notes`, { body: { body } }), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

async function deleteTodo(id: string) {
  const { DELETE } = await import("@/app/api/todos/[id]/route");
  return readResponse(
    await DELETE(jsonRequest(`${BASE}/todos/${id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    }),
  );
}

describe("To Do routes", () => {
  let fixtures: Fixtures;
  let service: SupabaseClient;
  let memberId: string | undefined;

  beforeAll(async () => {
    fixtures = await seedFixtures(["eqPresident", "bishop", "stakePresident"]);
    service = createServiceSupabaseClient();
  });

  afterAll(async () => {
    const ownerIds = [fixtures?.users.eqPresident?.id, fixtures?.users.bishop?.id].filter(
      (id): id is string => id !== undefined,
    );
    if (ownerIds.length > 0) {
      await service.from("todos").delete().in("user_id", ownerIds);
    }
    if (memberId !== undefined) {
      await service.from("members").delete().eq("id", memberId);
    }
    await fixtures?.cleanup();
  });

  async function auditRowsFor(todoId: string) {
    const { data, error } = await service
      .from("audit_log")
      .select("action, module, detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("detail->>todoId", todoId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Could not read audit rows: ${error.message}`);
    return data ?? [];
  }

  async function logKindsFor(todoId: string): Promise<string[]> {
    const { data, error } = await service
      .from("todo_log_entries")
      .select("kind")
      .eq("todo_id", todoId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Could not read log lines: ${error.message}`);
    return (data ?? []).map((row) => row.kind);
  }

  it("creates a to-do on the caller's own list and audits it", async () => {
    await actAs(fixtures, "eqPresident");

    const { status, body } = await createTodo({
      title: "Plan the quorum service project",
      doDate: "2026-09-28",
      dueDate: "2026-10-05",
      // Not on the schema. Ignored rather than honoured — the owner is always the session.
      userId: fixtures.user("bishop").id,
    });

    expect(status).toBe(201);
    const todo = body.todo as { id: string; doDate: string; dueDate: string; steps: unknown[] };
    expect(todo.doDate).toBe("2026-09-28");
    expect(todo.dueDate).toBe("2026-10-05");
    expect(todo.steps).toEqual([]);

    const { data } = await service
      .from("todos")
      .select("user_id, assigned_by")
      .eq("id", todo.id)
      .single();
    expect(data?.user_id).toBe(fixtures.user("eqPresident").id);
    expect(data?.assigned_by).toBeNull();

    const audit = await auditRowsFor(todo.id);
    expect(audit.map((row) => row.action)).toEqual(["todo_created"]);
    expect(audit[0].module).toBe("todos");
  });

  it("refuses a to-do with no title, with a sentence", async () => {
    await actAs(fixtures, "eqPresident");

    const { status, body } = await createTodo({ title: "   " });

    expect(status).toBe(400);
    expect(errorMessage(body)).toMatch(/title/i);
  });

  it("writes a step_done line when a step is checked off, and keeps it private from the audit log", async () => {
    await actAs(fixtures, "eqPresident");

    const created = await createTodo({ title: "Prepare the lesson" });
    const todoId = (created.body.todo as { id: string }).id;

    const stepResponse = await addStep(todoId, "Read chapter 12 twice");
    expect(stepResponse.status).toBe(201);
    const stepId = (stepResponse.body.step as { id: string }).id;

    const checked = await patchStep(stepId, { done: true });
    expect(checked.status).toBe(200);
    expect((checked.body.step as { doneAt: string | null }).doneAt).not.toBeNull();

    const noteResponse = await addNote(todoId, "Brother Lee offered to bring the handout.");
    expect(noteResponse.status).toBe(201);

    expect(await logKindsFor(todoId)).toEqual(["step_done", "note"]);

    const { data: line } = await service
      .from("todo_log_entries")
      .select("body")
      .eq("todo_id", todoId)
      .eq("kind", "step_done")
      .single();
    expect(line?.body).toBe("Read chapter 12 twice");

    const audit = await auditRowsFor(todoId);
    expect(audit.map((row) => row.action)).toEqual([
      "todo_created",
      "todo_step_added",
      "todo_step_updated",
      "todo_note_added",
    ]);

    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain("Prepare the lesson");
    expect(serialized).not.toContain("Read chapter 12");
    expect(serialized).not.toContain("Brother Lee");
  });

  it("completes a to-do once, and reopening writes its own line", async () => {
    await actAs(fixtures, "eqPresident");

    const created = await createTodo({ title: "Return the key to the library" });
    const todoId = (created.body.todo as { id: string }).id;

    const completed = await patchTodo(todoId, { complete: true });
    expect(completed.status).toBe(200);
    expect((completed.body.todo as { completedAt: string | null }).completedAt).not.toBeNull();

    // A second "complete" is a no-op — it must not write a second timeline line.
    await patchTodo(todoId, { complete: true });

    const reopened = await patchTodo(todoId, { complete: false });
    expect((reopened.body.todo as { completedAt: string | null }).completedAt).toBeNull();

    expect(await logKindsFor(todoId)).toEqual(["completed", "reopened"]);

    const actions = (await auditRowsFor(todoId)).map((row) => row.action);
    expect(actions).toEqual(["todo_created", "todo_completed", "todo_reopened"]);
  });

  // "Schedule this" (p5-c). The window sends an instant already converted from the ward's wall
  // clock; the route records a timeline line each way, reads the member's name back through the
  // ward-scoped foreign key, and clears the member when the schedule is removed.
  it("schedules a to-do with a member, and unscheduling clears both and says so", async () => {
    const { data: member, error: memberError } = await service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        first_name: "Scheduled",
        last_name: `Fixture${fixtures.runId}`,
        category: "adult",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(`Could not seed a member: ${memberError.message}`);
    memberId = member.id;

    await actAs(fixtures, "eqPresident");

    const created = await createTodo({ title: "Visit about the move" });
    const todoId = (created.body.todo as { id: string }).id;

    const scheduled = await patchTodo(todoId, {
      scheduledFor: "2026-09-26T01:30:00.000Z",
      scheduledWithMemberId: memberId,
    });
    expect(scheduled.status).toBe(200);

    const { GET } = await import("@/app/api/todos/route");
    const listed = await readResponse(await GET(jsonRequest(`${BASE}/todos?status=open`)));
    const listedTodo = (listed.body.todos as { id: string; scheduledFor: string | null; scheduledWithMemberName: string | null }[])
      .find((todo) => todo.id === todoId);
    expect(listedTodo?.scheduledFor).not.toBeNull();
    expect(new Date(listedTodo?.scheduledFor as string).toISOString()).toBe("2026-09-26T01:30:00.000Z");
    expect(listedTodo?.scheduledWithMemberName).toBe(`Scheduled Fixture${fixtures.runId}`);

    const unscheduled = await patchTodo(todoId, { scheduledFor: null });
    expect(unscheduled.status).toBe(200);

    const { data } = await service
      .from("todos")
      .select("scheduled_for, scheduled_with_member_id")
      .eq("id", todoId)
      .single();
    expect(data?.scheduled_for).toBeNull();
    expect(data?.scheduled_with_member_id).toBeNull();

    expect(await logKindsFor(todoId)).toEqual(["scheduled", "unscheduled"]);
  });

  // D2, at the route: the bishop gets a 404 for somebody else's to-do — not a 403, which would
  // confirm that it exists.
  it("answers 404 to the bishop for another leader's to-do, and changes nothing", async () => {
    await actAs(fixtures, "eqPresident");
    const created = await createTodo({ title: "Private to the president" });
    const todoId = (created.body.todo as { id: string }).id;

    await actAs(fixtures, "bishop");

    const patched = await patchTodo(todoId, { title: "Changed by the bishop" });
    expect(patched.status).toBe(404);

    const deleted = await deleteTodo(todoId);
    expect(deleted.status).toBe(404);

    const noted = await addNote(todoId, "The bishop was here.");
    expect(noted.status).toBe(404);

    const { data } = await service.from("todos").select("title").eq("id", todoId).single();
    expect(data?.title).toBe("Private to the president");
  });

  it("refuses a role without personal_tools.use", async () => {
    await actAs(fixtures, "stakePresident");

    const { status } = await createTodo({ title: "A stake officer's to-do" });

    expect(status).toBe(403);
  });

  it("deletes the owner's to-do, taking its steps and timeline with it", async () => {
    await actAs(fixtures, "eqPresident");

    const created = await createTodo({ title: "Typed by mistake" });
    const todoId = (created.body.todo as { id: string }).id;
    await addStep(todoId, "A step");

    const { status } = await deleteTodo(todoId);
    expect(status).toBe(200);

    const { data: steps } = await service.from("todo_steps").select("id").eq("todo_id", todoId);
    expect(steps).toEqual([]);
    expect((await auditRowsFor(todoId)).map((row) => row.action)).toContain("todo_deleted");
  });
});
