// @vitest-environment node
//
// POST and DELETE /api/hymns/select, and POST /api/musical-numbers.
//
// The route's assertCan() and migration 043's policy are two boundaries over the same decision,
// and this suite exercises the first while the second is genuinely live: only the client factory
// is mocked, so every query still runs against the hosted project as an authenticated user
// (tests/helpers/routeClient.ts). A 200 here means the policy allowed it too.
//
// CHECK THE FIXTURE'S REAL PERMISSIONS BEFORE ASSERTING A 403. `music_coordinator` holds
// music.manage; `org_president` does not; `ward_secretary` holds music.view but NOT music.manage
// — the matrix in lib/auth/permissions.ts is the source of truth and it is not always the
// intuitive answer.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is
// deleted in afterAll and nothing assumes an empty table.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

describe("hymn selection routes", () => {
  let fixtures: Fixtures;
  let sundayId = "";
  let noMeetingSundayId = "";

  async function selectionFor(hymnType: string) {
    const { data, error } = await fixtures.service
      .from("hymn_selections")
      .select("hymn_number, hymn_title, ai_suggested, selected_by")
      .eq("ward_id", fixtures.wardAId)
      .eq("sunday_id", sundayId)
      .eq("hymn_type", hymnType);

    if (error) throw new Error(`Could not re-read the selection: ${error.message}`);
    return data ?? [];
  }

  async function postSelect(body: unknown) {
    const { POST } = await import("@/app/api/hymns/select/route");
    return readResponse(
      await POST(jsonRequest("http://localhost/api/hymns/select", { method: "POST", body })),
    );
  }

  async function deleteSelect(body: unknown) {
    const { DELETE } = await import("@/app/api/hymns/select/route");
    return readResponse(
      await DELETE(
        jsonRequest("http://localhost/api/hymns/select", { method: "DELETE", body }),
      ),
    );
  }

  async function postMusicalNumber(body: unknown) {
    const { POST } = await import("@/app/api/musical-numbers/route");
    return readResponse(
      await POST(
        jsonRequest("http://localhost/api/musical-numbers", { method: "POST", body }),
      ),
    );
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "musicCoordinator",
      "eqPresident",
      "eqSecretary",
    ]);

    const seedSunday = async (date: string, type: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: fixtures.wardAId, date, type, speaking_slots: 2 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    sundayId = await seedSunday("2027-10-03", "standard");
    // stake_conference holds no sacrament meeting (NO_MEETING_SUNDAY_TYPES in types/domain.ts).
    noMeetingSundayId = await seedSunday("2027-10-10", "stake_conference");
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("who may save a hymn", () => {
    it("lets a music coordinator save one", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await postSelect({
        sundayId,
        hymnType: "opening",
        hymnNumber: 19,
        hymnTitle: "We Thank Thee, O God, for a Prophet",
      });

      expect(status).toBe(200);

      const rows = await selectionFor("opening");
      expect(rows).toHaveLength(1);
      expect(rows[0].hymn_number).toBe(19);
    });

    it("refuses an org president", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await postSelect({
        sundayId,
        hymnType: "closing",
        hymnNumber: 152,
        hymnTitle: "God Be with You Till We Meet Again",
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).not.toBe("");
      // The refusal is a refusal, not a write that reported one.
      expect(await selectionFor("closing")).toHaveLength(0);
    });

    it("lets the bishopric save one too", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await postSelect({
        sundayId,
        hymnType: "closing",
        hymnNumber: 152,
        hymnTitle: "God Be with You Till We Meet Again",
      });

      expect(status).toBe(200);
    });
  });

  describe("a Sunday with no sacrament meeting", () => {
    it("answers 422 rather than storing a hymn nobody will sing", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status, body } = await postSelect({
        sundayId: noMeetingSundayId,
        hymnType: "opening",
        hymnNumber: 2,
        hymnTitle: "The Spirit of God",
      });

      expect(status).toBe(422);
      expect(errorMessage(body)).toContain("no sacrament meeting");

      const { data } = await fixtures.service
        .from("hymn_selections")
        .select("id")
        .eq("sunday_id", noMeetingSundayId);
      expect(data).toEqual([]);
    });

    it("answers 404 for a Sunday that is not this ward's", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await postSelect({
        sundayId: "00000000-0000-4000-8000-000000000000",
        hymnType: "opening",
        hymnNumber: 2,
        hymnTitle: "The Spirit of God",
      });

      expect(status).toBe(404);
    });
  });

  describe("one selection per slot", () => {
    it("replaces the existing hymn rather than adding a second row", async () => {
      await actAs(fixtures, "musicCoordinator");

      await postSelect({
        sundayId,
        hymnType: "sacrament",
        hymnNumber: 169,
        hymnTitle: "As Now We Take the Sacrament",
      });
      await postSelect({
        sundayId,
        hymnType: "sacrament",
        hymnNumber: 173,
        hymnTitle: "While of These Emblems We Partake",
      });

      const rows = await selectionFor("sacrament");
      expect(rows).toHaveLength(1);
      expect(rows[0].hymn_number).toBe(173);
    });
  });

  describe("the ai_suggested flag", () => {
    it("defaults to false when the request does not say", async () => {
      await actAs(fixtures, "musicCoordinator");

      await postSelect({
        sundayId,
        hymnType: "opening",
        hymnNumber: 2,
        hymnTitle: "The Spirit of God",
      });

      expect((await selectionFor("opening"))[0].ai_suggested).toBe(false);
    });

    it("records true when the choice began as a suggestion", async () => {
      await actAs(fixtures, "musicCoordinator");

      await postSelect({
        sundayId,
        hymnType: "opening",
        hymnNumber: 241,
        hymnTitle: "Count Your Blessings",
        aiSuggested: true,
      });

      expect((await selectionFor("opening"))[0].ai_suggested).toBe(true);
    });

    it("records who chose it", async () => {
      await actAs(fixtures, "musicCoordinator");

      await postSelect({
        sundayId,
        hymnType: "opening",
        hymnNumber: 30,
        hymnTitle: "Come, Come, Ye Saints",
      });

      expect((await selectionFor("opening"))[0].selected_by).toBe(
        fixtures.user("musicCoordinator").id,
      );
    });
  });

  describe("the title is stored beside the number", () => {
    // The program draft is a SNAPSHOT: a program approved before the hymns table changed must
    // keep printing the title it was approved with. A join at render time would rewrite history.
    it("keeps the title that was sent, not a lookup", async () => {
      await actAs(fixtures, "musicCoordinator");

      await postSelect({
        sundayId,
        hymnType: "closing",
        hymnNumber: 152,
        hymnTitle: "A Title Only This Ward Uses",
      });

      expect((await selectionFor("closing"))[0].hymn_title).toBe(
        "A Title Only This Ward Uses",
      );
    });

    it("refuses a selection with no title", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await postSelect({
        sundayId,
        hymnType: "closing",
        hymnNumber: 152,
        hymnTitle: "   ",
      });

      expect(status).toBe(400);
    });

    it("refuses a hymn number that is not a number a hymnbook could hold", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await postSelect({
        sundayId,
        hymnType: "closing",
        hymnNumber: 0,
        hymnTitle: "Nothing",
      });

      expect(status).toBe(400);
    });
  });

  describe("clearing a slot", () => {
    it("removes the selection", async () => {
      await actAs(fixtures, "musicCoordinator");

      await postSelect({
        sundayId,
        hymnType: "sacrament",
        hymnNumber: 169,
        hymnTitle: "As Now We Take the Sacrament",
      });

      const { status, body } = await deleteSelect({ sundayId, hymnType: "sacrament" });

      expect(status).toBe(200);
      expect(body.cleared).toBe(true);
      expect(await selectionFor("sacrament")).toHaveLength(0);
    });

    it("reports honestly when there was nothing to clear", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status, body } = await deleteSelect({ sundayId, hymnType: "sacrament" });

      expect(status).toBe(200);
      expect(body.cleared).toBe(false);
    });

    it("refuses a role without music.manage", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await deleteSelect({ sundayId, hymnType: "opening" });

      expect(status).toBe(403);
      // RE-READ rather than trusting the status: an RLS-denied DELETE is a zero-row success, so
      // a suite that only checked the response could pass while the row was gone.
      expect(await selectionFor("opening")).toHaveLength(1);
    });
  });

  describe("musical numbers", () => {
    it("lets a music coordinator log a performer and a piece", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await postMusicalNumber({
        sundayId,
        performer: "The Primary children",
        pieceTitle: "I Am a Child of God",
      });

      expect(status).toBe(200);
    });

    it("refuses a role without music.manage", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await postMusicalNumber({
        sundayId,
        performer: "Somebody",
        pieceTitle: "A Piece",
      });

      expect(status).toBe(403);
    });

    // A row of nulls would make the printed programme render an empty musical-number line on a
    // Sunday that has none.
    it("refuses an empty musical number", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await postMusicalNumber({ sundayId });

      expect(status).toBe(400);
    });

    it("replaces the existing musical number rather than adding a second", async () => {
      await actAs(fixtures, "musicCoordinator");

      await postMusicalNumber({ sundayId, performer: "A Quartet", pieceTitle: "A Piece" });
      await postMusicalNumber({ sundayId, performer: "A Duet", pieceTitle: "Another Piece" });

      const { data, error } = await fixtures.service
        .from("musical_numbers")
        .select("performer")
        .eq("ward_id", fixtures.wardAId)
        .eq("sunday_id", sundayId);

      if (error) throw new Error(error.message);
      expect(data).toHaveLength(1);
      expect(data?.[0].performer).toBe("A Duet");
    });

    it("answers 422 for a Sunday that holds no sacrament meeting", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await postMusicalNumber({
        sundayId: noMeetingSundayId,
        performer: "Somebody",
        pieceTitle: "A Piece",
      });

      expect(status).toBe(422);
    });
  });
});
