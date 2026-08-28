import { describe, expect, it } from "vitest";
import { PREVIEW_MAX_CHARACTERS } from "@/lib/reports/preview";
import type { ReportReadState } from "@/lib/reports/readStatus";
import type { ActivityLogWithContext } from "@/lib/youth/activityLogs";
import { toYouthReportTile, toYouthReportTiles } from "@/lib/youth/reportTiles";

// Pure. No database, no client, no clock — which is the point of keeping the mapper out of the
// component and out of the route.
//
// What these pin is the set of decisions a youth tile can get quietly wrong: `authorLabel` filled
// in with whoever typed the follow-up (the ambiguity visits-d split a column to remove), an
// "outcome" label on every tile instead of on the one that needs it, an empty preview that reads
// as a note which failed to load, and — the one this module is most likely to get wrong —
// `occurredOn` computed in UTC, which puts a Friday evening game on Saturday.

const PROFILE_ID = "5f2a6f1c-0000-4000-8000-000000000001";
const LOG_ID = "11111111-0000-4000-8000-000000000001";

// A ward WEST of UTC, chosen so a 7:30pm local event is already the NEXT DAY in UTC. With
// America/Denver and a UTC-formatted mapper this test fails, which is the only way it can be
// meaningful — a zone that agrees with UTC could not tell the two implementations apart.
const WARD_TIMEZONE = "America/Denver";

// 2027-01-02T19:30 in Denver is 2027-01-03T02:30Z. The tile must say the 2nd.
const EVENING_BEFORE_MIDNIGHT_UTC = "2027-01-03T02:30:00Z";

function log(overrides: Partial<ActivityLogWithContext> = {}): ActivityLogWithContext {
  return {
    id: LOG_ID,
    eventId: "22222222-0000-4000-8000-000000000001",
    loggedBy: "33333333-0000-4000-8000-000000000001",
    sharedNotes: "They played well and the whole family came.",
    flaggedForWardCouncil: false,
    flagSentAt: null,
    createdAt: "2027-01-04T17:00:00Z",
    eventTitle: "Game against Roosevelt",
    eventDate: EVENING_BEFORE_MIDNIGHT_UTC,
    profileId: PROFILE_ID,
    profileName: "Varsity basketball",
    activityType: "sport",
    loggedByName: "Miguel Cortez",
    confirmedAttendance: null,
    ...overrides,
  };
}

function tileFor(
  overrides: Partial<ActivityLogWithContext> = {},
  readStatus: ReadonlyMap<string, ReportReadState> = new Map(),
) {
  return toYouthReportTile(log(overrides), { wardTimezone: WARD_TIMEZONE, readStatus });
}

describe("toYouthReportTile", () => {
  it("maps the log onto the generic tile", () => {
    const tile = tileFor();

    expect(tile.reportType).toBe("youth_activity");
    // The LOG's id, not the event's. That is what /api/reports/read-status marks read, and what
    // REPORT_MODULES.youth_activity resolves through getActivityLog().
    expect(tile.reportId).toBe(LOG_ID);
    // The ACTIVITY, not the organization — a youth activity feed is read by activity.
    expect(tile.contextId).toBe(PROFILE_ID);
    expect(tile.contextLabel).toBe("Varsity basketball");
    expect(tile.contextTone).toBe("teal");
    expect(tile.subjectLabel).toBe("Game against Roosevelt");
    expect(tile.recordedByLabel).toBe("Miguel Cortez");
  });

  // ---------------------------------------------------------------------------
  // `occurredOn` IS THE EVENT'S DATE IN THE WARD'S ZONE
  // ---------------------------------------------------------------------------
  // The seeded instant is 2027-01-03T02:30Z, which is the evening of the 2nd in Denver. A mapper
  // using `.toISOString().slice(0, 10)` answers "2027-01-03" and passes every other assertion in
  // this file — this is the one that catches it.
  describe("occurredOn", () => {
    it("is the event's date in the ward's zone, not in UTC", () => {
      expect(tileFor().occurredOn).toBe("2027-01-02");
    });

    it("is the event's date rather than the report's", () => {
      // The log was written two days later. A feed ordered by report date must still SHOW the day
      // the game was played.
      expect(tileFor().occurredOn).not.toBe("2027-01-04");
    });

    it("falls back to the log's own creation date when the event date is missing", () => {
      // Never "today": a tile must not claim a follow-up happened on the day somebody opened the
      // feed. 2027-01-04T17:00Z is still the 4th in Denver.
      expect(tileFor({ eventDate: null }).occurredOn).toBe("2027-01-04");
    });

    it("falls back rather than throwing on an unreadable event date", () => {
      expect(tileFor({ eventDate: "not a date" }).occurredOn).toBe("2027-01-04");
    });
  });

  // ---------------------------------------------------------------------------
  // `authorLabel` IS NULL IN EVERY CASE
  // ---------------------------------------------------------------------------
  // `authorLabel` is WHO WENT (lib/reports/types.ts). `activity_logs` has no participants table,
  // so there is nothing to put there — and filling it with `logged_by` would put "who went" on one
  // kind of tile and "who typed it" on the other under the same label.
  describe("authorLabel", () => {
    it("is null with a named author", () => {
      expect(tileFor().authorLabel).toBeNull();
    });

    it("is null with a confirmed attendance", () => {
      expect(tileFor({ confirmedAttendance: true }).authorLabel).toBeNull();
    });

    it("is null with no author name at all", () => {
      expect(tileFor({ loggedByName: null }).authorLabel).toBeNull();
    });
  });

  // THE EXCEPTION ONLY. A label on every tile reading "Went" is noise; the one reading "Did not
  // attend" is the point, because it is the only thing on the tile a leader has to act on.
  describe("outcomeLabel", () => {
    it('is "Did not attend" when the author confirmed they did not go', () => {
      expect(tileFor({ confirmedAttendance: false }).outcomeLabel).toBe("Did not attend");
    });

    it("is null when the author confirmed they went", () => {
      expect(tileFor({ confirmedAttendance: true }).outcomeLabel).toBeNull();
    });

    it("is null when nobody said either way", () => {
      expect(tileFor({ confirmedAttendance: null }).outcomeLabel).toBeNull();
    });
  });

  // NULL, never "". An empty string renders as a blank gap where the note goes, which reads as a
  // note that failed to load — the tile says "No shared note" instead.
  describe("previewText", () => {
    it("is null for a missing shared note", () => {
      expect(tileFor({ sharedNotes: null }).previewText).toBeNull();
    });

    it("is null and not an empty string for whitespace", () => {
      expect(tileFor({ sharedNotes: "   \n  " }).previewText).toBeNull();
    });

    it("is the first line only", () => {
      expect(
        tileFor({ sharedNotes: "They played well.\nThe coach was late." }).previewText,
      ).toBe("They played well.");
    });

    it("cuts a long note at a word boundary with an ellipsis", () => {
      const note = `${"word ".repeat(60)}end`;
      const preview = tileFor({ sharedNotes: note }).previewText;

      expect(preview).not.toBeNull();
      expect(preview!.endsWith("…")).toBe(true);
      expect(preview!.length).toBeLessThanOrEqual(PREVIEW_MAX_CHARACTERS + 1);
    });
  });

  describe("a deleted activity", () => {
    it("says so rather than rendering a blank chip", () => {
      const tile = tileFor({ profileId: null, profileName: null, activityType: null });

      expect(tile.contextId).toBeNull();
      expect(tile.contextLabel).toBe("An activity that is no longer listed");
      // Slate, which ACTIVITY_TYPE_TONES gives `other` — never some other activity's colour.
      expect(tile.contextTone).toBe("slate");
    });

    it("says so for a deleted event too", () => {
      expect(tileFor({ eventTitle: null }).subjectLabel).toBe(
        "An event that is no longer listed",
      );
    });
  });

  // A report with no read-status row at all is unread and unbookmarked, which is the correct
  // default and is what the mapper renders without needing a second query.
  describe("read state", () => {
    it("defaults to unread and unbookmarked", () => {
      const tile = tileFor();

      expect(tile.isRead).toBe(false);
      expect(tile.bookmarked).toBe(false);
    });

    it("reads both out of the map when a row exists", () => {
      const tile = tileFor(
        {},
        new Map([[LOG_ID, { reportId: LOG_ID, isRead: true, bookmarked: true }]]),
      );

      expect(tile.isRead).toBe(true);
      expect(tile.bookmarked).toBe(true);
    });
  });
});

describe("toYouthReportTiles", () => {
  it("maps a list in order", () => {
    const tiles = toYouthReportTiles(
      [log({ id: LOG_ID }), log({ id: "44444444-0000-4000-8000-000000000001" })],
      { wardTimezone: WARD_TIMEZONE, readStatus: new Map() },
    );

    expect(tiles.map((tile) => tile.reportId)).toEqual([
      LOG_ID,
      "44444444-0000-4000-8000-000000000001",
    ]);
  });
});
