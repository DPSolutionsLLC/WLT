import { sundaysInRange, type DateOnly } from "@/lib/calendar/dates";
import type { MeetingSundayEntry } from "@/lib/calendar/meetingSeries";

// A meeting series with NO cancellations at all.
//
// resolveConductingUser() takes the meeting history as a required argument, so every existing
// rotation test has to supply one. The suites that predate the skip rule are all asking "what
// does the cycle do when nothing interrupts it", and this is that question written down: their
// assertions keep the meaning they were written with rather than being retuned around a
// cancellation they never intended to test.
//
// A test that DOES care about cancellations should build its series explicitly, or call
// buildMeetingSeries() with the stored types it is exercising.
export function allMeetingSeries(from: DateOnly, to: DateOnly): MeetingSundayEntry[] {
  return sundaysInRange(from, to).map((date) => ({ date, holdsMeeting: true }));
}

// The same, minus the dates named. Sugar for "everything holds a meeting except these", which is
// the shape most skip assertions want.
export function seriesWithout(
  from: DateOnly,
  to: DateOnly,
  cancelled: DateOnly[],
): MeetingSundayEntry[] {
  const dead = new Set(cancelled);

  return sundaysInRange(from, to).map((date) => ({
    date,
    holdsMeeting: !dead.has(date),
  }));
}
