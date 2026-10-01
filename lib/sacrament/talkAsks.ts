import { formatSundayLabelWithYear, type DateOnly } from "@/lib/calendar/dates";
import { MAX_TODO_NOTES, MAX_TODO_TITLE } from "@/lib/validation/todo";
import { holdsSacramentMeeting, type RequestOutcome, type SundayType } from "@/types/domain";

// THE RULES FOR ASKING A SUNDAY'S SPEAKERS — Sacrament slice f1. Pure: no clock, no database.
//
// NOTHING THAT TOUCHES `next/headers` MAY BE IMPORTED HERE. The hub's card renders the state this
// module computes, so it sits one import from the browser bundle (lib/sacrament/sundayStatus.ts
// carries the same rule). `@/lib/calendar/dates` is pure string arithmetic, and
// `@/lib/validation/todo` imports only zod and that file.
//
// ---------------------------------------------------------------------------
// "NOT YET ASKED" IS COMPUTED, NEVER STORED
// ---------------------------------------------------------------------------
// There is no `talks_asked_at` column. A talk needs an ask when it has a speaker, nobody holds an
// open ask for it, and its outcome is not already decided. So finalizing speakers again later asks
// only the talks that still need one (U9). A speaker change withdraws the old ask, clears the
// outcome and un-finalizes the speakers (PATCH /api/assignments/[id], ITER-036 D2), which puts the
// new speaker back on this list on its own.

export type TalkAskInput = {
  hasSpeaker: boolean;
  requestOutcome: RequestOutcome | null;
  // Open ask to-dos for this talk, across every owner. The conductor's and the assistant's copies
  // of one ask count twice. Only "is it zero" is ever read.
  openAskCount: number;
  // talkIsOff(): nobody is asked to give a talk that is off (Sacrament slice f2b).
  isOff: boolean;
};

export function talkNeedsAsk(talk: TalkAskInput): boolean {
  return (
    talk.hasSpeaker &&
    !talk.isOff &&
    talk.openAskCount === 0 &&
    (talk.requestOutcome === null || talk.requestOutcome === "pending")
  );
}

// ---------------------------------------------------------------------------
// A TALK IS OFF — Sacrament slice f2b
// ---------------------------------------------------------------------------
// Its Sunday holds no sacrament meeting (a stake conference), or its slot no longer exists (a Fast
// Sunday has no speaking slots; a Sunday can be cut to fewer). COMPUTED from the Sunday every time,
// never stored: the calendar decides it, and the calendar can change back. A talk with no slot
// number is off only when the meeting is.
export function talkIsOff(input: {
  sundayType: SundayType;
  speakingSlots: number;
  slotNumber: number | null;
}): boolean {
  if (!holdsSacramentMeeting(input.sundayType)) return true;
  return input.slotNumber !== null && input.slotNumber > input.speakingSlots;
}

export function countTalksNeedingAsk(talks: readonly TalkAskInput[]): number {
  return talks.filter(talkNeedsAsk).length;
}

// REFERENCES NO LONGER LOCK THE ASKS (ITER-036, D5). The ask card reads the topic's references
// live, so speakers can be finalized before the references are decided.
export type TalksLockReason = "no_speaker" | "no_conductor";

export const TALKS_LOCK_REASON_TEXT: Record<TalksLockReason, string> = {
  no_speaker: "No speaker to ask yet",
  no_conductor: "Nobody is conducting yet",
};

// The Talks pill's check on the hub, in five states.
export type TalksAskState =
  | { kind: "locked"; reason: TalksLockReason }
  | { kind: "not_finalized"; count: number }
  | { kind: "pending" }
  | { kind: "accepted" }
  | { kind: "declined"; count: number };

export type TalksAskStateInput = {
  // sunday.speakersFinalizedAt !== null (migration 088).
  speakersFinalized: boolean;
  hasConductor: boolean;
  talks: readonly TalkAskInput[];
};

// Whether the finalize control reads PRESSED: the stamp is set AND nobody is left to ask. A stamp
// with speakers still to ask is a half-finished run (or a stamp a speaker change failed to clear),
// and pressing the control again must ASK them — never un-finalize over their heads.
export function speakersSettled(input: TalksAskStateInput): boolean {
  return input.speakersFinalized && countTalksNeedingAsk(input.talks) === 0;
}

// PRECEDENCE: declined, then not finalized, then pending, then all accepted. That is the
// prototype's order with "not finalized" added (ITER-036).
//
// A DECLINE OUTRANKS "NO SPEAKER". A decline clears the speaker, so a Sunday whose only speaker
// said no has no speaker at all. Checking for a speaker first would dim the pill and hide the one
// state that needs somebody to act.
//
// NOT FINALIZED covers two cases with one meaning, "pressing this asks people": a Sunday nobody has
// finalized (its count may be 0 after an un-finalize kept a scheduled ask), and a finalized Sunday
// with speakers still to ask.
//
// NO CONDUCTOR LOCKS ONLY WHAT IT BLOCKS. Asks already sent keep their state when the conductor is
// cleared (the open asks stay with the previous owner). Only a Sunday that still needs finalizing
// is locked, because finalizing has nobody to give the asks to.
export function talksAskState(input: TalksAskStateInput): TalksAskState {
  const declined = input.talks.filter((talk) => talk.requestOutcome === "declined").length;
  if (declined > 0) return { kind: "declined", count: declined };

  const withSpeaker = input.talks.filter((talk) => talk.hasSpeaker);
  if (withSpeaker.length === 0) return { kind: "locked", reason: "no_speaker" };

  if (!speakersSettled(input)) {
    return input.hasConductor
      ? { kind: "not_finalized", count: countTalksNeedingAsk(withSpeaker) }
      : { kind: "locked", reason: "no_conductor" };
  }

  return withSpeaker.every((talk) => talk.requestOutcome === "accepted")
    ? { kind: "accepted" }
    : { kind: "pending" };
}

// ---------------------------------------------------------------------------
// THE ASK'S TEXT
// ---------------------------------------------------------------------------

export const VISITOR_CONTACT_LINE = "Not on the roster — no contact on file";
export const NO_CONTACT_LINE = "No contact on file";

export type AskNotesInput = {
  speakerName: string;
  onRoster: boolean;
  phone: string | null;
  topicTitle: string | null;
  sundayDate: DateOnly;
  references: readonly string[];
};

// The contact line an ask shows: the phone, or why there is none. Null when the talk has no speaker
// any more (a decline clears it), because "no contact on file" would then describe nobody.
export function askContactLine(input: {
  speakerName: string | null;
  onRoster: boolean;
  phone: string | null;
}): string | null {
  if (input.speakerName === null) return null;
  if (!input.onRoster) return VISITOR_CONTACT_LINE;
  const phone = input.phone?.trim() ?? "";
  return phone === "" ? NO_CONTACT_LINE : `Phone: ${phone}`;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export function buildAskTitle(speakerName: string): string {
  return truncate(`Ask ${speakerName.trim()} to speak`, MAX_TODO_TITLE);
}

// "LET ___ KNOW IT'S CANCELLED" (Sacrament slices f2b and f2c). Whoever asked somebody to take part
// on a Sunday that lost it gets one of these. Worded without a pronoun, which the app cannot know.
export function buildTellTitle(speakerName: string): string {
  return truncate(`Let ${speakerName.trim()} know the talk is cancelled`, MAX_TODO_TITLE);
}

export function buildPrayerTellTitle(personName: string): string {
  return truncate(`Let ${personName.trim()} know the prayer is cancelled`, MAX_TODO_TITLE);
}

// `performer` is free text and may be empty.
export function buildMusicTellTitle(performer: string | null): string {
  const who = performer === null || performer.trim() === "" ? "the performer" : performer.trim();
  return truncate(`Let ${who} know the musical number is cancelled`, MAX_TODO_TITLE);
}

// `sundays.date` is a `date` column, so the day is formatted in UTC (CLAUDE.md rule 12).
export function buildAskNotes(input: AskNotesInput): string {
  const lines = [
    `Speaker: ${input.speakerName.trim()}`,
    askContactLine(input) ?? NO_CONTACT_LINE,
    `Sunday: ${formatSundayLabelWithYear(input.sundayDate)}`,
    `Topic: ${input.topicTitle?.trim() || "No topic yet"}`,
  ];

  if (input.references.length > 0) {
    lines.push("References:", ...input.references.map((citation) => `- ${citation}`));
  }

  return truncate(lines.join("\n"), MAX_TODO_NOTES);
}
