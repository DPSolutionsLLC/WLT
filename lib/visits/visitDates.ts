import { parseDateOnly, type DateOnly } from "@/lib/calendar/dates";

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
// An appointment is a `timestamptz` — a real instant — and must be formatted in the reader's own
// zone or it shows a time nobody agreed to meet at.
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

// The reader's OWN locale and zone, from the browser — undefined locale rather than "en-US",
// because an appointment is a time somebody has to turn up at.
export function formatAppointmentInstant(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
