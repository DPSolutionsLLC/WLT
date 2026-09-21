
// The shape of an agenda, and the templates a new one starts from.
//
// ---------------------------------------------------------------------------
// PURE AND CLIENT-IMPORTABLE — KEEP IT THAT WAY
// ---------------------------------------------------------------------------
// The builder screen renders these in the browser and the PDF renderer reads them on the server,
// so this file imports nothing but types. The same standing instruction lib/youth/roster.ts,
// lib/youth/coverage.ts and lib/youth/profileNeed.ts carry: ONE import of a queries module would
// pull `next/headers` into the client bundle and break the page, and `npm run build` is the only
// thing that catches it (youth-c recorded that lint, typecheck and 2982 tests did not).

// One line on an agenda. Free text, because a ward council item is whatever the secretary needs to
// say — but see `source` below, which is the one thing about it the app knows and the person does
// not have to retype.
export type AgendaItem = {
  id: string;
  text: string;
  // WHERE THIS LINE CAME FROM, and it is the reason an item is an object rather than a string.
  //
  // `manual`     — somebody typed it.
  // `flag`       — auto-populated from an unresolved visit or youth follow-up flag (Step A2).
  // `carried`    — an open action item copied forward from the previous agenda (Step A3).
  //
  // The distinction is load-bearing at PUBLISH: only `flag` items resolve their source flag, and
  // resolving a flag somebody typed by hand would silence a notification nobody had answered.
  source: AgendaItemSource;
  // Set only on `flag` items — the row whose flag this line represents, so publishing can mark it
  // resolved without matching on the TEXT, which a secretary is free to edit.
  sourceId: string | null;
};

export const AGENDA_ITEM_SOURCES = ["manual", "flag", "carried"] as const;
export type AgendaItemSource = (typeof AGENDA_ITEM_SOURCES)[number];

// One heading and its lines.
export type AgendaSection = {
  id: string;
  title: string;
  items: AgendaItem[];
  // ---------------------------------------------------------------------------
  // WHAT THIS FLAG MEANS, BECAUSE THE NAME INVITES THE WRONG READING
  // ---------------------------------------------------------------------------
  // It does NOT mean "copy these items to the next agenda". Action items carry forward as
  // `action_items` ROWS, not as section text, and lib/agendas/carryForward.ts owns that rule.
  //
  // It marks the section that the carried rows are RENDERED INTO, so a template can put "Action
  // items" third rather than last and the builder knows where to put them. Exactly one section per
  // template carries it; `agendaTemplate()` guarantees that and the Zod schema enforces it.
  carryForward: boolean;
};

export type AgendaSections = AgendaSection[];

// ---------------------------------------------------------------------------
// THE TWO TEMPLATES
// ---------------------------------------------------------------------------
// 09-meetings-tithing.md §Step A1 lists seven standing sections and names which are populated by
// the template, which by the secretary, and which automatically. Both meeting types get the same
// seven: the phase plan's table is not split by type, and a bishopric meeting that omitted "Flagged
// ward council items" would silently drop the flags a leader raised — the section renders empty
// when there are none, which says "nothing was raised" rather than hiding the question.
//
// SECTIONS ARE FREELY EDITABLE AFTER CREATION. This is a starting point, not a schema: a ward that
// wants a different shape renames, reorders, adds and deletes. That is why the template lives in
// TypeScript and the stored `sections` is jsonb — migration 012 chose that, and it means a ward's
// existing agendas do not move when this list changes.
const STANDING_SECTIONS: { title: string; carryForward?: true }[] = [
  { title: "Opening and prayer" },
  { title: "Approval of previous minutes" },
  { title: "Flagged ward council items" },
  { title: "Organization reports" },
  { title: "Action items", carryForward: true },
  { title: "New business" },
  { title: "Closing and prayer" },
];

// `crypto.randomUUID` is available in the browser, in Node 22 and in the Next server runtime, so
// one id generator serves the builder and the create route. Ids are stable across a save because
// they are stored inside the jsonb, which is what lets React key a list a person is reordering.
function newId(): string {
  return crypto.randomUUID();
}

// NO `meetingType` PARAMETER, though the phase plan's table is headed by meeting type.
//
// Both types get the same seven standing sections — §Step A1's table is not split by type, and a
// bishopric agenda that omitted "Flagged ward council items" would silently drop the flags a
// leader raised. Taking an argument this function never reads would be a promise it does not keep;
// the day the two templates genuinely differ is the day it gains one back.
export function agendaTemplate(): AgendaSections {
  return STANDING_SECTIONS.map((section) => ({
    id: newId(),
    title: section.title,
    items: [],
    carryForward: section.carryForward === true,
  }));
}

export function newAgendaItem(
  text: string,
  source: AgendaItemSource = "manual",
  sourceId: string | null = null,
): AgendaItem {
  return { id: newId(), text, source, sourceId };
}

export function newAgendaSection(title: string): AgendaSection {
  return { id: newId(), title, items: [], carryForward: false };
}

// THE SECTION CARRIED ROWS AND FLAGS ARE RENDERED INTO.
//
// Returns null rather than throwing or inventing one: a ward that has deleted its "Action items"
// section has said something, and the answer is to render the carried rows nowhere rather than to
// resurrect a heading they removed. Every caller handles null, and `describeCarryForward()` is how
// the screen says so out loud instead of silently dropping them.
export function carryForwardSection(sections: AgendaSections): AgendaSection | null {
  return sections.find((section) => section.carryForward) ?? null;
}

export function findSectionByTitle(
  sections: AgendaSections,
  title: string,
): AgendaSection | null {
  const wanted = title.trim().toLowerCase();
  return sections.find((section) => section.title.trim().toLowerCase() === wanted) ?? null;
}

// The heading flagged items land under. Matched by TITLE rather than by a second boolean, because
// unlike the carry-forward section this one has no consequence at publish time — an item's own
// `source` decides that. A ward that renames the heading gets its flags in a section of their own
// making, which is the behaviour a rename is asking for.
export const FLAGGED_SECTION_TITLE = "Flagged ward council items";

// Total lines on the agenda, for the "3 items" summary beside a date in the list. Counted from the
// sections themselves rather than stored, so it cannot disagree with what the page renders — the
// ITER-022 count-and-list rule, which this module is otherwise free of only because it stores no
// counts at all.
export function countAgendaItems(sections: AgendaSections): number {
  return sections.reduce((total, section) => total + section.items.length, 0);
}
