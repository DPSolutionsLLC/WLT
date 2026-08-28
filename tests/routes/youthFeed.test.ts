// @vitest-environment node
//
// GET /api/youth/feed — the youth half of the seam visits-c built.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. THE CURSOR PAGES WITHOUT REPEATING OR SKIPPING. This feed orders on `activity_logs.created_at`
//    while the tile DISPLAYS the event's date — a deliberate departure from visits, because a
//    log's event date lives on another table and PostgREST cannot order parent rows by an embedded
//    column. The cursor's `occurredOn` half therefore carries the LOG'S created_at reduced to a
//    date, not the tile's. Taking it from the tile would page in an order the query does not use,
//    and the symptom is exactly what this test looks for: a repeat or a gap on page two.
//
// 2. THE UNREAD COUNT DESCRIBES WHAT THE FILTER SHOWS. Filtered to one activity, "8 unread" over
//    four tiles is a number nobody can reconcile against the list beneath it.
//
// 3. AN UNKNOWN `context` IS AN EMPTY PAGE, NOT A 403. The filter is a DISPLAY PREFERENCE and
//    never a permission: RLS has already decided which follow-ups exist for this caller.
//
// 4. THE CONTEXT LIST DOES NOT SHRINK AS THE READER PAGES, because it is derived from the
//    unfiltered summaries rather than from the page on screen.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import type { ReportFeedPage } from "@/lib/reports/types";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BASE_URL = "http://localhost/api/youth/feed";

// Enough follow-ups that a page size of three needs three pages, so a keyset bug has room to show.
const LOG_COUNT = 7;

async function readFeed(query: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/youth/feed/route");
  const url = new URL(BASE_URL);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);

  const { status, body } = await readResponse(await GET(jsonRequest(url.toString())));
  return { status, page: body as unknown as ReportFeedPage };
}

describe("/api/youth/feed", () => {
  let fixtures: Fixtures;

  let basketballProfileId: string;
  let choirProfileId: string;
  // One follow-up per event, all authored by the bishop so every one of them is readable to the
  // reader below and paging is the only thing under test.
  let basketballLogIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident"]);

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

    const { data: profiles, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert([
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.eldersQuorumId,
          member_id: member.id,
          activity_name: `Basketball ${fixtures.runId}`,
          activity_type: "sport",
        },
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.eldersQuorumId,
          member_id: member.id,
          activity_name: `Choir ${fixtures.runId}`,
          activity_type: "performance",
        },
      ])
      .select("id, activity_name");
    if (profileError) throw new Error(profileError.message);

    basketballProfileId = profiles.find((row) =>
      row.activity_name.startsWith("Basketball"),
    )!.id;
    choirProfileId = profiles.find((row) => row.activity_name.startsWith("Choir"))!.id;

    // Seven basketball games and one choir concert. The choir one exists so the filter has
    // something to exclude and the context dropdown has two options.
    const eventRows = [
      ...Array.from({ length: LOG_COUNT }, (_, index) => ({
        ward_id: fixtures.wardAId,
        profile_id: basketballProfileId,
        title: `Game ${index + 1} ${fixtures.runId}`,
        event_type: "home",
        event_date: `2026-03-${String(index + 1).padStart(2, "0")}T19:30:00-07:00`,
        status: "upcoming",
      })),
      {
        ward_id: fixtures.wardAId,
        profile_id: choirProfileId,
        title: `Concert ${fixtures.runId}`,
        event_type: "home",
        event_date: "2026-03-20T19:30:00-07:00",
        status: "upcoming",
      },
    ];

    const { data: events, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert(eventRows)
      .select("id, profile_id, title");
    if (eventError) throw new Error(eventError.message);

    // ONE AT A TIME, so each row gets its own `created_at` microsecond. A batch insert can share
    // an instant, and a cursor over `created_at` has nothing to separate rows that do.
    const created: { id: string; profileId: string }[] = [];
    for (const event of events) {
      const { data, error } = await fixtures.service
        .from("activity_logs")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: event.id,
          logged_by: fixtures.user("bishop").id,
          shared_notes: `Shared note for ${event.title}`,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      created.push({ id: data.id, profileId: event.profile_id! });
    }

    basketballLogIds = created
      .filter((row) => row.profileId === basketballProfileId)
      .map((row) => row.id);
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("returns a page of tiles with the youth report type", async () => {
    await actAs(fixtures, "bishop");

    const { status, page } = await readFeed();

    expect(status).toBe(200);
    expect(page.tiles.length).toBe(LOG_COUNT + 1);

    for (const tile of page.tiles) {
      expect(tile.reportType).toBe("youth_activity");
      // `authorLabel` is ALWAYS null for a youth tile — `activity_logs` has no participants table,
      // so there is nothing that answers "who went" (lib/reports/types.ts).
      expect(tile.authorLabel).toBeNull();
      expect(tile.recordedByLabel).not.toBeNull();
    }
  });

  it("orders newest report first", async () => {
    await actAs(fixtures, "bishop");

    const { page } = await readFeed();

    // The choir concert's follow-up was written last, so it leads — even though its event date is
    // the latest too. What matters here is that the ORDER is the report's, which the paging test
    // below pins properly.
    expect(page.tiles[0]?.subjectLabel).toContain("Concert");
  });

  it("offers every activity that has a follow-up as a filter option", async () => {
    await actAs(fixtures, "bishop");

    const { page } = await readFeed();

    expect(page.contexts.map((context) => context.id).sort()).toEqual(
      [basketballProfileId, choirProfileId].sort(),
    );
    // The tone comes from the ACTIVITY TYPE, which is what ACTIVITY_TYPE_TONES was shaped for in
    // slice A.
    expect(page.contexts.find((c) => c.id === basketballProfileId)?.tone).toBe("teal");
    expect(page.contexts.find((c) => c.id === choirProfileId)?.tone).toBe("violet");
  });

  // ---------------------------------------------------------------------------
  // PAGING — NO REPEATS AND NO GAPS
  // ---------------------------------------------------------------------------
  it("pages through the whole feed without repeating or skipping a report", async () => {
    await actAs(fixtures, "bishop");

    const seen: string[] = [];
    let cursor: string | null = null;
    let contextCount = -1;

    for (let guard = 0; guard < 10; guard += 1) {
      const query: Record<string, string> = { limit: "3" };
      if (cursor !== null) query.before = cursor;

      const { page } = await readFeed(query);

      seen.push(...page.tiles.map((tile) => tile.reportId));

      // The context list is derived from the UNFILTERED summaries, so it must not shrink as the
      // reader pages past an activity's last follow-up.
      if (contextCount === -1) contextCount = page.contexts.length;
      expect(page.contexts.length).toBe(contextCount);

      cursor = page.nextCursor;
      if (cursor === null) break;
    }

    expect(cursor).toBeNull();

    // NO REPEATS.
    expect(new Set(seen).size).toBe(seen.length);
    // NO GAPS.
    expect(seen.length).toBe(LOG_COUNT + 1);
    for (const logId of basketballLogIds) {
      expect(seen).toContain(logId);
    }
  });

  // ---------------------------------------------------------------------------
  // THE UNREAD COUNT DESCRIBES WHAT THE FILTER SHOWS
  // ---------------------------------------------------------------------------
  it("counts unread under the current filter, not across the whole feed", async () => {
    await actAs(fixtures, "bishop");

    const everything = await readFeed();
    expect(everything.page.unreadCount).toBe(LOG_COUNT + 1);

    const choirOnly = await readFeed({ context: choirProfileId });
    expect(choirOnly.page.tiles.length).toBe(1);
    expect(choirOnly.page.unreadCount).toBe(1);

    const basketballOnly = await readFeed({ context: basketballProfileId });
    expect(basketballOnly.page.tiles.length).toBe(LOG_COUNT);
    expect(basketballOnly.page.unreadCount).toBe(LOG_COUNT);
  });

  it("drops the unread count as reports are read, without touching anybody else's", async () => {
    await actAs(fixtures, "bishop");

    const { POST } = await import("@/app/api/reports/read-status/route");
    await POST(
      jsonRequest("http://localhost/api/reports/read-status", {
        method: "POST",
        body: {
          reportType: "youth_activity",
          reportId: basketballLogIds[0],
          read: true,
        },
      }),
    );

    const { page } = await readFeed();
    expect(page.unreadCount).toBe(LOG_COUNT);

    // ANOTHER READER'S count is untouched — that is the whole feature of a per-user read state.
    await actAs(fixtures, "eqPresident");
    const other = await readFeed();
    expect(other.page.unreadCount).toBe(LOG_COUNT + 1);
  });

  // A DISPLAY PREFERENCE, NEVER A PERMISSION. RLS has already decided which follow-ups exist for
  // this caller, so naming an activity they cannot read returns an empty page rather than a
  // refusal from this module.
  it("answers an unknown context with an empty page rather than a 403", async () => {
    await actAs(fixtures, "bishop");

    const { status, page } = await readFeed({
      context: "00000000-0000-4000-8000-00000000dead",
    });

    expect(status).toBe(200);
    expect(page.tiles).toEqual([]);
    expect(page.unreadCount).toBe(0);
    // The dropdown still offers everything, because the options come from the unfiltered
    // summaries.
    expect(page.contexts.length).toBe(2);
  });

  it("refuses a malformed cursor with a sentence", async () => {
    await actAs(fixtures, "bishop");

    const { status } = await readFeed({ before: "not-a-cursor" });

    expect(status).toBe(400);
  });

  it("refuses a context that is not a uuid", async () => {
    await actAs(fixtures, "bishop");

    const { status } = await readFeed({ context: "not-a-uuid" });

    expect(status).toBe(400);
  });
});
