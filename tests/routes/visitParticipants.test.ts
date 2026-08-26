// @vitest-environment node
//
// Who went, at the ROUTE layer — and the two rules nothing below the route enforces.
//
// ---------------------------------------------------------------------------
// THE FIVE-COMPANION LIMIT HAS NO DATABASE BEHIND IT
// ---------------------------------------------------------------------------
// A CHECK constraint cannot count rows in another table, and this repo deliberately has no
// triggers (migration 027 Part 3). So the route is the ONLY keeper of the rule, exactly as it is
// for `sunday_org_conducting`. A refusal is therefore asserted AND PROVEN BY RE-READING THE
// TABLE: a 400 with six rows written behind it looks identical from the response body, and it is
// the shape a limit takes the day it stops working.
//
// ---------------------------------------------------------------------------
// ABSENT AND EMPTY ARE DIFFERENT ANSWERS
// ---------------------------------------------------------------------------
// No `participants` key means "I went". An empty array means "nobody is recorded as having
// gone" — a secretary typing up a visit they did not make and does not know the companions for.
// Collapsing the two would re-create the ambiguity this slice exists to remove, so both are
// asserted separately.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked —
// only the client factory, so every query below still runs as a genuinely authenticated user
// against the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import { MAX_VISIT_COMPANIONS, MAX_VISIT_PARTICIPANTS } from "@/lib/validation/visit";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const COMPANION_LABEL_PREFIX = "COMPANION-";

async function callPostVisit(body: unknown) {
  const { POST } = await import("@/app/api/visits/route");
  return readResponse(
    await POST(jsonRequest("http://localhost/api/visits", { method: "POST", body })),
  );
}

async function callPatchVisit(visitId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/visits/[id]/route");
  const request = jsonRequest(`http://localhost/api/visits/${visitId}`, {
    method: "PATCH",
    body,
  });
  return readResponse(await PATCH(request, { params: Promise.resolve({ id: visitId }) }));
}

async function callGetVisits(url: string) {
  const { GET } = await import("@/app/api/visits/route");
  return readResponse(await GET(jsonRequest(url)));
}

describe("visit participants at the route layer", () => {
  let fixtures: Fixtures;
  let wardId: string;
  let householdId: string;
  let memberId: string;

  const participantsOf = async (visitLogId: string) => {
    const { data, error } = await fixtures.service
      .from("visit_participants")
      .select("id, org_id, user_id, member_id, label")
      .eq("visit_log_id", visitLogId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const recordedByOf = async (visitLogId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("visit_logs")
      .select("recorded_by")
      .eq("id", visitLogId)
      .single();

    if (error) throw new Error(error.message);
    return data.recorded_by;
  };

  const visitIdFrom = (body: Record<string, unknown>): string =>
    (body.visit as { id: string }).id;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "eqSecretary", "wardBEqPresident"]);
    wardId = fixtures.wardAId;

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: wardId, family_name: "Participants Family" })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);
    householdId = household.id;

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: wardId,
        household_id: householdId,
        first_name: "Ruth",
        last_name: "Participants",
        status: "active",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);
    memberId = member.id;
  }, 60_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("POST /api/visits — the default", () => {
    it("records the caller when no participants key is sent at all", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-05",
        visitType: "in_home",
      });

      expect(status).toBe(201);

      const participants = await participantsOf(visitIdFrom(body));

      expect(participants).toHaveLength(1);
      expect(participants[0]?.user_id).toBe(fixtures.user("eqPresident").id);
      expect(participants[0]?.member_id).toBeNull();
      expect(participants[0]?.label).toBeNull();
    });

    // The other half of the same rule, and the reason `participants` is not given a Zod default.
    it("records NOBODY when an empty participants array is sent", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status, body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-06",
        visitType: "in_home",
        participants: [],
      });

      expect(status).toBe(201);
      expect(await participantsOf(visitIdFrom(body))).toHaveLength(0);
    });

    it("takes all three kinds on one visit", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-07",
        visitType: "in_home",
        participants: [
          { kind: "user", userId: fixtures.user("eqSecretary").id },
          { kind: "member", memberId },
          { kind: "label", label: "A neighbour" },
        ],
      });

      expect(status).toBe(201);

      const participants = await participantsOf(visitIdFrom(body));

      expect(participants).toHaveLength(3);
      expect(participants.map((row) => row.user_id).filter(Boolean)).toEqual([
        fixtures.user("eqSecretary").id,
      ]);
      expect(participants.map((row) => row.member_id).filter(Boolean)).toEqual([memberId]);
      expect(participants.map((row) => row.label).filter(Boolean)).toEqual(["A neighbour"]);
    });

    // Denormalized from the VISIT, never from the request — that is what lets migration 046's
    // SELECT policy be a column comparison rather than a subquery per row.
    it("stamps every participant's org from the visit", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-08",
        visitType: "in_home",
        participants: [{ kind: "label", label: "Stamped from the visit" }],
      });

      const participants = await participantsOf(visitIdFrom(body));

      expect(participants[0]?.org_id).toBe(fixtures.eldersQuorumId);
    });
  });

  describe("POST /api/visits — the recorder", () => {
    // The stamp is the boundary. A request that could name its own recorder could put a visit in
    // somebody else's name — so the field is not on the schema at all, and a body carrying one is
    // stripped rather than honoured.
    it("stamps recorded_by from the session even when the body tries to set it", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status, body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-09",
        visitType: "in_home",
        recordedBy: fixtures.user("bishop").id,
        recorded_by: fixtures.user("bishop").id,
        visitedBy: fixtures.user("bishop").id,
      });

      expect(status).toBe(201);
      expect(await recordedByOf(visitIdFrom(body))).toBe(fixtures.user("eqSecretary").id);
    });

    // The recorder is not automatically a participant when a list is supplied. This is the state
    // the whole slice exists for: the secretary typed it, the president went.
    it("keeps the recorder off the participant list when they are not on it", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status, body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-10",
        visitType: "in_home",
        participants: [{ kind: "user", userId: fixtures.user("eqPresident").id }],
      });

      expect(status).toBe(201);

      const visitId = visitIdFrom(body);
      const participants = await participantsOf(visitId);

      expect(participants).toHaveLength(1);
      expect(participants[0]?.user_id).toBe(fixtures.user("eqPresident").id);
      expect(await recordedByOf(visitId)).toBe(fixtures.user("eqSecretary").id);
    });
  });

  describe("POST /api/visits — the cap", () => {
    // SIX is the recorder plus five companions, and it is allowed.
    it("accepts six participants", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-11",
        visitType: "in_home",
        participants: Array.from({ length: MAX_VISIT_PARTICIPANTS }, (_, index) => ({
          kind: "label",
          label: `${COMPANION_LABEL_PREFIX}${index}`,
        })),
      });

      expect(status).toBe(201);
      expect(await participantsOf(visitIdFrom(body))).toHaveLength(MAX_VISIT_PARTICIPANTS);
    });

    // A seventh is refused with a SENTENCE naming the limit, and — the assertion that matters —
    // NOTHING IS WRITTEN. The database would happily take all seven.
    it("refuses a seventh and writes no visit at all", async () => {
      await actAs(fixtures, "eqPresident");

      const { data: before, error: beforeError } = await fixtures.service
        .from("visit_logs")
        .select("id")
        .eq("ward_id", wardId)
        .eq("visit_date", "2026-04-12");
      if (beforeError) throw new Error(beforeError.message);

      const { status, body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-12",
        visitType: "in_home",
        participants: Array.from({ length: MAX_VISIT_PARTICIPANTS + 1 }, (_, index) => ({
          kind: "label",
          label: `${COMPANION_LABEL_PREFIX}TOO-MANY-${index}`,
        })),
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain(String(MAX_VISIT_COMPANIONS));

      const { data: after, error: afterError } = await fixtures.service
        .from("visit_logs")
        .select("id")
        .eq("ward_id", wardId)
        .eq("visit_date", "2026-04-12");
      if (afterError) throw new Error(afterError.message);

      expect(after ?? []).toHaveLength((before ?? []).length);

      // And no orphan participant rows carrying the refused labels.
      const { data: orphans, error: orphanError } = await fixtures.service
        .from("visit_participants")
        .select("id")
        .eq("ward_id", wardId)
        .like("label", `${COMPANION_LABEL_PREFIX}TOO-MANY-%`);
      if (orphanError) throw new Error(orphanError.message);

      expect(orphans ?? []).toHaveLength(0);
    });
  });

  describe("POST /api/visits — participants that are not real", () => {
    // A user from another ward. The composite foreign key would refuse it with a constraint
    // violation, which is a 500 reporting the server's own fault for the caller's bad id — so the
    // failure must not be a 500, and nothing may be written.
    it("refuses a leader from another ward and writes nothing", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPostVisit({
        householdId,
        visitDate: "2026-04-13",
        visitType: "in_home",
        participants: [{ kind: "user", userId: fixtures.user("wardBEqPresident").id }],
      });

      expect(status).toBeGreaterThanOrEqual(400);

      const { data: rows, error } = await fixtures.service
        .from("visit_participants")
        .select("id")
        .eq("ward_id", wardId)
        .eq("user_id", fixtures.user("wardBEqPresident").id);
      if (error) throw new Error(error.message);

      expect(rows ?? []).toHaveLength(0);
    });

    it("refuses the same leader twice in one request", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPostVisit({
        householdId,
        visitDate: "2026-04-14",
        visitType: "in_home",
        participants: [
          { kind: "user", userId: fixtures.user("eqPresident").id },
          { kind: "user", userId: fixtures.user("eqPresident").id },
        ],
      });

      expect(status).toBe(400);
    });

    it("refuses a participant carrying no identity", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPostVisit({
        householdId,
        visitDate: "2026-04-15",
        visitType: "in_home",
        participants: [{ kind: "label", label: "   " }],
      });

      expect(status).toBe(400);
    });
  });

  describe("PATCH /api/visits/[id] — editing who went", () => {
    it("replaces the list rather than appending to it", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-16",
        visitType: "in_home",
        participants: [{ kind: "label", label: "The first companion" }],
      });
      const visitId = visitIdFrom(body);

      const { status } = await callPatchVisit(visitId, {
        participants: [{ kind: "label", label: "The second companion" }],
      });

      expect(status).toBe(200);

      const participants = await participantsOf(visitId);

      expect(participants).toHaveLength(1);
      expect(participants[0]?.label).toBe("The second companion");
    });

    it("can clear the list to nobody", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-17",
        visitType: "in_home",
      });
      const visitId = visitIdFrom(body);

      expect(await participantsOf(visitId)).toHaveLength(1);

      const { status } = await callPatchVisit(visitId, { participants: [] });

      expect(status).toBe(200);
      expect(await participantsOf(visitId)).toHaveLength(0);
    });

    it("refuses a seventh on edit and leaves the existing list alone", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-18",
        visitType: "in_home",
        participants: [{ kind: "label", label: "Still here afterwards" }],
      });
      const visitId = visitIdFrom(body);

      const { status } = await callPatchVisit(visitId, {
        participants: Array.from({ length: MAX_VISIT_PARTICIPANTS + 1 }, (_, index) => ({
          kind: "label",
          label: `${COMPANION_LABEL_PREFIX}EDIT-${index}`,
        })),
      });

      expect(status).toBe(400);

      const participants = await participantsOf(visitId);

      expect(participants).toHaveLength(1);
      expect(participants[0]?.label).toBe("Still here afterwards");
    });

    it("edits the outcome", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callPostVisit({
        householdId,
        visitDate: "2026-04-19",
        visitType: "in_home",
      });
      const visitId = visitIdFrom(body);

      const { status, body: patched } = await callPatchVisit(visitId, {
        outcome: "attempted",
      });

      expect(status).toBe(200);
      expect((patched.visit as { outcome: string }).outcome).toBe("attempted");
    });
  });

  describe("GET /api/visits", () => {
    it("carries the participants and both roles, and still no private note", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGetVisits(
        `http://localhost/api/visits?householdId=${householdId}`,
      );

      expect(status).toBe(200);

      const visits = body.visits as Array<{
        recordedBy: string | null;
        recordedByName: string | null;
        conductedByLabel: string | null;
        participants: unknown[];
        outcome: string;
        arrangement: string;
      }>;

      expect(visits.length).toBeGreaterThan(0);
      expect(visits.every((visit) => Array.isArray(visit.participants))).toBe(true);
      expect(visits.every((visit) => typeof visit.outcome === "string")).toBe(true);

      // The whole point of splitting the column: a visit reads "nobody went" rather than
      // crediting whoever typed it in.
      const nobodyWent = visits.filter((visit) => visit.participants.length === 0);
      expect(nobodyWent.every((visit) => visit.conductedByLabel === null)).toBe(true);
      expect(nobodyWent.some((visit) => visit.recordedByName !== null)).toBe(true);

      // Structural, unchanged from visits-a: no key anywhere in the payload mentions "private".
      expect(JSON.stringify(body)).not.toMatch(/"[^"]*private[^"]*"\s*:/i);
    });
  });

  describe("the audit trail", () => {
    // COUNTS, NEVER NAMES. An audit row is bishopric-readable and a companion is not its
    // subject — a person's movements should not be recorded in a log they cannot read.
    it("records participantCount and no participant name", async () => {
      await actAs(fixtures, "eqPresident");

      const distinctive = "AUDIT-SHOULD-NEVER-CARRY-THIS-NAME";

      const { status } = await callPostVisit({
        householdId,
        visitDate: "2026-04-20",
        visitType: "in_home",
        participants: [
          { kind: "user", userId: fixtures.user("eqPresident").id },
          { kind: "label", label: distinctive },
        ],
      });
      expect(status).toBe(201);

      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("action, detail")
        .eq("ward_id", wardId)
        .eq("action", "visit_logged");

      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);

      // Asserted on the STRING, so a rename of the field does not retire the check.
      expect(JSON.stringify(data)).not.toContain(distinctive);
      expect(JSON.stringify(data)).toContain("participantCount");
    });
  });
});
