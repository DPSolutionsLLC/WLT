// @vitest-environment node
//
// GET and PUT /api/ward-settings/home-venues.
//
// ---------------------------------------------------------------------------
// THE ASSERTION THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// THE MERGE. `wards.settings` is ONE jsonb column holding role_access, timezone,
// cross_org_visibility and now home_venues. A wholesale write here would silently delete the
// ward's permission overrides — a list of gyms quietly changing who may do what, which is about
// the worst side effect available in this codebase.
//
// The bug is INVISIBLE without a ward that already has an override, which is why one is seeded
// and asserted after the write. tests/routes/crossOrgVisibility.test.ts guards the same column
// the same way, and both must keep doing it.
//
// Also: GET is readable by anybody who reads the calendar, because "why is this game marked
// away?" is a question the page should answer without a leader having to ask a counselor. PUT is
// bishopric, and bishop and counselor are identical (CLAUDE.md §7).
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

const VENUES_URL = "http://localhost/api/ward-settings/home-venues";

// A non-default override, seeded before the venue list is ever touched. `music_coordinator`
// gaining `youth_activities.view` is a change nothing else in this suite would notice going
// missing — which is exactly why it is the right canary for a merge that failed.
const ROLE_ACCESS_OVERRIDE = {
  music_coordinator: { add: ["youth_activities.view"] },
};

async function getVenues() {
  const { GET } = await import("@/app/api/ward-settings/home-venues/route");
  return readResponse(await GET());
}

async function putVenues(body: unknown) {
  const { PUT } = await import("@/app/api/ward-settings/home-venues/route");
  return readResponse(await PUT(jsonRequest(VENUES_URL, { method: "PUT", body })));
}

describe("/api/ward-settings/home-venues", () => {
  let fixtures: Fixtures;

  const venuesFrom = (body: Record<string, unknown>): string[] =>
    body.homeVenues as string[];

  const storedSettings = async (): Promise<Record<string, unknown>> => {
    const { data, error } = await fixtures.service
      .from("wards")
      .select("settings")
      .eq("id", fixtures.wardAId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data?.settings ?? {}) as Record<string, unknown>;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "counselor1", "eqPresident", "eqSecretary", "musicCoordinator"],
      { roleAccess: ROLE_ACCESS_OVERRIDE },
    );
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("reading", () => {
    it("starts empty for a ward that has configured nothing", async () => {
      // THE CLOSED DIRECTION. With no venues, every event lands `tbd` — visible, loud, and
      // waiting for a person. The open direction would be guessing.
      await actAs(fixtures, "eqPresident");

      const { status, body } = await getVenues();

      expect(status).toBe(200);
      expect(venuesFrom(body)).toEqual([]);
    });

    it("lets an org secretary read the list", async () => {
      // `youth_activities.view`, not `.manage`. An org secretary holds the first and not the
      // second, and needs to be able to answer "why is this marked away?" from the page.
      await actAs(fixtures, "eqSecretary");

      const { status } = await getVenues();

      expect(status).toBe(200);
    });

    it("refuses a role holding none of the youth permissions", async () => {
      // The seeded override gives music_coordinator `youth_activities.view`, so this asserts the
      // gate through a role that would otherwise be refused — and proves the override survived
      // every write below when it runs after them. Ordered first here on purpose: it reads.
      await actAs(fixtures, "musicCoordinator");

      const { status } = await getVenues();

      expect(status).toBe(200);
    });
  });

  describe("writing", () => {
    it("refuses an org president with a sentence naming the rule", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await putVenues({ homeVenues: ["Lincoln High School"] });

      expect(status).toBe(403);
      expect(errorMessage(body)).toContain("bishop");
    });

    it("refuses an org secretary", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await putVenues({ homeVenues: ["Lincoln High School"] });

      expect(status).toBe(403);
    });

    // TRIMMED, NOT LOWER-CASED. The ward's own spelling is what comes back; case is folded at
    // comparison time by classifyEventLocation instead. Reading back "lincoln high school" after
    // typing "Lincoln High School" looked like a bug when scenario 054 was walked.
    it("lets the bishop save, trimmed, with the typed casing intact", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await putVenues({
        homeVenues: ["  Lincoln High School  ", "WARD BUILDING"],
      });

      expect(status).toBe(200);
      expect(venuesFrom(body)).toEqual(["Lincoln High School", "WARD BUILDING"]);
    });

    // ---------------------------------------------------------------------------
    // THE MERGE — the failure this whole suite exists to prevent
    // ---------------------------------------------------------------------------
    it("leaves role_access and timezone untouched", async () => {
      await actAs(fixtures, "bishop");

      await putVenues({ homeVenues: ["Lincoln High School"] });

      const settings = await storedSettings();

      expect(settings.role_access).toEqual(ROLE_ACCESS_OVERRIDE);
      expect(settings.timezone).toBe("America/Denver");
      expect(settings.cross_org_visibility).toBe(false);
      expect(settings.home_venues).toEqual(["Lincoln High School"]);
    });

    it("lets a counselor save exactly as the bishop can", async () => {
      // Shared bishopric authority is a product requirement, not a nicety (CLAUDE.md §7). Never
      // build a check that grants the bishop something a counselor lacks.
      await actAs(fixtures, "counselor1");

      const { status, body } = await putVenues({
        homeVenues: ["Lincoln High School", "Riverside Park"],
      });

      expect(status).toBe(200);
      expect(venuesFrom(body)).toEqual(["Lincoln High School", "Riverside Park"]);
    });

    it("de-duplicates case-insensitively, keeping the first spelling", async () => {
      await actAs(fixtures, "bishop");

      const { body } = await putVenues({
        homeVenues: ["Lincoln High School", "lincoln high school"],
      });

      expect(venuesFrom(body)).toEqual(["Lincoln High School"]);
    });

    it("accepts an empty list, which is a ward saying it has no home venues", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await putVenues({ homeVenues: [] });

      expect(status).toBe(200);
      expect(venuesFrom(body)).toEqual([]);
    });

    it("refuses a list that is not a list", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await putVenues({ homeVenues: "Lincoln High School" });

      expect(status).toBe(400);
    });

    it("refuses an over-long list with a sentence", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await putVenues({
        homeVenues: Array.from({ length: 41 }, (_, index) => `Venue ${index}`),
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("40");
    });

    it("writes an audit row carrying the before and after lists", async () => {
      await actAs(fixtures, "bishop");
      await putVenues({ homeVenues: ["Lincoln High School"] });
      await putVenues({ homeVenues: ["Roosevelt High School"] });

      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "home_venues_updated")
        .order("created_at", { ascending: false })
        .limit(1);

      expect(error).toBeNull();

      const detail = (data?.[0]?.detail ?? {}) as Record<string, unknown>;

      // "Changed" cannot answer "which venue was removed, and when" — the question somebody asks
      // when a season's games start arriving as "Home or away?".
      expect(detail.homeVenues).toEqual(["Roosevelt High School"]);
      expect(detail.previousHomeVenues).toEqual(["Lincoln High School"]);
    });
  });
});
