// @vitest-environment node
//
// GET, POST, PATCH and DELETE on /api/youth/events — the games themselves.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. A FLOATING eventDate IS REJECTED WITH THE SENTENCE, not silently stored. `2026-09-04T16:00`
//    is four o'clock in no particular place; stored as an instant it becomes whatever the server's
//    zone made of it, and the game shows at the wrong hour for ever. Writing this rejection now is
//    what makes slice B's ICS timezone suite an extension rather than a rewrite — that slice
//    inherits this column and must not inherit ambiguous rows in it.
//
// 2. GET DEFAULTS TO UPCOMING AND WIDENS WITH includePast. A module whose landing page opens on
//    last season's games is a module nobody opens twice.
//
// 3. A profileId from another ward answers with a SENTENCE, not a foreign-key constraint
//    violation — the composite key would otherwise report its own name to somebody trying to add
//    a game.
//
// 4. calendar_id IS NULL ON EVERY HAND-ENTERED ROW. Slice B's idempotent re-import matches rows
//    against the calendar they came from, so a manual entry that looked like a feed's row would be
//    silently overwritten by the next import.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const EVENTS_URL = "http://localhost/api/youth/events";

type EventBody = {
  id: string;
  profileId: string | null;
  calendarId: string | null;
  title: string;
  eventType: string;
  eventDate: string;
  location: string | null;
  status: string;
  occasionId: string | null;
};

async function callGet(query = "") {
  const { GET } = await import("@/app/api/youth/events/route");
  return readResponse(await GET(jsonRequest(`${EVENTS_URL}${query}`)));
}

async function callPost(body: unknown) {
  const { POST } = await import("@/app/api/youth/events/route");
  return readResponse(await POST(jsonRequest(EVENTS_URL, { method: "POST", body })));
}

async function callPatch(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/youth/events/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${EVENTS_URL}/${id}`, { method: "PATCH", body }), {
      params: Promise.resolve({ id }),
    }),
  );
}

async function callDelete(id: string) {
  const { DELETE } = await import("@/app/api/youth/events/[id]/route");
  return readResponse(
    await DELETE(jsonRequest(`${EVENTS_URL}/${id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    }),
  );
}

// Far enough out that the suite does not start failing on a particular Tuesday in 2027, and far
// enough back that "past" is unambiguous.
function yearsFromNow(years: number): string {
  const instant = new Date();
  instant.setFullYear(instant.getFullYear() + years);
  return instant.toISOString();
}

describe("/api/youth/events", () => {
  let fixtures: Fixtures;
  let wardId: string;

  let profileId: string;
  let wardBProfileId: string;
  let pastEventId: string;
  let upcomingEventId: string;

  const created: string[] = [];
  // Occasions outlive the events that made them until afterAll, because deleting an event does
  // not delete the occasion it was in (migration 059b is `set null`, deliberately).
  const createdOccasions: string[] = [];

  const eventFrom = (body: Record<string, unknown>): EventBody => body.event as EventBody;
  const eventsFrom = (body: Record<string, unknown>): EventBody[] => body.events as EventBody[];

  const storedEvent = async (
    eventId: string,
  ): Promise<{
    event_date: string;
    status: string;
    calendar_id: string | null;
    occasion_id: string | null;
  } | null> => {
    const { data, error } = await fixtures.service
      .from("activity_events")
      .select("event_date, status, calendar_id, occasion_id")
      .eq("id", eventId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
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

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "musicCoordinator",
      "wardBBishop",
    ]);
    wardId = fixtures.wardAId;

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: wardId,
          first_name: "Ada",
          last_name: `Youth${fixtures.runId}`,
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
          activity_name: `Basketball ${fixtures.runId}`,
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
      .select("id, ward_id");
    if (profileError) throw new Error(profileError.message);

    profileId = profiles!.find((row) => row.ward_id === wardId)!.id;
    wardBProfileId = profiles!.find((row) => row.ward_id === fixtures.wardBId)!.id;

    const { data: events, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert([
        {
          ward_id: wardId,
          profile_id: profileId,
          title: `Last season ${fixtures.runId}`,
          event_type: "home",
          event_date: yearsFromNow(-2),
          // `upcoming`, not `completed`: migration 056a removed that value on the argument that
          // removed `covered` — an event in the past is completed BY THE CLOCK, and this row
          // being two years old is what makes it past. Nothing needs to say so as well.
          status: "upcoming",
        },
        {
          ward_id: wardId,
          profile_id: profileId,
          title: `Next season ${fixtures.runId}`,
          event_type: "away",
          event_date: yearsFromNow(2),
          status: "upcoming",
        },
      ])
      .select("id, title");
    if (eventError) throw new Error(eventError.message);

    pastEventId = events!.find((row) => row.title.startsWith("Last season"))!.id;
    upcomingEventId = events!.find((row) => row.title.startsWith("Next season"))!.id;
  }, 180_000);

  afterAll(async () => {
    if (created.length > 0) {
      await fixtures.service.from("activity_events").delete().in("id", created);
    }
    if (createdOccasions.length > 0) {
      await fixtures.service.from("activity_occasions").delete().in("id", createdOccasions);
    }
    await fixtures?.cleanup();
  });

  describe("reading", () => {
    it("defaults to upcoming events only", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGet();
      const ids = eventsFrom(body).map((event) => event.id);

      expect(status).toBe(200);
      expect(ids).toContain(upcomingEventId);
      expect(ids).not.toContain(pastEventId);
    });

    it("widens to past events on includePast=true", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGet("?includePast=true");
      const ids = eventsFrom(body).map((event) => event.id);

      expect(status).toBe(200);
      expect(ids).toContain(pastEventId);
      expect(ids).toContain(upcomingEventId);
    });

    it("does not widen on any other spelling", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callGet("?includePast=1");

      expect(eventsFrom(body).map((event) => event.id)).not.toContain(pastEventId);
    });

    it("orders upcoming events soonest first", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callGet("?includePast=true");
      const dates = eventsFrom(body).map((event) => new Date(event.eventDate).getTime());

      expect(dates).toEqual([...dates].sort((left, right) => left - right));
    });

    it("narrows to one activity on profileId", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGet(
        `?includePast=true&profileId=${encodeURIComponent(profileId)}`,
      );

      expect(status).toBe(200);
      expect(eventsFrom(body).every((event) => event.profileId === profileId)).toBe(true);
    });

    it("refuses a floating from bound rather than ignoring it", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGet("?from=2026-09-01T00:00");

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("time zone");
    });

    it("lets an org secretary read", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callGet();

      expect(status).toBe(200);
    });

    it("refuses a role holding none of the youth permissions", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callGet();

      expect(status).toBe(403);
    });
  });

  describe("creating", () => {
    it("stores an offset-bearing instant and defaults to tbd and upcoming", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        profileId,
        title: `Game against Lincoln ${fixtures.runId}`,
        eventDate: "2027-09-04T19:30:00-06:00",
      });

      expect(status).toBe(201);
      const event = eventFrom(body);
      created.push(event.id);

      expect(event.eventType).toBe("tbd");
      expect(event.status).toBe("upcoming");

      // The stored instant is the SAME MOMENT, whatever text form Postgres returns it in.
      const stored = await storedEvent(event.id);
      expect(new Date(stored!.event_date).getTime()).toBe(
        new Date("2027-09-04T19:30:00-06:00").getTime(),
      );
    });

    it("writes a null calendar_id on a hand-entered event", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        profileId,
        title: `Hand entered ${fixtures.runId}`,
        eventDate: "2027-10-04T19:30:00-06:00",
        eventType: "home",
      });

      expect(status).toBe(201);
      const event = eventFrom(body);
      created.push(event.id);

      expect(event.calendarId).toBeNull();
      expect((await storedEvent(event.id))!.calendar_id).toBeNull();
    });

    // THE CASE THIS SUITE IS FOR.
    it("refuses a floating eventDate with the sentence, and stores nothing", async () => {
      await actAs(fixtures, "eqPresident");
      const before = eventsFrom((await callGet("?includePast=true")).body).length;

      const { status, body } = await callPost({
        profileId,
        title: `Floating ${fixtures.runId}`,
        eventDate: "2027-09-04T16:00",
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("time zone");
      expect(eventsFrom((await callGet("?includePast=true")).body)).toHaveLength(before);
    });

    it("accepts an instant in UTC", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        profileId,
        title: `Utc ${fixtures.runId}`,
        eventDate: "2027-09-05T01:30:00Z",
      });

      expect(status).toBe(201);
      created.push(eventFrom(body).id);
    });

    // A SENTENCE, NOT A CONSTRAINT VIOLATION.
    it("returns 404 for a profile in another ward", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        profileId: wardBProfileId,
        title: `Cross ward ${fixtures.runId}`,
        eventDate: "2027-09-06T19:30:00-06:00",
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
    });

    it("refuses an org secretary, who may read but not manage", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPost({
        profileId,
        title: `Secretary ${fixtures.runId}`,
        eventDate: "2027-09-07T19:30:00-06:00",
      });

      expect(status).toBe(403);
    });

    // ---------------------------------------------------------------------------
    // ADDING A YOUNG PERSON TO A GAME THAT ALREADY EXISTS (slice G)
    // ---------------------------------------------------------------------------
    // `occasionWithEventId` names ANOTHER EVENT rather than an occasion, because when the game is
    // not yet an occasion no id exists for a client to send. The route resolves or creates it and
    // STAMPS BOTH ROWS in one request — so the two come out of it either both linked or neither,
    // which is the state a client making two calls could not guarantee.
    it("creates an occasion and stamps both rows when the source has none", async () => {
      await actAs(fixtures, "eqPresident");
      const { body: sourceBody } = await callPost({
        profileId,
        title: `Occasion source ${fixtures.runId}`,
        eventDate: "2027-09-20T19:30:00-06:00",
      });
      const sourceId = eventFrom(sourceBody).id;
      created.push(sourceId);

      expect((await storedEvent(sourceId))!.occasion_id).toBeNull();

      const { status, body } = await callPost({
        profileId,
        title: `Occasion joiner ${fixtures.runId}`,
        eventDate: "2027-09-20T19:30:00-06:00",
        occasionWithEventId: sourceId,
      });

      expect(status).toBe(201);
      const joiner = eventFrom(body);
      created.push(joiner.id);
      createdOccasions.push(joiner.occasionId as string);

      expect(joiner.occasionId).not.toBeNull();
      expect((await storedEvent(sourceId))!.occasion_id).toBe(joiner.occasionId);
    });

    it("joins the source's existing occasion rather than creating a second", async () => {
      await actAs(fixtures, "eqPresident");
      const { body: firstBody } = await callPost({
        profileId,
        title: `Existing source ${fixtures.runId}`,
        eventDate: "2027-09-21T19:30:00-06:00",
      });
      const sourceId = eventFrom(firstBody).id;
      created.push(sourceId);

      const { body: secondBody } = await callPost({
        profileId,
        title: `Existing joiner ${fixtures.runId}`,
        eventDate: "2027-09-21T19:30:00-06:00",
        occasionWithEventId: sourceId,
      });
      const occasionId = eventFrom(secondBody).occasionId as string;
      created.push(eventFrom(secondBody).id);
      createdOccasions.push(occasionId);

      const { status, body: thirdBody } = await callPost({
        profileId,
        title: `Existing third ${fixtures.runId}`,
        eventDate: "2027-09-21T19:30:00-06:00",
        occasionWithEventId: sourceId,
      });

      expect(status).toBe(201);
      created.push(eventFrom(thirdBody).id);
      expect(eventFrom(thirdBody).occasionId).toBe(occasionId);
    });

    // A SENTENCE, AND NO ROW WRITTEN. Resolving before the insert is what turns the composite
    // foreign key's constraint violation into something a person can act on.
    it("returns 404 for a source event in another ward and creates nothing", async () => {
      const { data: theirs } = await fixtures.service
        .from("activity_events")
        .insert({
          ward_id: fixtures.wardBId,
          profile_id: wardBProfileId,
          title: `Ward B source ${fixtures.runId}`,
          event_type: "home",
          event_date: yearsFromNow(2),
        })
        .select("id")
        .single();

      await actAs(fixtures, "eqPresident");
      const before = eventsFrom((await callGet("?includePast=true")).body).length;

      const { status, body } = await callPost({
        profileId,
        title: `Cross ward occasion ${fixtures.runId}`,
        eventDate: "2027-09-22T19:30:00-06:00",
        occasionWithEventId: theirs!.id,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
      expect(eventsFrom((await callGet("?includePast=true")).body)).toHaveLength(before);

      await fixtures.service.from("activity_events").delete().eq("id", theirs!.id);
    });

    // ---------------------------------------------------------------------------
    // `away` IS ALWAYS A HUMAN'S WORD, AND IT IS NOT COPIED ACROSS AN OCCASION
    // ---------------------------------------------------------------------------
    // The source row is hand-corrected to `away` with a location matching no venue on the ward's
    // list. The new row must be classified from ITS OWN location and come out `tbd`, which
    // renders "Home or away?" and asks somebody. Copying the source's `away` would silently
    // remove the new young person from the coverage model — an away game carries no coverage
    // expectation by design — and nothing anywhere would say so (youth-c). This pins the rule
    // against exactly the shortcut a later reader would take.
    it("classifies the new row from its own location rather than copying the source", async () => {
      await actAs(fixtures, "eqPresident");
      const { body: sourceBody } = await callPost({
        profileId,
        title: `Away source ${fixtures.runId}`,
        eventDate: "2027-09-23T19:30:00-06:00",
        location: `Nowhere anybody listed ${fixtures.runId}`,
        eventType: "away",
      });
      const source = eventFrom(sourceBody);
      created.push(source.id);
      expect(source.eventType).toBe("away");

      const { status, body } = await callPost({
        profileId,
        title: `Away joiner ${fixtures.runId}`,
        eventDate: "2027-09-23T19:30:00-06:00",
        location: `Nowhere anybody listed ${fixtures.runId}`,
        occasionWithEventId: source.id,
      });

      expect(status).toBe(201);
      const joiner = eventFrom(body);
      created.push(joiner.id);
      createdOccasions.push(joiner.occasionId as string);

      expect(joiner.eventType).toBe("tbd");
      expect(joiner.occasionId).toBe((await storedEvent(source.id))!.occasion_id);
    });

    it("refuses an org secretary from adding a young person to a game", async () => {
      await actAs(fixtures, "eqPresident");
      const { body: sourceBody } = await callPost({
        profileId,
        title: `Gate source ${fixtures.runId}`,
        eventDate: "2027-09-24T19:30:00-06:00",
      });
      const sourceId = eventFrom(sourceBody).id;
      created.push(sourceId);

      await actAs(fixtures, "eqSecretary");
      const { status } = await callPost({
        profileId,
        title: `Gate joiner ${fixtures.runId}`,
        eventDate: "2027-09-24T19:30:00-06:00",
        occasionWithEventId: sourceId,
      });

      expect(status).toBe(403);
      expect((await storedEvent(sourceId))!.occasion_id).toBeNull();
    });

    it("writes an audit row", async () => {
      const before = await countAuditRows("youth_activity_event_created");

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callPost({
        profileId,
        title: `Audited ${fixtures.runId}`,
        eventDate: "2027-09-08T19:30:00-06:00",
      });

      expect(status).toBe(201);
      created.push(eventFrom(body).id);

      expect(await countAuditRows("youth_activity_event_created")).toBe(before + 1);
    });
  });

  describe("updating", () => {
    let editableId: string;

    beforeAll(async () => {
      await actAs(fixtures, "eqPresident");
      const { body } = await callPost({
        profileId,
        title: `Editable ${fixtures.runId}`,
        eventDate: "2027-11-14T19:30:00-07:00",
      });
      editableId = eventFrom(body).id;
      created.push(editableId);
    });

    // CANCELLING IS AN UPDATE. The row stays, marked, because the record that a game was ever
    // scheduled is what answers "why did nobody go?" (migration 054c).
    it("cancels an event without removing it", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(editableId, { status: "cancelled" });

      expect(status).toBe(200);
      expect((await storedEvent(editableId))!.status).toBe("cancelled");
    });

    it("keeps a cancelled event in the upcoming list", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callGet();

      expect(eventsFrom(body).map((event) => event.id)).toContain(editableId);
    });

    it("un-cancels through the same control", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(editableId, { status: "upcoming" });

      expect(status).toBe(200);
      expect((await storedEvent(editableId))!.status).toBe("upcoming");
    });

    // THE DOUBLE-CONVERSION BUG, ASSERTED ACROSS THE WIRE: saving the same instant twice must
    // leave the same moment, not one shifted by the offset each time.
    it("does not shift the instant when the same value is saved twice", async () => {
      await actAs(fixtures, "eqPresident");
      const instant = "2027-11-20T19:30:00-07:00";

      await callPatch(editableId, { eventDate: instant });
      const first = (await storedEvent(editableId))!.event_date;

      await callPatch(editableId, { eventDate: instant });
      const second = (await storedEvent(editableId))!.event_date;

      expect(new Date(second).getTime()).toBe(new Date(first).getTime());
      expect(new Date(second).getTime()).toBe(new Date(instant).getTime());
    });

    it("refuses a floating eventDate on a patch", async () => {
      await actAs(fixtures, "eqPresident");
      const before = (await storedEvent(editableId))!.event_date;

      const { status } = await callPatch(editableId, { eventDate: "2027-11-21T19:30" });

      expect(status).toBe(400);
      expect((await storedEvent(editableId))!.event_date).toBe(before);
    });

    it("refuses a removed status value", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(editableId, { status: "covered" });

      expect(status).toBe(400);
    });

    it("refuses an empty patch with a sentence", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatch(editableId, {});

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Nothing was changed.");
    });

    it("returns 404 for an event in another ward", async () => {
      await actAs(fixtures, "eqPresident");

      const { data } = await fixtures.service
        .from("activity_events")
        .insert({
          ward_id: fixtures.wardBId,
          profile_id: wardBProfileId,
          title: `Ward B event ${fixtures.runId}`,
          event_type: "home",
          event_date: yearsFromNow(2),
        })
        .select("id")
        .single();

      const { status, body } = await callPatch(data!.id, { title: "Anything" });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");

      await fixtures.service.from("activity_events").delete().eq("id", data!.id);
    });

    it("writes an audit row on a successful update", async () => {
      const before = await countAuditRows("youth_activity_event_updated");

      await actAs(fixtures, "eqPresident");
      const { status } = await callPatch(editableId, { location: `Gym ${fixtures.runId}` });

      expect(status).toBe(200);
      expect(await countAuditRows("youth_activity_event_updated")).toBe(before + 1);
    });
  });

  describe("deleting", () => {
    it("removes an event and audits it", async () => {
      await actAs(fixtures, "eqPresident");
      const { body } = await callPost({
        profileId,
        title: `Removable ${fixtures.runId}`,
        eventDate: "2027-12-01T19:30:00-07:00",
      });
      const eventId = eventFrom(body).id;

      const before = await countAuditRows("youth_activity_event_deleted");
      const { status } = await callDelete(eventId);

      expect(status).toBe(200);
      expect(await storedEvent(eventId)).toBeNull();
      expect(await countAuditRows("youth_activity_event_deleted")).toBe(before + 1);
    });

    it("refuses an org secretary", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callDelete(upcomingEventId);

      expect(status).toBe(403);
      expect(await storedEvent(upcomingEventId)).not.toBeNull();
    });
  });

  // Deleting a profile takes its events with it, and that is correct: a game has no meaning
  // without the season it belongs to. Asserted here rather than in the profile suite because the
  // EVENT is what disappears.
  describe("deleting a profile cascades to its events", () => {
    it("removes the events with it", async () => {
      await actAs(fixtures, "eqPresident");

      const { body: profileBody } = await readResponse(
        await (await import("@/app/api/youth/profiles/route")).POST(
          jsonRequest("http://localhost/api/youth/profiles", {
            method: "POST",
            body: {
              memberId: (
                await fixtures.service
                  .from("youth_activity_profiles")
                  .select("member_id")
                  .eq("id", profileId)
                  .single()
              ).data!.member_id,
              activityName: `Cascade ${fixtures.runId}`,
              activityType: "sport",
            },
          }),
        ),
      );
      const cascadeProfileId = (profileBody.profile as { id: string }).id;

      const { body: eventBody } = await callPost({
        profileId: cascadeProfileId,
        title: `Cascade game ${fixtures.runId}`,
        eventDate: "2027-12-05T19:30:00-07:00",
      });
      const cascadeEventId = eventFrom(eventBody).id;

      const { DELETE: DELETE_PROFILE } = await import("@/app/api/youth/profiles/[id]/route");
      const { status } = await readResponse(
        await DELETE_PROFILE(
          jsonRequest(`http://localhost/api/youth/profiles/${cascadeProfileId}`, {
            method: "DELETE",
          }),
          { params: Promise.resolve({ id: cascadeProfileId }) },
        ),
      );

      expect(status).toBe(200);
      expect(await storedEvent(cascadeEventId)).toBeNull();
    });
  });
});
