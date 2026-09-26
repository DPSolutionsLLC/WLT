import { formatSundayLabelWithYear, type DateOnly } from "@/lib/calendar/dates";
import { MAX_TODO_NOTES, MAX_TODO_TITLE } from "@/lib/validation/todo";
import type { RequestOutcome } from "@/types/domain";

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
// open ask for it, and its outcome is not already decided. So pressing Send asks again later sends
// only the talks that still need one (U9). A speaker change closes the old ask and clears the
// outcome (PATCH /api/assignments/[id]), which puts the new speaker back on this list on its own.

export type TalkAskInput = {
  hasSpeaker: boolean;
  requestOutcome: RequestOutcome | null;
  // Open ask to-dos for this talk, across every owner. The conductor's and the assistant's copies
  // of one ask count twice. Only "is it zero" is ever read.
  openAskCount: number;
};

export function talkNeedsAsk(talk: TalkAskInput): boolean {
  return (
    talk.hasSpeaker &&
    talk.openAskCount === 0 &&
    (talk.requestOutcome === null || talk.requestOutcome === "pending")
  );
}

export function countTalksNeedingAsk(talks: readonly TalkAskInput[]): number {
  return talks.filter(talkNeedsAsk).length;
}

export type TalksLockReason = "references_open" | "no_speaker" | "no_conductor";

export const TALKS_LOCK_REASON_TEXT: Record<TalksLockReason, string> = {
  references_open: "Finalize or skip References first",
  no_speaker: "No speaker to ask yet",
  no_conductor: "Nobody is conducting yet",
};

// The Talks pill's check on the hub, in five states.
export type TalksAskState =
  | { kind: "locked"; reason: TalksLockReason }
  | { kind: "not_asked"; count: number }
  | { kind: "pending" }
  | { kind: "accepted" }
  | { kind: "declined"; count: number };

export type TalksAskStateInput = {
  // referencesDecisionOf(sunday) !== null — finalized OR skipped.
  referencesDecided: boolean;
  hasConductor: boolean;
  talks: readonly TalkAskInput[];
};

// PRECEDENCE: declined, then not asked, then pending, then all accepted. That is the prototype's
// order with "not yet asked" added.
//
// A DECLINE OUTRANKS "NO SPEAKER". A decline clears the speaker, so a Sunday whose only speaker
// said no has no speaker at all. Checking for a speaker first would dim the pill and hide the one
// state that needs somebody to act. The References gate still comes first: until the talks are
// ready, nothing about them has been asked.
//
// NO CONDUCTOR LOCKS ONLY WHAT IT BLOCKS. Asks already sent keep their state when the conductor is
// cleared (the open asks stay with the previous owner). Only a Sunday with speakers still to ask
// is locked, because Send asks has nobody to give them to.
export function talksAskState(input: TalksAskStateInput): TalksAskState {
  if (!input.referencesDecided) return { kind: "locked", reason: "references_open" };

  const declined = input.talks.filter((talk) => talk.requestOutcome === "declined").length;
  if (declined > 0) return { kind: "declined", count: declined };

  const withSpeaker = input.talks.filter((talk) => talk.hasSpeaker);
  if (withSpeaker.length === 0) return { kind: "locked", reason: "no_speaker" };

  const notAsked = countTalksNeedingAsk(withSpeaker);
  if (notAsked > 0) {
    return input.hasConductor
      ? { kind: "not_asked", count: notAsked }
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
