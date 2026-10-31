// @vitest-environment node
//
// MATCHING A PUBLIC SIGN-UP TO THE ROSTER (ITER-052 z3b, plan D3): a sign-up that says "I'm a
// member" puts "Match ___ to the roster" on every serving bishopric member's list, and the first
// match — POST /api/zoom/registrations/[id]/match — closes every copy. Only the server client
// factory is mocked (tests/helpers/routeClient.ts). Negative-path bodies are otherwise valid.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type FixtureHandle, type Fixtures } from "@/tests/helpers/seed";
import { createStatusToken } from "@/lib/zoom/registrationTokens";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

async function submit(body: unknown) {
  const { POST } = await import("@/app/api/public/zoom-registrations/route");
  return readResponse(
    await POST(jsonRequest("http://localhost/api/public/zoom-registrations", { method: "POST", body })),
  );
}

async function match(id: string, body: unknown) {
  const { POST } = await import("@/app/api/zoom/registrations/[id]/match/route");
  return readResponse(
    await POST(jsonRequest(`http://localhost/api/zoom/registrations/${id}/match`, { method: "POST", body }), {
      params: Promise.resolve({ id }),
    }),
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

describe("matching a Zoom sign-up to the roster", () => {
  let fixtures: Fixtures;
  const slug = `zoom-match-${crypto.randomUUID().slice(0, 8)}`;
  let activeMemberId: string;
  let otherMemberId: string;
  let movedOutMemberId: string;
  let phoneCounter = 0;

  async function seedMember(firstName: string, status: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        first_name: firstName,
        last_name: `Match${fixtures.runId}`,
        category: "adult",
        status,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  function memberBody(displayName: string) {
    phoneCounter += 1;
    return {
      slug,
      displayName,
      phone: `555-410-${String(1000 + phoneCounter)}`,
      email: "",
      saysMember: true,
      answers: [],
      website: "",
    };
  }

  async function submitMember(displayName: string): Promise<string> {
    const { status } = await submit(memberBody(displayName));
    expect(status).toBe(201);
    const { data, error } = await fixtures.service
      .from("zoom_registrations")
      .select("id")
      .eq("ward_id", fixtures.wardAId)
      .eq("display_name", displayName)
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async function matchTodos(registrationId: string) {
    const { data, error } = await fixtures.service
      .from("todos")
      .select("id, user_id, title, tag, assigned_by, completed_at, todo_log_entries (kind, body)")
      .eq("zoom_registration_id", registrationId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function matchAs(handle: FixtureHandle, id: string, memberId: string) {
    await actAs(fixtures, handle);
    return match(id, { memberId });
  }

  async function setAutoApprove(autoApprove: boolean) {
    const { error } = await fixtures.service
      .from("zoom_registration_settings")
      .update({ auto_approve: autoApprove })
      .eq("ward_id", fixtures.wardAId);
    if (error) throw new Error(error.message);
  }

  async function clearWard() {
    const service = fixtures.service;
    const wardId = fixtures.wardAId;
    await service.from("todos").delete().eq("ward_id", wardId).not("zoom_registration_id", "is", null);
    await service.from("todos").delete().eq("ward_id", wardId).not("zoom_invitee_id", "is", null);
    await service.from("zoom_registrations").delete().eq("ward_id", wardId);
    await service.from("zoom_invitees").delete().eq("ward_id", wardId);
    await service.from("zoom_join_links").delete().eq("ward_id", wardId);
    await service.from("audit_log").delete().eq("ward_id", wardId).like("action", "zoom_%");
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2", "wardSecretary"]);
    const service = fixtures.service;

    const page = await service
      .from("public_pages")
      .insert({ ward_id: fixtures.wardAId, page_type: "zoom_registration", slug, is_active: true });
    if (page.error) throw new Error(page.error.message);

    const settings = await service
      .from("zoom_registration_settings")
      .insert({ ward_id: fixtures.wardAId, is_open: true, auto_approve: false });
    if (settings.error) throw new Error(settings.error.message);

    activeMemberId = await seedMember("Active", "active");
    otherMemberId = await seedMember("Other", "active");
    movedOutMemberId = await seedMember("Moved", "moved_out");
  });

  beforeEach(async () => {
    await clearWard();
    await setAutoApprove(false);
  });

  afterAll(async () => {
    if (!fixtures) return;
    await clearWard();
    await fixtures.service.from("zoom_registration_settings").delete().eq("ward_id", fixtures.wardAId);
    await fixtures.service.from("public_pages").delete().eq("slug", slug);
    await fixtures.cleanup();
  });

  it("puts one match to-do on every bishopric member's list when a member signs up", async () => {
    const id = await submitMember("Member Person");
    const todos = await matchTodos(id);

    expect(todos.map((todo) => todo.user_id).sort()).toEqual(
      [fixtures.user("bishop").id, fixtures.user("counselor1").id, fixtures.user("counselor2").id].sort(),
    );
    for (const todo of todos) {
      expect(todo).toMatchObject({
        title: "Match Member Person to the roster",
        tag: "Zoom",
        assigned_by: null,
        completed_at: null,
      });
    }

    const { data: audits } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "zoom_registration_submitted");
    expect((audits?.[0]?.detail as { matchTodoIds: string[] }).matchTodoIds).toHaveLength(3);
  });

  it("puts no match to-do on anybody's list for a non-member", async () => {
    const { status } = await submit({ ...memberBody("Not A Member"), saysMember: false });
    expect(status).toBe(201);
    const { count } = await fixtures.service
      .from("todos")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId)
      .not("zoom_registration_id", "is", null);
    expect(count).toBe(0);
  });

  it("matches, closes every copy with its line, and audits ids only", async () => {
    const id = await submitMember("To Be Matched");

    const { status, body } = await matchAs("counselor1", id, activeMemberId);
    expect(status).toBe(200);
    expect((body as { registration: { memberId: string } }).registration.memberId).toBe(activeMemberId);

    const { data: row } = await fixtures.service
      .from("zoom_registrations")
      .select("member_id, matched_by, matched_at")
      .eq("id", id)
      .single();
    expect(row).toMatchObject({ member_id: activeMemberId, matched_by: fixtures.user("counselor1").id });
    expect(row?.matched_at).not.toBeNull();

    const todos = await matchTodos(id);
    expect(todos).toHaveLength(3);
    for (const todo of todos) {
      expect(todo.completed_at).not.toBeNull();
      expect(todo.todo_log_entries).toEqual([
        { kind: "source_completed", body: "They were matched to the roster." },
      ]);
    }

    const { data: audits } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "zoom_registration_matched");
    expect(audits).toHaveLength(1);
    const detail = audits?.[0]?.detail as Record<string, unknown>;
    expect(detail).toMatchObject({ registrationId: id, memberId: activeMemberId, previousMemberId: false });
    expect(detail.closedTodoIds).toHaveLength(3);
    expect(JSON.stringify(detail)).not.toContain("To Be Matched");
  });

  it("gives an approved sign-up's invitee the same member and keeps the name they gave", async () => {
    await setAutoApprove(true);
    const id = await submitMember("Approved Member");
    const { data: before } = await fixtures.service
      .from("zoom_registrations")
      .select("status, invitee_id")
      .eq("id", id)
      .single();
    expect(before?.status).toBe("approved");

    expect((await matchAs("bishop", id, activeMemberId)).status).toBe(200);

    const { data: invitee } = await fixtures.service
      .from("zoom_invitees")
      .select("member_id, display_name")
      .eq("id", before?.invitee_id as string)
      .single();
    expect(invitee).toEqual({ member_id: activeMemberId, display_name: "Approved Member" });
  });

  it("allows a re-match and records that there was one before", async () => {
    const id = await submitMember("Rematched");
    expect((await matchAs("bishop", id, activeMemberId)).status).toBe(200);
    expect((await matchAs("bishop", id, otherMemberId)).status).toBe(200);

    const { data: row } = await fixtures.service
      .from("zoom_registrations")
      .select("member_id")
      .eq("id", id)
      .single();
    expect(row?.member_id).toBe(otherMemberId);

    const { data: audits } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "zoom_registration_matched")
      .order("created_at", { ascending: true });
    expect((audits ?? []).map((audit) => (audit.detail as { previousMemberId: boolean }).previousMemberId)).toEqual([
      false,
      true,
    ]);
  });

  it("refuses a moved-out member with a sentence and changes nothing", async () => {
    const id = await submitMember("Moved Match");
    const { status, body } = await matchAs("bishop", id, movedOutMemberId);
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe("Pick the person again — that roster record isn't available.");

    const { data: row } = await fixtures.service.from("zoom_registrations").select("member_id").eq("id", id).single();
    expect(row?.member_id).toBeNull();
    expect((await matchTodos(id)).every((todo) => todo.completed_at === null)).toBe(true);
  });

  it("refuses the clerk and changes nothing", async () => {
    const id = await submitMember("Clerk Tries");
    expect((await matchAs("wardSecretary", id, activeMemberId)).status).toBe(403);
    const { data: row } = await fixtures.service.from("zoom_registrations").select("member_id").eq("id", id).single();
    expect(row?.member_id).toBeNull();
  });

  it("refuses a tick and a delete on an open match to-do, and deletes it once matched", async () => {
    const id = await submitMember("No Checkbox");
    const own = (await matchTodos(id)).find((todo) => todo.user_id === fixtures.user("counselor2").id);
    const todoId = own!.id;

    await actAs(fixtures, "counselor2");
    const tick = await patchTodo(todoId, { complete: true });
    expect(tick.status).toBe(400);
    expect((tick.body as { error: string }).error).toBe("This closes itself once they're matched on Zoom → Sign-ups.");

    const refused = await deleteTodo(todoId);
    expect(refused.status).toBe(409);
    expect((refused.body as { error: string }).error).toBe("This closes itself once they're matched on Zoom → Sign-ups.");

    expect((await matchAs("bishop", id, activeMemberId)).status).toBe(200);

    await actAs(fixtures, "counselor2");
    expect((await deleteTodo(todoId)).status).toBeLessThan(300);
    expect((await matchTodos(id)).map((todo) => todo.id)).not.toContain(todoId);
  });

  it("answers 409 for a declined sign-up", async () => {
    const { data, error } = await fixtures.service
      .from("zoom_registrations")
      .insert({
        ward_id: fixtures.wardAId,
        display_name: "Declined Person",
        phone: "555-410-9999",
        phone_digits: "5554109999",
        says_member: true,
        status: "declined",
        decided_at: new Date().toISOString(),
        status_token_hash: createStatusToken().hash,
        referral_code: `Decl${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { status } = await matchAs("bishop", data.id, activeMemberId);
    expect(status).toBe(409);
  });
});
