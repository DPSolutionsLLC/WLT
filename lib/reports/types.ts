import type { ContextTone, ReportType } from "@/types/domain";

// The shape a return-and-report tile has, and the ONLY shape ReportFeed knows about.
//
// CLIENT-IMPORTABLE — types only, no server import anywhere in this file.
//
// ---------------------------------------------------------------------------
// NO MODULE VOCABULARY LIVES HERE
// ---------------------------------------------------------------------------
// There is no `visit`, no `household` and no `org` on this type, and there must never be. The
// feed is Phase 8's too (08-youth-activities.md), and a field named for one module is what turns
// "pass reportType and a mapper" into "fork the component". Each module owns a mapper —
// lib/visits/reportTiles.ts today — and the mapper is the seam.
//
// ---------------------------------------------------------------------------
// `authorLabel` AND `recordedByLabel` ARE TWO DIFFERENT FACTS
// ---------------------------------------------------------------------------
// `authorLabel` is WHO WENT. For a visit it comes from visit_participants, and it is NULL when
// nobody is recorded as having gone — the tile then says so in words rather than falling back to
// whoever typed the record in. Falling back would re-create the exact ambiguity visits-d removed.
//
// `recordedByLabel` is WHO TYPED IT IN, rendered quieter and never a substitute for the above.
//
// Phase 8's `activity_logs.logged_by` is a RECORDER, not a participant — that table has no
// participants at all. Mapping it onto `authorLabel` would put "who went" on one kind of tile and
// "who typed it" on the other under the same label, with nothing on screen to tell them apart.
// It maps to `recordedByLabel`, and `authorLabel` stays null.

export type { ContextTone, ReportType };

// One value the feed can be filtered down to — an organization here, an activity in Phase 8.
//
// The FILTER IS SERVER-SIDE, and `id` is what the fetcher sends back to its own route. A feed is
// paginated, so filtering the loaded tiles in the browser would answer "3 reports" while twenty
// more sat below the fold — a filter that is silently wrong rather than visibly missing
// (plans/retros/roster-b-picker-and-orgs.md).
export type ReportFeedContext = {
  id: string;
  label: string;
  tone: ContextTone;
};

export type ReportTile = {
  reportType: ReportType;
  reportId: string;
  // Which context this report belongs to, for the filter. Null when it belongs to none — a
  // bishopric-authored visit has no organization — and such a report is reachable only with the
  // filter set to "all".
  contextId: string | null;
  // The organization for a visit; the activity name for Phase 8.
  contextLabel: string;
  // The hue the context chip renders in. NEVER the only signal: the chip always carries
  // `contextLabel` too, because seven hues separate seven things only for somebody who can see
  // all seven (app/globals.css §Context tones).
  contextTone: ContextTone;
  // The family visited; the event title for Phase 8.
  subjectLabel: string;
  // Date-only, YYYY-MM-DD. Never a local-time string (CLAUDE.md §6).
  occurredOn: string;
  authorLabel: string | null;
  recordedByLabel: string | null;
  // Set only for the EXCEPTION — "Attempted" on a visit nobody was home for. Null when there is
  // nothing worth saying: every tile reading "Visited" is noise, and the one reading "Attempted"
  // is the point. Phase 8's activities have no such state, so it stays null there.
  outcomeLabel: string | null;
  // One line, from SHARED notes only. A private note has no route to this field: the mapper does
  // not import the module that reads them (CLAUDE.md rule 5).
  previewText: string | null;
  isRead: boolean;
  // The PRIVATE per-user bookmark from `report_read_status.flagged` — NOT
  // `visit_logs.flagged_for_ward_council`, which is a ward-council agenda request that notifies
  // the executive secretary. Same word in the database, unrelated meanings; one leaking into the
  // other would either spam the executive secretary or publish a personal bookmark.
  bookmarked: boolean;
};

export type ReportFeedPage = {
  tiles: ReportTile[];
  // Unread across everything the caller can see UNDER THE CURRENT FILTER, not just this page and
  // not the whole feed. A badge that counted only the loaded page would fall as the reader
  // scrolled; one that ignored the filter would say "8 unread" over four tiles. The number always
  // describes what filtering to this context would show.
  unreadCount: number;
  // Opaque to the client. Null means this is the last page.
  nextCursor: string | null;
  // Every context present in the WHOLE feed, not just this page — otherwise the filter's options
  // would change as the reader paged, and an organization would vanish from the dropdown because
  // its last report was further down. Ordered by label so the list is stable between renders.
  contexts: ReportFeedContext[];
};
