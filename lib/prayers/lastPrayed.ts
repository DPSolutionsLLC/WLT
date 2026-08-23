import { parseDateOnly, type DateOnly } from "@/lib/calendar/dates";

// "Last prayed March 2025", or nothing at all. Pure and client-importable — PrayerBoard renders
// it beside every name in the picker (plans/retros/roster-b-picker-and-orgs.md on why the pure
// rule cannot live in queries.ts).
//
// lib/calendar/dates.ts is safe to import: it is pure UTC arithmetic with no Supabase and no
// next/headers, and MemberPicker already depends on the same class of module.

export type LastPrayed = {
  memberId: string;
  // The DATE of the Sunday the prayer was given on, not a timestamp. A prayer belongs to a
  // Sunday, and "March 2025" is a fact about the meeting rather than about when a row was
  // written.
  lastPrayedAt: DateOnly | null;
};

const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

// Returns NULL when there is no history, and never the word "Never".
//
// Somebody who has not been asked is not a category of person. "Never" beside a name reads as a
// judgement about them rather than as an absence of data, and the bishopric would be reading it
// down a list of their own ward. Render nothing and let the absence speak — the names with no
// label are exactly the ones to consider, which is the nudge this label exists to give.
export function lastPrayedLabel(lastPrayedAt: DateOnly | null): string | null {
  if (lastPrayedAt === null) return null;

  return `Last prayed ${MONTH_YEAR_FORMAT.format(parseDateOnly(lastPrayedAt))}`;
}

// The most recent Sunday date per member, from rows that have ALREADY been filtered to the
// completed stage by the caller. Keeping the stage filter out of here is deliberate: this
// function cannot be handed an `ask` row and quietly count it, because it has no stage to look
// at (types/domain.ts PRAYER_COMPLETED_STAGE says why that matters).
export function latestPrayerDates(
  rows: readonly { memberId: string; date: DateOnly }[],
): Map<string, DateOnly> {
  const latest = new Map<string, DateOnly>();

  for (const row of rows) {
    const current = latest.get(row.memberId);
    // Date-only strings sort lexicographically because they are zero-padded ISO.
    if (current === undefined || row.date > current) {
      latest.set(row.memberId, row.date);
    }
  }

  return latest;
}

// One lookup shaped for a whole picker at once, so a caller annotates a roster without asking
// "when did this person last pray" per name.
export function shapeLastPrayed(
  memberIds: readonly string[],
  rows: readonly { memberId: string; date: DateOnly }[],
): LastPrayed[] {
  const latest = latestPrayerDates(rows);

  return memberIds.map((memberId) => ({
    memberId,
    lastPrayedAt: latest.get(memberId) ?? null,
  }));
}
