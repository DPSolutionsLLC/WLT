// @vitest-environment node
//
// POST /api/issue-reports.
//
// ---------------------------------------------------------------------------
// THE ASSERTION THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// `role` AND `calling_id` COME FROM THE SESSION, NEVER FROM THE BODY. That is the entire feature:
// a report carries where the person was and what they were acting as, so nobody reconstructs it
// from a text message a day later. A body-supplied role would make the tag a CLAIM rather than a
// FACT, and a report tagged with the wrong calling is worse than one tagged with none.
//
// So the happy path files a report AS AN ORG PRESIDENT while the body claims to be a bishop, and
// the row is read back with the SERVICE client — because the author deliberately cannot read it
// (migration 076b), which is also why lib/issues/writeIssueReport.ts never uses a RETURNING
// clause. tests/rls/issue-reports.test.ts pins that trap at the table.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const REPORTS_URL = "http://localhost/api/issue-reports";

async function postReport(body: unknown) {
  const { POST } = await import("@/app/api/issue-reports/route");
  return readResponse(await POST(jsonRequest(REPORTS_URL, { body })));
}

describe("POST /api/issue-reports", () => {
  let fixtures: Fixtures;
  let service: SupabaseClient;
  const created: string[] = [];

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident"]);
    service = createServiceSupabaseClient();
  });

  afterAll(async () => {
    if (created.length > 0) {
      await service.from("issue_reports").delete().in("id", created);
    }
    await fixtures?.cleanup();
  });

  it("writes the row, tagged with the page the reporter was on", async () => {
    await actAs(fixtures, "eqPresident");

    const { status, body } = await postReport({
      body: "The support percentage is an em dash and I expected a number.",
      pagePath: "/youth/profiles",
    });

    expect(status).toBe(201);

    const report = body.report as { id: string; pagePath: string };
    created.push(report.id);
    expect(report.pagePath).toBe("/youth/profiles");

    const { data } = await service
      .from("issue_reports")
      .select("ward_id, reported_by, page_path, role, calling_id, body")
      .eq("id", report.id)
      .single();

    expect(data?.ward_id).toBe(fixtures.wardAId);
    expect(data?.reported_by).toBe(fixtures.user("eqPresident").id);
    expect(data?.page_path).toBe("/youth/profiles");
    expect(data?.body).toMatch(/em dash/);
    // The calling, from the session — this is what P12's review screen reads to say which
    // organization the reporter was acting for.
    expect(data?.calling_id).toBeTruthy();
  });

  // THE HEADLINE ASSERTION.
  it("takes the role from the session and ignores one supplied in the body", async () => {
    await actAs(fixtures, "eqPresident");

    const { status, body } = await postReport({
      body: "Claiming to be the bishop on purpose.",
      pagePath: "/visits",
      role: "bishop",
      callingId: "00000000-0000-4000-8000-0000000000ff",
      wardId: "00000000-0000-4000-8000-0000000000fe",
      reportedBy: "00000000-0000-4000-8000-0000000000fd",
    });

    expect(status).toBe(201);

    const report = body.report as { id: string };
    created.push(report.id);

    const { data } = await service
      .from("issue_reports")
      .select("ward_id, reported_by, role")
      .eq("id", report.id)
      .single();

    expect(data?.role).toBe("org_president");
    expect(data?.ward_id).toBe(fixtures.wardAId);
    expect(data?.reported_by).toBe(fixtures.user("eqPresident").id);
  });

  it("refuses an empty report with a sentence", async () => {
    await actAs(fixtures, "eqPresident");

    const { status, body } = await postReport({ body: "   ", pagePath: "/visits" });

    expect(status).toBe(400);
    expect(errorMessage(body)).toMatch(/Say what went wrong/);
  });

  it("refuses a page path that is not a path in this app", async () => {
    await actAs(fixtures, "eqPresident");

    const { status } = await postReport({
      body: "Somewhere else entirely.",
      pagePath: "//evil.example.com/visits",
    });

    expect(status).toBe(400);
  });

  it("refuses a body with no page path at all", async () => {
    await actAs(fixtures, "eqPresident");

    const { status } = await postReport({ body: "No page." });

    expect(status).toBe(400);
  });

  // There is no `issues.*` permission and there must not be one — reporting a bug is not a
  // ward-configurable privilege. So a bishop and an org president are equally able to file.
  it("lets the bishop file one too", async () => {
    await actAs(fixtures, "bishop");

    const { status, body } = await postReport({
      body: "The overdue count on the visits page looks wrong.",
      pagePath: "/visits",
    });

    expect(status).toBe(201);
    created.push((body.report as { id: string }).id);
  });

  it("writes an audit row for the submission", async () => {
    await actAs(fixtures, "eqPresident");

    const { body } = await postReport({
      body: "Audited on purpose.",
      pagePath: "/youth",
    });

    const report = body.report as { id: string };
    created.push(report.id);

    const { data } = await service
      .from("audit_log")
      .select("action, module, detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "issue_reported")
      .order("created_at", { ascending: false })
      .limit(1);

    expect(data?.[0]?.module).toBe("admin");
    expect((data?.[0]?.detail as { issueReportId?: string })?.issueReportId).toBe(report.id);
  });
});
