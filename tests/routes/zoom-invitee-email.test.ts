// @vitest-environment node
//
// POST /api/zoom/invitees/[id]/email — email somebody their own Zoom link
// (plans/zoom-link-email-and-text.md). Only the server client factory is mocked for auth, so every
// query runs as the acting user. lib/email/resend.ts is replaced so nothing reaches a real inbox and
// "is email set up" can be switched.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

const state = vi.hoisted(() => ({
  configured: true,
  refuse: false,
  sends: [] as { to: string[]; subject: string; html: string; text: string }[],
}));

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

vi.mock("@/lib/email/resend", () => ({
  emailConfiguration: () =>
    state.configured
      ? { configured: true, fromAddress: "zoom@example.org" }
      : { configured: false, reason: "Not configured in this test." },
  getResendClient: () => ({
    emails: {
      send: async (message: { to: string[]; subject: string; html: string; text: string }) => {
        if (state.refuse) return { data: null, error: { name: "validation_error", message: "Refused" } };
        state.sends.push(message);
        return { data: { id: "test" }, error: null };
      },
    },
  }),
}));

async function emailLink(id: string) {
  const { POST } = await import("@/app/api/zoom/invitees/[id]/email/route");
  return readResponse(
    await POST(jsonRequest(`http://localhost/api/zoom/invitees/${id}/email`, { method: "POST" }), {
      params: Promise.resolve({ id }),
    }),
  );
}

describe("POST /api/zoom/invitees/[id]/email", () => {
  let fixtures: Fixtures;
  let withLinkId: string;
  let noEmailId: string;
  let waitingId: string;
  let otherWardId: string;
  const joinUrl = "https://example.org/j/email-test?tk=secret";

  async function seedLink(wardId: string, label: string, url: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("zoom_join_links")
      .insert({
        ward_id: wardId,
        placeholder_name: `Guest ${label}`,
        placeholder_email: `sacrament+${label}@example.org`,
        join_url: url,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async function seedInvitee(
    wardId: string,
    displayName: string,
    email: string | null,
    joinLinkId: string | null,
  ): Promise<string> {
    const { data, error } = await fixtures.service
      .from("zoom_invitees")
      .insert({
        ward_id: wardId,
        display_name: displayName,
        email,
        join_link_id: joinLinkId,
        link_given_at: joinLinkId ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  }

  async function auditRows() {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "zoom_invitee_link_emailed");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "wardSecretary"]);
    const linkA = await seedLink(fixtures.wardAId, `e1-${fixtures.runId}`, joinUrl);
    const linkB = await seedLink(fixtures.wardAId, `e2-${fixtures.runId}`, `${joinUrl}-2`);
    const linkOther = await seedLink(fixtures.wardBId, `e3-${fixtures.runId}`, `${joinUrl}-3`);
    withLinkId = await seedInvitee(fixtures.wardAId, "Ann Lee", "ann@example.org", linkA);
    noEmailId = await seedInvitee(fixtures.wardAId, "No Email", null, linkB);
    waitingId = await seedInvitee(fixtures.wardAId, "Still Waiting", "wait@example.org", null);
    otherWardId = await seedInvitee(fixtures.wardBId, "Elsewhere", "else@example.org", linkOther);
  });

  beforeEach(() => {
    state.configured = true;
    state.refuse = false;
    state.sends = [];
  });

  afterAll(async () => {
    for (const wardId of [fixtures?.wardAId, fixtures?.wardBId]) {
      if (!wardId) continue;
      await fixtures.service.from("zoom_invitees").delete().eq("ward_id", wardId);
      await fixtures.service.from("zoom_join_links").delete().eq("ward_id", wardId);
    }
    await fixtures?.cleanup();
  });

  it("emails the link behind a button, and keeps it out of the response and the audit row", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await emailLink(withLinkId);

    expect(status).toBe(200);
    expect(body).toEqual({ sent: true });
    expect(state.sends).toHaveLength(1);
    const sent = state.sends[0]!;
    expect(sent.to).toEqual(["ann@example.org"]);
    expect(sent.subject).toContain("sacrament meeting on Zoom");
    expect(sent.html).toContain(">Watch sacrament meeting</a>");
    expect(sent.html).toContain("href=\"https://example.org/j/email-test?tk=secret\"");
    expect(sent.text).toContain(joinUrl);

    const rows = await auditRows();
    expect(rows.map((row) => row.detail)).toContainEqual({ inviteeId: withLinkId });
    expect(JSON.stringify(rows)).not.toContain("example.org");
  });

  it("refuses the ward clerk, who can see the list but not hand out links", async () => {
    await actAs(fixtures, "wardSecretary");
    expect((await emailLink(withLinkId)).status).toBe(403);
    expect(state.sends).toHaveLength(0);
  });

  it("answers 404 for somebody still waiting for a link", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await emailLink(waitingId);
    expect(status).toBe(404);
    expect(body).toEqual({ error: "They don't have a Zoom link yet." });
    expect(state.sends).toHaveLength(0);
  });

  it("answers 404 for an invitee in another ward", async () => {
    await actAs(fixtures, "bishop");
    expect((await emailLink(otherWardId)).status).toBe(404);
    expect(state.sends).toHaveLength(0);
  });

  it("answers 409 with a sentence when there is no email address on file", async () => {
    await actAs(fixtures, "bishop");
    const { status, body } = await emailLink(noEmailId);
    expect(status).toBe(409);
    expect(body).toEqual({ error: "There's no email address on file for them. Add one with Edit." });
    expect(state.sends).toHaveLength(0);
  });

  it("answers 409 and sends nothing when email is not set up", async () => {
    state.configured = false;
    await actAs(fixtures, "bishop");
    const before = (await auditRows()).length;
    const { status, body } = await emailLink(withLinkId);
    expect(status).toBe(409);
    expect((body as { error: string }).error).toContain("Email isn't set up");
    expect(state.sends).toHaveLength(0);
    expect(await auditRows()).toHaveLength(before);
  });

  it("answers 502 and writes no audit row when Resend refuses", async () => {
    state.refuse = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await actAs(fixtures, "bishop");
    const before = (await auditRows()).length;
    const { status } = await emailLink(withLinkId);
    expect(status).toBe(502);
    expect(await auditRows()).toHaveLength(before);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("ann@example.org");
    errorSpy.mockRestore();
  });
});
