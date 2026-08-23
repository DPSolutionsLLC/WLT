// The whole calendar module's defence against the timezone pitfall 03-calendar.md opens with.
//
// `sundays.date` is a Postgres `date` — a day, with no time and no zone. `new Date("2026-03-01")`
// parses that as UTC midnight, but `getDay()`, `getDate()` and `toLocaleDateString()` all read it
// back in LOCAL time, so a machine anywhere west of UTC sees Saturday, February 28. Every bug that
// costs a Sunday its place on the calendar starts there.
//
// The rules this module exists to enforce:
//   - a date value is a `YYYY-MM-DD` string, never a Date, everywhere outside these functions
//   - every intermediate Date is built with Date.UTC(...) and read with getUTC*
//   - date arithmetic is milliseconds, never setDate()/setMonth(), which are local-time writes
//
// Never round-trip a calendar date through a local-time string. tests/lib/calendarDates.test.ts
// exists specifically to pin this.

export const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export type DateOnly = string; // YYYY-MM-DD

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Throws on a bad shape AND on a date that does not exist. `2026-02-30` parses without complaint
// into March 2 — Date.UTC rolls over silently — so the round trip back through formatDateOnly is
// what rejects it. Same reasoning as toEnumValue() in lib/roster/queries.ts: a value that should
// be impossible means two things have drifted, and throwing is the only safe answer.
export function parseDateOnly(value: DateOnly): Date {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error(
      `"${value}" is not a YYYY-MM-DD date. Calendar dates are date-only strings, never ` +
        "timestamps (lib/calendar/dates.ts).",
    );
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));

  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (formatDateOnly(parsed) !== value) {
    throw new Error(`"${value}" is not a date that exists.`);
  }

  return parsed;
}

export function formatDateOnly(date: Date): DateOnly {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Milliseconds against a UTC-midnight timestamp, which is what makes this DST-proof: it never
// constructs a local-time Date, so a day that is 23 or 25 hours long somewhere cannot shift it.
export function addDaysUtc(value: DateOnly, days: number): DateOnly {
  return formatDateOnly(new Date(parseDateOnly(value).getTime() + days * MS_PER_DAY));
}

export function isSunday(value: DateOnly): boolean {
  return parseDateOnly(value).getUTCDay() === 0;
}

export function firstSundayOnOrAfter(value: DateOnly): DateOnly {
  const weekday = parseDateOnly(value).getUTCDay();
  return weekday === 0 ? value : addDaysUtc(value, 7 - weekday);
}

// Inclusive at both ends: a range whose first day is itself a Sunday includes it, and so does one
// whose last day is.
export function sundaysInRange(from: DateOnly, to: DateOnly): DateOnly[] {
  const lastMs = parseDateOnly(to).getTime();
  const sundays: DateOnly[] = [];

  let current = firstSundayOnOrAfter(from);
  while (parseDateOnly(current).getTime() <= lastMs) {
    sundays.push(current);
    current = addDaysUtc(current, 7);
  }

  return sundays;
}

// For validation boundaries, which need a yes/no rather than an exception. parseDateOnly stays
// the throwing version because a bad date reaching the data layer means two things have drifted.
export function isValidDateOnly(value: string): boolean {
  try {
    parseDateOnly(value);
    return true;
  } catch {
    return false;
  }
}

export function monthStart(value: DateOnly): DateOnly {
  parseDateOnly(value);
  return `${value.slice(0, 7)}-01`;
}

// YYYY-MM, for grouping. A string rather than a { year, month } pair because it is only ever a
// Map key, and two strings compare without anyone writing a comparator.
export function monthOf(value: DateOnly): string {
  parseDateOnly(value);
  return value.slice(0, 7);
}

// Clamps to the last day of the target month rather than rolling over: addMonths("2026-01-31", 1)
// is 2026-02-28, not 2026-03-03. Rolling over would silently skip a month in a range loop.
export function addMonths(value: DateOnly, months: number): DateOnly {
  const parsed = parseDateOnly(value);
  const target = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + months, 1));

  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();

  return formatDateOnly(
    new Date(
      Date.UTC(
        target.getUTCFullYear(),
        target.getUTCMonth(),
        Math.min(parsed.getUTCDate(), daysInTargetMonth),
      ),
    ),
  );
}

// Both arguments must be Sundays — the whole point is a whole number of weeks, and a count of
// "Sundays between a Tuesday and a Friday" has no meaning the caller could have intended.
//
// A negative result is returned as-is. The caller decides what a date before the anchor means;
// resolveConductingUser() reads it as "outside this rotation" rather than wrapping.
export function countSundaysBetween(from: DateOnly, to: DateOnly): number {
  if (!isSunday(from) || !isSunday(to)) {
    throw new Error(
      `countSundaysBetween needs two Sundays; got "${from}" and "${to}".`,
    );
  }

  return (parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) / MS_PER_WEEK;
}

// Whole calendar months from one date to another: 0 for two dates in the same month, 1 from any
// day in March to any day in April, -1 the other way.
//
// Pure string arithmetic. This is the one date helper in the module that never constructs a Date
// at all, which makes it timezone-proof by having nothing to get wrong — the strongest possible
// version of the defence the rest of this file spends its effort on. parseDateOnly still runs on
// both arguments so a malformed input throws here rather than producing a plausible number.
//
// A negative result is returned as-is, matching countSundaysBetween. The caller decides what a
// date before the anchor means.
export function countMonthsBetween(from: DateOnly, to: DateOnly): number {
  parseDateOnly(from);
  parseDateOnly(to);

  const yearDelta = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  const monthDelta = Number(to.slice(5, 7)) - Number(from.slice(5, 7));

  return yearDelta * 12 + monthDelta;
}

// The last day of the month `value` falls in — 28, 29, 30 or 31, worked out rather than assumed.
// Building a range end by pasting "-31" onto a month is how you ask Postgres for 2026-02-31 and
// get a 500 instead of a calendar.
export function lastDayOfMonth(value: DateOnly): DateOnly {
  return addDaysUtc(monthStart(addMonths(value, 1)), -1);
}

// ---------------------------------------------------------------------------------------------
// Month helpers for the calendar UI (calendar-b).
//
// `today` is a PARAMETER on every function here, never a `new Date()` inside one. That is what
// makes these testable without freezing the clock, and it keeps the "what month am I looking at"
// decision in the page — where the session and the request live — rather than hidden in a helper.
// ---------------------------------------------------------------------------------------------

const MONTH_PARAM_PATTERN = /^\d{4}-\d{2}$/;

// A mistyped ?month= falls back to the current month rather than erroring. Somebody who edits the
// address bar should get a calendar, not a stack trace — the URL is a view, not a command.
export function parseMonthParam(value: string | undefined, today: DateOnly): DateOnly {
  if (value !== undefined && MONTH_PARAM_PATTERN.test(value) && isValidDateOnly(`${value}-01`)) {
    return `${value}-01`;
  }

  return monthStart(today);
}

// Every formatter below passes timeZone: "UTC" explicitly. Without it, Intl formats a UTC-midnight
// Date in the BROWSER's zone and a reader west of UTC sees the previous day — the same drift
// parseDateOnly exists to stop, arriving one layer later where a user actually reads it.
const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

const SUNDAY_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
});

// The same label WITH the year, for anywhere the surrounding page does not already supply it.
//
// formatSundayLabel() drops the year on purpose: on a calendar you are looking at one month, and
// repeating "2026" in every cell is noise. That reasoning does not survive contact with a list
// that spans years — a speaking history is read to answer "how long ago", and "Sunday, June 7"
// above "Sunday, June 2" hides that those are two years apart. Found by walking scenario 018.
const SUNDAY_LABEL_WITH_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function monthLabel(value: DateOnly): string {
  return MONTH_LABEL_FORMAT.format(parseDateOnly(value));
}

export function formatSundayLabel(value: DateOnly): string {
  return SUNDAY_LABEL_FORMAT.format(parseDateOnly(value));
}

export function formatSundayLabelWithYear(value: DateOnly): string {
  return SUNDAY_LABEL_WITH_YEAR_FORMAT.format(parseDateOnly(value));
}

// How many empty cells sit before the 1st in a Sunday-first month grid: 0 when the month opens on
// a Sunday, 6 when it opens on a Saturday. Pure arithmetic so the grid's padding is testable
// without rendering anything.
export function leadingBlankDays(value: DateOnly): number {
  return parseDateOnly(monthStart(value)).getUTCDay();
}

export function daysInMonth(value: DateOnly): number {
  return Number(lastDayOfMonth(value).slice(8, 10));
}
