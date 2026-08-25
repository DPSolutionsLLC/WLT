import { isPlaceholderTitle } from "@/lib/music/hymnSource";

// The one place a placeholder hymn is marked on screen.
//
// A COLUMN NOBODY SEES IS A COLUMN THAT STOPS BEING TRUE. `hymns.source` (migration 042) records
// that 299 of the 341 rows are synthetic build-and-test entries, and that fact is worth nothing
// unless it reaches the person about to put one on a programme. This component is rendered
// wherever a hymn is shown: search results, the coordinator's Sunday card, and the program
// builder's hymn fields.
//
// It reads the TITLE rather than the source column on purpose. A stored program draft snapshots
// the hymn title and not a hymn id (lib/program/draft.ts), so the column is not reachable from
// every surface that needs this — the title always is.
//
// No "use client". It holds no state and no handlers, so it renders in a Server Component and in
// a client one alike.

export function UnverifiedHymnBadge({ title }: { title: string | null }) {
  if (title === null || !isPlaceholderTitle(title)) return null;

  return (
    <span
      className="inline-flex items-center rounded-full border border-danger px-2 py-0.5 text-xs font-medium text-danger"
      // Said in full for a screen reader, because "Not a real hymn" out of context is alarming
      // in a way the visual placement is not.
      title="This number has no verified hymn behind it. Do not print it."
    >
      Not a real hymn
    </span>
  );
}
