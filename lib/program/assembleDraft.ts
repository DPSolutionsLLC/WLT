import { speakerFrom, externalDisplayName } from "@/lib/assignments/speaker";
import type { HymnSelection, ProgramSources } from "@/lib/program/gather";
import type {
  HymnRef,
  MusicalNumberField,
  NameField,
  ProgramDraft,
  ProgramSpeaker,
} from "@/lib/program/draft";
import { PROGRAM_DRAFT_VERSION } from "@/lib/program/draft";
import {
  PIPELINE_STAGES,
  type HymnType,
  type MissingFieldKey,
  type PipelineStage,
} from "@/types/domain";

// Sources in, one program draft out. PURE — no Supabase import, no await, no clock read.
//
// ---------------------------------------------------------------------------------------------
// THE NAME RULE, STATED ONCE
// ---------------------------------------------------------------------------------------------
// Every person on a program carries a printedName and a publicName (program-a Decision 3). Which
// one differs is decided by ONE question:
//
//   Did this name come from a RECORD, or did somebody TYPE it in order to have it printed?
//
//   From a record (a member, a bishopric user)  ->  printed in full, public as "Sarah W."
//   Typed to be printed (an external speaker,   ->  identical in both, in full
//   a presiding override, a musical performer)
//
// The reasoning is ITER-004's: a roster name is private data the ward never consented to publish,
// while a name the bishopric typed specifically so it would appear on a program has no member
// record behind it to protect, and a visiting stake president is named in full on every paper
// program there has ever been. Shortening typed text is also actively wrong — "The Primary
// children" would become "The Primary c.".
//
// ---------------------------------------------------------------------------------------------
// MISSING IS A LIST, NEVER A THROW
// ---------------------------------------------------------------------------------------------
// A program built on Thursday with no confirmed speaker, two of three hymns and no announcements
// assembles successfully with several entries in `missing`. That is the normal case, not the
// error case (06-program-music.md §Step 2).
//
// No field is ever the string "TBD" or "Not yet assigned". Absent is null and `missing` names it.
// A placeholder baked into the data would be printed by program-d exactly as though somebody had
// typed it, and nobody would be able to tell the difference.

// The public form of a name that came from a record: "Sarah Whitfield" -> "Sarah W.".
//
// This is the function the public page's privacy rests on, which is why it is exported and tested
// directly rather than living inline. It shortens the LAST token and keeps the first, so a middle
// name drops and a hyphenated surname yields one initial ("Whitfield-Jones" -> "W.") rather than
// two — the surname is one name, however it is spelled.
//
// A single-word name comes back unchanged: there is no surname to protect, and returning "M." for
// a performer or a one-name record would be less private-looking and less useful at once.
export function publicNameFor(full: string | null): string | null {
  if (full === null) return null;

  const tokens = full.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokens[0];

  const surname = tokens[tokens.length - 1];
  return `${tokens[0]} ${surname.charAt(0).toUpperCase()}.`;
}

// A name read from a member or user record.
function recordName(full: string | null): NameField {
  return { printedName: full, publicName: publicNameFor(full) };
}

// A name somebody typed in order to have it printed. Both halves hold it verbatim.
function typedName(text: string | null): NameField {
  const trimmed = text?.trim() ?? "";
  const value = trimmed === "" ? null : trimmed;
  return { printedName: value, publicName: value };
}

// Whether an assignment has travelled far enough to count as a speaker on a program.
//
// `notify` or later, per 06-program-music.md §Step 2. Somebody who has been planned but not yet
// notified is not yet a speaker — printing their name would tell a congregation something the
// person themselves has not been told.
//
// Compared by INDEX into PIPELINE_STAGES rather than against a hardcoded list of four stage
// strings, so a stage inserted into the pipeline later cannot silently fall on the wrong side.
const NOTIFY_STAGE_INDEX = PIPELINE_STAGES.indexOf("notify");

export function countsAsProgramSpeaker(stage: PipelineStage): boolean {
  return PIPELINE_STAGES.indexOf(stage) >= NOTIFY_STAGE_INDEX;
}

// A selection with no hymn NUMBER is treated as absent: hymnRefSchema needs a number, and a
// half-filled row means somebody opened the picker and did not choose. The title may legitimately
// be empty — the hymnbook is only partially seeded until program-e, so a number whose title
// cannot be resolved is a state that will occur, and the snapshot records what was chosen.
function hymnRefFrom(selections: HymnSelection[], hymnType: HymnType): HymnRef | null {
  const selection = selections.find((entry) => entry.hymnType === hymnType);
  if (!selection || selection.hymnNumber === null) return null;

  return { number: selection.hymnNumber, title: selection.hymnTitle ?? "" };
}

function musicalNumberFrom(sources: ProgramSources): MusicalNumberField | null {
  const musical = sources.musicalNumber;
  if (!musical) return null;

  const pieceTitle = musical.pieceTitle?.trim() ?? "";
  const performer = typedName(musical.performer);

  // A row with neither a performer nor a piece is an empty row somebody created and abandoned.
  // Carrying it into the snapshot would print a blank musical number into the meeting order.
  if (performer.printedName === null && pieceTitle === "") return null;

  return { performer, pieceTitle, notes: musical.notes };
}

function prayerName(sources: ProgramSources, prayerType: "invocation" | "benediction"): NameField | null {
  const prayer = sources.prayers.find((entry) => entry.prayerType === prayerType);
  if (!prayer || prayer.memberId === null) return null;

  return recordName(sources.memberNames[prayer.memberId] ?? null);
}

function assembleSpeakers(sources: ProgramSources): ProgramSpeaker[] {
  const slotCount = sources.sunday.speakingSlots;

  return Array.from({ length: slotCount }, (_unused, index) => {
    const slotNumber = index + 1;

    const assignment = sources.assignments.find(
      (entry) =>
        entry.slotNumber === slotNumber && countsAsProgramSpeaker(entry.stage),
    );

    if (!assignment) {
      return { slotNumber, kind: "empty" as const, printedName: null, publicName: null, topic: null };
    }

    const topic = assignment.topicId === null ? null : (sources.topicTitles[assignment.topicId] ?? null);

    // Read through speakerFrom(), NEVER by branching on member_id. Two callers that reach their
    // own conclusion is how an external speaker vanishes from a printed program while still
    // appearing on the planner (lib/assignments/speaker.ts, ITER-004).
    const speaker = speakerFrom({
      memberId: assignment.memberId,
      externalSpeakerName: assignment.externalSpeakerName,
      externalSpeakerTitle: assignment.externalSpeakerTitle,
    });

    if (speaker.kind === "member") {
      const name = recordName(sources.memberNames[speaker.memberId] ?? null);
      return { slotNumber, kind: "member" as const, ...name, topic };
    }

    if (speaker.kind === "external") {
      const name = typedName(externalDisplayName(speaker));
      return { slotNumber, kind: "external" as const, ...name, topic };
    }

    return { slotNumber, kind: "empty" as const, printedName: null, publicName: null, topic };
  });
}

// Presiding, per program-a Decision 2.
//
// `sundays.presiding_override` when somebody typed one; otherwise the bishop. NOTHING is ever
// guessed — the temptation on a ward conference is to prefill the stake president, and writing a
// name nobody typed into a snapshot that then gets printed and emailed is precisely the failure
// CLAUDE.md rule 3 exists to prevent. `users` records no gender, which is why
// bishopricDisplayName() already refuses to guess an honorific.
//
// Leaving it silently blank is the OTHER failure ITER-004 records — an outstanding task that does
// not look like one. So the bishop still resolves, and the ward-conference case is named in
// `missing` instead, telling the bishopric what to check.
function assemblePresiding(sources: ProgramSources): NameField {
  const override = typedName(sources.sunday.presidingOverride);
  if (override.printedName !== null) return override;

  return recordName(sources.bishopName);
}

// Built in MEETING ORDER and filtered, rather than pushed as each field is computed. Two reasons:
// the order a person reads is the order the program runs in, and a deterministic list is what
// makes diffDrafts() able to show "the sacrament hymn is no longer missing" as a stable line.
//
// DEDUPED BY CONSTRUCTION. `speaker_slot` appears at most once however many slots are empty: the
// keys are a closed set that program-b renders as one written sentence each, and the same
// sentence twice tells a secretary nothing about which slot. Which slot is empty is visible in
// `speakers` itself, and the per-slot diff lines are what report a single slot filling.
// `hasPresidingOverride` is passed rather than re-derived from `draft.presiding`, because
// presiding is NEVER blank — it falls back to the bishop — so the resolved field cannot answer
// "did anybody actually confirm this". Reading the fallback as confirmation is exactly the
// outstanding-task-that-looks-done failure Decision 2 exists to prevent.
function assembleMissing(
  draft: Omit<ProgramDraft, "missing">,
  isWardConference: boolean,
  hasPresidingOverride: boolean,
): MissingFieldKey[] {
  const checks: [MissingFieldKey, boolean][] = [
    ["presiding_unconfirmed_ward_conference", isWardConference && !hasPresidingOverride],
    ["organist", draft.organist === null],
    ["chorister", draft.chorister === null],
    ["opening_hymn", draft.openingHymn === null],
    ["invocation", draft.invocation === null],
    ["sacrament_hymn", draft.sacramentHymn === null],
    ["speaker_slot", draft.speakers.some((speaker) => speaker.kind === "empty")],
    ["closing_hymn", draft.closingHymn === null],
    ["benediction", draft.benediction === null],
    ["announcements", draft.announcements === null],
  ];

  return checks.filter(([, isMissing]) => isMissing).map(([key]) => key);
}

export function assembleDraft(sources: ProgramSources): ProgramDraft {
  const { sunday } = sources;

  // A ward conference is an ordinary program with a heading, not a second template (program-a
  // Decision 1). Its meeting order is the same shape as any other Sunday; what differs is who
  // presides and that the congregation should be told which meeting they are in. program-d
  // renders NOTHING when this is null — not an empty element.
  const isWardConference = sunday.type === "ward_conference";
  const hasPresidingOverride = typedName(sunday.presidingOverride).printedName !== null;

  const body: Omit<ProgramDraft, "missing"> = {
    version: PROGRAM_DRAFT_VERSION,
    heading: isWardConference ? "Ward Conference" : null,
    date: sunday.date,
    sundayType: sunday.type,
    presiding: assemblePresiding(sources),
    conducting: recordName(sources.conductingName),
    // No table in this schema holds an organist or a chorister. 06-program-music.md sources them
    // from "music coordinator entry or manual", and neither surface exists until program-e — so
    // they assemble as null, are named in `missing`, and program-b's editor is what fills them.
    organist: null,
    chorister: null,
    openingHymn: hymnRefFrom(sources.hymnSelections, "opening"),
    invocation: prayerName(sources, "invocation"),
    // Free text a secretary writes in program-b. There is no upstream source to read, so a first
    // assembly leaves them null; a refresh must not overwrite what was typed, which is why the
    // refresh route diffs and asks rather than assembling straight over the stored draft.
    wardBusiness: null,
    sacramentHymn: hymnRefFrom(sources.hymnSelections, "sacrament"),
    specialNotes: null,
    musicalNumber: musicalNumberFrom(sources),
    speakers: assembleSpeakers(sources),
    closingHymn: hymnRefFrom(sources.hymnSelections, "closing"),
    benediction: prayerName(sources, "benediction"),
    announcements: null,
    leadershipContacts: sources.wardSettings.leadershipContacts,
    missionaries: sources.wardSettings.missionaries,
  };

  return {
    ...body,
    missing: assembleMissing(body, isWardConference, hasPresidingOverride),
  };
}
