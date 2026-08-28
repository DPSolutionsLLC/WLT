// @vitest-environment node
//
// GET/POST/DELETE /api/youth/logs/[id]/private-note — and, more importantly, EVERY OTHER YOUTH
// ENDPOINT NOT CARRYING WHAT IT WRITES.
//
// ---------------------------------------------------------------------------
// THIS SUITE ASSERTS ON SERIALIZED RESPONSE BODIES, NOT ON TABLES
// ---------------------------------------------------------------------------
// That is the FOURTH of CLAUDE.md rule 5's four independent mechanisms, and the only one that
// catches a widened select AFTER somebody has changed the types to allow it. The other three —
// a separate table, a separate module, four author-only policies — are asserted by
// tests/rls/activity-private-notes.test.ts and by reading an import list.
//
// The scan is for THE STRING, the way tests/rls/public-program-anon.test.ts scans a public page,
// rather than a list of field names. A list of fields only catches the leaks somebody thought of.
//
// ---------------------------------------------------------------------------
// THERE IS NO `userId` PARAMETER ON ANY VERB, AND THERE NEVER MAY BE
// ---------------------------------------------------------------------------
// The author is always auth.uid() — in the route, in lib/youth/privateNotes.ts, and in migration
// 019's four author-only policies — so "read somebody else's note" is not a request this API can
// express. A bishop calling GET on an org president's note gets `null`, exactly as a stranger
// would, because the policy denies the ROW rather than the query.
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

const BASE_URL = "http://localhost/api/youth/logs";

// Distinctive enough that a scan for it cannot match anything the seed wrote by accident.
const PRIVATE_BODY = "PRIVATEZQX I am worried about how he took the loss.";
const SHARED_BODY = "SHAREDZQX a close game, well played.";

async function callNote(
  logId: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
) {
  const routeModule = await import("@/app/api/youth/logs/[id]/private-note/route");
  const handler =
    method === "GET"
      ? routeModule.GET
      : method === "POST"
        ? routeModule.POST
        : routeModule.DELETE;

  return readResponse(
    await handler(jsonRequest(`${BASE_URL}/${logId}/private-note`, { method, body }), {
      params: Promise.resolve({ id: logId }),
    }),
  );
}

describe("/api/youth/logs/[id]/private-note", () => {
  let fixtures: Fixtures;

  let eventId: string;
  let logId: string;

  const auditRowsFor = async (action: string) => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", action);

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "eqSecretary"]);

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        first_name: "Ada",
        last_name: `Youth${fixtures.runId}`,
        category: "youth",
        status: "active",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);

    const { data: profile, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: fixtures.wardAId,
        org_id: fixtures.eldersQuorumId,
        member_id: member.id,
        activity_name: `EQ basketball ${fixtures.runId}`,
        activity_type: "sport",
      })
      .select("id")
      .single();
    if (profileError) throw new Error(profileError.message);

    const { data: event, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert({
        ward_id: fixtures.wardAId,
        profile_id: profile.id,
        title: `EQ game ${fixtures.runId}`,
        event_type: "home",
        // PAST, so GET /api/youth/events' widened view and GET /api/youth/logs both reach it.
        event_date: "2020-02-01T19:30:00-07:00",
        status: "upcoming",
      })
      .select("id")
      .single();
    if (eventError) throw new Error(eventError.message);
    eventId = event.id;

    const { data: log, error: logError } = await fixtures.service
      .from("activity_logs")
      .insert({
        ward_id: fixtures.wardAId,
        event_id: eventId,
        logged_by: fixtures.user("eqPresident").id,
        shared_notes: SHARED_BODY,
      })
      .select("id")
      .single();
    if (logError) throw new Error(logError.message);
    logId = log.id;
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("the caller's own note", () => {
    it("is null before anything is written", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callNote(logId, "GET");

      expect(status).toBe(200);
      expect(body.note).toBeNull();
    });

    it("saves and reads back", async () => {
      await actAs(fixtures, "eqPresident");

      const saved = await callNote(logId, "POST", { notes: PRIVATE_BODY });
      expect(saved.status).toBe(200);
      expect((saved.body.note as { notes: string }).notes).toBe(PRIVATE_BODY);

      const read = await callNote(logId, "GET");
      expect((read.body.note as { notes: string }).notes).toBe(PRIVATE_BODY);
    });

    // Migration 057b's `unique (activity_log_id, user_id)` is the upsert's conflict target.
    // Without it a second save writes a second row and "the caller's note" stops being a single
    // row anybody can name.
    it("upserts rather than accumulating rows", async () => {
      await actAs(fixtures, "eqPresident");

      await callNote(logId, "POST", { notes: `${PRIVATE_BODY} (edited)` });

      const { count, error } = await fixtures.service
        .from("activity_private_notes")
        .select("id", { count: "exact", head: true })
        .eq("activity_log_id", logId)
        .eq("user_id", fixtures.user("eqPresident").id);

      if (error) throw new Error(error.message);
      expect(count).toBe(1);
    });

    it("refuses an empty note with a sentence offering the alternative", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callNote(logId, "POST", { notes: "   " });
      expect(status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // A BISHOP GETS `null`, EXACTLY AS A STRANGER WOULD
  // ---------------------------------------------------------------------------
  // Not a 403, not an error — the policy denies the ROW rather than the query, so "somebody
  // else's note" and "no note yet" are the same answer here. That is correct for the caller too:
  // neither is anything they may act on.
  describe("somebody else's note", () => {
    it("reads as null to the bishop", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callNote(logId, "GET");

      expect(status).toBe(200);
      expect(body.note).toBeNull();
    });

    it("reads as null to a colleague in the same organization", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status, body } = await callNote(logId, "GET");

      expect(status).toBe(200);
      expect(body.note).toBeNull();
    });

    // `deleted: false` covers both "there was no note" and "the note was not yours", which are
    // the same answer to this caller. The author's note must still be there afterwards.
    it("cannot be deleted by the bishop", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callNote(logId, "DELETE");

      expect(status).toBe(200);
      expect(body.deleted).toBe(false);

      const { data } = await fixtures.service
        .from("activity_private_notes")
        .select("notes")
        .eq("activity_log_id", logId)
        .eq("user_id", fixtures.user("eqPresident").id)
        .maybeSingle();

      expect(data?.notes).toContain("PRIVATEZQX");
    });
  });

  it("answers 404 for a follow-up that is not in the caller's ward", async () => {
    await actAs(fixtures, "eqPresident");

    const { status, body } = await callNote(
      "00000000-0000-4000-8000-00000000dead",
      "GET",
    );

    expect(status).toBe(404);
    expect(errorMessage(body)).toBe("That follow-up is not in your ward.");
  });

  // ---------------------------------------------------------------------------
  // THE AUDIT TRAIL RECORDS *THAT* A NOTE WAS WRITTEN AND NEVER WHAT IT SAID
  // ---------------------------------------------------------------------------
  // writeAuditLog runs redactSensitive() over `detail`, but relying on a denylist to catch a field
  // nobody added to it is not the rule — the rule is simply never to pass the text
  // (plans/retros/program-e, ITER-017). And there is NO audit row on the GET at all: logging that
  // somebody opened their own note would build the very record of private reflection this table
  // exists to avoid keeping.
  describe("the audit trail", () => {
    it("records the save with the follow-up id and nothing else", async () => {
      const rows = await auditRowsFor("youth_activity_private_note_saved");

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(JSON.stringify(row.detail)).not.toContain("PRIVATEZQX");
      }
    });

    it("writes no row at all for a read", async () => {
      expect(await auditRowsFor("youth_activity_private_note_read")).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // THE SCAN. NO OTHER YOUTH ENDPOINT CARRIES THE NOTE'S TEXT.
  // ---------------------------------------------------------------------------
  // Asserted on the SERIALIZED body of each handler, as the bishop — who can read every follow-up
  // in the ward and none of its private notes. A widened select in any of the three would show up
  // here even if the types had been changed to allow it.
  describe("no other endpoint carries the private note", () => {
    it("is absent from GET /api/youth/feed", async () => {
      await actAs(fixtures, "bishop");

      const { GET } = await import("@/app/api/youth/feed/route");
      const { status, body } = await readResponse(
        await GET(jsonRequest("http://localhost/api/youth/feed")),
      );

      expect(status).toBe(200);

      const serialized = JSON.stringify(body);
      // The premise: the bishop CAN see this follow-up's shared note. Without it the scan below
      // would pass against a feed that returned nothing at all.
      expect(serialized).toContain("SHAREDZQX");
      expect(serialized).not.toContain("PRIVATEZQX");
    });

    it("is absent from GET /api/youth/logs", async () => {
      await actAs(fixtures, "eqPresident");

      const { GET } = await import("@/app/api/youth/logs/route");
      const { status, body } = await readResponse(
        await GET(jsonRequest("http://localhost/api/youth/logs?includePast=true")),
      );

      expect(status).toBe(200);

      const serialized = JSON.stringify(body);
      // The premise: this IS the author, and their own follow-up is in the response.
      expect(serialized).toContain("SHAREDZQX");
      expect(serialized).not.toContain("PRIVATEZQX");
    });

    it("is absent from GET /api/youth/events", async () => {
      await actAs(fixtures, "bishop");

      const { GET } = await import("@/app/api/youth/events/route");
      const { status, body } = await readResponse(
        await GET(jsonRequest("http://localhost/api/youth/events?includePast=true")),
      );

      expect(status).toBe(200);
      expect(JSON.stringify(body)).not.toContain("PRIVATEZQX");
    });
  });

  describe("deleting your own note", () => {
    it("removes it and says so", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callNote(logId, "DELETE");

      expect(status).toBe(200);
      expect(body.deleted).toBe(true);

      const after = await callNote(logId, "GET");
      expect(after.body.note).toBeNull();
    });

    // The same `false` for "there was no note" as for "the note was not yours".
    it("answers false when there is nothing to delete", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callNote(logId, "DELETE");

      expect(status).toBe(200);
      expect(body.deleted).toBe(false);
    });
  });
});
