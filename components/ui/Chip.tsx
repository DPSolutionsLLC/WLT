import type { ReactNode } from "react";

// A removable tag — an organization filter, a planned item, an attendee.
//
// NO "use client", AND THAT IS A DESIGN DECISION RATHER THAN AN OVERSIGHT. The chip holds no
// state: the PARENT owns the list, and removing one is the parent's business. A chip that
// remembered whether it had been removed would be a second copy of a fact the list already holds,
// and the two would disagree — the rule this codebase applies to stored-versus-computed
// everywhere else. It compiles into whichever client bundle imports it and must never gain a
// server import (plans/retros/roster-b-picker-and-orgs.md).
//
// THE REMOVE CONTROL IS A REAL <button> WITH A REAL NAME, never a bare × glyph on a span. A × is
// unreachable by keyboard, announces as "times" or as nothing at all, and gives a screen-reader
// user no way to tell eight identical remove buttons apart. `aria-label` names the thing being
// removed, so the eighth one announces "Remove Relief Society" rather than "button".
//
// The label passed as `children` is what shows; `removeLabel` is what the button announces, and
// defaults to the children when they are a plain string. A caller passing rich children must name
// it, because a ReactNode has no reliable text form.

export type ChipProps = {
  children: ReactNode;
  onRemove?: () => void;
  // The accessible name of the remove button, as "Remove {removeLabel}". Required in practice
  // whenever `children` is not a plain string.
  removeLabel?: string;
  className?: string;
};

export function Chip({ children, onRemove, removeLabel, className = "" }: ChipProps) {
  const name = removeLabel ?? (typeof children === "string" ? children : "item");

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-foreground ${className}`.trim()}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onRemove === undefined ? null : (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {/* aria-hidden: the button's accessible name above already says what this does. */}
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  );
}
