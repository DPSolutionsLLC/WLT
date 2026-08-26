"use client";

import { forwardRef } from "react";
import type { ReportTile as ReportTileModel } from "@/lib/reports/types";
import type { ContextTone } from "@/types/domain";

// One report in the return-and-report feed.
//
// GENERIC. Grep this file for "visit", "household" or "org" and you should find them only in this
// comment: every string on screen comes out of the tile it is handed, and the mapper that built
// that tile is the module-specific half (lib/visits/reportTiles.ts today). Phase 8 reuses this
// component unchanged — that is the whole reason it takes a normalized tile rather than a row.
//
// It lives under components/visits/ because 07-visits.md specifies that path. Moving it to
// components/reports/ is a rename this slice does not own; the retro notes it as a candidate if
// Phase 8 finds the path confusing.

// UTC and WITH THE YEAR, for the two reasons lib/visits/visitDates.ts opens on: a date-only value
// formatted in local time shows the previous day to anybody west of UTC, and a feed spans years —
// "7 June" above "2 June" hides that they are eighteen months apart.
//
// Inlined rather than imported from lib/visits/visitDates.ts, which would put visit vocabulary
// into a component that must not have any.
const REPORT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatReportDate(occurredOn: string): string {
  const parsed = new Date(`${occurredOn}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return occurredOn;
  return REPORT_DATE_FORMAT.format(parsed);
}

// The tile says this when nobody is recorded as having taken part. It is a STATEMENT about the
// report, not an absence of data — and never a fall-back to whoever typed the report in, which
// would re-create the ambiguity visits-d removed (lib/reports/types.ts).
const NOBODY_RECORDED = "Nobody recorded as taking part";

// A shared note that is empty. Blank space where a note goes reads as a tile that failed to load.
const NO_SHARED_NOTE = "No shared note";

export type ReportTileProps = {
  tile: ReportTileModel;
  // Set on the one tile Next Unread has just walked to, so the reader can see where they landed.
  isFocused: boolean;
  isBusy: boolean;
  onOpen: (tile: ReportTileModel) => void;
  onToggleBookmark: (tile: ReportTileModel) => void;
};

// ---------------------------------------------------------------------------
// UNREAD IS MARKED THREE WAYS, NOT ONE
// ---------------------------------------------------------------------------
// A colour, a weight, and a text glyph — the same rule VisitProgressTable follows for its five
// statuses. Colour alone separates read from unread only for somebody who can see the colour, and
// this is the single most important distinction on the page.
const UNREAD_CLASSES = "border-l-4 border-l-primary bg-surface-raised";
const READ_CLASSES = "border-l-4 border-l-transparent bg-surface";

// ---------------------------------------------------------------------------
// THE CONTEXT CHIP: COLOUR AND BORDER, NEVER A FILL
// ---------------------------------------------------------------------------
// Following VisitProgressTable's status badges, which followed components/assignments/StageBadge:
// the tone is the TEXT and BORDER on the surrounding surface rather than white on a filled pill,
// because every --tone-* token in app/globals.css was measured against --surface and
// --surface-raised in both themes and a fill would need its own second measurement per tone.
//
// A STATIC Record, not an interpolated class name. Tailwind scans source text for complete class
// strings, so `border-tone-${tone}` compiles to nothing at all and the chip renders unstyled.
//
// The chip always carries the context's NAME beside the colour. Seven hues separate seven
// organizations only for somebody who can see all seven.
const TONE_CLASSES: Record<ContextTone, string> = {
  slate: "border-tone-slate text-tone-slate",
  blue: "border-tone-blue text-tone-blue",
  violet: "border-tone-violet text-tone-violet",
  magenta: "border-tone-magenta text-tone-magenta",
  teal: "border-tone-teal text-tone-teal",
  amber: "border-tone-amber text-tone-amber",
  rose: "border-tone-rose text-tone-rose",
};

export const ReportTile = forwardRef<HTMLLIElement, ReportTileProps>(function ReportTile(
  { tile, isFocused, isBusy, onOpen, onToggleBookmark },
  ref,
) {
  return (
    <li
      ref={ref}
      className={`rounded-md border border-border p-3 ${
        tile.isRead ? READ_CLASSES : UNREAD_CLASSES
      } ${isFocused ? "outline-2 outline-offset-2 outline-primary" : ""}`.trim()}
    >
      <div className="flex items-start justify-between gap-2">
        {/* The whole tile body is the tap target, so opening a report on a phone does not need a
            thumb on a small link. */}
        <button
          type="button"
          onClick={() => onOpen(tile)}
          disabled={isBusy}
          className="flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
        >
          <p
            className={`text-sm text-foreground ${
              tile.isRead ? "font-normal" : "font-semibold"
            }`}
          >
            {tile.isRead ? null : (
              // aria-hidden because the label below already announces it in words; a screen
              // reader saying "bullet Unread" would read the same fact twice.
              <span aria-hidden className="mr-1 text-primary">
                ●
              </span>
            )}
            {tile.subjectLabel}
            <span className="sr-only">{tile.isRead ? " (read)" : " (unread)"}</span>
          </p>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                TONE_CLASSES[tile.contextTone]
              }`}
            >
              {tile.contextLabel}
            </span>
            <span>{formatReportDate(tile.occurredOn)}</span>
          </p>

          {/* The exception only, and it carries the attention colour: a report that did not
              happen counts towards no goal, and rendering it identically to one that did would
              undo that distinction (lib/reports/types.ts). */}
          {tile.outcomeLabel === null ? null : (
            <p className="mt-1 text-sm font-medium text-warning">{tile.outcomeLabel}</p>
          )}

          <p className="mt-1 text-sm text-foreground">
            {tile.authorLabel === null ? NOBODY_RECORDED : tile.authorLabel}
          </p>

          {tile.recordedByLabel === null ? null : (
            <p className="text-xs text-muted">Recorded by {tile.recordedByLabel}</p>
          )}

          {/* SHARED notes only, already shortened to one line by the mapper. A private note has
              no route to this field (CLAUDE.md rule 5). */}
          <p
            className={`mt-2 text-sm ${
              tile.previewText === null ? "italic text-muted" : "text-foreground"
            }`}
          >
            {tile.previewText ?? NO_SHARED_NOTE}
          </p>
        </button>

        {/* THE PRIVATE BOOKMARK, not the ward-council flag. Nobody else ever sees this, and
            nothing is notified by it. */}
        <button
          type="button"
          onClick={() => onToggleBookmark(tile)}
          disabled={isBusy}
          aria-pressed={tile.bookmarked}
          aria-label={
            tile.bookmarked
              ? `Remove your bookmark on ${tile.subjectLabel}`
              : `Bookmark ${tile.subjectLabel} for yourself`
          }
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-lg text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden>{tile.bookmarked ? "★" : "☆"}</span>
        </button>
      </div>
    </li>
  );
});
