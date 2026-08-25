import type { HymnRef, NameField } from "@/lib/program/draft";

// The three readers every panel uses to turn a draft field into printable text, or into null.
//
// ---------------------------------------------------------------------------------------------
// ON PAPER, AN EMPTY FIELD PRINTS NOTHING AT ALL
// ---------------------------------------------------------------------------------------------
// This is deliberately DIFFERENT from components/program/ProgramPreview.tsx, which keeps the nine
// fixed meeting-order lines on screen and greys the empty ones. That is right for a working
// screen — walking scenario 031 proved that deleting the rows made the preview read as "failed to
// load" — and wrong for the printed sheet.
//
// The printed programme is handed to a congregation, not to the person filling it in. program-d's
// plan is explicit: a null field renders nothing — no label, no dash, no "TBD". The `missing` list
// is program-b's screen. A congregation does not need to read what the bishopric has not finished,
// and a line reading "Organist: Nobody yet" on a Sunday handout is worse than no line.
//
// Returning null rather than "" is what makes that enforceable: a panel cannot accidentally render
// an empty <Text> with its label still attached, because there is nothing to render.

export function textOf(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// THE PRINTED name, always — never publicName. A paper handout in a chapel is not the open
// internet, and program-a computed the pair at assembly precisely so this choice is made once per
// surface rather than per field (lib/program/draft.ts).
//
// THIS IS WHERE ITER-004 CLOSES: an external speaker's printedName is the full title somebody
// typed in order to have it printed — "President Mark Andersen" — and it reaches the paper
// unaltered.
export function printedNameOf(name: NameField | null | undefined): string | null {
  return textOf(name?.printedName);
}

// A hymn whose title could not be resolved still prints its NUMBER. The hymnbook is only partly
// verified (42 of 341 rows carry `source = 'authoritative'`, migration 042), so "a number with no
// title" is a state that will actually occur, and a chorister can work from the number alone.
//
// ---------------------------------------------------------------------------------------------
// A PLACEHOLDER PRINTS ITS OWN UGLY TITLE, ON PURPOSE — AND THE WALK DECIDES WHETHER THAT IS
// ENOUGH
// ---------------------------------------------------------------------------------------------
// program-e fills the 299 unverified numbers with rows titled "[Placeholder] Hymn 43". Nothing
// here strips or softens that: if one reaches a printed programme it reads as "43 — [Placeholder]
// Hymn 43" on the sheet, which is unmissable. That IS the safety property — the same
// safe-by-construction instinct as omitting fields from PublicProgram rather than nulling them.
//
// The open question program-e left for the walk is whether the PDF should REFUSE to render at all
// when a placeholder is present, rather than printing it loudly. Refusing is stronger; it also
// means a ward cannot print a programme on a Saturday night because of a number nobody minded.
// That trade needs a person looking at real paper, so it is deliberately not decided here.
// isPlaceholderTitle() in lib/music/hymnSource.ts is what a refusal would be built on.
export function hymnOf(hymn: HymnRef | null | undefined): string | null {
  if (hymn === null || hymn === undefined) return null;
  const title = textOf(hymn.title);
  return title === null ? `Hymn ${hymn.number}` : `${hymn.number} — ${title}`;
}
