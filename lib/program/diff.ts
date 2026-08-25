import type { HymnRef, NameField, ProgramDraft } from "@/lib/program/draft";
import { MISSING_FIELD_KEYS, SUNDAY_TYPE_LABELS, type MissingFieldKey } from "@/types/domain";

// What has moved upstream since the draft was written. PURE — no I/O, no clock.
//
// This function is the entire reason the snapshot rule is safe to keep. A draft that stopped
// tracking its sources is only trustworthy if there is an honest, explicit way to see what has
// changed and choose to take it (POST /api/programs/[id]/refresh).
//
// ---------------------------------------------------------------------------------------------
// A DECLARED TABLE, NOT A GENERIC WALK
// ---------------------------------------------------------------------------------------------
// Comparing two objects recursively would put `speakers.1.publicName` and `version` on a
// secretary's screen, which tells them nothing they can act on — calendar-b's raw-uuid rule in a
// different costume. Every field that can appear in a diff is declared below WITH the words a
// person reads and a renderer that turns it into a string.
//
// publicName is deliberately absent from the whole table. It is derived from printedName by one
// rule (assembleDraft.publicNameFor), so a publicName change with no printedName change is
// impossible, and showing both would double every line about a person.
//
// `before` and `after` are RENDERED STRINGS. program-b displays a diff without knowing anything
// about the draft's internals, and program-b's AI editor reuses the same panel.

export type DraftChange = {
  // A stable machine-readable path — "openingHymn", "speakers.2.printedName". program-b keys
  // React rows on it and the refresh route audits it. It is never displayed.
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};

type FieldSpec = {
  field: string;
  label: string;
  render: (draft: ProgramDraft) => string | null;
};

function renderName(name: NameField | null): string | null {
  return name?.printedName ?? null;
}

// "241 — Behold the Great Redeemer", or just "241" when the hymnbook could not supply a title.
// The partially-seeded hymnbook makes the second case real until program-e.
function renderHymn(hymn: HymnRef | null): string | null {
  if (hymn === null) return null;
  return hymn.title === "" ? `${hymn.number}` : `${hymn.number} — ${hymn.title}`;
}

function renderText(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}

const FIELD_SPECS: FieldSpec[] = [
  {
    field: "sundayType",
    label: "Kind of Sunday",
    render: (draft) => SUNDAY_TYPE_LABELS[draft.sundayType],
  },
  { field: "heading", label: "Heading", render: (draft) => renderText(draft.heading) },
  { field: "presiding", label: "Presiding", render: (draft) => renderName(draft.presiding) },
  { field: "conducting", label: "Conducting", render: (draft) => renderName(draft.conducting) },
  { field: "organist", label: "Organist", render: (draft) => renderName(draft.organist) },
  { field: "chorister", label: "Chorister", render: (draft) => renderName(draft.chorister) },
  {
    field: "openingHymn",
    label: "Opening hymn",
    render: (draft) => renderHymn(draft.openingHymn),
  },
  { field: "invocation", label: "Invocation", render: (draft) => renderName(draft.invocation) },
  {
    field: "wardBusiness",
    label: "Ward business",
    render: (draft) => renderText(draft.wardBusiness),
  },
  {
    field: "sacramentHymn",
    label: "Sacrament hymn",
    render: (draft) => renderHymn(draft.sacramentHymn),
  },
  {
    field: "specialNotes",
    label: "Special notes",
    render: (draft) => renderText(draft.specialNotes),
  },
  {
    field: "musicalNumber",
    label: "Musical number",
    render: (draft) => {
      const musical = draft.musicalNumber;
      if (musical === null) return null;
      const performer = musical.performer.printedName;
      return performer === null ? musical.pieceTitle : `${musical.pieceTitle} — ${performer}`;
    },
  },
  {
    field: "closingHymn",
    label: "Closing hymn",
    render: (draft) => renderHymn(draft.closingHymn),
  },
  {
    field: "benediction",
    label: "Benediction",
    render: (draft) => renderName(draft.benediction),
  },
  {
    field: "announcements",
    label: "Announcements",
    render: (draft) => renderText(draft.announcements),
  },
  {
    field: "leadershipContacts",
    label: "Leadership contacts",
    // Names only. The stored contacts carry PHONE NUMBERS, and a diff panel is a screen like any
    // other — there is no reason for one to appear here to say that a list changed.
    render: (draft) =>
      draft.leadershipContacts.length === 0
        ? null
        : draft.leadershipContacts.map((contact) => contact.name).join(", "),
  },
  {
    field: "missionaries",
    label: "Missionary information",
    render: (draft) => renderText(draft.missionaries),
  },
];

// Ordinals rather than "Speaker 2", because a program is read aloud in order and "the second
// speaker" is how a bishopric talks about it. Beyond the ninth the numeric form is clearer than
// an invented word, and MAX_SPEAKING_SLOTS allows fifteen.
const SPEAKER_ORDINALS = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
];

export function speakerSlotLabel(slotNumber: number): string {
  const ordinal = SPEAKER_ORDINALS[slotNumber - 1];
  return ordinal === undefined ? `Speaker ${slotNumber}` : `${ordinal} speaker`;
}

// Short nouns, not the sentences in MISSING_FIELD_LABELS. That map words a checklist item on
// program-b's screen ("No sacrament hymn has been chosen."); a diff row needs a column heading
// with a before and an after beside it. A closed Record either way, so a key added to
// MISSING_FIELD_KEYS fails to compile until it is named here too.
const MISSING_LABELS: Record<MissingFieldKey, string> = {
  presiding_unconfirmed_ward_conference: "Presiding officer confirmed",
  opening_hymn: "Opening hymn chosen",
  sacrament_hymn: "Sacrament hymn chosen",
  closing_hymn: "Closing hymn chosen",
  invocation: "Invocation assigned",
  benediction: "Benediction assigned",
  speaker_slot: "Every speaking slot filled",
  organist: "Organist named",
  chorister: "Chorister named",
  announcements: "Announcements written",
};

const STILL_NEEDED = "Still needed";
const NOW_DONE = "Done";

function diffSpeakers(current: ProgramDraft, next: ProgramDraft): DraftChange[] {
  const slotNumbers = [
    ...new Set([
      ...current.speakers.map((speaker) => speaker.slotNumber),
      ...next.speakers.map((speaker) => speaker.slotNumber),
    ]),
  ].sort((left, right) => left - right);

  return slotNumbers.flatMap((slotNumber) => {
    const before = current.speakers.find((speaker) => speaker.slotNumber === slotNumber) ?? null;
    const after = next.speakers.find((speaker) => speaker.slotNumber === slotNumber) ?? null;
    const label = speakerSlotLabel(slotNumber);

    const changes: DraftChange[] = [];

    const beforeName = before?.printedName ?? null;
    const afterName = after?.printedName ?? null;
    if (beforeName !== afterName) {
      changes.push({
        field: `speakers.${slotNumber}.printedName`,
        label,
        before: beforeName,
        after: afterName,
      });
    }

    const beforeTopic = before?.topic ?? null;
    const afterTopic = after?.topic ?? null;
    if (beforeTopic !== afterTopic) {
      changes.push({
        field: `speakers.${slotNumber}.topic`,
        label: `${label}'s topic`,
        before: beforeTopic,
        after: afterTopic,
      });
    }

    return changes;
  });
}

// `missing` is diffed too, and a slot that filled in since Thursday is the single most useful
// line a refresh can show. Read in the DONE direction — "Still needed" -> "Done" — because that
// is the direction a secretary is hoping for, and reading a diff should not require translating
// a negation.
function diffMissing(current: ProgramDraft, next: ProgramDraft): DraftChange[] {
  const before = new Set(current.missing);
  const after = new Set(next.missing);

  return MISSING_FIELD_KEYS.filter((key) => before.has(key) !== after.has(key)).map((key) => ({
    field: `missing.${key}`,
    label: MISSING_LABELS[key],
    before: before.has(key) ? STILL_NEEDED : NOW_DONE,
    after: after.has(key) ? STILL_NEEDED : NOW_DONE,
  }));
}

// An unchanged field produces NO entry, so an empty array means "nothing upstream has moved" —
// which program-b shows as a sentence rather than as an empty panel.
export function diffDrafts(current: ProgramDraft, next: ProgramDraft): DraftChange[] {
  const scalarChanges = FIELD_SPECS.flatMap((spec) => {
    const before = spec.render(current);
    const after = spec.render(next);

    return before === after
      ? []
      : [{ field: spec.field, label: spec.label, before, after }];
  });

  return [...scalarChanges, ...diffSpeakers(current, next), ...diffMissing(current, next)];
}
