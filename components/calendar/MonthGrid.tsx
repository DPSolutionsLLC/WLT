import {
  SundayCell,
  type SundayReservedRegions,
} from "@/components/calendar/SundayCell";
import { daysInMonth, leadingBlankDays, type DateOnly } from "@/lib/calendar/dates";
import type { Sunday } from "@/lib/calendar/queries";

export type MonthGridProps = {
  monthStart: DateOnly;
  sundays: Sunday[];
  conductingNames: Record<string, string>;
  // Phase 4's reserved-region content, keyed by Sunday id. Built ONCE by the page from one
  // month-wide read and threaded through here, rather than each cell fetching its own — a grid
  // that fetches per cell is six round trips to draw one month.
  regionsBySundayId?: Record<string, SundayReservedRegions>;
};

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// Seven columns, Sunday first. Only the Sunday column carries content — the other six are inert
// spacers that give the month the shape a reader recognises, which is the whole reason this is a
// grid rather than a list of six dates.
//
// No virtualization and no new dependency: a month is at most six rows.
export function MonthGrid({
  monthStart,
  sundays,
  conductingNames,
  regionsBySundayId,
}: MonthGridProps) {
  const blanks = leadingBlankDays(monthStart);
  const days = daysInMonth(monthStart);

  // Built from the date STRING, so no Date is constructed for display anywhere in the grid.
  const monthPrefix = monthStart.slice(0, 7);
  const sundayByDate = new Map(sundays.map((sunday) => [sunday.date, sunday]));

  return (
    <div>
      <div className="grid grid-cols-7 gap-2" role="presentation">
        {WEEKDAY_HEADERS.map((weekday) => (
          <div key={weekday} className="pb-1 text-center text-xs font-medium text-muted">
            {weekday}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: blanks }, (_, index) => (
          <div key={`blank-${index}`} aria-hidden="true" />
        ))}

        {Array.from({ length: days }, (_, index) => {
          const dayOfMonth = index + 1;
          const date = `${monthPrefix}-${String(dayOfMonth).padStart(2, "0")}`;
          const sunday = sundayByDate.get(date);

          if (!sunday) {
            return (
              <div
                key={date}
                className="min-h-40 rounded-md bg-surface p-2 text-xs text-muted"
              >
                {dayOfMonth}
              </div>
            );
          }

          const regions = regionsBySundayId?.[sunday.id];

          return (
            <SundayCell
              key={date}
              sunday={sunday}
              conductingNames={conductingNames}
              speakers={regions?.speakers}
              pipelineStatus={regions?.pipelineStatus}
              goalAlerts={regions?.goalAlerts}
            />
          );
        })}
      </div>
    </div>
  );
}
