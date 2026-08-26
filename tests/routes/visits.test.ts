// @vitest-environment node
//
// The visit routes, and above all the notes boundary AT THE ROUTE LAYER.
//
// tests/rls/private-notes.test.ts already proves the policy half: the bishop cannot SELECT a
// counselor's private note. This suite proves the half that did not exist — that no response
// body any of these handlers builds carries one, whoever is asking. Both halves are needed,
// because a widened `select` in lib/visits/queries.ts would pass the RLS suite untouched while
// serving the note to its own author's colleagues through a list endpoint.
//
// The `private-notes-not-in-list` assertions are made against the SERIALIZED JSON on purpose.
// A structural check on a field name survives only until somebody renames the field;
// `JSON.stringify(body)` does not contain the text, whatever it is called.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked —
// only the client factory, so every query below still runs as a genuinely authenticated user
// against the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const FLAG_TRIGGER = "visit_flagged_for_ward_council";

const COUNSELOR_PRIVATE = "PRIVATE-COUNSELOR-a confidence nobody else may read";
const EQ_PRIVATE = "PRIVATE-EQ-a confidence nobody else may read";
const EQ_SHARED = "SHARED-EQ-brought a meal round";

async function callGetVisits(url: string) {
  const { GET } = await import("@/app/api/visits/route");
  return readResponse(await GET(jsonRequest(url)));
}

async function callPatchVisit(visitId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/visits/[id]/route");
  const request = jsonRequest(`http://localhost/api/visits/${visitId}`, {
    method: "PATCH",
    body,
  });
  return readResponse(await PATCH(request, { params: Promise.resolve({ id: visitId }) }));
}

async function callGetPrivateNote(visitId: string) {
  const { GET } = await import("@/app/api/visits/[id]/private-note/route");
  const request = jsonRequest(`http://localhost/api/visits/${visitId}/private-note`);
  return readResponse(await GET(request, { params: Promise.resolve({ id: visitId }) }));
}

async function callPostPrivateNote(visitId: string, body: unknown) {
  const { POST } = await import("@/app/api/visits/[id]/private-note/route");
  const request = jsonRequest(`http://localhost/api/visits/${visitId}/private-note`, {
    method: "POST",
    body,
  });
  return readResponse(await POST(request, { params: Promise.resolve({ id: visitId }) }));
}

async function callPostVisitGoal(body: unknown) {
  const { POST } = await import("@/app/api/visit-goals/route");
  return readResponse(
    await POST(jsonRequest("http://localhost/api/visit-goals", { method: "POST", body })),
  );
}

async function callGetVisitGoals() {
  const { GET } = await import("@/app/api/visit-goals/route");
  return readResponse(await GET());
}

describe("visit routes", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let eqLogId: string;
  let householdId: string;

  const notificationsFor = async (userId: string) => {
    const { data, error } = await fixtures.service
      .from("notifications")
      .select("id, title, body, recipient_user_id, created_at")
      .eq("ward_id", wardId)
      .eq("trigger_key", FLAG_TRIGGER)
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const flagSentAtOf = async (visitId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("visit_logs")
      .select("flag_sent_at")
      .eq("id", visitId)
      .single();

    if (error) throw new Error(error.message);
    return data.flag_sent_at;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "counselor1", "eqPresident", "eqSecretary", "executiveSecretary"],
      {
        // Seeded explicitly, with the roles migration 045 corrected the hosted rows to. A stale
        // array here would make this suite disagree with the app it is testing.
        notificationTriggers: [
          { triggerKey: FLAG_TRIGGER, defaultRoles: ["executive_secretary"] },
        ],
      },
    );
    wardId = fixtures.wardAId;

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: wardId, family_name: "Test Family" })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);
    householdId = household.id;

    const { data: log, error: logError } = await fixtures.service
      .from("visit_logs")
      .insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        household_id: householdId,
        visited_by: fixtures.user("eqPresident").id,
        visit_date: "2026-04-05",
        visit_type: "in_home",
        shared_notes: EQ_SHARED,
      })
      .select("id")
      .single();
    if (logError) throw new Error(logError.message);
    eqLogId = log.id;

    // Two private notes on the SAME visit, by two different authors. That is the shape that makes
    // "each sees their own and only their own" a real assertion rather than a coincidence — and
    // it is only expressible because migration 044's unique constraint is per (log, author).
    const counselor = await asRole(fixtures, "counselor1");
    const { error: counselorNoteError } = await counselor
      .from("visit_private_notes")
      .insert({
        ward_id: wardId,
        visit_log_id: eqLogId,
        user_id: fixtures.user("counselor1").id,
        notes: COUNSELOR_PRIVATE,
      });
    if (counselorNoteError) throw new Error(counselorNoteError.message);

    const eqPresident = await asRole(fixtures, "eqPresident");
    const { error: eqNoteError } = await eqPresident.from("visit_private_notes").insert({
      ward_id: wardId,
      visit_log_id: eqLogId,
      user_id: fixtures.user("eqPresident").id,
      notes: EQ_PRIVATE,
    });
    if (eqNoteError) throw new Error(eqNoteError.message);
  }, 60_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  // -------------------------------------------------------------------------
  // private-notes-absolute, at the route layer
  // -------------------------------------------------------------------------
  describe("GET /api/visits/[id]/private-note", () => {
    it("gives the bishop null for a counselor's note", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await callGetPrivateNote(eqLogId);

      expect(status).toBe(200);
      expect(body.note).toBeNull();
      expect(JSON.stringify(body)).not.toContain(COUNSELOR_PRIVATE);
      expect(JSON.stringify(body)).not.toContain(EQ_PRIVATE);
    });

    it("gives the org president their own note and not the counselor's", async () => {
      await actAs(fixtures, "eqPresident");
      const { status, body } = await callGetPrivateNote(eqLogId);

      expect(status).toBe(200);
      expect((body.note as { notes: string }).notes).toBe(EQ_PRIVATE);
      expect(JSON.stringify(body)).not.toContain(COUNSELOR_PRIVATE);
    });

    it("gives the counselor their own note and not the president's", async () => {
      await actAs(fixtures, "counselor1");
      const { status, body } = await callGetPrivateNote(eqLogId);

      expect(status).toBe(200);
      expect((body.note as { notes: string }).notes).toBe(COUNSELOR_PRIVATE);
      expect(JSON.stringify(body)).not.toContain(EQ_PRIVATE);
    });

    it("returns 404 rather than 403 for a visit the caller cannot see", async () => {
      await actAs(fixtures, "eqPresident");
      const { status } = await callGetPrivateNote("11111111-1111-4111-8111-111111111111");

      expect(status).toBe(404);
    });

    // The upsert. Saving twice leaves ONE note, which is what migration 044's unique
    // (visit_log_id, user_id) constraint buys — without it the author accumulates duplicates and
    // "the caller's note" stops being a single row anybody can name.
    it("upserts rather than duplicating the caller's note", async () => {
      await actAs(fixtures, "eqPresident");

      const first = await callPostPrivateNote(eqLogId, { notes: EQ_PRIVATE });
      expect(first.status).toBe(200);

      const second = await callPostPrivateNote(eqLogId, { notes: `${EQ_PRIVATE} (edited)` });
      expect(second.status).toBe(200);

      const { data, error } = await fixtures.service
        .from("visit_private_notes")
        .select("id, notes")
        .eq("visit_log_id", eqLogId)
        .eq("user_id", fixtures.user("eqPresident").id);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.notes).toBe(`${EQ_PRIVATE} (edited)`);
    });

    it("refuses an empty note", async () => {
      await actAs(fixtures, "eqPresident");
      const { status } = await callPostPrivateNote(eqLogId, { notes: "   " });

      expect(status).toBe(400);
    });

    // The audit trail records THAT a note was written and never what it said.
    it("writes an audit row carrying the visit id and no note text", async () => {
      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("action, detail")
        .eq("ward_id", wardId)
        .eq("action", "visit_private_note_saved");

      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
      expect(JSON.stringify(data)).not.toContain(EQ_PRIVATE);
      expect(JSON.stringify(data)).not.toContain(COUNSELOR_PRIVATE);
    });
  });

  // -------------------------------------------------------------------------
  // private-notes-not-in-list
  // -------------------------------------------------------------------------
  describe("GET /api/visits", () => {
    it.each(["bishop", "eqPresident", "counselor1"] as const)(
      "carries no private note in the list for %s",
      async (handle) => {
        await actAs(fixtures, handle);
        const { status, body } = await callGetVisits("http://localhost/api/visits");

        expect(status).toBe(200);

        const serialized = JSON.stringify(body);

        // Asserted on the STRING. This survives a refactor that renames the field, which a
        // structural check on `visit.privateNotes` would not.
        expect(serialized).not.toContain(COUNSELOR_PRIVATE);
        expect(serialized).not.toContain(EQ_PRIVATE);

        // …and structurally too: no key anywhere in the payload mentions "private".
        expect(serialized).not.toMatch(/"[^"]*private[^"]*"\s*:/i);
      },
    );

    it("still carries the shared notes", async () => {
      await actAs(fixtures, "eqPresident");
      const { body } = await callGetVisits("http://localhost/api/visits");

      expect(JSON.stringify(body)).toContain(EQ_SHARED);
    });

    it("ignores nothing — an unparseable filter is a 400, not a silent pass", async () => {
      await actAs(fixtures, "eqPresident");
      const { status } = await callGetVisits("http://localhost/api/visits?orgId=not-a-uuid");

      expect(status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // flag-notification
  // -------------------------------------------------------------------------
  describe("PATCH /api/visits/[id] — the ward council flag", () => {
    const executiveSecretaryId = () => fixtures.user("executiveSecretary").id;

    it("notifies the executive secretary exactly once, with the one-liner only", async () => {
      await actAs(fixtures, "eqPresident");
      const { status, body } = await callPatchVisit(eqLogId, { flaggedForWardCouncil: true });

      expect(status).toBe(200);
      expect((body.visit as { flaggedForWardCouncil: boolean }).flaggedForWardCouncil).toBe(true);

      const notifications = await notificationsFor(executiveSecretaryId());

      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.body).toBe(
        "Elders Quorum — Test Family — requested for ward council discussion",
      );

      // The whole point of the one-liner. The recipient holds no visits.view permission, so
      // anything else in this body would be a leak with no policy standing behind it.
      expect(notifications[0]?.body).not.toContain(EQ_SHARED);
      expect(notifications[0]?.body).not.toContain(EQ_PRIVATE);
      expect(notifications[0]?.body).not.toContain(COUNSELOR_PRIVATE);
    });

    it("tells nobody else", async () => {
      expect(await notificationsFor(fixtures.user("bishop").id)).toHaveLength(0);
      expect(await notificationsFor(fixtures.user("counselor1").id)).toHaveLength(0);
    });

    it("does not notify again when the same visit is flagged twice", async () => {
      const before = await flagSentAtOf(eqLogId);

      await actAs(fixtures, "eqPresident");
      const { status } = await callPatchVisit(eqLogId, { flaggedForWardCouncil: true });

      expect(status).toBe(200);
      expect(await notificationsFor(executiveSecretaryId())).toHaveLength(1);
      expect(await flagSentAtOf(eqLogId)).toBe(before);
    });

    it("clears flag_sent_at on unflag", async () => {
      await actAs(fixtures, "eqPresident");
      const { status } = await callPatchVisit(eqLogId, { flaggedForWardCouncil: false });

      expect(status).toBe(200);
      expect(await flagSentAtOf(eqLogId)).toBeNull();
      expect(await notificationsFor(executiveSecretaryId())).toHaveLength(1);
    });

    // Clearing flag_sent_at on unflag is exactly what makes a genuine re-raise reach somebody.
    it("notifies again on a genuine re-raise", async () => {
      await actAs(fixtures, "eqPresident");
      const { status } = await callPatchVisit(eqLogId, { flaggedForWardCouncil: true });

      expect(status).toBe(200);
      expect(await notificationsFor(executiveSecretaryId())).toHaveLength(2);
      expect(await flagSentAtOf(eqLogId)).not.toBeNull();
    });

    it("sends nothing when only the shared notes change", async () => {
      await actAs(fixtures, "eqPresident");
      const { status } = await callPatchVisit(eqLogId, { sharedNotes: `${EQ_SHARED} (edited)` });

      expect(status).toBe(200);
      expect(await notificationsFor(executiveSecretaryId())).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Permission paths. Checked against lib/auth/permissions.ts, which is not always the
  // intuitive answer — an org SECRETARY logs visits and does not configure goals.
  // -------------------------------------------------------------------------
  describe("permissions", () => {
    it("lets an org secretary read the visit goals", async () => {
      await actAs(fixtures, "eqSecretary");
      const { status } = await callGetVisitGoals();

      expect(status).toBe(200);
    });

    it("refuses an org secretary creating a visit goal", async () => {
      await actAs(fixtures, "eqSecretary");
      const { status, body } = await callPostVisitGoal({
        title: "Should not be created",
        targetType: "all_households",
        cadence: "annual",
        goalPeriodStart: "2026-01-01",
        goalPeriodEnd: "2026-12-31",
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toContain("permission");
    });

    it("lets an org secretary log a visit — they hold visits.create", async () => {
      await actAs(fixtures, "eqSecretary");
      const { POST } = await import("@/app/api/visits/route");
      const { status } = await readResponse(
        await POST(
          jsonRequest("http://localhost/api/visits", {
            method: "POST",
            body: {
              householdId,
              visitDate: "2026-04-06",
              visitType: "in_home",
              sharedNotes: "Logged by the secretary.",
            },
          }),
        ),
      );

      expect(status).toBe(201);
    });

    it("lets an org president create a goal for their own organization", async () => {
      await actAs(fixtures, "eqPresident");
      const { status, body } = await callPostVisitGoal({
        title: "EQ visits this year",
        targetType: "all_households",
        cadence: "annual",
        goalPeriodStart: "2026-01-01",
        goalPeriodEnd: "2026-12-31",
      });

      expect(status).toBe(201);
      expect((body.goal as { orgId: string }).orgId).toBe(fixtures.eldersQuorumId);
    });

    // The stamp is the boundary. A body that could name its own owner could write a goal onto
    // another organization's board.
    it("refuses an org president naming another organization", async () => {
      await actAs(fixtures, "eqPresident");
      const { status } = await callPostVisitGoal({
        title: "RS visits, written by EQ",
        orgId: fixtures.reliefSocietyId,
        targetType: "all_households",
        cadence: "annual",
        goalPeriodStart: "2026-01-01",
        goalPeriodEnd: "2026-12-31",
      });

      expect(status).toBe(403);
    });

    it("makes the bishopric say which organization a goal is for", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await callPostVisitGoal({
        title: "Ward-level goal with no owner",
        targetType: "all_households",
        cadence: "annual",
        goalPeriodStart: "2026-01-01",
        goalPeriodEnd: "2026-12-31",
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("organization");
    });

    it("lets the bishop create a goal for any organization in the ward", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await callPostVisitGoal({
        title: "RS visits this year",
        orgId: fixtures.reliefSocietyId,
        targetType: "all_households",
        cadence: "annual",
        goalPeriodStart: "2026-01-01",
        goalPeriodEnd: "2026-12-31",
      });

      expect(status).toBe(201);
      expect((body.goal as { orgId: string }).orgId).toBe(fixtures.reliefSocietyId);
    });

    it("refuses an organization from another ward", async () => {
      await actAs(fixtures, "bishop");
      const { status } = await callPostVisitGoal({
        title: "Cross-ward goal",
        orgId: fixtures.wardBOrgId,
        targetType: "all_households",
        cadence: "annual",
        goalPeriodStart: "2026-01-01",
        goalPeriodEnd: "2026-12-31",
      });

      expect(status).toBe(404);
    });
  });
});
