// One line of a shared note, for a return-and-report tile.
//
// MODULE-AGNOSTIC, like everything else in lib/reports/. Lifted out of lib/visits/reportTiles.ts
// UNCHANGED when Phase 8 needed the same preview: a lib/youth/* file importing lib/visits/* would
// say the two modules are related when they are not, and copying thirty lines would give the app
// two answers to "how long is a preview?".
//
// PURE. No client, no await, no clock — so both mappers' tests need no database.
//
// SHARED NOTES ONLY, AND THERE IS NO ARRANGEMENT OF THIS FILE THAT COULD REACH A PRIVATE ONE. It
// takes a string. The callers are lib/visits/reportTiles.ts and lib/youth/reportTiles.ts, and
// neither has a private-note field on its input type to pass in (CLAUDE.md rule 5).

// About a line and a half on a phone. Long enough that a tile carries the sense of the note,
// short enough that twelve tiles are still a scannable list rather than twelve paragraphs.
export const PREVIEW_MAX_CHARACTERS = 120;

const ELLIPSIS = "…";

// The FIRST LINE only, trimmed. A shared note that opens with a one-line summary and continues
// into detail should preview as the summary; joining the lines would produce a run-on that reads
// as a formatting bug.
//
// NULL, never "". An empty string renders as a tile with a blank gap where the note goes, which
// reads as a note that failed to load. The tile says "No shared note" instead, which is a fact
// about the report.
export function toPreviewText(sharedNotes: string | null): string | null {
  if (sharedNotes === null) return null;

  const firstLine = sharedNotes.split("\n")[0]?.trim() ?? "";
  if (firstLine === "") return null;

  if (firstLine.length <= PREVIEW_MAX_CHARACTERS) return firstLine;

  // Cut at a WORD boundary. Slicing mid-word produces "brought them a meal and stayed for co…",
  // which looks like a rendering fault rather than a deliberate truncation.
  //
  // A single word longer than the limit has no boundary to find, so it is cut where it falls —
  // still better than a tile a hundred characters taller than its neighbours.
  const cut = firstLine.slice(0, PREVIEW_MAX_CHARACTERS);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;

  return `${body.trimEnd()}${ELLIPSIS}`;
}
