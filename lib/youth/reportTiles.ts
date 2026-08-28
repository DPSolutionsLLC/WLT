import { toPreviewText } from "@/lib/reports/preview";
import type { ReportReadState } from "@/lib/reports/readStatus";
import type { ReportTile } from "@/lib/reports/types";
import type { ActivityLogWithContext } from "@/lib/youth/activityLogs";
import { ACTIVITY_TYPE_TONES, type ContextTone } from "@/types/domain";

// Youth activity follow-ups, mapped into the generic tile the return-and-report feed renders.
//
// THIS IS THE YOUTH-SPECIFIC HALF, and it is the sibling of lib/visits/reportTiles.ts — read that
// file first. ReportFeed and ReportTile know nothing about either module; a mapper is the seam,
// and supplying one is what 08-youth-activities.md §Pitfalls asks for instead of a second
// component ("Forking the report feed. Two nearly identical components drift. Parameterize the
// one.").
//
// THIS FILE MUST NOT IMPORT lib/youth/privateNotes.ts, and there is no arrangement of it that
// could reach one: `previewText` is built from `sharedNotes` alone, and the input type —
// ActivityLogWithContext — has no private-note field to read even if somebody tried. That is the
// same structural promise lib/youth/activityLogs.ts states in its own header (CLAUDE.md rule 5).
//
// PURE. No client, no await, no clock — the ward's time zone arrives as a parameter, exactly as
// `asOf` does elsewhere in this module. tests/lib/youthReportTiles.test.ts therefore needs no
// database.

// A follow-up on an event whose activity has been deleted since. Never blank, for the reason
// UNKNOWN_HOUSEHOLD_LABEL is not: an empty chip reads as a page that failed to load.
const UNKNOWN_ACTIVITY_LABEL = "An activity that is no longer listed";

// The tone for a follow-up whose activity row has gone. Slate is what ACTIVITY_TYPE_TONES gives
// `other`, so the deleted case does not arrive wearing some other activity's colour.
const UNKNOWN_ACTIVITY_TONE: ContextTone = ACTIVITY_TYPE_TONES.other;

// An event deleted since the follow-up was written. `event_id` is `not null` and the feed query
// joins it inner, so this is unreachable today — it exists so a future outer join cannot render a
// blank line instead of saying what is missing.
const UNKNOWN_EVENT_LABEL = "An event that is no longer listed";

// ---------------------------------------------------------------------------
// A CONFIRMED NON-ATTENDANCE IS THE EXCEPTION, AND THE ONLY OUTCOME WORTH A LABEL
// ---------------------------------------------------------------------------
// lib/reports/types.ts used to say "Phase 8's activities have no such state, so it stays null
// there". That comment was AMENDED in the same change as this file rather than left to contradict
// the code: activities gained exactly such a state when `confirmed_attendance` got its first
// writer.
//
// The reasoning that put "Attempted" on a visit tile is identical. A label on every tile reading
// "Went" is noise; the one reading "Did not attend" is the point, because it is the only thing on
// the tile a leader has to act on. `null` — never answered — gets no label, because nobody said
// anything.
const DID_NOT_ATTEND_LABEL = "Did not attend";

// ---------------------------------------------------------------------------
// `occurredOn` IS DATE-ONLY IN THE WARD'S ZONE, AND BOTH HALVES OF THAT MATTER
// ---------------------------------------------------------------------------
// `activity_events.event_date` is a timestamptz. ReportTile formats `occurredOn` in UTC
// deliberately (a date-only value formatted locally shows the previous day west of UTC), so the
// string handed to it has to already BE the right day.
//
// NEVER `.toISOString().slice(0, 10)`. That is UTC, and it puts a 7:30pm Friday game on Saturday
// for every ward west of the line — which is the whole class of bug slice B's resolveInstant.ts
// was arranged to prevent, arriving by the other door.
//
// THE WARD'S ZONE RATHER THAN THE READER'S, and that is the mirror of what youth-c decided for the
// calendar. There, the reader's own zone decides which day a card sits under, because a card shows
// a time somebody has to turn up at. HERE, `occurredOn` is a property of the EVENT: it must be the
// same string for every reader, because it is displayed on a shared tile and — in the visits feed
// — a cursor is built from it.
//
// `en-CA` yields YYYY-MM-DD, which is the format lib/reports/types.ts specifies. formatToParts
// rather than trusting the locale's separator: a runtime that renders `2027-01-02` today and
// `2027/01/02` after an ICU update would produce a cursor nothing can decode.
function toWardDateOnly(instant: string, timeZone: string): string | null {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);

  const find = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = find("year");
  const month = find("month");
  const day = find("day");

  if (year === "" || month === "" || day === "") return null;

  return `${year}-${month}-${day}`;
}

export type YouthReportTileContext = {
  // From lib/ward/wardTimezone.ts. Resolved once by the caller rather than read per row: it is
  // one settings lookup for a whole page, and a per-row read could in principle disagree with
  // itself.
  wardTimezone: string;
  readStatus: ReadonlyMap<string, ReportReadState>;
};

export function toYouthReportTile(
  log: ActivityLogWithContext,
  context: YouthReportTileContext,
): ReportTile {
  const state = context.readStatus.get(log.id);

  // The log's own creation date is the fallback, not today's: a tile must never claim a follow-up
  // happened on the day somebody happened to open the feed.
  const occurredOn =
    (log.eventDate === null ? null : toWardDateOnly(log.eventDate, context.wardTimezone)) ??
    toWardDateOnly(log.createdAt, context.wardTimezone) ??
    log.createdAt.slice(0, 10);

  return {
    reportType: "youth_activity",
    // The LOG's id. That is what /api/reports/read-status marks read, and what
    // REPORT_MODULES.youth_activity resolves through getActivityLog().
    reportId: log.id,

    // THE ACTIVITY, NOT THE ORGANIZATION. A youth activity feed is read by activity — "the
    // basketball season", "the concert choir" — not by which presidency happened to enter it.
    // ACTIVITY_TYPE_TONES was shaped in slice A for exactly this, and says so in its own comment.
    contextId: log.profileId,
    contextLabel: log.profileName ?? UNKNOWN_ACTIVITY_LABEL,
    contextTone:
      log.activityType === null
        ? UNKNOWN_ACTIVITY_TONE
        : (ACTIVITY_TYPE_TONES[log.activityType] ?? UNKNOWN_ACTIVITY_TONE),

    subjectLabel: log.eventTitle ?? UNKNOWN_EVENT_LABEL,
    occurredOn,

    // ---------------------------------------------------------------------
    // `authorLabel` IS ALWAYS NULL, AND THAT IS NOT LAZINESS
    // ---------------------------------------------------------------------
    // lib/reports/types.ts spells it out: `authorLabel` is WHO WENT. `activity_logs` has no
    // participants table at all — there is nothing in this schema that records who was at a game
    // beyond who put themselves down for it beforehand — so mapping `logged_by` onto it would put
    // "who went" on one kind of tile and "who typed it" on the other under the same label, with
    // nothing on screen to tell them apart.
    //
    // The tile renders "Nobody recorded as taking part" in that case, which for a youth follow-up
    // is TRUE and probably not useful. That is flagged as the most likely copy defect in this
    // slice (scenario 055). If it reads badly, the fix is in ReportTile IN PLACE with the visits
    // feed re-verified — never a youth-only component.
    authorLabel: null,
    recordedByLabel: log.loggedByName,

    // THE EXCEPTION ONLY. See DID_NOT_ATTEND_LABEL above.
    outcomeLabel: log.confirmedAttendance === false ? DID_NOT_ATTEND_LABEL : null,

    // SHARED notes only. There is no private-note field on ActivityLogWithContext to read.
    previewText: toPreviewText(log.sharedNotes),

    isRead: state?.isRead ?? false,
    bookmarked: state?.bookmarked ?? false,
  };
}

export function toYouthReportTiles(
  logs: readonly ActivityLogWithContext[],
  context: YouthReportTileContext,
): ReportTile[] {
  return logs.map((log) => toYouthReportTile(log, context));
}
