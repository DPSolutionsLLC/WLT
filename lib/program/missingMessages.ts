import type { ProgramDraft } from "@/lib/program/draft";
import {
  MISSING_FIELD_KEYS,
  MISSING_FIELD_LABELS,
  type MissingFieldKey,
} from "@/types/domain";

// What is still needed on a program, worded as sentences and counted.
//
// PURE, and client-safe: types/domain and lib/program/draft only, so MissingPanel can import it
// from a "use client" component (plans/retros/roster-b-picker-and-orgs.md).
//
// ---------------------------------------------------------------------------------------------
// THE SENTENCES ALREADY EXIST — THIS FILE DOES NOT RESTATE THEM
// ---------------------------------------------------------------------------------------------
// program-b's plan asked for a new MISSING_MESSAGES map here. types/domain.ts already holds one:
// MISSING_FIELD_LABELS, a closed Record<MissingFieldKey, string> of exactly those sentences, and
// lib/program/diff.ts's MISSING_LABELS comment names it as "the sentences on program-b's screen".
// A second copy would be a second thing to keep in step, so this module consumes that map and
// adds only what it did not have: grouping, counting and the plural form.
//
// The compile-time discipline the plan wanted is unchanged — a key added to MISSING_FIELD_KEYS
// still fails to build until somebody writes its sentence, one file earlier.
//
// ---------------------------------------------------------------------------------------------
// ONLY ONE KEY CAN MEAN MORE THAN ONE THING
// ---------------------------------------------------------------------------------------------
// `speaker_slot` is emitted ONCE by assembleDraft (it is a `.some()` check) however many slots
// are open, so the count cannot come from the `missing` array — it comes from the speakers
// themselves. Every other key names a single field and is always a count of one.
//
// Repeats in `missing` are collapsed rather than trusted: the array is stored jsonb that a
// hand-edit or an AI edit could put a duplicate into, and two identical sentences in a checklist
// look like a rendering fault.

// Deliberately Partial. A closed Record would demand a plural sentence for nine keys that can
// never be plural, and a written sentence nobody can reach is worse than an absent one.
export const MISSING_PLURAL_MESSAGES: Partial<
  Record<MissingFieldKey, (count: number) => string>
> = {
  speaker_slot: (count) => `${count} speaking slots are still open.`,
};

export type MissingItem = {
  key: MissingFieldKey;
  // How many of this thing are needed. One for every key except `speaker_slot`.
  count: number;
  // The sentence a person reads. Never a field name (calendar-b's raw-uuid rule).
  message: string;
};

function countFor(key: MissingFieldKey, draft: ProgramDraft): number {
  if (key !== "speaker_slot") return 1;

  const open = draft.speakers.filter((speaker) => speaker.kind === "empty").length;

  // A draft that names the gap but has no empty slot to point at is still reporting one thing
  // needed. Falling to 0 here would render "0 speaking slots are still open".
  return open === 0 ? 1 : open;
}

export function messageFor(key: MissingFieldKey, count: number): string {
  const plural = MISSING_PLURAL_MESSAGES[key];
  return count > 1 && plural ? plural(count) : MISSING_FIELD_LABELS[key];
}

// In MISSING_FIELD_KEYS order rather than in the stored array's order, so two programs with the
// same gaps read the same way round however their drafts were written.
export function missingItems(draft: ProgramDraft): MissingItem[] {
  const present = new Set(draft.missing);

  return MISSING_FIELD_KEYS.filter((key) => present.has(key)).map((key) => {
    const count = countFor(key, draft);
    return { key, count, message: messageFor(key, count) };
  });
}

// "3 things still needed", "1 thing still needed". Never "0 things" — a complete program says so
// in its own words rather than counting to zero (talks-c: an absence renders as an absence).
export function missingSummary(itemCount: number): string {
  return `${itemCount} ${itemCount === 1 ? "thing" : "things"} still needed`;
}
