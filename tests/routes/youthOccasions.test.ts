// @vitest-environment node
//
// POST and DELETE on /api/youth/events/[id]/occasion — "this is the same game as that one", and
// "no it is not".
//
// ---------------------------------------------------------------------------
// WHAT THIS SUITE IS ACTUALLY GUARDING
// ---------------------------------------------------------------------------
// 1. AN OCCASION IS CREATED ONCE AND JOINED THEREAFTER. Two rows with no occasion produce ONE new
//    occasion holding both; a third row joins the existing one and creates NOTHING. The occasion
//    count is asserted rather than the response body alone, because a second occasion holding one
//    row is invisible from the caller's side and is exactly the shape deleteOccasionIfEmpty
//    exists to prevent accumulating.
//
// 2. MERGING TWO OCCASIONS IS REFUSED, AND NEITHER ROW MOVES. Silently absorbing one into the
//    other would reassign rows nobody named, and the audit entry would record it as an ordinary
//    join. The refusal is asserted by RE-READING BOTH ROWS with the service client, not by
//    trusting the status code.
//
// 3. THE DELETE TIDIES UP. Unlinking a two-row occasion leaves ONE row, which is a link to
//    nothing, so the occasion is removed — and the surviving event is still there, with
//    `occasion_id` null. That last half is the migration 046/047 column list doing its job
//    through the route.
//
// 4. THE 403 IS FOR A ROLE THAT HOLDS `youth_activities.view` BUT NOT `.manage`. Checked against
//    lib/auth/permissions.ts rather than guessed: `org_secretary` holds `view` and `log` and NOT
//    `manage`, so `eqSecretary` is the fixture. `music_coordinator` would be the wrong test — it
//    holds none of the youth permissions and would 403 for the wrong reason.
//
// Only the client factory is mocked. Every query still runs against the hosted project as a
// genuinely authenticated user, so a passing test proves the policy allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE = "http://localhost/api/youth/events";

async function callJoin(eventId: string, body: unknown) {
  const { POST } = await import("@/app/api/youth/events/[id]/occasion/route");
  return readResponse(
    await POST(jsonRequest(`${BASE}/${eventId}/occasion`, { method: "POST", body }), {
      params: Promise.resolve({ id: eventId }),
    }),
  );
}

async function callLeave(eventId: string) {
  const { DELETE } = await import("@/app/api/youth/events/[id]/occasion/route");
  return readResponse(
    await DELETE(jsonRequest(`${BASE}/${eventId}/occasion`, { method: "DELETE" }), {
      params: Promise.resolve({ id: eventId }),
    }),
  );
}

describe("/api/youth/events/[id]/occasion", () => {
  let fixtures: Fixtures;
  let wardId: string;

  let ymProfileId: string;
  let ywProfileId: string;
  let wardBProfileId: string;

  const createdEvents: string[] = [];
  const createdOccasions: string[] = [];

  const seedEvent = async (
    title: string,
    profileId: string = ymProfileId,
    eventWardId: string = wardId,
  ): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("activity_events")
      .insert({
        ward_id: eventWardId,
        profile_id: profileId,
        title: `${title} ${fixtures.runId}`,
        event_type: "home",
        event_date: "2027-11-14T19:30:00-07:00",
        status: "upcoming",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    createdEvents.push(data.id);
    return data.id;
  };

  const storedOccasion = async (eventId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("activity_events")
      .select("occasion_id")
      .eq("id", eventId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.occasion_id ?? null;
  };

  const occasionCount = async (): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("activity_occasions")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const occasionExists = async (occasionId: string): Promise<boolean> => {
    const { data, error } = await fixtures.service
      .from("activity_occasions")
      .select("id")
      .eq("id", occasionId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data !== null;
  };

  const countAuditRows = async (action: string): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("action", action);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const latestAuditDetail = async (
    action: string,
  ): Promise<Record<string, unknown> | null> => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", wardId)
      .eq("action", action)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);
    return (data?.[0]?.detail ?? null) as Record<string, unknown> | null;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
      "wardBBishop",
    ]);
    wardId = fixtures.wardAId;

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: wardId,
          first_name: "Ada",
          last_name: `YouthA${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: fixtures.wardBId,
          first_name: "Bo",
          last_name: `YouthB${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
      ])
      .select("id, ward_id");
    if (memberError) throw new Error(memberError.message);

    const youthId = members!.find((row) => row.ward_id === wardId)!.id;
    const wardBYouthId = members!.find((row) => row.ward_id === fixtures.wardBId)!.id;

    const { data: profiles, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          member_id: youthId,
          activity_name: `EQ basketball ${fixtures.runId}`,
          activity_type: "sport",
        },
        {
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          member_id: youthId,
          activity_name: `RS basketball ${fixtures.runId}`,
          activity_type: "sport",
        },
        {
          ward_id: fixtures.wardBId,
          org_id: fixtures.wardBOrgId,
          member_id: wardBYouthId,
          activity_name: `Ward B track ${fixtures.runId}`,
          activity_type: "sport",
        },
      ])
      .select("id, activity_name");
    if (profileError) throw new Error(profileError.message);

    ymProfileId = profiles!.find((row) => row.activity_name.startsWith("EQ"))!.id;
    ywProfileId = profiles!.find((row) => row.activity_name.startsWith("RS"))!.id;
    wardBProfileId = profiles!.find((row) => row.activity_name.startsWith("Ward B"))!.id;
  }, 180_000);

  afterAll(async () => {
    if (createdEvents.length > 0) {
      await fixtures.service.from("activity_events").delete().in("id", createdEvents);
    }
    if (createdOccasions.length > 0) {
      await fixtures.service.from("activity_occasions").delete().in("id", createdOccasions);
    }
    await fixtures?.cleanup();
  });

  describe("joining", () => {
    it("creates one occasion and stamps both rows", async () => {
      const first = await seedEvent("Roosevelt one");
      const second = await seedEvent("Roosevelt two", ywProfileId);

      await actAs(fixtures, "eqPresident");
      const before = await occasionCount();

      const { status, body } = await callJoin(first, { otherEventId: second });

      expect(status).toBe(200);
      const occasionId = body.occasionId as string;
      createdOccasions.push(occasionId);

      expect(await occasionCount()).toBe(before + 1);
      expect(await storedOccasion(first)).toBe(occasionId);
      expect(await storedOccasion(second)).toBe(occasionId);

      // The occasion's rows come back with the response, so the client has the new state without
      // a second round trip.
      expect((body.events as { id: string }[]).map((event) => event.id).sort()).toEqual(
        [first, second].sort(),
      );
    });

    // NO SECOND OCCASION. A third row joins the one that exists — this is the assertion that
    // catches an implementation which creates an occasion unconditionally and then stamps.
    it("joins an existing occasion without creating a second", async () => {
      const first = await seedEvent("Jefferson one");
      const second = await seedEvent("Jefferson two", ywProfileId);
      const third = await seedEvent("Jefferson three");

      await actAs(fixtures, "eqPresident");
      const { body } = await callJoin(first, { otherEventId: second });
      const occasionId = body.occasionId as string;
      createdOccasions.push(occasionId);

      const before = await occasionCount();
      const { status, body: joined } = await callJoin(third, { otherEventId: first });

      expect(status).toBe(200);
      expect(joined.occasionId).toBe(occasionId);
      expect(await occasionCount()).toBe(before);
      expect(await storedOccasion(third)).toBe(occasionId);
    });

    it("refuses an event joined to itself", async () => {
      const only = await seedEvent("Madison alone");

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callJoin(only, { otherEventId: only });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("same game as itself");
      expect(await storedOccasion(only)).toBeNull();
    });

    it("refuses two rows already in the same occasion", async () => {
      const first = await seedEvent("Adams one");
      const second = await seedEvent("Adams two", ywProfileId);

      await actAs(fixtures, "eqPresident");
      const { body } = await callJoin(first, { otherEventId: second });
      createdOccasions.push(body.occasionId as string);

      const { status, body: again } = await callJoin(first, { otherEventId: second });

      expect(status).toBe(409);
      expect(errorMessage(again)).toContain("already recorded as the same game");
    });

    // AND NEITHER ROW MOVES. The refusal is the decision; a merge that quietly reassigned a third
    // young person's row would be recorded in the audit trail as an ordinary join.
    it("refuses two rows in different occasions and moves nothing", async () => {
      const leftA = await seedEvent("Left A");
      const leftB = await seedEvent("Left B", ywProfileId);
      const rightA = await seedEvent("Right A");
      const rightB = await seedEvent("Right B", ywProfileId);

      await actAs(fixtures, "eqPresident");
      const { body: left } = await callJoin(leftA, { otherEventId: leftB });
      const { body: right } = await callJoin(rightA, { otherEventId: rightB });
      const leftOccasion = left.occasionId as string;
      const rightOccasion = right.occasionId as string;
      createdOccasions.push(leftOccasion, rightOccasion);

      const { status, body } = await callJoin(leftA, { otherEventId: rightA });

      expect(status).toBe(409);
      // A REFUSAL THAT NAMES THE ALTERNATIVE, which is what makes it a decision rather than a
      // wall (the visits-f empty-bulk-replace precedent).
      expect(errorMessage(body)).toContain("Take one out of its game first");

      expect(await storedOccasion(leftA)).toBe(leftOccasion);
      expect(await storedOccasion(leftB)).toBe(leftOccasion);
      expect(await storedOccasion(rightA)).toBe(rightOccasion);
      expect(await storedOccasion(rightB)).toBe(rightOccasion);
    });

    // A SENTENCE, NOT A CONSTRAINT VIOLATION. The composite foreign key would otherwise report
    // its own name to somebody trying to link two games.
    it("returns 404 for an event in another ward", async () => {
      const mine = await seedEvent("Cross ward mine");
      const theirs = await seedEvent("Cross ward theirs", wardBProfileId, fixtures.wardBId);

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callJoin(mine, { otherEventId: theirs });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
      expect(await storedOccasion(mine)).toBeNull();
    });

    // `org_secretary` HOLDS `youth_activities.view` AND `.log`, AND NOT `.manage`. Checked in
    // lib/auth/permissions.ts rather than guessed — CLAUDE.md §8 warns that the intuitive answer
    // is often wrong here.
    it("refuses an org secretary, who may read but not manage", async () => {
      const first = await seedEvent("Secretary one");
      const second = await seedEvent("Secretary two", ywProfileId);

      await actAs(fixtures, "eqSecretary");
      const { status } = await callJoin(first, { otherEventId: second });

      expect(status).toBe(403);
      expect(await storedOccasion(first)).toBeNull();
      expect(await storedOccasion(second)).toBeNull();
    });

    it("refuses a body with no otherEventId", async () => {
      const only = await seedEvent("No body");

      await actAs(fixtures, "eqPresident");
      const { status } = await callJoin(only, {});

      expect(status).toBe(400);
    });

    it("writes an audit row carrying `created`", async () => {
      const first = await seedEvent("Audited one");
      const second = await seedEvent("Audited two", ywProfileId);
      const third = await seedEvent("Audited three");

      await actAs(fixtures, "eqPresident");
      const before = await countAuditRows("youth_activity_occasion_joined");

      const { body } = await callJoin(first, { otherEventId: second });
      createdOccasions.push(body.occasionId as string);

      expect(await countAuditRows("youth_activity_occasion_joined")).toBe(before + 1);
      // THE DIFFERENCE BETWEEN "STARTED A GAME" AND "ADDED TO ONE", which is the question a
      // reader has at exactly the moment they care.
      expect(await latestAuditDetail("youth_activity_occasion_joined")).toMatchObject({
        created: true,
      });

      await callJoin(third, { otherEventId: first });
      expect(await latestAuditDetail("youth_activity_occasion_joined")).toMatchObject({
        created: false,
      });
    });

    // THE CROSS-ORGANIZATION CASE, THROUGH THE ROUTE. The Relief Society president links an
    // Elders Quorum youth's event into a game — no organization check anywhere refuses it, which
    // is migration 059c's decision arriving at the API.
    it("lets one organization's president join another organization's event", async () => {
      const eqEvent = await seedEvent("Cross org EQ");
      const rsEvent = await seedEvent("Cross org RS", ywProfileId);

      await actAs(fixtures, "rsPresident");
      const { status, body } = await callJoin(rsEvent, { otherEventId: eqEvent });

      expect(status).toBe(200);
      createdOccasions.push(body.occasionId as string);
      expect(await storedOccasion(eqEvent)).toBe(body.occasionId);
    });
  });

  describe("leaving", () => {
    it("unlinks and removes an occasion left with one row", async () => {
      const first = await seedEvent("Leaving one");
      const second = await seedEvent("Leaving two", ywProfileId);

      await actAs(fixtures, "eqPresident");
      const { body } = await callJoin(first, { otherEventId: second });
      const occasionId = body.occasionId as string;
      createdOccasions.push(occasionId);

      const { status, body: left } = await callLeave(first);

      expect(status).toBe(200);
      expect(left.occasionId).toBeNull();
      expect(await storedOccasion(first)).toBeNull();

      // A ONE-ROW OCCASION IS A LINK TO NOTHING, so it goes — and the surviving event is still
      // there, unlinked rather than deleted with it. That last half is migration 059b's column
      // list on `set null` doing its job.
      expect(await occasionExists(occasionId)).toBe(false);
      expect(await storedOccasion(second)).toBeNull();

      const { data } = await fixtures.service
        .from("activity_events")
        .select("id")
        .eq("id", second)
        .maybeSingle();
      expect(data).not.toBeNull();
    });

    it("keeps an occasion that still holds two rows", async () => {
      const first = await seedEvent("Three one");
      const second = await seedEvent("Three two", ywProfileId);
      const third = await seedEvent("Three three");

      await actAs(fixtures, "eqPresident");
      const { body } = await callJoin(first, { otherEventId: second });
      const occasionId = body.occasionId as string;
      createdOccasions.push(occasionId);
      await callJoin(third, { otherEventId: first });

      const { status } = await callLeave(third);

      expect(status).toBe(200);
      expect(await occasionExists(occasionId)).toBe(true);
      expect(await storedOccasion(first)).toBe(occasionId);
      expect(await storedOccasion(second)).toBe(occasionId);
      expect(await storedOccasion(third)).toBeNull();
    });

    it("refuses an event that is not in an occasion", async () => {
      const only = await seedEvent("Alone");

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callLeave(only);

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("not part of a game with anybody else");
    });

    it("returns 404 for an event in another ward", async () => {
      const theirs = await seedEvent("Their event", wardBProfileId, fixtures.wardBId);

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callLeave(theirs);

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
    });

    it("refuses an org secretary", async () => {
      const first = await seedEvent("Secretary leaving one");
      const second = await seedEvent("Secretary leaving two", ywProfileId);

      await actAs(fixtures, "eqPresident");
      const { body } = await callJoin(first, { otherEventId: second });
      const occasionId = body.occasionId as string;
      createdOccasions.push(occasionId);

      await actAs(fixtures, "eqSecretary");
      const { status } = await callLeave(first);

      expect(status).toBe(403);
      expect(await storedOccasion(first)).toBe(occasionId);
    });

    it("writes an audit row carrying `occasionRemoved`", async () => {
      const first = await seedEvent("Audit leaving one");
      const second = await seedEvent("Audit leaving two", ywProfileId);

      await actAs(fixtures, "eqPresident");
      const { body } = await callJoin(first, { otherEventId: second });
      createdOccasions.push(body.occasionId as string);

      const before = await countAuditRows("youth_activity_occasion_left");
      const { status } = await callLeave(first);

      expect(status).toBe(200);
      expect(await countAuditRows("youth_activity_occasion_left")).toBe(before + 1);
      expect(await latestAuditDetail("youth_activity_occasion_left")).toMatchObject({
        occasionRemoved: true,
      });
    });
  });
});
