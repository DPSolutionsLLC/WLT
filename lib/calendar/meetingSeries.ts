import { sundaysInRange, type DateOnly } from "@/lib/calendar/dates";
import { isGeneralConference } from "@/lib/calendar/generateSundays";
import { holdsSacramentMeeting, type SundayType } from "@/types/domain";

// Which Sundays between two dates hold a sacrament meeting. Pure: dates and a map in, an array
// out. No ids, no Date.now(), no I/O — lib/calendar/queries.ts reads the stored types and hands
// them here.
//
// This exists because the conducting rotation now SKIPS a Sunday with no meeting. Counting turns
// therefore needs the history between the rotation's anchor and the Sunday being resolved, not
// just the target date.

export type MeetingSundayEntry = {
  date: DateOnly;
  holdsMeeting: boolean;
};

// `storedTypes` holds the types of the Sundays that actually have rows. Every other Sunday in
// the range falls back to a PREDICTED type, and that fallback is the whole point of this module.
//
// Months are generated on demand, so a bishopric skipping from August to December leaves August
// through November with no rows at all — routine, not exceptional. A walk over only the stored
// rows would count those gaps as zero cancellations, shift everyone's turn by however many
// general conferences it missed, and then STORE that wrong answer onto December's rows.
//
// The prediction is exactly right rather than merely convenient: a month with no rows cannot
// hold a hand-set stake conference, because setting one requires a row to set it on. The only
// cancellation that can exist in an un-generated month is general conference — the first Sunday
// of April and of October — and that is predictable from the date alone.
//
// A stored row always wins over the prediction, so a bishopric that cleared a general conference
// the Church actually moved is respected.
export function buildMeetingSeries(
  from: DateOnly,
  to: DateOnly,
  storedTypes: ReadonlyMap<DateOnly, SundayType>,
): MeetingSundayEntry[] {
  return sundaysInRange(from, to).map((date) => {
    const type: SundayType =
      storedTypes.get(date) ??
      (isGeneralConference(date) ? "general_conference" : "standard");

    return { date, holdsMeeting: holdsSacramentMeeting(type) };
  });
}
