import type { DraftChange } from "@/lib/program/diff";

// What changed, label / before / after. ONE component, TWO callers: the refresh flow and the AI
// editor. It is presentational and deliberately ignorant of which — a diff panel that knew where
// its changes came from would grow a second wording for the same table.
//
// It never renders `change.field`. That is the stable machine path ("speakers.2.printedName")
// React keys on and the routes audit; putting it on a secretary's screen is calendar-b's
// raw-uuid rule in a different costume. `change.label` is the words a person reads, and
// lib/program/diff.ts is where every one of them is written.
//
// An absence renders as an absence (talks-c). A field that had nothing before shows an em dash,
// never "None", never "Not set" — those read as text somebody typed.

export const NOTHING_CHANGED =
  "Nothing has changed since this program was built.";

const ABSENT = "—";

export type DraftDiffProps = {
  changes: readonly DraftChange[];
};

function Value({ text, isNew }: { text: string | null; isNew: boolean }) {
  if (text === null) {
    return (
      <span className="text-muted">
        <span aria-hidden="true">{ABSENT}</span>
        <span className="sr-only">{isNew ? "cleared" : "nothing"}</span>
      </span>
    );
  }

  return <span className={isNew ? "text-foreground" : "text-muted line-through"}>{text}</span>;
}

// A definition list, not a <table>. Each change is one label with a before and an after under it,
// which is the shape that survives 375px without a horizontal scroll — a three-column table of
// free text does not, and the meeting order is read on a phone in a chapel foyer.
export function DraftDiff({ changes }: DraftDiffProps) {
  if (changes.length === 0) {
    return <p className="text-sm text-muted">{NOTHING_CHANGED}</p>;
  }

  return (
    <dl className="flex flex-col gap-3">
      {changes.map((change) => (
        <div
          key={change.field}
          className="flex flex-col gap-1 rounded-md border border-border p-3"
        >
          <dt className="text-sm font-medium text-foreground">{change.label}</dt>
          <dd className="flex flex-col gap-1 text-sm sm:flex-row sm:items-baseline sm:gap-2">
            <Value text={change.before} isNew={false} />
            <span aria-hidden="true" className="text-muted">
              →
            </span>
            <span className="sr-only">becomes</span>
            <Value text={change.after} isNew />
          </dd>
        </div>
      ))}
    </dl>
  );
}
