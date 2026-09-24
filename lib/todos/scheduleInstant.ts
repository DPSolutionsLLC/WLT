import { wallClockToInstant } from "@/lib/youth/ics/resolveInstant";

// "Schedule this" (p5-c): a day and a time typed as the WARD's wall clock, and back again.
//
// NEVER `new Date("2026-09-25T19:30")`. That reads the digits in the BROWSER's zone, so a leader
// travelling in another zone would book a time nobody agreed to — and the same call on the server
// reads them as UTC. The ward's zone is what every time in this app renders in (CLAUDE.md rule
// 12), so it is also what a typed time means. wallClockToInstant is the one place a wall clock and
// a zone name become an instant (lib/youth/ics/resolveInstant.ts), and it is used here rather than
// a second implementation.
//
// The inverse fills the window back in from a stored instant, in the same zone, so opening and
// saving an unchanged schedule is a no-op rather than a shift (the double conversion
// lib/youth/eventInstant.ts describes).
//
// Pure, and importable from a client component: no server imports and no argument-less clock.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export function wardInputsToInstant(date: string, time: string, timeZone: string): string | null {
  const dateMatch = DATE_PATTERN.exec(date.trim());
  const timeMatch = TIME_PATTERN.exec(time.trim());
  if (dateMatch === null || timeMatch === null) return null;

  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hour, minute] = timeMatch.slice(1).map(Number);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  // Date.UTC rolls 31 February into March silently; a day that does not exist is refused instead.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1) return null;

  const instant = wallClockToInstant({ year, month, day, hour, minute, second: 0 }, timeZone);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}

const INPUT_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function inputFormatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = INPUT_FORMATTERS.get(timeZone);
  if (existing !== undefined) return existing;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  INPUT_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

export function instantToWardInputs(
  instant: string,
  timeZone: string,
): { date: string; time: string } | null {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return null;

  const parts = inputFormatterFor(timeZone).formatToParts(parsed);
  const find = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${find("year")}-${find("month")}-${find("day")}`,
    time: `${find("hour")}:${find("minute")}`,
  };
}
