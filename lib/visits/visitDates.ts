import {
  countMonthsBetween,
  formatDateOnly,
  MS_PER_DAY,
  parseDateOnly,
  type DateOnly,
} from "@/lib/calendar/dates";

// How the visits module renders a day to a human. CLIENT-IMPORTABLE — types and Intl only.
//
// ---------------------------------------------------------------------------
// BOTH FORMATTERS RENDER THE YEAR, AND THAT IS THE WHOLE POINT OF THIS FILE
// ---------------------------------------------------------------------------
// formatSundayLabel() drops the year deliberately: on a calendar you are looking at one month
// and repeating "2026" in every cell is noise. That reasoning does not survive contact with a
// list that spans years. "Last visited: June 7" above "Last visited: June 2" hides that those
// are two years apart, which is precisely the question a leader opens this dashboard to answer —
// talks-d recorded the same bug in the speaking history, found by walking scenario 018.
//
// AppointmentPanel had the same defect, recorded as an open minor issue in visits-d's
// walkthrough: a 2099 appointment rendered identically to a 2026 one. Both formatters live here
// so the fix is one decision rather than two files that agreed by accident.
//
// ---------------------------------------------------------------------------
// WHY TWO FUNCTIONS AND NOT ONE
// ---------------------------------------------------------------------------
// A visit date is a Postgres `date` — a day with no time and no zone — and must be formatted in
// UTC or a reader west of UTC sees the previous day (lib/calendar/dates.ts opens on that bug).
// An appointment is a `timestamptz` — a real instant — and must be formatted in the WARD's zone
// or it shows a time nobody agreed to meet at.
//
// One function cannot be right about both. Sharing the year decision is what was actually worth
// sharing; sharing the timezone would have been a bug.

const VISIT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

// The em dash rather than an empty cell: a blank where a date goes reads as a column that failed
// to load, and "never" is a fact about the household worth stating.
export const NO_DATE = "—";

export function formatVisitDate(value: DateOnly | null): string {
  if (value === null) return NO_DATE;
  return VISIT_DATE_FORMAT.format(parseDateOnly(value));
}

// ---------------------------------------------------------------------------
// THE WARD'S ZONE, NOT THE READER'S — REVERSED 2026-08-29, AND WHY
// ---------------------------------------------------------------------------
// This function used to pass `undefined` for both locale and zone, so that an appointment showed
// in the reader's own zone: "a time somebody has to turn up at". The intent was right and the
// mechanism could not deliver it.
//
// A "use client" component is still SERVER-RENDERED on the first request. On the server there is
// no reader, so `undefined` resolves to the SERVER's zone — UTC on Vercel — and the browser then
// re-renders the same instant in its own. The result is a React #418 hydration mismatch and a
// visible flash of the wrong time, and in production the first paint is simply wrong: the youth
// calendar shipped "Sat, Jan 16, 2027, 2:30 AM" over a 7:30pm Friday game. Invisible in dev,
// where both sides are America/Denver — CLAUDE.md §9's "passes every test on the dev machine and
// ships wrong", arriving through the render path rather than through an ICS file.
//
// The ward's zone is deterministic, so the server and the browser agree by construction. It is
// also the better answer: a ward is one geographic congregation, so for very nearly every reader
// it IS their zone — and for the one who is travelling, "7:30pm" is the time the appointment was
// agreed for and the time you would say aloud, not 9:30pm in their hotel.
//
// The zone is a PARAMETER, resolved once per page by readWardTimezone() and handed down, the same
// discipline `asOf` keeps in this module: never read inside, so it stays pure and testable from
// literals. "en-US" rather than undefined for the same reason — a locale the server does not
// share with the browser is the identical bug in a second dimension.
export function formatAppointmentInstant(value: string, timeZone: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// HOW LONG OVERDUE, IN WORDS
// ---------------------------------------------------------------------------
// This replaces the percentage the badge used to carry for an overdue household. A percentage
// answers "how far past due, as a fraction of the interval", which is the right thing to SORT on
// and the wrong thing to read: 109% and 110% are a month apart on a yearly cadence and a day
// apart on a monthly one, and the reader cannot tell which without doing the arithmetic
// themselves. "3 weeks overdue" is the same fact in the unit a person acts in.
//
// `elapsedFraction` is unchanged and still drives the sort and the pill's fill — this is a
// display decision, not a change to the scale.
//
// The unit steps up as the gap grows, because precision stops helping: a household 14 months
// past due does not need "426 days". Months are counted with countMonthsBetween() rather than
// by dividing days, so "1 month overdue" means the calendar month actually turned.
//
// `asOf` is a PARAMETER, never a `new Date()` inside — the same discipline
// householdVisitPriority() keeps, and what makes the boundaries testable.
export function formatOverdueFor(dueOn: DateOnly, asOf: Date): string {
  const today = formatDateOnly(asOf);
  const days = Math.floor(
    (parseDateOnly(today).getTime() - parseDateOnly(dueOn).getTime()) / MS_PER_DAY,
  );

  // Not overdue at all, or due exactly today. The caller only asks about overdue rows, so this
  // is a guard against a caller that has drifted rather than a state a user reaches.
  if (days <= 0) return "due today";

  if (days < 14) {
    return `${days} ${days === 1 ? "day" : "days"} overdue`;
  }

  // ELAPSED months, not month BOUNDARIES crossed. countMonthsBetween() answers "how many times
  // did the month number change", so 15 June to 14 August is 2 by its reckoning — which would
  // report a household as "2 months overdue" when it is one day short of two months. Backing off
  // by one when the day of the month has not come round yet is how a person counts an age, and it
  // is the difference between a badge that is true and one that flatters the urgency.
  const dueDayOfMonth = Number(dueOn.slice(8, 10));
  const todayDayOfMonth = Number(today.slice(8, 10));
  const months =
    countMonthsBetween(dueOn, today) - (todayDayOfMonth < dueDayOfMonth ? 1 : 0);

  if (months < 2) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} overdue`;
  }

  if (months < 12) {
    return `${months} months overdue`;
  }

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (remainingMonths === 0) {
    return `${years} ${years === 1 ? "year" : "years"} overdue`;
  }

  return `${years}y ${remainingMonths}m overdue`;
}
