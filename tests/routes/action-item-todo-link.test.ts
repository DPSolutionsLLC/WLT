// @vitest-environment node
//
// Two keys, one agenda item (P5 slice b): assigning an action item creates the assignee's linked
// to-do; completion runs both ways as a FLAG and never completes or deletes the other side.
//
// Only the client factory is mocked (tests/helpers/routeClient.ts). The assignee's to-do is
// written by lib/todos/sourceLinks.ts with the service role, so every assertion about it reads the
// row back with the service client — the bishop's own client could not see it (D2), which is the
// point of the design and not something a test should route around.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type FixtureHandle, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api";

type TodoRow = {
  id: string;
  user_id: string;
  assigned_by: string | null;
  action_item_id: string | null;
  source_completed_at: string | null;
  completed_at: string | null;
};

async function createItem(agendaId: string, body: unknown) {
  const { POST } = await import("@/app/api/agendas/[id]/action-items/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/agendas/${agendaId}/action-items`, { body }), {
      params: Promise.resolve({ id: agendaId }),
    }),
  );
}

async function patchItem(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/action-items/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/action-items/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

async function deleteItem(id: string) {
  const { DELETE } = await import("@/app/api/action-items/[id]/route");
  return readResponse(
    await DELETE(jsonRequest(`${BASE}/action-items/${id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    }),
  );
}

async function patchTodo(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/todos/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/todos/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
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

async function addStep(todoId: string, label: string) {
  const { POST } = await import("@/app/api/todos/[id]/steps/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/todos/${todoId}/steps`, { body: { label } }), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

async function createAgenda(body: unknown) {
  const { POST } = await import("@/app/api/agendas/route");
  return readResponse(await POST(jsonRequest(`${BASE}/agendas`, { body })));
}

describe("Action item ↔ to-do link", () => {
  let fixtures: Fixtures;
  let service: SupabaseClient;
  let agendaId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "rsPresident", "wardBBishop"]);
    service = createServiceSupabaseClient();

    const { data, error } = await service
      .from("agendas")
      .insert({
        ward_id: fixtures.wardAId,
        meeting_type: "bishopric",
        meeting_date: "2026-09-20",
        sections: [],
        status: "draft",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not seed an agenda: ${error.message}`);
    agendaId = data.id;
  });

  afterAll(async () => {
    const ownerIds = [
      fixtures?.users.eqPresident?.id,
      fixtures?.users.rsPresident?.id,
      fixtures?.users.bishop?.id,
    ].filter((id): id is string => id !== undefined);
    if (ownerIds.length > 0) {
      await service.from("todos").delete().in("user_id", ownerIds);
    }
    await fixtures?.cleanup();
  });

  async function linkedTodos(actionItemId: string): Promise<TodoRow[]> {
    const { data, error } = await service
      .from("todos")
      .select("id, user_id, assigned_by, action_item_id, source_completed_at, completed_at")
      .eq("action_item_id", actionItemId);
    if (error) throw new Error(`Could not read linked to-dos: ${error.message}`);
    return (data ?? []) as TodoRow[];
  }

  async function readTodo(id: string): Promise<TodoRow | null> {
    const { data, error } = await service
      .from("todos")
      .select("id, user_id, assigned_by, action_item_id, source_completed_at, completed_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Could not read a to-do: ${error.message}`);
    return data as TodoRow | null;
  }

  async function readItem(id: string) {
    const { data, error } = await service
      .from("action_items")
      .select("status, completion_review_requested_at, assigned_user_id")
      .eq("id", id)
      .single();
    if (error) throw new Error(`Could not read an action item: ${error.message}`);
    return data;
  }

  async function logKinds(todoId: string): Promise<string[]> {
    const { data, error } = await service
      .from("todo_log_entries")
      .select("kind")
      .eq("todo_id", todoId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Could not read log lines: ${error.message}`);
    return (data ?? []).map((row) => row.kind);
  }

  async function newAssignedItem(description: string, assigneeKey: FixtureHandle = "eqPresident") {
    await actAs(fixtures, "bishop");
    const { status, body } = await createItem(agendaId, {
      description,
      assignedUserId: fixtures.user(assigneeKey).id,
    });
    expect(status).toBe(201);
    const itemId = (body.actionItem as { id: string }).id;
    const [todo] = await linkedTodos(itemId);
    return { itemId, todo };
  }

  it("creates the assignee's linked to-do, stamped with who assigned it", async () => {
    const { itemId, todo } = await newAssignedItem("Visit the Tanaka family");

    expect(todo).toBeDefined();
    expect(todo.user_id).toBe(fixtures.user("eqPresident").id);
    expect(todo.assigned_by).toBe(fixtures.user("bishop").id);
    expect((await linkedTodos(itemId))).toHaveLength(1);
  });

  it("does not create a second to-do when the same assignee is sent again", async () => {
    const { itemId } = await newAssignedItem("Order hymnals");

    const { status } = await patchItem(itemId, { assignedUserId: fixtures.user("eqPresident").id });

    expect(status).toBe(200);
    expect(await linkedTodos(itemId)).toHaveLength(1);
  });

  it("deletes the previous assignee's UNTOUCHED to-do on reassignment", async () => {
    const { itemId, todo } = await newAssignedItem("Arrange the chairs");

    const { status } = await patchItem(itemId, { assignedUserId: fixtures.user("rsPresident").id });

    expect(status).toBe(200);
    expect(await readTodo(todo.id)).toBeNull();
    const linked = await linkedTodos(itemId);
    expect(linked).toHaveLength(1);
    expect(linked[0].user_id).toBe(fixtures.user("rsPresident").id);
  });

  it("unlinks and KEEPS a touched to-do on reassignment", async () => {
    const { itemId, todo } = await newAssignedItem("Prepare the ward budget");

    await actAs(fixtures, "eqPresident");
    expect((await addStep(todo.id, "Gather receipts")).status).toBe(201);

    await actAs(fixtures, "bishop");
    expect((await patchItem(itemId, { assignedUserId: fixtures.user("rsPresident").id })).status).toBe(200);

    const kept = await readTodo(todo.id);
    expect(kept).not.toBeNull();
    expect(kept?.action_item_id).toBeNull();
  });

  it("flags the to-do when the item is completed — and never deletes it — then clears on reopen", async () => {
    const { itemId, todo } = await newAssignedItem("Call the stake about the building");

    expect((await patchItem(itemId, { complete: true })).status).toBe(200);

    const flagged = await readTodo(todo.id);
    expect(flagged).not.toBeNull();
    expect(flagged?.source_completed_at).not.toBeNull();
    expect(flagged?.completed_at).toBeNull();
    expect(await logKinds(todo.id)).toContain("source_completed");

    expect((await patchItem(itemId, { complete: false })).status).toBe(200);
    expect((await readTodo(todo.id))?.source_completed_at).toBeNull();
  });

  it("asks for review when the owner completes the to-do, without completing the item", async () => {
    const { itemId, todo } = await newAssignedItem("Update the ward directory");

    await actAs(fixtures, "eqPresident");
    expect((await patchTodo(todo.id, { complete: true })).status).toBe(200);

    const item = await readItem(itemId);
    expect(item.status).toBe("open");
    expect(item.completion_review_requested_at).not.toBeNull();

    // Reopening the to-do withdraws the request.
    expect((await patchTodo(todo.id, { complete: false })).status).toBe(200);
    expect((await readItem(itemId)).completion_review_requested_at).toBeNull();
  });

  it("completing an UNLINKED to-do touches no action item", async () => {
    await actAs(fixtures, "eqPresident");
    const { POST } = await import("@/app/api/todos/route");
    const created = await readResponse(
      await POST(jsonRequest(`${BASE}/todos`, { body: { title: "My own errand" } })),
    );
    expect(created.status).toBe(201);
    const todoId = (created.body.todo as { id: string }).id;

    const { data: before } = await service
      .from("action_items")
      .select("id")
      .eq("ward_id", fixtures.wardAId)
      .not("completion_review_requested_at", "is", null);

    expect((await patchTodo(todoId, { complete: true })).status).toBe(200);

    const { data: after } = await service
      .from("action_items")
      .select("id")
      .eq("ward_id", fixtures.wardAId)
      .not("completion_review_requested_at", "is", null);
    expect(after?.length).toBe(before?.length);
  });

  it("refuses to delete a to-do linked to an open item, naming the alternative", async () => {
    const { itemId, todo } = await newAssignedItem("Schedule the youth interviews");

    await actAs(fixtures, "eqPresident");
    const refused = await deleteTodo(todo.id);
    expect(refused.status).toBe(409);
    expect(errorMessage(refused.body)).toContain("Mark it complete instead");
    expect(await readTodo(todo.id)).not.toBeNull();

    // Once the meeting completes the item, the owner may remove it like any other.
    await actAs(fixtures, "bishop");
    expect((await patchItem(itemId, { complete: true })).status).toBe(200);
    await actAs(fixtures, "eqPresident");
    expect((await deleteTodo(todo.id)).status).toBe(200);
  });

  it("refuses an assignee who holds no calling in this ward, and creates no to-do", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await createItem(agendaId, {
      description: "Something for another ward",
      assignedUserId: fixtures.user("wardBBishop").id,
    });

    expect(status).toBe(400);
    expect(errorMessage(body)).toBe("That person does not hold a calling in this ward.");

    const { data } = await service
      .from("todos")
      .select("id")
      .eq("user_id", fixtures.user("wardBBishop").id);
    expect(data ?? []).toHaveLength(0);
  });

  it("removes an untouched to-do when its item is deleted, and keeps a touched one", async () => {
    const untouched = await newAssignedItem("Typed by mistake");
    expect((await deleteItem(untouched.itemId)).status).toBe(200);
    expect(await readTodo(untouched.todo.id)).toBeNull();

    const touched = await newAssignedItem("Real work, later removed");
    await actAs(fixtures, "eqPresident");
    expect((await addStep(touched.todo.id, "Started it")).status).toBe(201);
    await actAs(fixtures, "bishop");
    expect((await deleteItem(touched.itemId)).status).toBe(200);
    const kept = await readTodo(touched.todo.id);
    expect(kept).not.toBeNull();
    expect(kept?.action_item_id).toBeNull();
  });

  it("moves the to-do link onto the carried copy when the next agenda is created", async () => {
    // A published agenda of its own meeting type, so no other test's items are carried.
    const { data: published, error } = await service
      .from("agendas")
      .insert({
        ward_id: fixtures.wardAId,
        meeting_type: "ward_council",
        meeting_date: "2026-09-13",
        sections: [],
        status: "published",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not seed a published agenda: ${error.message}`);

    await actAs(fixtures, "bishop");
    const created = await createItem(published.id, {
      description: "Carried with its assignee",
      assignedUserId: fixtures.user("eqPresident").id,
    });
    expect(created.status).toBe(201);
    const originalId = (created.body.actionItem as { id: string }).id;
    const [todo] = await linkedTodos(originalId);

    const next = await createAgenda({ meetingType: "ward_council", meetingDate: "2026-09-27" });
    expect(next.status).toBe(201);
    const nextAgendaId = (next.body.agenda as { id: string }).id;

    const { data: copies } = await service
      .from("action_items")
      .select("id, assigned_user_id")
      .eq("agenda_id", nextAgendaId);
    expect(copies ?? []).toHaveLength(1);
    expect(copies?.[0].assigned_user_id).toBe(fixtures.user("eqPresident").id);

    expect((await readTodo(todo.id))?.action_item_id).toBe(copies?.[0].id);
    expect(await linkedTodos(originalId)).toHaveLength(0);
  });
});
