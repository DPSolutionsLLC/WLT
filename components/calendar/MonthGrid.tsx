import { SundayCell } from "@/components/calendar/SundayCell";
import { daysInMonth, leadingBlankDays, type DateOnly } from "@/lib/calendar/dates";
import type { Sunday } from "@/lib/calendar/queries";

export type MonthGridProps = {
  monthStart: DateOnly;
  sundays: Sunday[];
  conductingNames: Record<string, string>;
};

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// Seven columns, Sunday first. Only the Sunday column carries content — the other six are inert
// spacers that give the month the shape a reader recognises, which is the whole reason this is a
// grid rather than a list of six dates.
//
// No virtualization and no new dependency: a month is at most six rows.
export function MonthGrid({ monthStart, sundays, conductingNames }: MonthGridProps) {
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

          return (
            <SundayCell
              key={date}
              sunday={sunday}
              conductingNames={conductingNames}
            />
          );
        })}
      </div>
    </div>
  );
}
