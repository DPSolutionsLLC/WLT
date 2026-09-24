// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// `todos`, `todo_steps` and `todo_log_entries` (migration 081) — OWNER ONLY.
//
// D2: nobody but the owner reads or writes a to-do, and the bishop is NOT an exception.
// D3: nobody can create a to-do on somebody else's list, or claim one was assigned.
//
// THE ANCHOR: the owner's own read returns exactly one row. Without it, every "returns nothing"
// assertion below would pass against a policy that returned nothing to anybody.
//
// A denied INSERT raises; a denied UPDATE or DELETE is a ZERO-ROW SUCCESS — so those re-read the
// row with the service client to prove nothing moved.

describe("todos RLS", () => {
  let fixtures: Fixtures;
  let service: SupabaseClient;
  let owner: SupabaseClient;
  let bishopA: SupabaseClient;
  let bishopB: SupabaseClient;

  const seeded = { todoId: "", stepId: "", logId: "" };

  beforeAll(async () => {
    fixtures = await seedFixtures(["eqPresident", "bishop", "wardBBishop"]);

    service = createServiceSupabaseClient();
    owner = await asRole(fixtures, "eqPresident");
    bishopA = await asRole(fixtures, "bishop");
    bishopB = await asRole(fixtures, "wardBBishop");

    const { data: todo, error: todoError } = await service
      .from("todos")
      .insert({
        ward_id: fixtures.wardAId,
        user_id: fixtures.user("eqPresident").id,
        title: "Visit the Andersons before Sunday",
      })
      .select("id")
      .single();
    if (todoError) throw new Error(`Could not seed a to-do: ${todoError.message}`);
    seeded.todoId = todo.id;

    const { data: step, error: stepError } = await service
      .from("todo_steps")
      .insert({ ward_id: fixtures.wardAId, todo_id: todo.id, label: "Call first", position: 1 })
      .select("id")
      .single();
    if (stepError) throw new Error(`Could not seed a step: ${stepError.message}`);
    seeded.stepId = step.id;

    const { data: log, error: logError } = await service
      .from("todo_log_entries")
      .insert({
        ward_id: fixtures.wardAId,
        todo_id: todo.id,
        kind: "note",
        body: "Sister Anderson asked us to come after 6.",
      })
      .select("id")
      .single();
    if (logError) throw new Error(`Could not seed a log line: ${logError.message}`);
    seeded.logId = log.id;
  });

  afterAll(async () => {
    // Steps and log lines go with their to-do by cascade. Deleted by owner, not by id list, so any
    // row a test created is caught as well — the hosted project is shared (CLAUDE.md §9).
    const ownerIds = [fixtures?.users.eqPresident?.id, fixtures?.users.bishop?.id].filter(
      (id): id is string => id !== undefined,
    );
    if (ownerIds.length > 0) {
      await service.from("todos").delete().in("user_id", ownerIds);
    }
    await fixtures?.cleanup();
  });

  // ---------------------------------------------------------------------------
  // THE OWNER
  // ---------------------------------------------------------------------------

  it("lets the owner read their to-do, its step and its log line — the anchor", async () => {
    const [todos, steps, log] = await Promise.all([
      owner.from("todos").select("id").eq("id", seeded.todoId),
      owner.from("todo_steps").select("id").eq("id", seeded.stepId),
      owner.from("todo_log_entries").select("id, body").eq("id", seeded.logId),
    ]);

    expect(todos.error).toBeNull();
    expect(todos.data).toHaveLength(1);
    expect(steps.data).toHaveLength(1);
    expect(log.data).toHaveLength(1);
    expect(log.data?.[0].body).toMatch(/after 6/);
  });

  it("lets the owner create, edit and delete a to-do of their own", async () => {
    const { data: created, error: createError } = await owner
      .from("todos")
      .insert({
        ward_id: fixtures.wardAId,
        user_id: fixtures.user("eqPresident").id,
        title: "Order the manuals",
      })
      .select("id")
      .single();

    expect(createError).toBeNull();

    const { data: updated, error: updateError } = await owner
      .from("todos")
      .update({ title: "Order the manuals — 12 copies" })
      .eq("id", created!.id)
      .select("title");

    expect(updateError).toBeNull();
    expect(updated?.[0].title).toBe("Order the manuals — 12 copies");

    const { data: deleted, error: deleteError } = await owner
      .from("todos")
      .delete()
      .eq("id", created!.id)
      .select("id");

    expect(deleteError).toBeNull();
    expect(deleted).toHaveLength(1);
  });

  it("lets the owner add a step and a log line to their to-do", async () => {
    const { error: stepError } = await owner.from("todo_steps").insert({
      ward_id: fixtures.wardAId,
      todo_id: seeded.todoId,
      label: "Take the lesson manual",
      position: 2,
    });
    expect(stepError).toBeNull();

    const { error: logError } = await owner.from("todo_log_entries").insert({
      ward_id: fixtures.wardAId,
      todo_id: seeded.todoId,
      kind: "note",
      body: "Confirmed Thursday.",
    });
    expect(logError).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // D3 — NOBODY ELSE'S LIST, AND NO CLAIMED ASSIGNMENT
  // ---------------------------------------------------------------------------

  it("refuses a to-do created on somebody else's list", async () => {
    const { error } = await owner.from("todos").insert({
      ward_id: fixtures.wardAId,
      user_id: fixtures.user("bishop").id,
      title: "Put on the bishop's list on purpose",
    });

    expect(error).not.toBeNull();
  });

  it("refuses a to-do that claims to have been assigned", async () => {
    const { error } = await owner.from("todos").insert({
      ward_id: fixtures.wardAId,
      user_id: fixtures.user("eqPresident").id,
      assigned_by: fixtures.user("bishop").id,
      title: "Claiming the bishop assigned this",
    });

    expect(error).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // D2 — THE BISHOP IS NOT AN EXCEPTION
  // ---------------------------------------------------------------------------

  it("does not let the bishop in the same ward read the to-do, its step or its log", async () => {
    const [todos, steps, log] = await Promise.all([
      bishopA.from("todos").select("id").eq("id", seeded.todoId),
      bishopA.from("todo_steps").select("id").eq("id", seeded.stepId),
      bishopA.from("todo_log_entries").select("id").eq("id", seeded.logId),
    ]);

    expect(todos.error).toBeNull();
    expect(todos.data).toEqual([]);
    expect(steps.data).toEqual([]);
    expect(log.data).toEqual([]);
  });

  it("does not let the bishop edit the to-do or check off its step", async () => {
    await bishopA.from("todos").update({ title: "Edited by the bishop" }).eq("id", seeded.todoId);
    await bishopA
      .from("todo_steps")
      .update({ done_at: new Date().toISOString() })
      .eq("id", seeded.stepId);

    const { data: todo } = await service
      .from("todos")
      .select("title")
      .eq("id", seeded.todoId)
      .single();
    const { data: step } = await service
      .from("todo_steps")
      .select("done_at")
      .eq("id", seeded.stepId)
      .single();

    expect(todo?.title).toBe("Visit the Andersons before Sunday");
    expect(step?.done_at).toBeNull();
  });

  it("does not let the bishop delete the to-do, its step or its log line", async () => {
    await bishopA.from("todo_log_entries").delete().eq("id", seeded.logId);
    await bishopA.from("todo_steps").delete().eq("id", seeded.stepId);
    await bishopA.from("todos").delete().eq("id", seeded.todoId);

    const [todo, step, log] = await Promise.all([
      service.from("todos").select("id").eq("id", seeded.todoId),
      service.from("todo_steps").select("id").eq("id", seeded.stepId),
      service.from("todo_log_entries").select("id").eq("id", seeded.logId),
    ]);

    expect(todo.data).toHaveLength(1);
    expect(step.data).toHaveLength(1);
    expect(log.data).toHaveLength(1);
  });

  it("does not let the bishop add a step or a note to somebody else's to-do", async () => {
    const { error: stepError } = await bishopA.from("todo_steps").insert({
      ward_id: fixtures.wardAId,
      todo_id: seeded.todoId,
      label: "Added by the bishop",
      position: 9,
    });
    const { error: logError } = await bishopA.from("todo_log_entries").insert({
      ward_id: fixtures.wardAId,
      todo_id: seeded.todoId,
      kind: "note",
      body: "Written by the bishop.",
    });

    expect(stepError).not.toBeNull();
    expect(logError).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // WARD ISOLATION
  // ---------------------------------------------------------------------------

  it("shows ward B's bishop nothing of ward A's to-dos", async () => {
    const [todos, steps, log] = await Promise.all([
      bishopB.from("todos").select("id").eq("id", seeded.todoId),
      bishopB.from("todo_steps").select("id").eq("id", seeded.stepId),
      bishopB.from("todo_log_entries").select("id").eq("id", seeded.logId),
    ]);

    expect(todos.data).toEqual([]);
    expect(steps.data).toEqual([]);
    expect(log.data).toEqual([]);
  });

  it("refuses a to-do written into another ward, even onto the author's own list", async () => {
    const { error } = await owner.from("todos").insert({
      ward_id: fixtures.wardBId,
      user_id: fixtures.user("eqPresident").id,
      title: "Filed into ward B on purpose",
    });

    expect(error).not.toBeNull();
  });
});
