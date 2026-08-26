"use client";

import { useState, type ReactNode } from "react";

// One collapsed panel on /visits.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// The dashboard made /visits four panels tall — progress, the goal, appointments, and the form
// that is the only way to log a visit at all — and visits-c adds a link across to the feed. Four
// stacked cards is roughly four screens at 375px, which is a scroll nobody makes twice. So the
// dashboard stays open and the three action panels collapse.
//
// ---------------------------------------------------------------------------
// THE CHILDREN STAY MOUNTED
// ---------------------------------------------------------------------------
// `hidden` rather than `{open ? children : null}`, and that is the whole design.
//
// VisitLogForm seeds its draft in a useState initializer, which React runs ONCE per mount.
// Unmounting on collapse would throw away a half-typed visit note the moment somebody folded the
// panel to look at the table above it — and it would re-run the appointment prefill logic on
// every re-open. `hidden` is display:none, so the content is not rendered, not focusable and not
// read by a screen reader, while its state survives.
//
// The trade is a slightly heavier first paint, which is the cheaper of the two.

export type CollapsibleSectionProps = {
  id: string;
  title: string;
  // A one-line summary shown while collapsed, so the header answers its own question — "Once a
  // year · 12 households" beats a chevron somebody has to open to learn anything from.
  summary?: string;
  // Open on first render. The log-a-visit section takes this from `?appointment=`: arriving from
  // "Log this visit" and landing on a collapsed panel would be the same silent dead flow the
  // prefill has already had once (plans/retros/visits-d-attempts-appointments-and-participants.md).
  defaultOpen?: boolean;
  children: ReactNode;
};

export function CollapsibleSection({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex flex-col">
          <span className="text-base font-semibold text-foreground">{title}</span>
          {summary === undefined ? null : (
            <span className="text-sm text-muted">{summary}</span>
          )}
        </span>

        {/* aria-hidden: aria-expanded on the button already announces the state, so a screen
            reader reading the triangle would say it twice. */}
        <span aria-hidden="true" className="text-muted">
          {open ? "▾" : "▸"}
        </span>
      </button>

      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
