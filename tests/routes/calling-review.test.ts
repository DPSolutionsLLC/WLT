// @vitest-environment node
//
// THE CALLING REVIEW AND THE OVERRIDE (ITER-058 cr2), against the hosted project as real users.
//
// /api/callings/review recomputes the review and applies only the ticked ids; every guard refuses
// only its own row (P10). /api/callings/override is the super admin's alone. Every write is
// asserted by RE-READING `ward_role_assignments` with the service client. Each negative case uses
// an actor who passes every check before the one under test, so it is refused for that reason.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OWN_CALLING_MESSAGE, lastBishopMessage } from "@/lib/callings/applyCallingReview";
import type { CallingReviewRow } from "@/lib/callings/callingReview";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { FixtureHandle } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const REVIEW_URL = "http://localhost/api/callings/review";
const OVERRIDE_URL = "http://localhost/api/callings/override";
const REMOTE_LINK = "https://example.org/remote/calling-review-3c9d";

type ApplyBody = {
  applied: Array<{ id: string; summary: string }>;
  refused: Array<{ id: string; sentence: string }>;
  stale: number;
};

async function readReview(): Promise<{ status: number; rows: CallingReviewRow[] }> {
  const { GET } = await import("@/app/api/callings/review/route");
  const { status, body } = await readResponse(await GET());
  return { status, rows: (body as { rows?: CallingReviewRow[] }).rows ?? [] };
}

async function apply(selectedIds: string[]) {
  const { POST } = await import("@/app/api/callings/review/route");
  const response = await readResponse(
    await POST(jsonRequest(REVIEW_URL, { method: "POST", body: { selectedIds } })),
  );
  return { status: response.status, body: response.body as ApplyBody };
}

async function override(method: "POST" | "DELETE", body: unknown) {
  const route = await import("@/app/api/callings/override/route");
  const handler = method === "POST" ? route.POST : route.DELETE;
  return readResponse(await handler(jsonRequest(OVERRIDE_URL, { method, body })));
}

describe("/api/callings/review and /api/callings/override", () => {
  let fixtures: Fixtures;

  const LINKED = ["bishop", "counselor1", "counselor2", "wardSecretary", "eqPresident", "wardCouncilMember"] as const;
  type Linked = (typeof LINKED)[number];

  const rosterCallings: Record<Linked, { callings: string; status?: "moved_out" }> = {
    // The bishop's record says something else, so the only thing stopping that row is the guard.
    bishop: { callings: "Ward Executive Secretary" },
    counselor1: { callings: "Bishopric Second Counselor" },
    counselor2: { callings: "Bishopric First Counselor" },
    wardSecretary: { callings: "Ward Clerk" },
    eqPresident: { callings: "Elders Quorum Secretary\nWard Mission Leader" },
    wardCouncilMember: { callings: "Ward Clerk", status: "moved_out" },
  };

  async function callingOf(handle: FixtureHandle) {
    const { data, error } = await fixtures.service
      .from("ward_role_assignments")
      .select("id, role, org_id, counselor_position, is_active, source, override_by, override_at")
      .eq("user_id", fixtures.user(handle).id)
      .eq("ward_id", fixtures.wardAId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async function rowFor(handle: FixtureHandle, kind?: CallingReviewRow["kind"]) {
    const { rows } = await readReview();
    const found = rows.find(
      (row) => row.userId === fixtures.user(handle).id && (kind === undefined || row.kind === kind),
    );
    if (!found) throw new Error(`No review row for ${handle}`);
    return found;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "counselor2",
      "wardSecretary",
      "eqPresident",
      "wardCouncilMember",
      "superAdmin",
    ]);

    for (const handle of LINKED) {
      const { data: member, error: memberError } = await fixtures.service
        .from("members")
        .insert({
          ward_id: fixtures.wardAId,
          first_name: handle,
          last_name: `Review ${fixtures.runId}`,
          birth_date: "1980-05-01",
          callings: rosterCallings[handle].callings,
          status: rosterCallings[handle].status ?? "active",
        })
        .select("id")
        .single();
      if (memberError) throw new Error(memberError.message);

      const { error: linkError } = await fixtures.service.from("user_member_links").insert({
        user_id: fixtures.user(handle).id,
        ward_id: fixtures.wardAId,
        member_id: member.id,
        status: "active",
        method: "admin",
        linked_by: fixtures.user("bishop").id,
        decided_by: fixtures.user("bishop").id,
        decided_at: new Date().toISOString(),
      });
      if (linkError) throw new Error(linkError.message);
    }
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("refuses the review to somebody who cannot manage accounts", async () => {
    await actAs(fixtures, "eqPresident");
    const { status } = await readReview();
    expect(status).toBe(403);
  });

  it("lists every disagreement, unticked, with the set-aside and unrecognised titles named", async () => {
    await actAs(fixtures, "bishop");
    const { status, rows } = await readReview();
    expect(status).toBe(200);

    const byUser = new Map(rows.map((row) => [row.userId, row]));
    expect(byUser.get(fixtures.user("counselor1").id)?.kind).toBe("change");
    expect(byUser.get(fixtures.user("counselor2").id)?.kind).toBe("change");
    expect(byUser.get(fixtures.user("bishop").id)?.kind).toBe("change");
    expect(byUser.get(fixtures.user("eqPresident").id)?.details).toContain(
      "Calling not recognised: Ward Mission Leader",
    );
    expect(byUser.get(fixtures.user("wardCouncilMember").id)?.kind).toBe("release");
    expect(byUser.has(fixtures.user("wardSecretary").id)).toBe(false);
    expect(byUser.has(fixtures.user("superAdmin").id)).toBe(false);
    expect(rows.every((row) => row.defaultSelected === false)).toBe(true);
  });

  it("puts a stream remote link on counselor 1's position for the swap to retire", async () => {
    await actAs(fixtures, "bishop");
    const { PUT } = await import("@/app/api/zoom/remote-links/[position]/route");
    const { status } = await readResponse(
      await PUT(
        jsonRequest("http://localhost/api/zoom/remote-links/counselor_1", {
          method: "PUT",
          body: { url: REMOTE_LINK },
        }),
        { params: Promise.resolve({ position: "counselor_1" }) },
      ),
    );
    expect(status).toBe(200);
  });

  it("refuses a change to your own calling and changes nothing", async () => {
    await actAs(fixtures, "counselor1");
    const own = await rowFor("counselor1");

    const { status, body } = await apply([own.id]);
    expect(status).toBe(200);
    expect(body.applied).toEqual([]);
    expect(body.refused).toEqual([{ id: own.id, sentence: OWN_CALLING_MESSAGE }]);
    expect((await callingOf("counselor1"))?.counselor_position).toBe(1);
  });

  it("counts a tick the review no longer produces as stale", async () => {
    await actAs(fixtures, "bishop");
    const { body } = await apply(["calling:00000000-0000-0000-0000-000000000000:bishop.-.-"]);
    expect(body).toEqual({ applied: [], refused: [], stale: 1 });
  });

  it("refuses moving the last bishop away while the other ticked row still applies", async () => {
    await actAs(fixtures, "counselor2");
    const bishopRow = await rowFor("bishop");
    const eqRow = await rowFor("eqPresident");

    const { body } = await apply([bishopRow.id, eqRow.id]);
    expect(body.refused).toEqual([{ id: bishopRow.id, sentence: lastBishopMessage(bishopRow.accountName) }]);
    expect(body.applied.map((entry) => entry.id)).toEqual([eqRow.id]);

    expect((await callingOf("bishop"))?.role).toBe("bishop");
    expect(await callingOf("eqPresident")).toMatchObject({
      role: "org_secretary",
      org_id: fixtures.eldersQuorumId,
      source: "roster",
    });
  });

  it("left the unticked counselor rows alone", async () => {
    expect((await callingOf("counselor1"))?.counselor_position).toBe(1);
    expect((await callingOf("counselor2"))?.counselor_position).toBe(2);
  });

  it("audits each applied change with ids and roles, and no names", async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("action, module, detail")
      .eq("user_id", fixtures.user("counselor2").id)
      .eq("action", "calling_changed_from_roster");
    if (error) throw new Error(error.message);

    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      module: "admin",
      detail: {
        rowKind: "change",
        targetUserId: fixtures.user("eqPresident").id,
        beforeRole: "org_president",
        afterRole: "org_secretary",
      },
    });
    expect(JSON.stringify(data?.[0].detail)).not.toContain(fixtures.runId);
  });

  it("swaps the two counselors and turns off the stale remote link", async () => {
    await actAs(fixtures, "bishop");
    const first = await rowFor("counselor1");
    const second = await rowFor("counselor2");

    const { body } = await apply([first.id, second.id]);
    expect(body.refused).toEqual([]);
    expect(body.applied).toHaveLength(2);

    expect(await callingOf("counselor1")).toMatchObject({ counselor_position: 2, source: "roster" });
    expect(await callingOf("counselor2")).toMatchObject({ counselor_position: 1, source: "roster" });

    const { data: link, error } = await fixtures.service
      .from("zoom_remote_links")
      .select("url, deactivated_reason")
      .eq("ward_id", fixtures.wardAId)
      .eq("position", "counselor_1")
      .maybeSingle();
    if (error) throw new Error(error.message);
    expect(link).toMatchObject({ url: null, deactivated_reason: "holder_changed" });
  });

  it("releases a moved-out member only when ticked, and sends them to /no-calling", async () => {
    await actAs(fixtures, "bishop");
    const release = await rowFor("wardCouncilMember", "release");

    const { body } = await apply([release.id]);
    expect(body.applied.map((entry) => entry.id)).toEqual([release.id]);
    expect((await callingOf("wardCouncilMember"))?.is_active).toBe(false);

    await actAs(fixtures, "wardCouncilMember");
    const { getSessionUserForPage, NoCallingError, getSessionUser } = await import("@/lib/auth/session");
    await expect(getSessionUser()).rejects.toBeInstanceOf(NoCallingError);
    await expect(getSessionUserForPage()).rejects.toMatchObject({
      digest: expect.stringContaining("/no-calling"),
    });
  });

  it("lets the released account still sign out", async () => {
    await actAs(fixtures, "wardCouncilMember");
    const { POST } = await import("@/app/api/auth/logout/route");
    const { status } = await readResponse(await POST());
    expect(status).toBe(200);
  });

  describe("the super admin's override", () => {
    it("is refused to a bishopric member", async () => {
      await actAs(fixtures, "bishop");
      const { status } = await override("POST", {
        userId: fixtures.user("wardSecretary").id,
        role: "executive_secretary",
        orgId: null,
        counselorPosition: null,
      });
      expect(status).toBe(403);
      expect((await callingOf("wardSecretary"))?.role).toBe("ward_secretary");
    });

    it("refuses a counselor with no counselor number", async () => {
      await actAs(fixtures, "superAdmin");
      const { status } = await override("POST", {
        userId: fixtures.user("wardSecretary").id,
        role: "counselor",
        orgId: null,
        counselorPosition: null,
      });
      expect(status).toBe(400);
    });

    it("sets a marked override, which the review then offers to clear", async () => {
      await actAs(fixtures, "superAdmin");
      const { status } = await override("POST", {
        userId: fixtures.user("wardSecretary").id,
        role: "executive_secretary",
        orgId: null,
        counselorPosition: null,
      });
      expect(status).toBe(200);
      expect(await callingOf("wardSecretary")).toMatchObject({
        role: "executive_secretary",
        source: "override",
        override_by: fixtures.user("superAdmin").id,
      });
      expect((await callingOf("wardSecretary"))?.override_at).not.toBeNull();

      await actAs(fixtures, "bishop");
      const row = await rowFor("wardSecretary");
      expect(row.kind).toBe("override");
      expect(row.target?.role).toBe("ward_secretary");
    });

    it("clears the override back to the ward list, which the review then proposes", async () => {
      await actAs(fixtures, "superAdmin");
      const { status } = await override("DELETE", { userId: fixtures.user("wardSecretary").id });
      expect(status).toBe(200);
      expect(await callingOf("wardSecretary")).toMatchObject({
        role: "executive_secretary",
        source: "roster",
        override_by: null,
        override_at: null,
      });

      await actAs(fixtures, "bishop");
      expect((await rowFor("wardSecretary")).kind).toBe("change");
    });

    it("audits both halves", async () => {
      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("action")
        .eq("user_id", fixtures.user("superAdmin").id)
        .in("action", ["calling_override_set", "calling_override_cleared"]);
      if (error) throw new Error(error.message);
      expect((data ?? []).map((row) => row.action).sort()).toEqual([
        "calling_override_cleared",
        "calling_override_set",
      ]);
    });
  });
});
