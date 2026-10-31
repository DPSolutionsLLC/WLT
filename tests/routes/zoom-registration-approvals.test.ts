// @vitest-environment node
//
// THE BISHOPRIC'S ANSWERS TO A PUBLIC ZOOM SIGN-UP (ITER-052 z3b): PATCH /api/zoom/registrations/[id].
// Approval is unanimous among whoever serves in the bishopric at the moment of each answer, and any
// one member may decline. Only the server client factory is mocked, so each request runs as the
// acting user (tests/helpers/routeClient.ts). Every sign-up here is seeded PENDING and otherwise
// valid, so each refusal is refused for the reason under test.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type FixtureHandle, type Fixtures } from "@/tests/helpers/seed";
import { createStatusToken } from "@/lib/zoom/registrationTokens";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api/zoom/registrations";
const PRIVATE_NOTE = "Spoke with their family already — Bertha";

async function answer(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/zoom/registrations/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${BASE}/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

async function giveLink(inviteeId: string) {
  const { POST } = await import("@/app/api/zoom/invitees/[id]/link/route");
  return readResponse(
    await POST(jsonRequest(`http://localhost/api/zoom/invitees/${inviteeId}/link`, { method: "POST" }), {
      params: Promise.resolve({ id: inviteeId }),
    }),
  );
}

describe("PATCH /api/zoom/registrations/[id]", () => {
  let fixtures: Fixtures;
  let counter = 0;

  async function seedRegistration(fields: Record<string, unknown> = {}): Promise<string> {
    counter += 1;
    const { data, error } = await fixtures.service
      .from("zoom_registrations")
      .insert({
        ward_id: fixtures.wardAId,
        display_name: `Sign-up ${counter}`,
        phone: `555-300-${String(1000 + counter)}`,
        phone_digits: `555300${String(1000 + counter)}`,
        says_member: false,
        status: "pending",
        held_reason: "approvals_on",
        status_token_hash: createStatusToken().hash,
        referral_code: `Appr${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`,
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async function seedLinks(count: number) {
    for (let index = 0; index < count; index += 1) {
      const { error } = await fixtures.service.from("zoom_join_links").insert({
        ward_id: fixtures.wardAId,
        placeholder_name: `Guest ${index}`,
        placeholder_email: `guest-${crypto.randomUUID().slice(0, 8)}@example.org`,
        join_url: `https://zoom.us/w/${crypto.randomUUID()}`,
      });
      if (error) throw new Error(error.message);
    }
  }

  async function registrationRow(id: string) {
    const { data, error } = await fixtures.service
      .from("zoom_registrations")
      .select("status, decided_by, decline_note, invitee_id")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function responses(id: string) {
    const { data, error } = await fixtures.service
      .from("zoom_registration_responses")
      .select("user_id, response")
      .eq("registration_id", id);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function auditDetails(action: string) {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", action);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.detail as Record<string, unknown>);
  }

  async function setCalling(handle: FixtureHandle, isActive: boolean) {
    const { error } = await fixtures.service
      .from("ward_role_assignments")
      .update({ is_active: isActive })
      .eq("ward_id", fixtures.wardAId)
      .eq("user_id", fixtures.user(handle).id);
    if (error) throw new Error(error.message);
  }

  async function respondAs(handle: FixtureHandle, id: string, body: unknown) {
    await actAs(fixtures, handle);
    return answer(id, body);
  }

  async function clearWard() {
    const service = fixtures.service;
    const wardId = fixtures.wardAId;
    await service.from("todos").delete().eq("ward_id", wardId).not("zoom_invitee_id", "is", null);
    await service.from("todos").delete().eq("ward_id", wardId).not("zoom_registration_id", "is", null);
    await service.from("zoom_registrations").delete().eq("ward_id", wardId);
    await service.from("zoom_invitees").delete().eq("ward_id", wardId);
    await service.from("zoom_join_links").delete().eq("ward_id", wardId);
    await service.from("audit_log").delete().eq("ward_id", wardId).like("action", "zoom_%");
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2", "wardSecretary"]);
  });

  beforeEach(async () => {
    await clearWard();
    await seedLinks(1);
  });

  afterAll(async () => {
    if (!fixtures) return;
    await clearWard();
    await fixtures.cleanup();
  });

  it("waits on the last member, then the last approval approves and gives a link", async () => {
    const id = await seedRegistration();

    expect((await respondAs("bishop", id, { action: "approve" })).status).toBe(200);
    const second = await respondAs("counselor2", id, { action: "approve" });
    expect(second.status).toBe(200);
    expect((second.body as { registration: { status: string } }).registration.status).toBe("pending");

    const last = await respondAs("counselor1", id, { action: "approve" });
    expect(last.status).toBe(200);
    const registration = (last.body as { registration: { status: string; linkGiven: boolean } }).registration;
    expect(registration).toMatchObject({ status: "approved", linkGiven: true });

    const row = await registrationRow(id);
    expect(row.decided_by).toBe(fixtures.user("counselor1").id);
    const { data: invitee } = await fixtures.service
      .from("zoom_invitees")
      .select("source, join_link_id")
      .eq("id", row.invitee_id as string)
      .single();
    expect(invitee).toMatchObject({ source: "self_registration" });
    expect(invitee?.join_link_id).not.toBeNull();

    expect(await auditDetails("zoom_registration_responded")).toHaveLength(3);
    expect(await auditDetails("zoom_registration_approved")).toEqual([
      { registrationId: id, inviteeId: row.invitee_id, linkGiven: true, waitingTodoIds: [] },
    ]);
  });

  it("replaces a member's own talk-first with their approval", async () => {
    const id = await seedRegistration();
    await respondAs("counselor1", id, { action: "talk_first" });
    await respondAs("counselor1", id, { action: "approve" });

    expect(await responses(id)).toEqual([{ user_id: fixtures.user("counselor1").id, response: "approve" }]);
    expect((await registrationRow(id)).status).toBe("pending");
  });

  it("declines on one member's word, keeps the note private, and closes the match to-dos", async () => {
    const id = await seedRegistration({ says_member: true });
    const { error } = await fixtures.service.from("todos").insert({
      ward_id: fixtures.wardAId,
      user_id: fixtures.user("bishop").id,
      title: "Match Sign-up to the roster",
      tag: "Zoom",
      zoom_registration_id: id,
    });
    if (error) throw new Error(error.message);

    const declined = await respondAs("counselor2", id, { action: "decline", note: PRIVATE_NOTE });
    expect(declined.status).toBe(200);
    expect(JSON.stringify(declined.body)).not.toContain(PRIVATE_NOTE);

    const row = await registrationRow(id);
    expect(row).toMatchObject({
      status: "declined",
      decided_by: fixtures.user("counselor2").id,
      decline_note: PRIVATE_NOTE,
      invitee_id: null,
    });

    const audits = await auditDetails("zoom_registration_declined");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ registrationId: id, declinedWithMessage: true });
    expect(JSON.stringify(audits[0])).not.toContain("Bertha");

    const { data: todos } = await fixtures.service
      .from("todos")
      .select("id, completed_at, todo_log_entries (kind, body)")
      .eq("zoom_registration_id", id);
    expect(todos).toHaveLength(1);
    expect(todos?.[0]?.completed_at).not.toBeNull();
    expect(todos?.[0]?.todo_log_entries).toEqual([
      { kind: "source_completed", body: "The sign-up was declined." },
    ]);
  });

  it("stores a blank note as null", async () => {
    const id = await seedRegistration();
    expect((await respondAs("bishop", id, { action: "decline", note: "   " })).status).toBe(200);
    expect((await registrationRow(id)).decline_note).toBeNull();
    expect((await auditDetails("zoom_registration_declined"))[0]).toMatchObject({ declinedWithMessage: false });
  });

  it("answers 409 on a sign-up that was already decided", async () => {
    const id = await seedRegistration();
    await respondAs("bishop", id, { action: "decline" });

    for (const body of [{ action: "approve" }, { action: "decline" }, { action: "finish" }]) {
      const { status, body: refused } = await respondAs("counselor1", id, body);
      expect(status).toBe(409);
      expect((refused as { error: string }).error).toBe("This sign-up was already decided.");
    }
  });

  it("answers 404 for a sign-up in no ward of the caller's", async () => {
    const { status } = await respondAs("bishop", crypto.randomUUID(), { action: "approve" });
    expect(status).toBe(404);
  });

  it("refuses the clerk and leaves the sign-up unchanged", async () => {
    const id = await seedRegistration();
    for (const body of [{ action: "approve" }, { action: "decline", note: "x" }]) {
      expect((await respondAs("wardSecretary", id, body)).status).toBe(403);
    }
    expect(await registrationRow(id)).toMatchObject({ status: "pending", decline_note: null });
    expect(await responses(id)).toEqual([]);
  });

  it("finishes the approval once the only member still waited on is released", async () => {
    const id = await seedRegistration();
    await respondAs("bishop", id, { action: "approve" });
    await respondAs("counselor1", id, { action: "approve" });

    await setCalling("counselor2", false);
    try {
      const finished = await respondAs("bishop", id, { action: "finish" });
      expect(finished.status).toBe(200);
      expect((await registrationRow(id)).status).toBe("approved");
    } finally {
      await setCalling("counselor2", true);
    }
  });

  it("approves on one approval when only the bishop is serving", async () => {
    const id = await seedRegistration();
    await setCalling("counselor1", false);
    await setCalling("counselor2", false);
    try {
      expect((await respondAs("bishop", id, { action: "approve" })).status).toBe(200);
      expect((await registrationRow(id)).status).toBe("approved");
    } finally {
      await setCalling("counselor1", true);
      await setCalling("counselor2", true);
    }
  });

  it("approves with an empty pool, puts a waiting to-do on every member, and a link closes them all", async () => {
    await fixtures.service.from("zoom_join_links").delete().eq("ward_id", fixtures.wardAId);
    const id = await seedRegistration({ display_name: "Pool Empty" });

    await respondAs("bishop", id, { action: "approve" });
    await respondAs("counselor1", id, { action: "approve" });
    const last = await respondAs("counselor2", id, { action: "approve" });
    expect(last.status).toBe(200);
    expect((last.body as { registration: { linkGiven: boolean } }).registration.linkGiven).toBe(false);

    const inviteeId = (await registrationRow(id)).invitee_id as string;
    const { data: waiting } = await fixtures.service
      .from("todos")
      .select("user_id, title, completed_at")
      .eq("zoom_invitee_id", inviteeId);
    expect(waiting?.map((todo) => todo.user_id).sort()).toEqual(
      [fixtures.user("bishop").id, fixtures.user("counselor1").id, fixtures.user("counselor2").id].sort(),
    );
    expect(waiting?.every((todo) => todo.title === "Give Pool Empty a Zoom link")).toBe(true);

    const approved = await auditDetails("zoom_registration_approved");
    expect(approved[0]).toMatchObject({ linkGiven: false });
    expect(approved[0]?.waitingTodoIds).toHaveLength(3);

    await seedLinks(1);
    await actAs(fixtures, "counselor1");
    expect((await giveLink(inviteeId)).status).toBe(200);

    const { data: after } = await fixtures.service
      .from("todos")
      .select("completed_at")
      .eq("zoom_invitee_id", inviteeId);
    expect(after?.every((todo) => todo.completed_at !== null)).toBe(true);
  });

  it("refuses an unknown action with a sentence", async () => {
    const id = await seedRegistration();
    const { status } = await respondAs("bishop", id, { action: "maybe" });
    expect(status).toBe(400);
    expect((await registrationRow(id)).status).toBe("pending");
  });
});
