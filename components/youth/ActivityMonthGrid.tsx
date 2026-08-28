"use client";

import {
  addDaysUtc,
  daysInMonth,
  leadingBlankDays,
  monthLabel,
  monthStart,
  type DateOnly,
} from "@/lib/calendar/dates";
import { COVERAGE_STATE_LABELS, type CoverageState } from "@/types/domain";

// A month of the ward's youth activities, at `md:` and up.
//
// ---------------------------------------------------------------------------
// components/calendar/MonthGrid.tsx WAS EXAMINED AND CANNOT BE REUSED
// ---------------------------------------------------------------------------
// That component renders SIX SUNDAY CELLS and inert spacers, keyed on Sunday rows, because a
// sacrament meeting calendar is a list of Sundays wearing a grid's clothes. This needs every day
// of the month to be a real cell — a Tuesday game is the ordinary case here. Recording the
// rejection with its reason is what stops the next reader re-opening the question.
//
// What IS reused is `daysInMonth` and `leadingBlankDays` from lib/calendar/dates.ts, which is the
// part that was actually worth sharing: both are pure UTC arithmetic, and both exist because
// `new Date("2026-03-01").getDay()` reads back in local time and loses a day west of UTC.
//
// ---------------------------------------------------------------------------
// A CELL IS A SUMMARY, NOT A LIST OF CARDS
// ---------------------------------------------------------------------------
// The card list below `md:` is the PRIMARY form — it is what a leader reads on a phone, and it is
// the one that must be right (08-youth-activities.md §Step 7). The grid answers a different
// question: which days of this month have something on, and which of those need attention. So a
// cell carries a count and the worst coverage state on that day, and the card list carries the
// detail.

export type ActivityMonthGridDay = {
  date: DateOnly;
  count: number;
  // The most urgent state among that day's events, already reduced by the caller with
  // coverageRank(). Null when the day's events are all `not_expected`, which renders as a plain
  // count rather than as a badge saying nothing.
  worstState: CoverageState | null;
};

export type ActivityMonthGridProps = {
  month: DateOnly;
  days: ActivityMonthGridDay[];
  // The reader's own "today", bucketed by the CALLER in the reader's zone. This component does no
  // clock reading of its own — see ActivityCalendar's header on why the reader's zone is the only
  // right answer for which day a card sits under.
  today: DateOnly | null;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A STATIC Record, never an interpolated class name: Tailwind scans source text for complete
// class strings (components/visits/ReportTile.tsx states the rule).
const STATE_CLASSES: Record<CoverageState, string> = {
  uncovered: "border-danger text-danger font-semibold",
  needs_type: "border-warning text-warning",
  unassigned: "border-warning/60 text-warning",
  covered: "border-success text-success",
  awareness: "border-border text-muted",
  not_expected: "border-border text-muted",
};

export function ActivityMonthGrid({ month, days, today }: ActivityMonthGridProps) {
  const start = monthStart(month);
  const blanks = leadingBlankDays(start);
  const total = daysInMonth(start);

  const byDate = new Map(days.map((day) => [day.date, day]));

  const cells: (ActivityMonthGridDay | null)[] = [];
  for (let index = 0; index < blanks; index += 1) cells.push(null);
  for (let dayNumber = 0; dayNumber < total; dayNumber += 1) {
    const date = addDaysUtc(start, dayNumber);
    cells.push(byDate.get(date) ?? { date, count: 0, worstState: null });
  }

  return (
    <div className="hidden md:block">
      <h3 className="text-base font-semibold text-foreground">{monthLabel(start)}</h3>

      <div className="mt-2 grid grid-cols-7 gap-1" role="grid" aria-label={monthLabel(start)}>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-1 py-1 text-xs font-medium text-muted">
            {label}
          </div>
        ))}

        {cells.map((cell, index) =>
          cell === null ? (
            // An inert spacer, not a day. `aria-hidden` so a screen reader is not read a column
            // of empty cells before the 1st.
            <div key={`blank-${index}`} aria-hidden className="min-h-16" />
          ) : (
            <div
              key={cell.date}
              className={`min-h-16 rounded-md border p-1 ${
                cell.date === today ? "border-primary" : "border-border"
              }`}
            >
              <div className="text-xs text-muted">{Number(cell.date.slice(8, 10))}</div>

              {cell.count === 0 ? null : (
                <div
                  className={`mt-1 rounded-full border px-1.5 py-0.5 text-xs ${
                    cell.worstState === null
                      ? "border-border text-muted"
                      : STATE_CLASSES[cell.worstState]
                  }`}
                >
                  {/* Pluralised rather than "event(s)". youth-b shipped three copy defects with a
                      green suite and one of them was exactly this. */}
                  {cell.count === 1 ? "1 event" : `${cell.count} events`}
                  {cell.worstState === null || cell.worstState === "not_expected" ? null : (
                    // The WORD as well as the colour. Seven days a month in a warning hue tells
                    // somebody who cannot see the hue nothing at all.
                    <span className="sr-only">
                      {` — ${COVERAGE_STATE_LABELS[cell.worstState]}`}
                    </span>
                  )}
                </div>
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
