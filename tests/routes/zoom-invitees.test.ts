// @vitest-environment node
//
// The Zoom invitee routes (ITER-053, z2b): POST /api/zoom/invitees (the hand-out),
// PATCH /api/zoom/invitees/[id] (edit), and GET / POST /api/zoom/invitees/[id]/link (show a link,
// give a waiting person one). Only the server client factory is mocked, so every query runs as the
// acting user. See tests/helpers/routeClient.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api/zoom/invitees";

const typedPerson = {
  memberId: null,
  displayName: "Visitor Person",
  phone: "555-123-4567",
  email: "Visitor@Example.org",
  notes: "Met at the care centre",
};

async function handOut(body: unknown) {
  const { POST } = await import("@/app/api/zoom/invitees/route");
  return readResponse(await POST(jsonRequest(BASE, { method: "POST", body })));
}

async function edit(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/zoom/invitees/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

async function showLink(id: string) {
  const { GET } = await import("@/app/api/zoom/invitees/[id]/link/route");
  return readResponse(
    await GET(jsonRequest(`${BASE}/${id}/link`), { params: Promise.resolve({ id }) }),
  );
}

async function patchTodo(todoId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/todos/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`http://localhost/api/todos/${todoId}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

async function deleteTodo(todoId: string) {
  const { DELETE } = await import("@/app/api/todos/[id]/route");
  return readResponse(
    await DELETE(jsonRequest(`http://localhost/api/todos/${todoId}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: todoId }),
    }),
  );
}

async function giveLink(id: string) {
  const { POST } = await import("@/app/api/zoom/invitees/[id]/link/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/${id}/link`, { method: "POST" }), {
      params: Promise.resolve({ id }),
    }),
  );
}

type HandOutBody = {
  invitee: { id: string; displayName: string; placeholderName: string | null; email: string | null };
  joinUrl: string | null;
  pool: { tone: string; sentence: string | null };
};

describe("/api/zoom/invitees", () => {
  let fixtures: Fixtures;
  let activeMemberId: string;
  let movedOutMemberId: string;
  let wardBMemberId: string;

  async function seedMember(wardId: string, firstName: string, status: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("members")
      .insert({
        ward_id: wardId,
        first_name: firstName,
        last_name: `Zoom${fixtures.runId}`,
        category: "adult",
        status,
        phone: "555-777-8888",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not seed a member: ${error.message}`);
    return data.id;
  }

  async function seedLinks(labels: string[]): Promise<void> {
    for (const label of labels) {
      const { error } = await fixtures.service.from("zoom_join_links").insert({
        ward_id: fixtures.wardAId,
        placeholder_name: `Guest ${label}`,
        placeholder_email: `sacrament+${label}@example.org`,
        join_url: `https://example.org/j/${label}`,
      });
      if (error) throw new Error(error.message);
    }
  }

  async function inviteeCount(): Promise<number> {
    const { count, error } = await fixtures.service
      .from("zoom_invitees")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async function auditRows(action: string) {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", action);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "wardSecretary"]);
    activeMemberId = await seedMember(fixtures.wardAId, "Active", "active");
    movedOutMemberId = await seedMember(fixtures.wardAId, "Moved", "moved_out");
    wardBMemberId = await seedMember(fixtures.wardBId, "Elsewhere", "active");
  });

  async function zoomTodos(inviteeId: string) {
    const { data, error } = await fixtures.service
      .from("todos")
      .select("id, user_id, title, tag, assigned_by, completed_at, closed_reason")
      .eq("ward_id", fixtures.wardAId)
      .eq("zoom_invitee_id", inviteeId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function timelineKinds(todoId: string) {
    const { data, error } = await fixtures.service
      .from("todo_log_entries")
      .select("kind, body")
      .eq("todo_id", todoId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  beforeEach(async () => {
    await fixtures.service.from("todos").delete().eq("ward_id", fixtures.wardAId).not("zoom_invitee_id", "is", null);
    await fixtures.service.from("zoom_invitees").delete().eq("ward_id", fixtures.wardAId);
    await fixtures.service.from("zoom_join_links").delete().eq("ward_id", fixtures.wardAId);
    await fixtures.service.from("audit_log").delete().eq("ward_id", fixtures.wardAId).like("action", "zoom_%");
  });

  afterAll(async () => {
    await fixtures?.service.from("todos").delete().eq("ward_id", fixtures.wardAId).not("zoom_invitee_id", "is", null);
    await fixtures?.service.from("zoom_invitees").delete().eq("ward_id", fixtures.wardAId);
    await fixtures?.cleanup();
  });

  it("gives a roster member and then a typed name the next free links, oldest first", async () => {
    await seedLinks(["g01", "g02", "g03"]);
    await actAs(fixtures, "counselor1");

    const first = await handOut({ ...typedPerson, memberId: activeMemberId, displayName: "Active Member" });
    expect(first.status).toBe(201);
    const firstBody = first.body as HandOutBody;
    expect(firstBody.joinUrl).toBe("https://example.org/j/g01");
    expect(firstBody.invitee.placeholderName).toBe("Guest g01");

    const second = await handOut(typedPerson);
    expect(second.status).toBe(201);
    const secondBody = second.body as HandOutBody;
    expect(secondBody.joinUrl).toBe("https://example.org/j/g02");
    expect(secondBody.invitee.email).toBe("visitor@example.org");
    expect(secondBody.pool).toEqual({ tone: "low", sentence: "Only 1 Zoom link is left." });
  });

  it("audits ids and a boolean, never a phone, email, note or URL", async () => {
    await seedLinks(["a01"]);
    await actAs(fixtures, "bishop");
    const { status, body } = await handOut(typedPerson);
    expect(status).toBe(201);

    const rows = await auditRows("zoom_invitee_created");
    expect(rows).toHaveLength(1);
    const detail = rows[0]?.detail as Record<string, unknown>;
    expect(detail).toMatchObject({
      inviteeId: (body as HandOutBody).invitee.id,
      memberId: null,
      linkGiven: true,
    });
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("555");
    expect(serialized).not.toContain("visitor@");
    expect(serialized).not.toContain("care centre");
  });

  it("saves the person as waiting when the pool is empty", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await handOut(typedPerson);
    expect(status).toBe(201);
    const parsed = body as HandOutBody;
    expect(parsed.joinUrl).toBeNull();
    expect(parsed.invitee.placeholderName).toBeNull();
    expect(parsed.pool.tone).toBe("empty");
    expect(await inviteeCount()).toBe(1);
  });

  it("refuses a moved-out member with a sentence and writes nothing", async () => {
    await seedLinks(["m01"]);
    await actAs(fixtures, "bishop");
    const { status, body } = await handOut({ ...typedPerson, memberId: movedOutMemberId });
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe(
      "Pick the person again — that roster record isn't available.",
    );
    expect(await inviteeCount()).toBe(0);
  });

  it("refuses another ward's member with a sentence and writes nothing", async () => {
    await seedLinks(["b01"]);
    await actAs(fixtures, "bishop");
    const { status } = await handOut({ ...typedPerson, memberId: wardBMemberId });
    expect(status).toBe(400);
    expect(await inviteeCount()).toBe(0);
  });

  it("refuses the clerk on every write and on reading a link", async () => {
    await seedLinks(["c01"]);
    await actAs(fixtures, "bishop");
    const created = (await handOut(typedPerson)).body as HandOutBody;

    await actAs(fixtures, "wardSecretary");
    expect((await handOut(typedPerson)).status).toBe(403);
    expect((await edit(created.invitee.id, { phone: "555-999-0000" })).status).toBe(403);
    expect((await showLink(created.invitee.id)).status).toBe(403);
    expect((await giveLink(created.invitee.id)).status).toBe(403);

    expect(await inviteeCount()).toBe(1);
    const { data } = await fixtures.service
      .from("zoom_invitees")
      .select("phone")
      .eq("id", created.invitee.id)
      .single();
    expect(data?.phone).toBe("555-123-4567");
  });

  it("edits a phone and audits the field NAME only", async () => {
    await seedLinks(["e01"]);
    await actAs(fixtures, "bishop");
    const created = (await handOut(typedPerson)).body as HandOutBody;

    await actAs(fixtures, "counselor1");
    const { status } = await edit(created.invitee.id, {
      phone: "555-999-0000",
      displayName: typedPerson.displayName,
    });
    expect(status).toBe(200);

    const rows = await auditRows("zoom_invitee_updated");
    expect(rows.map((row) => row.detail)).toEqual([
      { inviteeId: created.invitee.id, changedFields: ["phone"] },
    ]);
    expect(JSON.stringify(rows)).not.toContain("555");
  });

  it("answers 404 for an invitee in no ward of the caller's", async () => {
    await actAs(fixtures, "bishop");
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await edit(unknown, { phone: "555-999-0000" })).status).toBe(404);
    expect((await showLink(unknown)).status).toBe(404);
    expect((await giveLink(unknown)).status).toBe(404);
  });

  it("shows a given person's link to the bishopric, and 404s for somebody waiting", async () => {
    await actAs(fixtures, "bishop");
    const waiting = (await handOut(typedPerson)).body as HandOutBody;
    expect((await showLink(waiting.invitee.id)).status).toBe(404);

    await seedLinks(["s01"]);
    const holder = (await handOut({ ...typedPerson, displayName: "Holder" })).body as HandOutBody;
    const { status, body } = await showLink(holder.invitee.id);
    expect(status).toBe(200);
    expect(body).toEqual({ joinUrl: "https://example.org/j/s01" });
  });

  it("refuses to give a waiting person a link from an empty pool, then gives one once pasted", async () => {
    await actAs(fixtures, "bishop");
    const waiting = (await handOut(typedPerson)).body as HandOutBody;

    const refused = await giveLink(waiting.invitee.id);
    expect(refused.status).toBe(409);
    expect((refused.body as { error: string }).error).toBe(
      "There are no free links. Paste more on the Link pool tab.",
    );

    await seedLinks(["w01"]);
    const given = await giveLink(waiting.invitee.id);
    expect(given.status).toBe(200);
    expect((given.body as HandOutBody).joinUrl).toBe("https://example.org/j/w01");

    const again = await giveLink(waiting.invitee.id);
    expect(again.status).toBe(409);
    expect((again.body as { error: string }).error).toBe("They already have a link.");

    const rows = await auditRows("zoom_invitee_link_given");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("https://");
  });

  // ---------------------------------------------------------------------------
  // z2c — the "Give ___ a Zoom link" to-do (D1)
  // ---------------------------------------------------------------------------

  it("puts exactly one open to-do on the leader's own list when the pool is empty", async () => {
    await actAs(fixtures, "counselor1");
    const waiting = (await handOut(typedPerson)).body as HandOutBody;

    const todos = await zoomTodos(waiting.invitee.id);
    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({
      user_id: fixtures.user("counselor1").id,
      title: "Give Visitor Person a Zoom link",
      tag: "Zoom",
      assigned_by: null,
      completed_at: null,
    });

    const rows = await auditRows("zoom_invitee_created");
    expect(rows[0]?.detail).toMatchObject({ linkGiven: false, waitingTodoId: todos[0]?.id });
  });

  it("writes no to-do when a link was given", async () => {
    await seedLinks(["t01"]);
    await actAs(fixtures, "counselor1");
    const given = (await handOut(typedPerson)).body as HandOutBody;
    expect(await zoomTodos(given.invitee.id)).toHaveLength(0);
    expect((await auditRows("zoom_invitee_created"))[0]?.detail).toMatchObject({
      waitingTodoId: null,
    });
  });

  it("closes counselor1's to-do with a timeline line when the bishop gives the link", async () => {
    await actAs(fixtures, "counselor1");
    const waiting = (await handOut(typedPerson)).body as HandOutBody;
    const [todo] = await zoomTodos(waiting.invitee.id);
    expect(todo).toBeDefined();

    await seedLinks(["c01"]);
    await actAs(fixtures, "bishop");
    expect((await giveLink(waiting.invitee.id)).status).toBe(200);

    const [closed] = await zoomTodos(waiting.invitee.id);
    expect(closed?.completed_at).not.toBeNull();
    expect(closed?.closed_reason).toBeNull();
    expect(await timelineKinds(todo!.id)).toEqual([
      { kind: "source_completed", body: "A Zoom link was given." },
    ]);

    const rows = await auditRows("zoom_invitee_link_given");
    expect(rows[0]?.detail).toMatchObject({ closedTodoIds: [todo!.id] });
  });

  it("refuses a tick and a delete on an open Zoom to-do, and deletes it once closed", async () => {
    await actAs(fixtures, "counselor1");
    const waiting = (await handOut(typedPerson)).body as HandOutBody;
    const [todo] = await zoomTodos(waiting.invitee.id);
    const todoId = todo!.id;

    const tick = await patchTodo(todoId, { complete: true });
    expect(tick.status).toBe(400);
    expect((tick.body as { error: string }).error).toBe(
      "This closes itself once they're given a link on Zoom.",
    );

    const refused = await deleteTodo(todoId);
    expect(refused.status).toBe(409);
    expect((refused.body as { error: string }).error).toBe(
      "This closes itself once they're given a link.",
    );
    expect(await zoomTodos(waiting.invitee.id)).toHaveLength(1);

    await seedLinks(["d01"]);
    expect((await giveLink(waiting.invitee.id)).status).toBe(200);

    const deleted = await deleteTodo(todoId);
    expect(deleted.status).toBeLessThan(300);
    expect(await zoomTodos(waiting.invitee.id)).toHaveLength(0);
  });
});
