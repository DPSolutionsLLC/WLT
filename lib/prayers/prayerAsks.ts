import { formatSundayLabelWithYear, type DateOnly } from "@/lib/calendar/dates";
import { askContactLine, NO_CONTACT_LINE } from "@/lib/sacrament/talkAsks";
import { MAX_TODO_NOTES, MAX_TODO_TITLE } from "@/lib/validation/todo";
import type { PrayerStage, PrayerType } from "@/types/domain";

// THE RULES FOR ASKING A SUNDAY'S PRAYERS — ITER-036 fb. Pure: no clock, no database.
// lib/sacrament/talkAsks.ts's shape, for prayers.
//
// NOTHING THAT TOUCHES `next/headers` MAY BE IMPORTED HERE. The hub's card and the Prayers board
// render the state this module computes, so it sits one import from the browser bundle.
//
// "NOT YET ASKED" IS COMPUTED, NEVER STORED. A prayer needs an ask when somebody is down to give it,
// it is still at `assign`, and nobody holds an open ask for it. A prayer moved to `ask` on the board
// by hand was asked already. Cancelled prayers are never read here at all (Sacrament slice f2c).

export type PrayerAskInput = {
  hasMember: boolean;
  stage: PrayerStage;
  // Open ask to-dos for this prayer, across every owner. Only "is it zero" is ever read.
  openAskCount: number;
};

export function prayerNeedsAsk(prayer: PrayerAskInput): boolean {
  return prayer.hasMember && prayer.stage === "assign" && prayer.openAskCount === 0;
}

export function countPrayersNeedingAsk(prayers: readonly PrayerAskInput[]): number {
  return prayers.filter(prayerNeedsAsk).length;
}

// Confirmed or given — they said yes.
export function prayerAccepted(prayer: PrayerAskInput): boolean {
  return prayer.hasMember && (prayer.stage === "confirm" || prayer.stage === "done");
}

export type PrayersLockReason = "no_prayer" | "no_conductor";

export const PRAYERS_LOCK_REASON_TEXT: Record<PrayersLockReason, string> = {
  no_prayer: "Nobody is down to pray yet",
  no_conductor: "Nobody is conducting yet",
};

// The Prayer pill's check on the hub and the board, in four states. There is no "declined" state,
// unlike the Talks pill's: a prayer keeps no record of a decline. Declining clears the person, so
// the pill's own count drops (2/2 → 1/2), which is what says somebody is needed.
export type PrayersAskState =
  | { kind: "locked"; reason: PrayersLockReason }
  | { kind: "not_finalized"; count: number }
  | { kind: "pending" }
  | { kind: "accepted" };

export type PrayersAskStateInput = {
  // sunday.prayersFinalizedAt !== null (migration 088).
  prayersFinalized: boolean;
  hasConductor: boolean;
  prayers: readonly PrayerAskInput[];
};

// PRESSED means the stamp is set AND nobody is left to ask — speakersSettled()'s rule. A stamp with
// prayers still to ask is a half-run, or a stamp a change failed to clear, and pressing again must
// ASK them rather than un-finalize over their heads.
export function prayersSettled(input: PrayersAskStateInput): boolean {
  return input.prayersFinalized && countPrayersNeedingAsk(input.prayers) === 0;
}

export function prayersAskState(input: PrayersAskStateInput): PrayersAskState {
  const withMember = input.prayers.filter((prayer) => prayer.hasMember);
  if (withMember.length === 0) return { kind: "locked", reason: "no_prayer" };

  if (!prayersSettled(input)) {
    return input.hasConductor
      ? { kind: "not_finalized", count: countPrayersNeedingAsk(withMember) }
      : { kind: "locked", reason: "no_conductor" };
  }

  return withMember.every(prayerAccepted) ? { kind: "accepted" } : { kind: "pending" };
}

// ---------------------------------------------------------------------------
// THE ASK'S TEXT
// ---------------------------------------------------------------------------

// What the invitation is for, in words a member would use. PRAYER_TYPE_LABELS says "Invocation".
export const PRAYER_ASK_PURPOSE: Record<PrayerType, string> = {
  invocation: "the opening prayer",
  benediction: "the closing prayer",
};

function purposeOf(prayerType: PrayerType | null): string {
  return prayerType === null ? "a prayer" : PRAYER_ASK_PURPOSE[prayerType];
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export function buildPrayerAskTitle(personName: string, prayerType: PrayerType | null): string {
  return truncate(`Ask ${personName.trim()} to give ${purposeOf(prayerType)}`, MAX_TODO_TITLE);
}

export type PrayerAskNotesInput = {
  personName: string;
  phone: string | null;
  prayerType: PrayerType | null;
  sundayDate: DateOnly;
};

// `sundays.date` is a `date` column, so the day is formatted in UTC (CLAUDE.md rule 12).
export function buildPrayerAskNotes(input: PrayerAskNotesInput): string {
  const purpose = purposeOf(input.prayerType);
  const lines = [
    `Prayer: ${purpose.charAt(0).toUpperCase()}${purpose.slice(1)}`,
    `Who: ${input.personName.trim()}`,
    askContactLine({ speakerName: input.personName, onRoster: true, phone: input.phone }) ??
      NO_CONTACT_LINE,
    `Sunday: ${formatSundayLabelWithYear(input.sundayDate)}`,
  ];
  return truncate(lines.join("\n"), MAX_TODO_NOTES);
}
