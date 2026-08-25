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
// seeded until program-e (42 of 341), so "a number with no title" is a state that will actually
// occur, and a chorister can work from the number alone.
export function hymnOf(hymn: HymnRef | null | undefined): string | null {
  if (hymn === null || hymn === undefined) return null;
  const title = textOf(hymn.title);
  return title === null ? `Hymn ${hymn.number}` : `${hymn.number} — ${title}`;
}
