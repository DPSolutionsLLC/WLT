import { addMonths, formatDateOnly, isValidDateOnly, monthStart } from "@/lib/calendar/dates";
import { SPEAKER_ROLES, SPEAKER_ROLE_LABELS, type SpeakerRole } from "@/types/domain";

// PURE, and CLIENT-SAFE. No client, no database, no next/headers — it parses strings and does
// date arithmetic. ScopePanel, FilterResolver and UploadForm all import it in the browser, and
// supabase/scripts/ingestConference.ts imports it under plain Node.
//
// Date arithmetic goes through lib/calendar/dates.ts rather than being re-derived here. That
// module exists to enforce one rule — every intermediate Date is built with Date.UTC and read
// with getUTC* — and a second, subtly different copy of it is exactly how a conference date
// starts landing a month early for anyone west of UTC.

// Re-exported so a reader working on the corpus finds the vocabulary in the module named after
// it, rather than reaching past into types/domain.ts. Same idiom as lib/ai/retrieve.ts
// re-exporting SIMILARITY_FLOOR. ONE definition, two names for where to look for it — the
// canonical list stays in types/domain.ts, next to the CHECK constraint it mirrors.
export { SPEAKER_ROLES, SPEAKER_ROLE_LABELS };
export type { SpeakerRole };

// A conference date is stored as the FIRST DAY OF THE CONFERENCE MONTH (migration 033). April
// and October are the two that exist, but nothing here hard-codes that: a ward ingesting a
// regional or stake conference should not be refused by a date parser.
const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MONTH_YEAR_PATTERN = /^([a-z]+)\s+(\d{4})$/;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

// NEVER THROWS. It is fed by a text input on the upload form and by a manifest file in the
// ingest script, and both have a caller ready to say something useful about null. A parser that
// throws on "Aprol 2026" turns a typo into a stack trace.
//
// Accepts "April 2026", "2026-04" and "2026-04-01"; returns the first of that month, always.
// Anything else is null.
export function parseConferenceDate(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return null;

  const monthYear = MONTH_YEAR_PATTERN.exec(trimmed);
  if (monthYear) {
    const monthIndex = MONTH_NAMES.indexOf(monthYear[1] as (typeof MONTH_NAMES)[number]);
    if (monthIndex === -1) return null;
    return `${monthYear[2]}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  }

  const yearMonth = YEAR_MONTH_PATTERN.exec(trimmed);
  if (yearMonth) {
    const candidate = `${yearMonth[1]}-${yearMonth[2]}-01`;
    return isValidDateOnly(candidate) ? candidate : null;
  }

  // A full date is accepted and NORMALISED to the first of its month rather than kept as given.
  // Two talks from the same conference entered as "2026-04-04" and "2026-04-05" would otherwise
  // sort apart and answer a `>= 2026-04-01` filter differently, which is not a distinction
  // anybody typing a conference date meant to draw.
  if (isValidDateOnly(trimmed)) return monthStart(trimmed);

  return null;
}

const CONFERENCE_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

// "April 2026". Falls back to the raw value rather than throwing: this renders in a list, and a
// row with an unexpected date should show something rather than blanking the page around it.
export function formatConferenceDate(value: string): string {
  if (!isValidDateOnly(value)) return value;
  return CONFERENCE_LABEL_FORMAT.format(new Date(`${value}T00:00:00Z`));
}

// RECENCY IS ONE AXIS AND GETS ONE CONTROL. Checkboxes for "last 2 years" and "last 5 years" are
// ambiguous the moment both are ticked — is that an intersection, a union, or a mistake? A single
// select cannot be asked the question. Speaker roles are the checkboxes, because a set of roles
// genuinely is a union and reads as one.
//
// `years: null` is NO LIMIT, and it is the default. A ward that has never opened this panel must
// retrieve exactly what it retrieved before ai-d shipped.
export const RECENCY_OPTIONS: readonly { label: string; years: number | null }[] = [
  { label: "No limit", years: null },
  { label: "Last 2 years", years: 2 },
  { label: "Last 5 years", years: 5 },
  { label: "Last 10 years", years: 10 },
];

export function recencyLabel(years: number | null): string {
  return RECENCY_OPTIONS.find((option) => option.years === years)?.label ?? `Last ${years} years`;
}

// Turns the panel's RELATIVE setting into the ABSOLUTE date match_document_chunks takes.
//
// Resolved at retrieval time and never at save time, which is the whole reason the setting
// stores a number of years. Pinning the date when the ward pressed Save would mean "the last two
// years" silently came to mean "since August 2026" and drifted a month further from the truth
// every month, with nothing on screen changing.
//
// `today` is a parameter rather than a Date.now() call so this is testable without freezing a
// clock, matching how lib/calendar/dates.ts is used everywhere else in this codebase.
export function resolveSinceDate(years: number | null, today: string): string | null {
  if (years === null) return null;
  return monthStart(addMonths(today, -12 * years));
}

// The date to hand resolveSinceDate in server code. Isolated here so exactly one line in this
// codebase reads the wall clock for conference scoping, and so a test can bypass it.
export function todayDateOnly(): string {
  return formatDateOnly(new Date());
}

export function isSpeakerRole(value: string): value is SpeakerRole {
  return (SPEAKER_ROLES as readonly string[]).includes(value);
}
