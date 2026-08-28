// @vitest-environment node
//
// POST and PATCH /api/reports/read-status.
//
// ---------------------------------------------------------------------------
// THE ASSERTION THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// `report_id` carries NO FOREIGN KEY — migration 008 says integrity is the application's job —
// so the route resolves every report through its owning module's query before writing a row. Skip
// that and a caller can probe for the existence of another organization's logs by watching which
// ids are accepted, which is a leak the read-status table's own policies cannot close: those
// policies are about the reader's rows, not about the report.
//
// The refusal is the SAME answer for "no such report" and "that report is not yours". Two
// distinguishable answers would be exactly the oracle the check exists to remove.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const URL_BASE = "http://localhost/api/reports/read-status";

async function post(body: unknown) {
  const { POST } = await import("@/app/api/reports/read-status/route");
  return readResponse(await POST(jsonRequest(URL_BASE, { method: "POST", body })));
}

async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/reports/read-status/route");
  return readResponse(await PATCH(jsonRequest(URL_BASE, { method: "PATCH", body })));
}

describe("/api/reports/read-status", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let eqLogId: string;
  let eqUnreadLogId: string;
  let rsLogId: string;
  let activityLogId: string;
  let otherOrgActivityLogId: string;

  const rowsFor = async (userId: string, reportId: string) => {
    const { data, error } = await fixtures.service
      .from("report_read_status")
      .select("id, read_at, flagged")
      .eq("user_id", userId)
      .eq("report_id", reportId);

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  beforeAll(async () => {
    // `wardCouncilMember` is here for the cross-module refusal below. Checked against
    // lib/auth/permissions.ts rather than assumed (CLAUDE.md §8): they hold
    // `youth_activities.view` and NOT `visits.view`, and no role in the matrix holds visits.view
    // WITHOUT youth_activities.view — so this is the direction the refusal is testable in.
    fixtures = await seedFixtures([
      "eqPresident",
      "rsPresident",
      "wardCouncilMember",
      "wardBEqPresident",
    ]);
    wardId = fixtures.wardAId;

    const { data: logs, error: logError } = await fixtures.service
      .from("visit_logs")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          recorded_by: fixtures.user("eqPresident").id,
          visit_date: "2026-04-05",
          visit_type: "in_home",
          shared_notes: "EQ shared: brought a meal round.",
        },
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          recorded_by: fixtures.user("eqPresident").id,
          visit_date: "2026-04-19",
          visit_type: "in_home",
          shared_notes: "EQ shared: helped with a move.",
        },
        {
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          recorded_by: fixtures.user("rsPresident").id,
          visit_date: "2026-04-12",
          visit_type: "in_home",
          shared_notes: "RS shared: sister is recovering well.",
        },
      ])
      .select("id, org_id, visit_date");
    if (logError) throw new Error(logError.message);

    eqLogId = logs.find((row) => row.visit_date === "2026-04-05")!.id;
    // Left untouched by every test above the bookmark one, so "bookmarked but not read" is a
    // state this suite can actually reach.
    eqUnreadLogId = logs.find((row) => row.visit_date === "2026-04-19")!.id;
    rsLogId = logs.find((row) => row.org_id === fixtures.reliefSocietyId)!.id;

    // ---------------------------------------------------------------------
    // Phase 8's half, AND IT NOW GOES THROUGH A NARROWED POLICY
    // ---------------------------------------------------------------------
    // `REPORT_MODULES.youth_activity` has existed since visits-c and was never exercised against
    // anything but a ward-wide select. Migration 057c replaced that with
    // `is_bishopric() or logged_by = auth.uid() or activity_event_is_in_caller_org(event_id) or
    // ward_allows_cross_org_visibility()`, so the entry's whole purpose — "does this report exist
    // and may this caller see it?" — is only now a question with two answers.
    //
    // Two follow-ups are seeded to ask both. The first hangs off a WARD-WIDE activity
    // (`org_id` null) and is authored by the ward council member, who has no organization at all;
    // the second belongs to the Relief Society and is authored by its president. A follow-up needs
    // an event as of migration 057a, and an event needs an activity, and an activity needs a
    // youth.
    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: wardId,
        first_name: "Ada",
        last_name: `Youth${fixtures.runId}`,
        category: "youth",
        status: "active",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);

    const { data: profiles, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert([
        {
          ward_id: wardId,
          org_id: null,
          member_id: member.id,
          activity_name: `Ward-wide debate ${fixtures.runId}`,
          activity_type: "academic",
        },
        {
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          member_id: member.id,
          activity_name: `RS choir ${fixtures.runId}`,
          activity_type: "performance",
        },
      ])
      .select("id, org_id");
    if (profileError) throw new Error(profileError.message);

    const wardWideProfileId = profiles.find((row) => row.org_id === null)!.id;
    const rsProfileId = profiles.find((row) => row.org_id !== null)!.id;

    const { data: events, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert([
        {
          ward_id: wardId,
          profile_id: wardWideProfileId,
          title: `Debate final ${fixtures.runId}`,
          event_type: "home",
          event_date: "2026-04-05T19:00:00-07:00",
          status: "upcoming",
        },
        {
          ward_id: wardId,
          profile_id: rsProfileId,
          title: `Spring concert ${fixtures.runId}`,
          event_type: "home",
          event_date: "2026-04-12T19:00:00-07:00",
          status: "upcoming",
        },
      ])
      .select("id, profile_id");
    if (eventError) throw new Error(eventError.message);

    const { data: activities, error: activityError } = await fixtures.service
      .from("activity_logs")
      .insert([
        {
          ward_id: wardId,
          event_id: events.find((row) => row.profile_id === wardWideProfileId)!.id,
          logged_by: fixtures.user("wardCouncilMember").id,
          shared_notes: "Activity shared: the whole class turned up.",
        },
        {
          ward_id: wardId,
          event_id: events.find((row) => row.profile_id === rsProfileId)!.id,
          logged_by: fixtures.user("rsPresident").id,
          shared_notes: "RS shared: the choir sang beautifully.",
        },
      ])
      .select("id, logged_by");
    if (activityError) throw new Error(activityError.message);

    activityLogId = activities.find(
      (row) => row.logged_by === fixtures.user("wardCouncilMember").id,
    )!.id;
    otherOrgActivityLogId = activities.find(
      (row) => row.logged_by === fixtures.user("rsPresident").id,
    )!.id;
  }, 60_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("POST", () => {
    it("marks a report read", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await post({
        reportType: "visit_log",
        reportId: eqLogId,
        read: true,
      });

      expect(status).toBe(200);
      expect(body.readStatus).toMatchObject({ reportId: eqLogId, isRead: true });
    });

    // The unique index is what makes a double tap safe. Without it the second call writes a
    // second row and "have I read this?" has two answers.
    it("is idempotent — the same report twice is one row and no error", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await post({
        reportType: "visit_log",
        reportId: eqLogId,
        read: true,
      });

      expect(status).toBe(200);
      expect(await rowsFor(fixtures.user("eqPresident").id, eqLogId)).toHaveLength(1);
    });

    // Two upserts against one row, and neither clears the other's column.
    it("keeps a bookmark when the report is later marked read", async () => {
      await actAs(fixtures, "rsPresident");

      await post({ reportType: "visit_log", reportId: rsLogId, bookmarked: true });
      const { body } = await post({
        reportType: "visit_log",
        reportId: rsLogId,
        read: true,
      });

      expect(body.readStatus).toMatchObject({ isRead: true, bookmarked: true });
    });

    // `read_at` is absent from the bookmark upsert's payload for exactly this reason: bookmarking
    // a report you have not opened must not claim you have opened it.
    it("bookmarks without claiming the report has been read", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await post({
        reportType: "visit_log",
        reportId: eqUnreadLogId,
        bookmarked: true,
      });

      expect(status).toBe(200);
      expect(body.readStatus).toMatchObject({ bookmarked: true, isRead: false });
    });

    // The probe this route exists to close. Cross-org visibility is off for the fixture ward, so
    // the RS log is invisible to the EQ president — and the answer must not distinguish that from
    // an id that does not exist.
    it("refuses a report the caller cannot see, and says nothing about why", async () => {
      await actAs(fixtures, "eqPresident");

      const refused = await post({
        reportType: "visit_log",
        reportId: rsLogId,
        read: true,
      });

      const missing = await post({
        reportType: "visit_log",
        reportId: "00000000-0000-4000-8000-0000000000ff",
        read: true,
      });

      expect(refused.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(errorMessage(refused.body)).toBe(errorMessage(missing.body));

      // And nothing was written for the refused one.
      expect(await rowsFor(fixtures.user("eqPresident").id, rsLogId)).toHaveLength(0);
    });

    it("refuses a report in another ward", async () => {
      await actAs(fixtures, "wardBEqPresident");

      const { status } = await post({
        reportType: "visit_log",
        reportId: eqLogId,
        read: true,
      });

      expect(status).toBe(404);
    });

    // The permission is the OWNING MODULE'S. A ward council member holds youth_activities.view
    // and not visits.view, so they may mark an activity read and never a visit.
    it("refuses a visit report to a caller who holds only the youth permission", async () => {
      await actAs(fixtures, "wardCouncilMember");

      const visit = await post({
        reportType: "visit_log",
        reportId: eqLogId,
        read: true,
      });

      expect(visit.status).toBe(403);

      const activity = await post({
        reportType: "youth_activity",
        reportId: activityLogId,
        read: true,
      });

      expect(activity.status).toBe(200);
    });

    // ---------------------------------------------------------------------
    // MIGRATION 057c's NARROWING, SEEN THROUGH THIS ROUTE
    // ---------------------------------------------------------------------
    // The ward council member holds `youth_activities.view` and has NO organization, so the
    // Relief Society's follow-up is not theirs to read — and `getActivityLog` returns null for it
    // through the caller's own session client, which is what turns the policy into the SAME 404
    // the visits half gives. Not a 403: two distinguishable answers would be the oracle this
    // suite's header says the check exists to remove.
    //
    // Before 057 this returned 200. That is the assertion the entry was written for and never had.
    it("refuses a follow-up the caller's organization does not own", async () => {
      await actAs(fixtures, "wardCouncilMember");

      const { status, body } = await post({
        reportType: "youth_activity",
        reportId: otherOrgActivityLogId,
        read: true,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toBe("That report is not available to you.");

      // Nothing was written. A refusal that still left a row would mean the caller had marked
      // read a report they cannot see.
      expect(
        await rowsFor(fixtures.user("wardCouncilMember").id, otherOrgActivityLogId),
      ).toEqual([]);
    });

    // A 400 from Zod, not a 500 from migration 008's CHECK constraint reporting the server's own
    // fault for the caller's bad input.
    it("refuses an unknown reportType with a 400", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await post({
        reportType: "sacrament_assignment",
        reportId: eqLogId,
        read: true,
      });

      expect(status).toBe(400);
    });

    it("refuses a body that changes neither field", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await post({ reportType: "visit_log", reportId: eqLogId });

      expect(status).toBe(400);
    });
  });

  describe("PATCH", () => {
    it("marks every named report read in one call", async () => {
      await actAs(fixtures, "rsPresident");

      const { status, body } = await patch({
        reportType: "visit_log",
        reportIds: [rsLogId],
      });

      expect(status).toBe(200);
      expect(body.markedCount).toBe(1);
    });

    // Refused WHOLE, not partially honoured. A caller who slips one unreadable id into an
    // otherwise valid array gets nothing written at all.
    it("refuses the whole batch when one id is not visible to the caller", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await patch({
        reportType: "visit_log",
        reportIds: [eqLogId, rsLogId],
      });

      expect(status).toBe(404);
      expect(await rowsFor(fixtures.user("eqPresident").id, rsLogId)).toHaveLength(0);
    });

    it("refuses an empty list rather than reporting a no-op as a success", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await patch({ reportType: "visit_log", reportIds: [] });

      expect(status).toBe(400);
    });

    it("refuses a caller without the owning module's permission", async () => {
      await actAs(fixtures, "wardCouncilMember");

      const { status } = await patch({
        reportType: "visit_log",
        reportIds: [eqLogId],
      });

      expect(status).toBe(403);
    });
  });
});
