// @vitest-environment node
//
// PATCH /api/youth/events/[id]/participation — recording that ONE young person is not taking part
// in ONE event.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. THE THIRD STATE IS THE ABSENCE OF THE ROW. `takingPart: null` DELETES it, and the test proves
//    the row is GONE by re-reading with the service client — not that some column is null, because
//    `taking_part` is `not null` and there is no such column to read.
//
// 2. A DOUBLE PATCH WRITES ONE ROW. Migration 062d's unique index plus an upsert is what makes a
//    double tap on a slow phone — the ordinary case in this module — one row rather than a raise
//    or a doubled marker.
//
// 3. A MEMBER WHO IS NOT ON THE TEAM IS REFUSED WITH A SENTENCE. This replaces migration 061's
//    CHECK constraint, which existed because a ward-wide event had no referent for "did THEY go?".
//    A person can act on "they are not on this activity"; nobody can act on a constraint violation
//    (CLAUDE.md rule 7, and 061's own stated reason for refusing in the route first).
//
// 4. ONE PLAYER'S ANSWER TOUCHES NOBODY ELSE AT THE SAME GAME. This is what youth-j exists for and
//    what a column on `activity_events` could never do — asserted by reading back BOTH rows.
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

describe("youth activity participation route", () => {
  let fixtures: Fixtures;
  let wardId: string;

  let ethanId: string;
  let joshId: string;
  let outsiderId: string;

  let eventId: string;
  let wardWideEventId: string;
  let wardBEventId: string;

  const callPatch = async (targetEventId: string, body: unknown) => {
    const { PATCH } = await import("@/app/api/youth/events/[id]/participation/route");
    return readResponse(
      await PATCH(
        jsonRequest(`http://localhost/api/youth/events/${targetEventId}/participation`, {
          method: "PATCH",
          body,
        }),
        { params: Promise.resolve({ id: targetEventId }) },
      ),
    );
  };

  // The ground truth. `undefined` means NO ROW — which is the third state, not a null column.
  const storedAnswer = async (
    targetEventId: string,
    memberId: string,
  ): Promise<boolean | undefined> => {
    const { data, error } = await fixtures.service
      .from("activity_event_participation")
      .select("taking_part")
      .eq("event_id", targetEventId)
      .eq("member_id", memberId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data === null ? undefined : data.taking_part;
  };

  const rowCount = async (targetEventId: string, memberId: string): Promise<number> => {
    const { count } = await fixtures.service
      .from("activity_event_participation")
      .select("id", { count: "exact", head: true })
      .eq("event_id", targetEventId)
      .eq("member_id", memberId);

    return count ?? 0;
  };

  const countAuditRows = async (action: string): Promise<number> => {
    const { count } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("action", action);

    return count ?? 0;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "eqSecretary", "wardBBishop"]);
    wardId = fixtures.wardAId;

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: wardId,
          first_name: "Ethan",
          last_name: `Part${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: wardId,
          first_name: "Josh",
          last_name: `Part${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          // IN THE WARD, ON NO TEAM. The referent problem migration 061's CHECK could not express.
          ward_id: wardId,
          first_name: "Outs",
          last_name: `Part${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
      ])
      .select("id, first_name");
    if (memberError) throw new Error(memberError.message);

    ethanId = members!.find((row) => row.first_name === "Ethan")!.id;
    joshId = members!.find((row) => row.first_name === "Josh")!.id;
    outsiderId = members!.find((row) => row.first_name === "Outs")!.id;

    // ONE TEAM, TWO PLAYERS, ONE GAME — the shape the whole slice is about.
    const { data: profile, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: wardId,
        org_id: fixtures.eldersQuorumId,
        activity_name: `Team of two ${fixtures.runId}`,
        activity_type: "sport",
      })
      .select("id")
      .single();
    if (profileError) throw new Error(profileError.message);

    const { error: rosterError } = await fixtures.service.from("activity_roster").insert([
      { ward_id: wardId, profile_id: profile.id, member_id: ethanId },
      { ward_id: wardId, profile_id: profile.id, member_id: joshId },
    ]);
    if (rosterError) throw new Error(rosterError.message);

    const { data: events, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert([
        {
          ward_id: wardId,
          profile_id: profile.id,
          title: `Team game ${fixtures.runId}`,
          event_date: "2027-01-16T02:30:00.000Z",
          event_type: "home",
          status: "upcoming",
        },
        {
          // NO PROFILE — a ward-wide event, which belongs to no team and has no roster.
          ward_id: wardId,
          profile_id: null,
          title: `Ward-wide ${fixtures.runId}`,
          event_date: "2027-01-16T02:30:00.000Z",
          event_type: "home",
          status: "upcoming",
        },
      ])
      .select("id, profile_id");
    if (eventError) throw new Error(eventError.message);

    eventId = events!.find((row) => row.profile_id !== null)!.id;
    wardWideEventId = events!.find((row) => row.profile_id === null)!.id;

    const { data: wardBEvent, error: wardBError } = await fixtures.service
      .from("activity_events")
      .insert({
        ward_id: fixtures.wardBId,
        title: `Ward B game ${fixtures.runId}`,
        event_date: "2027-01-16T02:30:00.000Z",
        event_type: "home",
        status: "upcoming",
      })
      .select("id")
      .single();
    if (wardBError) throw new Error(wardBError.message);
    wardBEventId = wardBEvent.id;
  }, 180_000);

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("recording an answer", () => {
    it("starts with NO ROW — nobody has said", async () => {
      expect(await storedAnswer(eventId, ethanId)).toBeUndefined();
    });

    it("stores false and audits it", async () => {
      await actAs(fixtures, "eqPresident");

      const before = await countAuditRows("youth_activity_participation_recorded");
      const { status } = await callPatch(eventId, { memberId: ethanId, takingPart: false });

      expect(status).toBe(200);
      expect(await storedAnswer(eventId, ethanId)).toBe(false);
      expect(await countAuditRows("youth_activity_participation_recorded")).toBe(before + 1);
    });

    // ---------------------------------------------------------------------------
    // NOBODY ELSE AT THE SAME GAME IS TOUCHED
    // ---------------------------------------------------------------------------
    // The headline behaviour of youth-j. Migration 061 put this fact on the EVENT, so marking
    // Ethan out would have marked Josh out too — which is exactly the bug this slice removes.
    it("leaves the team-mate at the same game untouched", async () => {
      expect(await storedAnswer(eventId, joshId)).toBeUndefined();
    });

    // `true` IS NOT A NO-OP even though it behaves like no-row in today's arithmetic: it keeps
    // "confirmed taking part" distinguishable from "nobody has said", and it is the second way
    // back from a wrong mark.
    it("stores true", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(eventId, { memberId: joshId, takingPart: true });

      expect(status).toBe(200);
      expect(await storedAnswer(eventId, joshId)).toBe(true);
    });

    // ---------------------------------------------------------------------------
    // ONE ROW, NOT TWO — THE UPSERT ON MIGRATION 062d's UNIQUE INDEX
    // ---------------------------------------------------------------------------
    // A double tap on a slow phone is the ordinary case in this module, and it must not raise and
    // must not write a second marker.
    it("writes ONE row for a double PATCH", async () => {
      await actAs(fixtures, "eqPresident");

      await callPatch(eventId, { memberId: ethanId, takingPart: false });
      const { status } = await callPatch(eventId, { memberId: ethanId, takingPart: false });

      expect(status).toBe(200);
      expect(await rowCount(eventId, ethanId)).toBe(1);
    });
  });

  describe("clearing back to nobody-has-said", () => {
    // THE WAY BACK THAT IS NOT THE OPPOSITE CLAIM. Pressing the active answer again sends `null`,
    // and the row is DELETED — which is precisely "nobody has said" rather than "they were there",
    // a different claim nobody made (migration 060a's reversibility rule).
    it("DELETES the row and audits the clear", async () => {
      await actAs(fixtures, "eqPresident");
      await callPatch(eventId, { memberId: ethanId, takingPart: false });

      const before = await countAuditRows("youth_activity_participation_cleared");
      const { status, body } = await callPatch(eventId, {
        memberId: ethanId,
        takingPart: null,
      });

      expect(status).toBe(200);
      expect(body.takingPart).toBeNull();

      // THE ROW IS GONE. Re-read with the service client — there is no nullable column to inspect,
      // because `taking_part` is `not null` and the third state IS the absence of the row.
      expect(await storedAnswer(eventId, ethanId)).toBeUndefined();
      expect(await rowCount(eventId, ethanId)).toBe(0);
      expect(await countAuditRows("youth_activity_participation_cleared")).toBe(before + 1);
    });

    // CLEARING AN ANSWER NOBODY GAVE IS THE STATE THE CALLER WANTED, so it is a success rather
    // than a 404 — the same reading addAttendee gives its unique violation.
    it("succeeds when there was no row to clear", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(eventId, { memberId: ethanId, takingPart: null });

      expect(status).toBe(200);
      expect(await rowCount(eventId, ethanId)).toBe(0);
    });
  });

  describe("what it refuses", () => {
    // ---------------------------------------------------------------------------
    // REPLACES MIGRATION 061'S CHECK, AND ANSWERS SOMETHING THE CHECK COULD NOT
    // ---------------------------------------------------------------------------
    // 061's constraint caught "a ward-wide event has no young person". It could not catch "this
    // young person is not on this team", because there was no roster to check against. A person
    // can act on this sentence; nobody can act on a constraint violation.
    it("refuses a young person who is not on the event's team, with a sentence", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatch(eventId, {
        memberId: outsiderId,
        takingPart: false,
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("not on this activity");
      expect(await storedAnswer(eventId, outsiderId)).toBeUndefined();
    });

    it("refuses a ward-wide event, which has no team and therefore no roster", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatch(wardWideEventId, {
        memberId: ethanId,
        takingPart: false,
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("not on an activity");
      expect(await storedAnswer(wardWideEventId, ethanId)).toBeUndefined();
    });

    it("answers 404 for an event in another ward", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatch(wardBEventId, {
        memberId: ethanId,
        takingPart: false,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
    });

    // A STRING OR A NUMBER IS REFUSED RATHER THAN COERCED. `"false"` is truthy in JavaScript, so a
    // coercing schema would record the exact opposite of what the caller sent.
    it("refuses a string or a number rather than coercing it", async () => {
      await actAs(fixtures, "eqPresident");

      for (const takingPart of ["false", 0]) {
        const { status } = await callPatch(eventId, { memberId: ethanId, takingPart });
        expect(status).toBe(400);
      }

      expect(await storedAnswer(eventId, ethanId)).toBeUndefined();
    });

    it("refuses a body with no memberId", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(eventId, { takingPart: false });

      expect(status).toBe(400);
    });

    // `org_secretary` HOLDS `.view` AND `.log` BUT NOT `.manage` — checked against
    // lib/auth/permissions.ts rather than guessed. This is the same gate `Cancel` runs under,
    // which is what migration 061 required and what migration 062f preserved.
    it("refuses an org secretary with 403", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPatch(eventId, { memberId: ethanId, takingPart: false });

      expect(status).toBe(403);
      expect(await storedAnswer(eventId, ethanId)).toBeUndefined();
    });
  });
});
