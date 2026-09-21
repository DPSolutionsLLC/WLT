import type { ReactNode } from "react";

// Eyebrow + Fraunces title + optional actions row.
//
// THE TITLE IS THE ONLY PLACE THE DISPLAY FACE IS REQUIRED. P1 pairs Fraunces (display) with
// Inter (body); `font-display` resolves through --font-fraunces in globals.css. The eyebrow stays
// in Inter deliberately — two display faces stacked read as two titles.
//
// THE EYEBROW IS NOT A HEADING. It is rendered as a plain <p> above the heading rather than as a
// smaller <h*>, because a document outline that alternates between two levels for what is
// visually one block is worse for a screen reader than one heading with a line of context above
// it. `headingLevel` exists so a caller can place this correctly in its page's outline rather
// than hardcoding <h2> and leaving every page with two <h1>s or none.
//
// min-w-0 ON BOTH SIDES OF THE FLEX ROW (plans/retros/youth-g-occasions-and-event-detail.md): a
// flex item's default `min-width: auto` refuses to shrink below its content, so a long title and
// an actions row on one line push the page wider than 375px instead of wrapping. The row also
// wraps outright, because at phone width a title and two buttons do not share a line legibly.
//
// No "use client": no state, no handlers. Actions are passed in already wired.

export type SectionHeaderProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  className?: string;
};

export function SectionHeader({
  title,
  eyebrow,
  description,
  actions,
  headingLevel = 2,
  className = "",
}: SectionHeaderProps) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";

  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 ${className}`.trim()}
    >
      <div className="min-w-0">
        {eyebrow === undefined ? null : (
          <p className="text-xs font-medium tracking-wide text-muted uppercase">{eyebrow}</p>
        )}
        {/* break-words rather than truncate: a ward's organization names are long and a title
            that wraps is readable where one cut off with an ellipsis is not. */}
        <Heading className="font-display text-lg font-semibold break-words text-foreground">
          {title}
        </Heading>
        {description === undefined ? null : (
          <p className="mt-1 text-sm text-muted">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
