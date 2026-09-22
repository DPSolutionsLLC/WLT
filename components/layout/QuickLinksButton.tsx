"use client";

import { useState } from "react";
import { Pin } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import type { NavigationItem } from "@/lib/auth/navigation";

// Pinned modules — a person's own shortlist, saved to `users.settings` so it follows THEM rather
// than the device they happened to pin it on.
//
// ---------------------------------------------------------------------------
// ⚠️ THE COUNT IS OF ALL THE PINS, NEVER OF THE PINS MATCHING THE SEARCH BOX
// ---------------------------------------------------------------------------
// This button sits in the dashboard's sticky bar, beside a search box that filters the grid. A
// count beside a filtered list that counts the FILTERED rows is a bug this codebase has now
// recorded four times — `roster-b`, restated by `visits-b`, `visits-f` and `youth-g` — and the
// honest answer is always the unfiltered one: filter to "music" and you still have four pins, not
// one. `searchTerm` is deliberately NOT a prop here, which is the strongest available way of
// saying so; tests/components/layout/QuickLinksButton.test.tsx is the only place that can catch a
// future version which accepts one.
//
// ---------------------------------------------------------------------------
// A MODAL, NOT AN INLINE SECTION
// ---------------------------------------------------------------------------
// Build note §dashboard-header-scroll moved this precisely so it stops pushing the tile grid
// down. An inline panel that appears above the grid moves every tile the moment somebody opens
// it, which is the opposite of what a shortcut is for.
//
// REORDER WITH BUTTONS, NOT ONLY WITH DRAG. A drag-only reorder is unreachable by keyboard and
// unusable with a screen reader, and this app clears 44px tap targets everywhere else.

export type QuickLinksButtonProps = {
  // Every module this person can actually open — the same list the grid renders, so a pin can
  // never name something they cannot reach.
  items: NavigationItem[];
  pinnedHrefs: string[];
};

export function QuickLinksButton({ items, pinnedHrefs }: QuickLinksButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pins, setPins] = useState<string[]>(pinnedHrefs);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const labels = new Map(items.map((item) => [item.href, item.label]));
  // A pin whose module has since gone — renamed by a later phase, or withdrawn from this
  // person's calling — is dropped from the view rather than rendered as a link to nowhere.
  const validPins = pins.filter((href) => labels.has(href));

  async function save(next: string[]): Promise<void> {
    const previous = pins;
    setPins(next);
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/session/quick-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quickLinks: next }),
      });
      const result: { quickLinks?: string[]; error?: string } = await response.json();

      if (!response.ok) {
        // PUT BACK WHAT WAS THERE. An optimistic update that silently keeps a change the server
        // refused leaves somebody looking at pins they do not have (CLAUDE.md rule 7).
        setPins(previous);
        setErrorMessage(result.error ?? "Could not save your pinned links. Please try again.");
        setIsSaving(false);
        return;
      }

      setPins(result.quickLinks ?? next);
      setIsSaving(false);
    } catch (error) {
      console.error("The quick-links save failed", error);
      setPins(previous);
      setErrorMessage("Could not save your pinned links. Please try again.");
      setIsSaving(false);
    }
  }

  function toggle(href: string): void {
    void save(pins.includes(href) ? pins.filter((pin) => pin !== href) : [...pins, href]);
  }

  function move(href: string, direction: -1 | 1): void {
    const index = validPins.indexOf(href);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= validPins.length) return;

    const next = [...validPins];
    [next[index], next[target]] = [next[target], next[index]];
    void save(next);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        // AN EXPLICIT NAME, because the visible text and the number are separate nodes and a
        // screen reader reads them run together as "Pinned3". The visible label is the short
        // form; this is the sentence.
        aria-label={`Pinned links, ${validPins.length} pinned`}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3 text-sm font-medium text-foreground hover:border-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {/* Decorative: the words beside it name the control. */}
        <Pin aria-hidden="true" className="size-4" />
        Pinned
        {/* THE UNFILTERED COUNT. See the header. */}
        <span className="text-muted">{validPins.length}</span>
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Pinned links">
        <div className="flex flex-col gap-5">
          <FormError message={errorMessage ?? undefined} />

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
              In this order
            </h3>
            {validPins.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing is pinned yet. Pin a module below and it will be marked on your dashboard.
              </p>
            ) : (
              <ol aria-label="Pinned links, in order" className="flex flex-col gap-2">
                {validPins.map((href, index) => (
                  <li key={href} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {labels.get(href)}
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => move(href, -1)}
                      disabled={isSaving || index === 0}
                      aria-label={`Move ${labels.get(href)} up`}
                    >
                      <span aria-hidden="true">↑</span>
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => move(href, 1)}
                      disabled={isSaving || index === validPins.length - 1}
                      aria-label={`Move ${labels.get(href)} down`}
                    >
                      <span aria-hidden="true">↓</span>
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">
              Your modules
            </h3>
            <ul aria-label="Every module you can open" className="flex flex-col gap-1">
              {items.map((item) => {
                const isPinned = pins.includes(item.href);

                return (
                  <li key={item.href}>
                    <Button
                      variant={isPinned ? "primary" : "secondary"}
                      onClick={() => toggle(item.href)}
                      disabled={isSaving}
                      // The state is in the WORD, not only in the colour — this app does not use
                      // colour-only signals (MemberStatusBadge's rule, ITER-022).
                      className="w-full justify-start"
                    >
                      {isPinned ? "Pinned ·" : "Pin"} {item.label}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Modal>
    </>
  );
}
