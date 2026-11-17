// @vitest-environment node
//
// Linking a login to its person on the ward list (ITER-058 cr1).
//
// /api/member-link: an account confirms its own EMAIL MATCH or ASKS — it never picks a record, and a
// member id sent by hand links nothing that is not its own match. /api/admin/member-links: a
// bishopric member links, declines or ends another account's link — never their own (P3), asserted
// with an actor who passes every other check so the refusal is for that reason alone.
//
// Writes are asserted by RE-READING `user_member_links` with the service client.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const MY_URL = "http://localhost/api/member-link";
const ADMIN_URL = "http://localhost/api/admin/member-links";

async function readMine() {
  const { GET } = await import("@/app/api/member-link/route");
  return readResponse(await GET());
}

async function postMine(body: unknown) {
  const { POST } = await import("@/app/api/member-link/route");
  return readResponse(await POST(jsonRequest(MY_URL, { method: "POST", body })));
}

async function adminLink(body: unknown) {
  const { POST } = await import("@/app/api/admin/member-links/route");
  return readResponse(await POST(jsonRequest(ADMIN_URL, { method: "POST", body })));
}

function linkIdOf(body: unknown): string {
  return (body as { link: { id: string } }).link.id;
}

async function adminDecide(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/admin/member-links/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${ADMIN_URL}/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

describe("/api/member-link and /api/admin/member-links", () => {
  let fixtures: Fixtures;
  const member: Record<"bishop" | "counselor1" | "counselor2" | "eqPresident" | "spare", string> = {
    bishop: "",
    counselor1: "",
    counselor2: "",
    eqPresident: "",
    spare: "",
  };

  const openLink = async (handle: "bishop" | "counselor1" | "counselor2" | "eqPresident") => {
    const { data, error } = await fixtures.service
      .from("user_member_links")
      .select("id, status, member_id, method, linked_by")
      .eq("user_id", fixtures.user(handle).id)
      .in("status", ["pending", "active"])
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  const auditActions = async (actorHandle: "bishop" | "counselor2" | "counselor1" | "eqPresident") => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("action, detail")
      .eq("user_id", fixtures.user(actorHandle).id)
      .like("action", "member_link_%");
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2", "eqPresident", "wardSecretary", "wardBBishop"]);

    const rows = [
      { key: "bishop", email: fixtures.user("bishop").email },
      // Counselor 2's roster email is their login email, in another case: the match ignores case.
      { key: "counselor2", email: fixtures.user("counselor2").email.toUpperCase() },
      // Counselor 1's roster record carries an address that is NOT their login.
      { key: "counselor1", email: `someone-else-${fixtures.runId}@example.com` },
      { key: "eqPresident", email: fixtures.user("eqPresident").email },
      { key: "spare", email: null },
    ] as const;

    for (const row of rows) {
      const { data, error } = await fixtures.service
        .from("members")
        .insert({
          ward_id: fixtures.wardAId,
          first_name: row.key,
          last_name: `Roster ${fixtures.runId}`,
          email: row.email,
          birth_date: "1980-05-01",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      member[row.key] = data.id;
    }
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("an account linking itself", () => {
    it("offers counselor 2 their own record by email, case-insensitively", async () => {
      await actAs(fixtures, "counselor2");
      const { status, body } = await readMine();
      expect(status).toBe(200);
      expect(body).toMatchObject({
        needed: true,
        link: null,
        emailCandidate: { memberId: member.counselor2, birthYear: 1980 },
      });
    });

    it("links counselor 2 when they say yes, and records it", async () => {
      await actAs(fixtures, "counselor2");
      const { status } = await postMine({ action: "confirm", memberId: member.counselor2 });
      expect(status).toBe(201);
      expect(await openLink("counselor2")).toMatchObject({
        status: "active",
        member_id: member.counselor2,
        method: "email_match",
        linked_by: null,
      });
      expect((await auditActions("counselor2")).map((row) => row.action)).toContain("member_link_created");
    });

    it("offers counselor 1 no candidate, because their roster email is not their login", async () => {
      await actAs(fixtures, "counselor1");
      const { body } = await readMine();
      expect(body).toMatchObject({ needed: true, link: null, emailCandidate: null });
    });

    it("refuses counselor 1 confirming a record that is somebody else's email match", async () => {
      await actAs(fixtures, "counselor1");
      const { status, body } = await postMine({ action: "confirm", memberId: member.eqPresident });
      expect(status).toBe(403);
      expect(body.error).toMatch(/no longer matches your email/);
      expect(await openLink("counselor1")).toBeNull();
    });

    it("records counselor 1's request to be linked, once", async () => {
      await actAs(fixtures, "counselor1");
      const first = await postMine({ action: "ask" });
      const second = await postMine({ action: "ask" });
      expect(first.status).toBe(200);
      expect(linkIdOf(second.body)).toBe(linkIdOf(first.body));
      expect(await openLink("counselor1")).toMatchObject({ status: "pending", member_id: null });
    });

    it("refuses a body that tries to choose a record while asking", async () => {
      await actAs(fixtures, "counselor1");
      const { status } = await postMine({ action: "ask", memberId: member.spare });
      expect(status).toBe(400);
    });
  });

  describe("the bishopric linking another account", () => {
    it("refuses the bishop linking their OWN account, though every other check passes", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await adminLink({ userId: fixtures.user("bishop").id, memberId: member.bishop });
      expect(status).toBe(403);
      expect(body.error).toMatch(/can't link your own account/);
      expect(await openLink("bishop")).toBeNull();
    });

    it("refuses somebody outside the bishopric", async () => {
      await actAs(fixtures, "wardSecretary");
      const { status } = await adminLink({ userId: fixtures.user("counselor1").id, memberId: member.counselor1 });
      expect(status).toBe(403);
      expect(await openLink("counselor1")).toMatchObject({ status: "pending" });
    });

    it("refuses an account from another ward with a sentence", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await adminLink({ userId: fixtures.user("wardBBishop").id, memberId: member.spare });
      expect(status).toBe(400);
      expect(body.error).toBe("That account is not in your ward.");
    });

    it("approves counselor 1's request in place", async () => {
      const pending = await openLink("counselor1");
      await actAs(fixtures, "bishop");
      const { status } = await adminLink({ userId: fixtures.user("counselor1").id, memberId: member.counselor1 });
      expect(status).toBe(201);
      expect(await openLink("counselor1")).toMatchObject({
        id: pending?.id,
        status: "active",
        member_id: member.counselor1,
        method: "admin",
        linked_by: fixtures.user("bishop").id,
      });
      const approved = (await auditActions("bishop")).find((row) => row.action === "member_link_approved");
      expect(approved?.detail).toMatchObject({ targetUserId: fixtures.user("counselor1").id, memberId: member.counselor1 });
    });

    it("refuses linking a record that is already linked to another account", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await adminLink({ userId: fixtures.user("eqPresident").id, memberId: member.counselor2 });
      expect(status).toBe(409);
      expect(body.error).toBe(
        `counselor2 Roster ${fixtures.runId} is already linked to another account. Unlink them first.`,
      );
      expect(body.error).not.toMatch(/Ask your bishopric/);
      expect(await openLink("eqPresident")).toBeNull();
    });

    it("declines a request, leaving the requester free to ask again", async () => {
      await actAs(fixtures, "eqPresident");
      const asked = await postMine({ action: "ask" });

      await actAs(fixtures, "counselor1");
      const { status } = await adminDecide(linkIdOf(asked.body), { action: "decline" });
      expect(status).toBe(200);
      expect(await openLink("eqPresident")).toBeNull();

      await actAs(fixtures, "eqPresident");
      const { body } = await readMine();
      expect(body).toMatchObject({ link: null, emailCandidate: { memberId: member.eqPresident } });
    });

    it("ends a link, keeping the row", async () => {
      const active = await openLink("counselor1");
      await actAs(fixtures, "counselor2");
      const { status } = await adminDecide(active!.id, { action: "end" });
      expect(status).toBe(200);

      const { data } = await fixtures.service
        .from("user_member_links")
        .select("status, ended_by")
        .eq("id", active!.id)
        .single();
      expect(data).toMatchObject({ status: "ended", ended_by: fixtures.user("counselor2").id });
    });

    it("refuses ending your own link", async () => {
      const own = await openLink("counselor2");
      await actAs(fixtures, "counselor2");
      const { status } = await adminDecide(own!.id, { action: "end" });
      expect(status).toBe(403);
      expect(await openLink("counselor2")).toMatchObject({ status: "active" });
    });
  });
});
