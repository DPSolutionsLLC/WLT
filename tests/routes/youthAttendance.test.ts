// @vitest-environment node
//
// POST/DELETE /api/youth/events/[id]/attend and .../assign — the two permission gates.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. TWO GATES, AND THEY ARE GENUINELY DIFFERENT. Self-adding needs `youth_activities.view`, so
//    an org secretary can do it. Asking somebody else needs the BISHOPRIC, so an org president —
//    who holds `youth_activities.manage` — cannot. Getting these the same way round is the whole
//    risk of the slice: youth-a-D1 and visits-d both shipped a control the API refused, and this
//    is the surface with three controls behind two gates.
//
// 2. A SECOND SELF-ADD IS A 200 WITH A SENTENCE, NOT A DUPLICATE ROW AND NOT A 409. Migration
//    056b's unique index makes a double tap on a slow phone — the ordinary case in this module —
//    into the state the caller wanted rather than a doubled coverage count. Both halves are
//    asserted: the status AND the row count.
//
// 3. A COUNSELOR CAN ASSIGN EXACTLY AS THE BISHOP CAN. Shared bishopric authority is a product
//    requirement (CLAUDE.md §7); never build a check that grants the bishop something a
//    counselor lacks.
//
// 4. THE NOTIFICATION REACHES THE ASSIGNEE AND NOBODY ELSE. The seeded default_roles for
//    `youth_support_assigned` reach every org president, counselor and secretary in the ward, so
//    a route that forgot `recipientUserIds` would deliver to a dozen people and still look like
//    it worked.
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

const BASE_URL = "http://localhost/api/youth/events";

async function callAttend(eventId: string, method: "POST" | "DELETE") {
  const routeModule = await import("@/app/api/youth/events/[id]/attend/route");
  const handler = method === "POST" ? routeModule.POST : routeModule.DELETE;

  return readResponse(
    await handler(jsonRequest(`${BASE_URL}/${eventId}/attend`, { method }), {
      params: Promise.resolve({ id: eventId }),
    }),
  );
}

async function callAssign(eventId: string, body: unknown) {
  const { POST } = await import("@/app/api/youth/events/[id]/assign/route");

  return readResponse(
    await POST(jsonRequest(`${BASE_URL}/${eventId}/assign`, { method: "POST", body }), {
      params: Promise.resolve({ id: eventId }),
    }),
  );
}

async function callUnassign(eventId: string, userId: string) {
  const { DELETE } = await import("@/app/api/youth/events/[id]/assign/route");
  const url = `${BASE_URL}/${eventId}/assign?userId=${encodeURIComponent(userId)}`;

  return readResponse(
    await DELETE(jsonRequest(url, { method: "DELETE" }), {
      params: Promise.resolve({ id: eventId }),
    }),
  );
}

describe("youth activity attendance", () => {
  let fixtures: Fixtures;

  let eventId: string;
  let secondEventId: string;
  let assignEventId: string;
  let wardBEventId: string;

  const createdEvents: string[] = [];

  const seedEvent = async (
    wardId: string,
    profileId: string,
    title: string,
  ): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("activity_events")
      .insert({
        ward_id: wardId,
        profile_id: profileId,
        title: `${title} ${fixtures.runId}`,
        event_type: "home",
        event_date: new Date(Date.now() + 86_400_000 * 30).toISOString(),
        status: "upcoming",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    createdEvents.push(data.id);
    return data.id;
  };

  const attendeeRows = async (
    targetEventId: string,
  ): Promise<{ user_id: string; assigned_by: string | null }[]> => {
    const { data, error } = await fixtures.service
      .from("activity_attendees")
      .select("user_id, assigned_by")
      .eq("event_id", targetEventId);

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const notificationsFor = async (
    userId: string,
  ): Promise<{ body: string | null; title: string | null }[]> => {
    const { data, error } = await fixtures.service
      .from("notifications")
      .select("title, body")
      .eq("ward_id", fixtures.wardAId)
      .eq("recipient_user_id", userId)
      .eq("trigger_key", "youth_support_assigned");

    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const auditCount = async (action: string): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId)
      .eq("action", action);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "counselor1", "eqPresident", "eqSecretary", "rsPresident", "wardBBishop"],
      {
        // The seeded default reaches every org president, counselor and secretary in the ward,
        // which is exactly what the assign route must NOT use.
        notificationTriggers: [
          {
            triggerKey: "youth_support_assigned",
            defaultRoles: ["org_president", "org_counselor", "org_secretary"],
          },
        ],
      },
    );

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: fixtures.wardAId,
          first_name: "Ada",
          last_name: `Attend${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: fixtures.wardBId,
          first_name: "Bo",
          last_name: `AttendB${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
      ])
      .select("id, ward_id");
    if (memberError) throw new Error(memberError.message);

    const { data: profiles, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert([
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.eldersQuorumId,
          member_id: members!.find((row) => row.ward_id === fixtures.wardAId)!.id,
          activity_name: `Basketball ${fixtures.runId}`,
          activity_type: "sport",
        },
        {
          ward_id: fixtures.wardBId,
          org_id: fixtures.wardBOrgId,
          member_id: members!.find((row) => row.ward_id === fixtures.wardBId)!.id,
          activity_name: `Ward B track ${fixtures.runId}`,
          activity_type: "sport",
        },
      ])
      .select("id, ward_id");
    if (profileError) throw new Error(profileError.message);

    const wardAProfile = profiles!.find((row) => row.ward_id === fixtures.wardAId)!.id;
    const wardBProfile = profiles!.find((row) => row.ward_id === fixtures.wardBId)!.id;

    // One event per case that writes, because migration 056b makes (event_id, user_id) unique and
    // a shared event would make the cases order-dependent.
    eventId = await seedEvent(fixtures.wardAId, wardAProfile, "Game one");
    secondEventId = await seedEvent(fixtures.wardAId, wardAProfile, "Game two");
    assignEventId = await seedEvent(fixtures.wardAId, wardAProfile, "Game three");
    wardBEventId = await seedEvent(fixtures.wardBId, wardBProfile, "Ward B meet");
  }, 180_000);

  afterAll(async () => {
    if (createdEvents.length > 0) {
      // The attendee rows cascade with the event (migration 009), so this is the whole cleanup.
      await fixtures.service.from("activity_events").delete().in("id", createdEvents);
    }
    await fixtures?.cleanup();
  });

  describe("putting yourself down", () => {
    it("lets an org secretary self-add and returns the row", async () => {
      // `.view`, not `.manage`. An org secretary holds the first and not the second, and is
      // exactly the sort of person who turns up to a basketball game.
      await actAs(fixtures, "eqSecretary");

      const { status, body } = await callAttend(eventId, "POST");

      expect(status).toBe(201);
      expect((body.attendee as { userId: string }).userId).toBe(
        fixtures.user("eqSecretary").id,
      );
    });

    it("records a self-add with a null assignedBy", async () => {
      // The record of HOW the row came to exist. A name there means somebody asked them, and the
      // card says which.
      const rows = await attendeeRows(eventId);
      const own = rows.find((row) => row.user_id === fixtures.user("eqSecretary").id);

      expect(own?.assigned_by).toBeNull();
    });

    it("answers a second self-add with a sentence and no second row", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status, body } = await callAttend(eventId, "POST");

      expect(status).toBe(200);
      expect(String(body.notice)).toContain("already");

      // BOTH HALVES. A 200 that still wrote a second row would double every coverage count.
      const rows = await attendeeRows(eventId);
      expect(rows.filter((row) => row.user_id === fixtures.user("eqSecretary").id)).toHaveLength(
        1,
      );
    });

    it("writes an audit row for the self-add", async () => {
      expect(await auditCount("youth_activity_attend")).toBeGreaterThan(0);
    });

    it("removes only your own row", async () => {
      await actAs(fixtures, "eqPresident");
      await callAttend(secondEventId, "POST");

      await actAs(fixtures, "eqSecretary");
      await callAttend(secondEventId, "POST");

      // The secretary comes off; the president stays.
      const { status } = await callAttend(secondEventId, "DELETE");

      expect(status).toBe(200);

      const rows = await attendeeRows(secondEventId);
      expect(rows.map((row) => row.user_id)).toEqual([fixtures.user("eqPresident").id]);
    });

    it("says so rather than reporting success when there was nothing to remove", async () => {
      // An RLS-denied or no-op DELETE is a zero-row success, not an error (CLAUDE.md §8), so the
      // route has to say so instead of claiming a change that did not happen.
      await actAs(fixtures, "rsPresident");

      const { status, body } = await callAttend(secondEventId, "DELETE");

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not down for that event");
    });

    it("answers a foreign ward's event with a sentence, not a constraint violation", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callAttend(wardBEventId, "POST");

      expect(status).toBe(404);
      expect(errorMessage(body)).toBe("That event is not in your ward.");
    });
  });

  describe("asking somebody else", () => {
    it("refuses an org president with a sentence naming the rule", async () => {
      // The gate that matters. `org_president` HOLDS `youth_activities.manage`, so a check on the
      // permission alone would let this through — which is the mistake this case exists to catch.
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callAssign(assignEventId, {
        userId: fixtures.user("rsPresident").id,
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toContain("bishopric");
      // And it says what they CAN do, rather than only what they cannot.
      expect(errorMessage(body)).toContain("add yourself");
      expect(await attendeeRows(assignEventId)).toHaveLength(0);
    });

    it("refuses an org secretary", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callAssign(assignEventId, {
        userId: fixtures.user("rsPresident").id,
      });

      // 403 either way: assertCan on `.manage` refuses first, which is what makes a ward whose
      // role_access override removed the module refuse before the role check can allow it.
      expect(status).toBe(403);
    });

    it("lets the bishop assign, recording who asked", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callAssign(assignEventId, {
        userId: fixtures.user("rsPresident").id,
      });

      expect(status).toBe(201);
      expect((body.attendee as { assignedBy: string }).assignedBy).toBe(
        fixtures.user("bishop").id,
      );
    });

    it("notifies the assignee, naming the youth, the activity and when", async () => {
      const received = await notificationsFor(fixtures.user("rsPresident").id);

      expect(received).toHaveLength(1);
      expect(received[0]?.body ?? "").toContain("Game three");
      expect(received[0]?.body ?? "").toContain("Ada");
      expect(received[0]?.body ?? "").toContain("Basketball");
    });

    it("notifies nobody else", async () => {
      // EXPLICIT RECIPIENTS, not the trigger's default_roles — which would have reached every org
      // president, counselor and secretary in the ward, including the two below.
      expect(await notificationsFor(fixtures.user("eqPresident").id)).toHaveLength(0);
      expect(await notificationsFor(fixtures.user("eqSecretary").id)).toHaveLength(0);
    });

    it("answers a second assignment of the same person with a sentence", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callAssign(assignEventId, {
        userId: fixtures.user("rsPresident").id,
      });

      expect(status).toBe(200);
      expect(String(body.notice)).toContain("already");
    });

    it("refuses a user from another ward with a sentence", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callAssign(assignEventId, {
        userId: fixtures.user("wardBBishop").id,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not an active account in your ward");
    });

    it("refuses a body with no user", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callAssign(assignEventId, {});

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("Choose who is going");
    });

    it("lets a counselor assign exactly as the bishop can", async () => {
      // Shared bishopric authority (CLAUDE.md §7).
      await actAs(fixtures, "counselor1");

      const { status } = await callAssign(assignEventId, {
        userId: fixtures.user("eqPresident").id,
      });

      expect(status).toBe(201);
    });

    it("refuses an org president withdrawing an assignment", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callUnassign(assignEventId, fixtures.user("rsPresident").id);

      expect(status).toBe(403);
      const rows = await attendeeRows(assignEventId);
      expect(rows.map((row) => row.user_id)).toContain(fixtures.user("rsPresident").id);
    });

    it("lets the bishopric withdraw one, and writes an audit row", async () => {
      await actAs(fixtures, "counselor1");

      const { status } = await callUnassign(assignEventId, fixtures.user("rsPresident").id);

      expect(status).toBe(200);

      const rows = await attendeeRows(assignEventId);
      expect(rows.map((row) => row.user_id)).not.toContain(fixtures.user("rsPresident").id);
      expect(await auditCount("youth_activity_unassigned")).toBeGreaterThan(0);
    });
  });
});
