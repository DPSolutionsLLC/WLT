import { formatDateOnly, parseDateOnly, type DateOnly } from "@/lib/calendar/dates";
import type { MemberCategory } from "@/types/domain";

// The Church's rule, decided by the user in ITER-042 discovery: a child becomes a youth on
// January 1 of the year they turn 12, and an adult on their 18th birthday. ITER-042 imports this
// for "age group on that Sunday", so it must stay a pure function of two date-only strings.
//
// UTC parts only. A date-only value has no zone, and reading it back in local time is the
// off-by-one-day bug lib/calendar/dates.ts exists to prevent.

function eighteenthBirthday(birthDate: DateOnly): DateOnly {
  const born = parseDateOnly(birthDate);
  const year = born.getUTCFullYear() + 18;
  const month = born.getUTCMonth();
  const day = born.getUTCDate();

  // Date.UTC rolls Feb 29 over to Mar 1 in a non-leap year, which is the birthday we want.
  return formatDateOnly(new Date(Date.UTC(year, month, day)));
}

export function ageGroupOn(birthDate: DateOnly, asOf: DateOnly): MemberCategory {
  const youthFrom = `${String(parseDateOnly(birthDate).getUTCFullYear() + 12).padStart(4, "0")}-01-01`;

  if (asOf < youthFrom) return "child";
  if (asOf < eighteenthBirthday(birthDate)) return "youth";
  return "adult";
}
