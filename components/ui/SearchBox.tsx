"use client";

import type { InputHTMLAttributes } from "react";

// An input with a leading icon and a clear button.
//
// "use client" BECAUSE OF THE CLEAR BUTTON, not because of state: the value is the parent's, as
// it is for every other controlled input in this app. The button needs an onClick, and an onClick
// needs a client boundary.
//
// ---------------------------------------------------------------------------
// min-w-0 ON THE INPUT, AND IT IS NOT DECORATION
// ---------------------------------------------------------------------------
// plans/retros/youth-g-occasions-and-event-detail.md: a <select> overflowed its row at 375px
// because a flex item's default `min-width: auto` refuses to shrink below its content. An input
// carries an intrinsic width from its `size` attribute, so this row overflows at phone width
// without it and the page grows a horizontal scrollbar. This is a mobile-first app; 375px is the
// target, not the edge case.
//
// THE CLEAR BUTTON ONLY EXISTS WHEN THERE IS SOMETHING TO CLEAR. A permanently visible × on an
// empty box is a control that does nothing, and it takes a tab stop to say so. It carries a real
// accessible name rather than a bare glyph, for the reason Chip's does.
//
// min-h-11 and text-base are inherited from Input's rules and are load-bearing: 44px is the tap
// target, and iOS zooms the whole page when a focused input's font is under 16px.

export type SearchBoxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  id: string;
  // The accessible name. Rendered sr-only rather than omitted — a search box whose only label is
  // its placeholder has no name at all once something is typed into it.
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onClear?: () => void;
  className?: string;
};

export function SearchBox({
  id,
  label,
  value,
  onValueChange,
  onClear,
  className = "",
  placeholder = "Search",
  ...props
}: SearchBoxProps) {
  const hasValue = value.length > 0;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface-raised px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
        {/* Decorative: the label above already names the control. */}
        <span aria-hidden="true" className="shrink-0 text-muted">
          ⌕
        </span>
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          // min-w-0 — see the header. Without it this row overflows at 375px.
          className="min-w-0 flex-1 bg-transparent py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-none"
          {...props}
        />
        {hasValue ? (
          <button
            type="button"
            onClick={() => {
              onValueChange("");
              onClear?.();
            }}
            aria-label={`Clear ${label}`}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
