// @vitest-environment node
//
// Invites tied to a person on the ward list (ITER-058 cr4).
//
// POST /api/auth/invite takes `{ email, memberId }` and NO role: the calling is derived on the
// server from the person's ward list callings, so the body cannot ask for `super_admin`. Redeeming
// re-derives from the roster AS IT IS NOW, creates the calling (`source: 'roster'`) and the link
// (`method: 'invite'`), and refuses a calling that has changed BEFORE any auth user exists.
//
// Writes are asserted by RE-READING with the service client.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  INVITE_CALLING_CHANGED_MESSAGE,
  INVITE_IDENTITY_REQUIRED_MESSAGE,
  INVITE_REFUSED_MESSAGE,
  readInvitePreview,
  redeemInvite,
} from "@/lib/auth/invites";
import { createInviteSchema, registerSchema } from "@/lib/validation/invite";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const INVITE_URL = "http://localhost/api/auth/invite";
const PASSWORD = "harness-invite-password-1";

async function getWaiting(memberId: string) {
  const { GET } = await import("@/app/api/auth/invite/route");
  return readResponse(await GET(jsonRequest(`${INVITE_URL}?memberId=${memberId}`)));
}

async function postNotMe(token: string) {
  const { POST } = await import("@/app/api/auth/invite/not-me/route");
  return readResponse(
    await POST(jsonRequest("http://localhost/api/auth/invite/not-me", { method: "POST", body: { token } })),
  );
}

async function postInvite(body: unknown) {
  const { POST } = await import("@/app/api/auth/invite/route");
  return readResponse(await POST(jsonRequest(INVITE_URL, { method: "POST", body })));
}

function tokenOf(body: unknown): string {
  const url = (body as { url: string }).url;
  return url.slice(url.lastIndexOf("/") + 1);
}

describe("POST /api/auth/invite and redeemInvite — a person on the ward list", () => {
  let fixtures: Fixtures;
  const createdAuthUserIds: string[] = [];
  const member: Record<
    "clerk" | "noCalling" | "linked" | "changes" | "unconfirmed" | "replaced" | "declines",
    string
  > = {
    clerk: "",
    noCalling: "",
    linked: "",
    changes: "",
    unconfirmed: "",
    replaced: "",
    declines: "",
  };
  const emailFor = (key: string) => `wlt-test-${fixtures.runId}-cr4-${key}@wardleadershiptools.test`;

  async function authUserExists(email: string): Promise<boolean> {
    const { data, error } = await fixtures.service.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error(error.message);
    return data.users.some((user) => user.email?.toLowerCase() === email.toLowerCase());
  }

  async function readInvite(token: string) {
    const { data, error } = await fixtures.service
      .from("invites")
      .select("member_id, role, used_at, declined_at, expires_at")
      .eq("token", token)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "eqPresident"], {
      notificationTriggers: [{ triggerKey: "invite_declined", defaultRoles: ["bishop", "counselor"] }],
    });

    const rows = [
      { key: "clerk", callings: "Ward Clerk" },
      { key: "noCalling", callings: "Ward Assistant Clerk" },
      { key: "linked", callings: "Ward Executive Secretary" },
      { key: "changes", callings: "Music Coordinator" },
      { key: "unconfirmed", callings: "Music Coordinator" },
      { key: "replaced", callings: "Music Coordinator" },
      { key: "declines", callings: "Music Coordinator" },
    ] as const;

    for (const row of rows) {
      const { data, error } = await fixtures.service
        .from("members")
        .insert({
          ward_id: fixtures.wardAId,
          first_name: row.key,
          last_name: `Invitee ${fixtures.runId}`,
          callings: row.callings,
          birth_date: "1985-03-01",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      member[row.key] = data.id;
    }

    // The executive secretary's record is already linked to the counselor's account.
    const { error: linkError } = await fixtures.service.from("user_member_links").insert({
      user_id: fixtures.user("counselor1").id,
      ward_id: fixtures.wardAId,
      member_id: member.linked,
      status: "active",
      method: "admin",
      linked_by: fixtures.user("bishop").id,
      decided_by: fixtures.user("bishop").id,
      decided_at: new Date().toISOString(),
    });
    if (linkError) throw new Error(linkError.message);
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
    for (const authUserId of createdAuthUserIds) {
      const { error } = await fixtures.service.auth.admin.deleteUser(authUserId);
      if (error) console.warn(`Could not delete registrant auth user ${authUserId}`, error.message);
    }
  });

  describe("the body", () => {
    it("refuses a role in the body — there is no such field any more", () => {
      const result = createInviteSchema.safeParse({
        email: "someone@example.com",
        memberId: "11111111-1111-4111-8111-111111111111",
        role: "super_admin",
      });
      expect(result.success).toBe(false);
    });

    it("answers 400 for a body that still carries a role, and creates no invite", async () => {
      await actAs(fixtures, "bishop");
      const { status } = await postInvite({
        email: emailFor("role"),
        memberId: member.clerk,
        role: "super_admin",
      });
      expect(status).toBe(400);

      const { count, error } = await fixtures.service
        .from("invites")
        .select("id", { head: true, count: "exact" })
        .eq("email", emailFor("role"));
      if (error) throw new Error(error.message);
      expect(count).toBe(0);
    });

    it("refuses false on \"Yes, this is me\"", () => {
      const result = registerSchema.safeParse({
        firstName: "Ada",
        lastName: "Lovelace",
        password: PASSWORD,
        confirmedIdentity: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("creating an invite", () => {
    it("refuses an organization president, who does not manage users", async () => {
      await actAs(fixtures, "eqPresident");
      const { status } = await postInvite({ email: emailFor("eq"), memberId: member.clerk });
      expect(status).toBe(403);
    });

    it("refuses a person whose ward list callings the app does not recognise", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await postInvite({ email: emailFor("none"), memberId: member.noCalling });
      expect(status).toBe(400);
      expect((body as { error: string }).error).toMatch(/holds no calling the app recognises/);
    });

    it("refuses a person already linked to an account", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await postInvite({ email: emailFor("linked"), memberId: member.linked });
      expect(status).toBe(400);
      expect((body as { error: string }).error).toMatch(/already has an account linked/);
    });

    it("stores the person and no role, and names the derived calling", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await postInvite({ email: emailFor("clerk"), memberId: member.clerk });
      expect(status).toBe(200);
      expect(body).toMatchObject({ invite: { role: "ward_secretary", memberId: member.clerk } });
      expect(await readInvite(tokenOf(body))).toMatchObject({ member_id: member.clerk, role: null });

      const { data: audit, error } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("user_id", fixtures.user("bishop").id)
        .eq("action", "invite_created")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (error) throw new Error(error.message);
      expect(audit.detail).toMatchObject({ memberId: member.clerk, role: "ward_secretary" });
      expect(JSON.stringify(audit.detail)).not.toContain("clerk Invitee");
    });
  });

  describe("redeeming an invite", () => {
    it("creates the roster calling and the link", async () => {
      await actAs(fixtures, "bishop");
      const created = await postInvite({ email: emailFor("redeem"), memberId: member.clerk });
      expect(created.status).toBe(200);

      const result = await redeemInvite(tokenOf(created.body), {
        firstName: "Clerk",
        lastName: "Newcomer",
        password: PASSWORD,
        confirmedIdentity: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdAuthUserIds.push(result.userId);

      const { data: calling, error: callingError } = await fixtures.service
        .from("ward_role_assignments")
        .select("role, ward_id, source")
        .eq("user_id", result.userId)
        .eq("is_active", true)
        .single();
      if (callingError) throw new Error(callingError.message);
      expect(calling).toEqual({ role: "ward_secretary", ward_id: fixtures.wardAId, source: "roster" });

      const { data: link, error: linkError } = await fixtures.service
        .from("user_member_links")
        .select("member_id, status, method, linked_by")
        .eq("user_id", result.userId)
        .single();
      if (linkError) throw new Error(linkError.message);
      expect(link).toEqual({
        member_id: member.clerk,
        status: "active",
        method: "invite",
        linked_by: fixtures.user("bishop").id,
      });
    });

    it("refuses without \"Yes, this is me\" and leaves the link usable", async () => {
      await actAs(fixtures, "bishop");
      const created = await postInvite({ email: emailFor("unconfirmed"), memberId: member.unconfirmed });
      expect(created.status).toBe(200);
      const token = tokenOf(created.body);

      const result = await redeemInvite(token, { firstName: "Not", lastName: "Sure", password: PASSWORD });
      expect(result).toEqual({ ok: false, message: INVITE_IDENTITY_REQUIRED_MESSAGE });
      expect((await readInvite(token)).used_at).toBeNull();
      expect(await authUserExists(emailFor("unconfirmed"))).toBe(false);
    });

    it("refuses a calling that changed since the invite, before an auth user exists", async () => {
      await actAs(fixtures, "bishop");
      const created = await postInvite({ email: emailFor("changes"), memberId: member.changes });
      expect(created.status).toBe(200);
      const token = tokenOf(created.body);

      const { error } = await fixtures.service
        .from("members")
        .update({ callings: "Ward Assistant Clerk" })
        .eq("id", member.changes);
      if (error) throw new Error(error.message);

      const result = await redeemInvite(token, {
        firstName: "Changed",
        lastName: "Calling",
        password: PASSWORD,
        confirmedIdentity: true,
      });
      expect(result).toEqual({ ok: false, message: INVITE_CALLING_CHANGED_MESSAGE });
      expect(await authUserExists(emailFor("changes"))).toBe(false);
      expect((await readInvite(token)).used_at).toBeNull();
    });
  });

  describe("one live link per person (decided walking scenario 105)", () => {
    it("reads the waiting link back for the bishopric, and a new link cancels it", async () => {
      await actAs(fixtures, "bishop");
      const first = await postInvite({ email: emailFor("replaced"), memberId: member.replaced });
      expect(first.status).toBe(200);
      const firstToken = tokenOf(first.body);

      const waiting = await getWaiting(member.replaced);
      expect(waiting.status).toBe(200);
      expect((waiting.body as { waiting: { url: string } }).waiting.url).toContain(firstToken);

      const second = await postInvite({ email: emailFor("replaced"), memberId: member.replaced });
      expect(second.status).toBe(200);
      expect((second.body as { warning: string | null }).warning).toBeNull();
      const secondToken = tokenOf(second.body);

      const old = await readInvite(firstToken);
      expect(new Date(old.expires_at ?? 0).getTime()).toBeLessThanOrEqual(Date.now());
      expect(await readInvitePreview(firstToken, fixtures.service)).toBeNull();

      const again = await getWaiting(member.replaced);
      expect((again.body as { waiting: { url: string } }).waiting.url).toContain(secondToken);
    });

    it("refuses the waiting link to somebody who cannot invite", async () => {
      await actAs(fixtures, "eqPresident");
      const { status } = await getWaiting(member.replaced);
      expect(status).toBe(403);
    });
  });

  describe("\"No, this isn't me\" (migration 107)", () => {
    it("kills the link, tells the sender, and audits ids only", async () => {
      await actAs(fixtures, "bishop");
      const created = await postInvite({ email: emailFor("declines"), memberId: member.declines });
      expect(created.status).toBe(200);
      const token = tokenOf(created.body);
      const inviteId = (created.body as { invite: { id: string } }).invite.id;

      const { status } = await postNotMe(token);
      expect(status).toBe(200);
      expect((await readInvite(token)).declined_at).not.toBeNull();

      expect(await readInvitePreview(token, fixtures.service)).toBeNull();
      const redeemed = await redeemInvite(token, {
        firstName: "Not",
        lastName: "Them",
        password: PASSWORD,
        confirmedIdentity: true,
      });
      expect(redeemed).toEqual({ ok: false, message: INVITE_REFUSED_MESSAGE });

      const { data: audit, error: auditError } = await fixtures.service
        .from("audit_log")
        .select("user_id, detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "invite_declined")
        .contains("detail", { inviteId })
        .single();
      if (auditError) throw new Error(auditError.message);
      expect(audit.user_id).toBeNull();
      expect(audit.detail).toEqual({ inviteId, memberId: member.declines });

      const { data: notes, error: noteError } = await fixtures.service
        .from("notifications")
        .select("recipient_user_id, body")
        .eq("ward_id", fixtures.wardAId)
        .eq("trigger_key", "invite_declined");
      if (noteError) throw new Error(noteError.message);
      expect(notes?.map((note) => note.recipient_user_id)).toEqual([fixtures.user("bishop").id]);
      expect(notes?.[0]?.body).not.toContain(token);
    });

    it("answers a second press, or an unknown token, the same way and changes nothing", async () => {
      const { status, body } = await postNotMe("not-a-real-token");
      expect(status).toBe(400);
      expect((body as { error: string }).error).toBe(INVITE_REFUSED_MESSAGE);
    });
  });
});
