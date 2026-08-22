import {
  monthOf,
  parseDateOnly,
  sundaysInRange,
  type DateOnly,
} from "@/lib/calendar/dates";
import { resolveFastSunday } from "@/lib/calendar/resolveFastSunday";
import { FALLBACK_SPEAKING_SLOTS } from "@/lib/calendar/wardCalendarSettings";
import { holdsSacramentMeeting, type SundayType } from "@/types/domain";

// Pure: a date range in, the rows that should exist out. No ids — ids do not exist until the rows
// are inserted — no Date.now(), and no I/O. lib/calendar/queries.ts is what turns this into an
// idempotent insert.

export type GeneratedSunday = {
  date: DateOnly;
  type: SundayType;
  speakingSlots: number;
};

// General conference is the first Sunday of April and of October.
//
// This is a PREDICTION the bishopric can override, not a fact — the Church has moved a session
// before and will again. It is pre-marked anyway for one reason: general conference DISPLACES
// FAST SUNDAY, and a calendar that generates a month with Fast Sunday in the wrong place makes
// every downstream speaker assignment wrong before anybody looks at it.
//
// Exported because lib/calendar/meetingSeries.ts needs the same prediction for months that have
// no rows yet, and two copies of a rule this load-bearing would drift.
export function isGeneralConference(date: DateOnly): boolean {
  const parsed = parseDateOnly(date);
  const month = parsed.getUTCMonth();
  const isAprilOrOctober = month === 3 || month === 9;

  return isAprilOrOctober && parsed.getUTCDate() <= 7;
}

// `defaultSpeakingSlots` is the WARD'S setting, read once by the caller and passed in — this
// function stays pure and has no idea a database exists. It defaults to the same fallback the
// settings reader uses so a test or a future caller can leave it out.
export function generateSundays(
  from: DateOnly,
  to: DateOnly,
  defaultSpeakingSlots: number = FALLBACK_SPEAKING_SLOTS,
): GeneratedSunday[] {
  const generated: GeneratedSunday[] = sundaysInRange(from, to).map((date) => {
    const type: SundayType = isGeneralConference(date) ? "general_conference" : "standard";

    // Keyed on the predicate rather than on the name of one type, so a future no-meeting type
    // gets zero speaking slots without anyone remembering to come back to this line.
    return {
      date,
      type,
      speakingSlots: holdsSacramentMeeting(type) ? defaultSpeakingSlots : 0,
    };
  });

  const byMonth = new Map<string, GeneratedSunday[]>();
  for (const sunday of generated) {
    const month = monthOf(sunday.date);
    const existing = byMonth.get(month);
    if (existing) {
      existing.push(sunday);
    } else {
      byMonth.set(month, [sunday]);
    }
  }

  // A month only PARTIALLY covered by the range resolves against only the Sundays this call
  // generated, so a range starting on the 15th can put Fast Sunday on the third Sunday. That is
  // the honest answer for a ragged range, and it does not arise in practice because
  // ensureMonthGenerated() and generateSundayRange() both widen to whole months before calling
  // here. A caller that generates a ragged range gets a ragged answer.
  for (const monthSundays of byMonth.values()) {
    const fastSundayDate = resolveFastSunday(
      monthSundays.map((sunday) => ({
        // The date doubles as the id: real ids do not exist before the insert, and this function
        // only needs to identify a candidate it is already holding.
        id: sunday.date,
        date: sunday.date,
        type: sunday.type,
        fastSundayPinned: false,
      })),
    );

    if (fastSundayDate === null) continue;

    const winner = monthSundays.find((sunday) => sunday.date === fastSundayDate);
    if (winner) {
      winner.type = "fast_sunday";
      winner.speakingSlots = 0;
    }
  }

  return generated;
}
