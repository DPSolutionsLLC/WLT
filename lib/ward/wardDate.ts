// The calendar date an instant falls on IN THE WARD'S ZONE, as YYYY-MM-DD.
//
// "Today" for anything a ward's leaders plan by — is this to-do overdue, is that youth event past —
// is the WARD's date. NEVER `new Date().toISOString().slice(0, 10)`: that is UTC, and after 6pm
// Mountain it already reads tomorrow, so an item due today would show as overdue all evening
// (CLAUDE.md rule 12).
//
// A PURE MODULE ON PURPOSE, separate from lib/ward/wardTimezone.ts, which imports the server
// Supabase client. That file READS the zone name; this one does arithmetic with it, and stays
// importable from client components and pure modules alike.
//
// `en-CA` yields YYYY-MM-DD; formatToParts rather than trusting the separator, for the reason
// lib/youth/reportTiles.ts gives — an ICU update must not change the shape of the string.

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = FORMATTERS.get(timeZone);
  if (existing !== undefined) return existing;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  FORMATTERS.set(timeZone, formatter);
  return formatter;
}

export function wardDateOnly(instant: Date, timeZone: string): string {
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("wardDateOnly was given an invalid Date.");
  }

  const parts = formatterFor(timeZone).formatToParts(instant);
  const find = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";

  return `${find("year")}-${find("month")}-${find("day")}`;
}
