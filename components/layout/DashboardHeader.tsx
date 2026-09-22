"use client";

import { useState, type ReactNode } from "react";
import { DashboardGrid } from "@/components/layout/DashboardGrid";
import { useCollapsingHeader } from "@/components/layout/useCollapsingHeader";
import { SearchBox } from "@/components/ui/SearchBox";
import type { NavigationItem } from "@/lib/auth/navigation";

// The dashboard's own header, and the one place the search term lives.
//
// ---------------------------------------------------------------------------
// THE STICKY BAR AND THE COLLAPSING EXTRAS ARE SIBLINGS. THEY MUST NOT BE WRAPPED TOGETHER.
// ---------------------------------------------------------------------------
// `position: sticky` only holds an element while ITS OWN DIRECT PARENT is still in view. The
// prototype's first attempt nested the sticky bar inside the collapsing wrapper; once the extras
// collapsed to near-zero height that parent's box was barely taller than the sticky bar itself,
// so it released almost immediately and scrolled away with the page. The bug reads as "sticky
// does not work" and the cause is nowhere near the sticky rule.
//
// So the two are returned as siblings of the page body — padding and borders go on each section
// directly, never on a shared wrapper added "for spacing".
//
// ---------------------------------------------------------------------------
// THE GRID IS RENDERED FROM HERE, AND THAT IS WHY THE SEARCH TERM LIVES IN ONE PLACE
// ---------------------------------------------------------------------------
// The page is a Server Component, so the search state cannot be lifted into it. Rendering the
// grid here — still as a SIBLING, inside the same fragment — is what keeps one `useState` behind
// both the box and the tiles. A second copy of the term in the grid is how a filter and its
// results come to disagree.
//
// THE SEARCH BOX FILTERS TILES. THAT IS ALL IT DOES. It is not a global search across modules,
// across members, or across anything else, and nothing in this phase builds one. If a later phase
// wants that, it is a different control in a different place — do not "finish" this one.
//
// THE COLLAPSE IS A TRANSFORM, NEVER A `max-height`. plans/prototype/decisions.md §6 records the
// prototype still stuttering here after two attempts and names a transform-based slide as the
// likely clean rebuild. A transform is compositor-driven and cannot fight a layout pass;
// animating height re-lays-out the whole page on EVERY FRAME, which is the stutter.
//
// So the height change is a SINGLE DISCRETE REFLOW, not an animated one — `h-0` flips once and
// only `transform` and `opacity` are in the transition list. That is the trade, stated rather
// than hidden: the space comes back instantly instead of easing, in exchange for an animation
// the compositor can run without touching layout. If somebody later adds `height` or
// `max-height` to that transition to make it ease, they will have reintroduced the exact bug
// this shape avoids.
//
// `motion-reduce:transition-none` honours prefers-reduced-motion — the state still changes, only
// the animation stops.

export type DashboardHeaderProps = {
  title: string;
  callingLabel: string;
  items: NavigationItem[];
  pinnedHrefs: string[];
  // The ward switcher (P3c). Rendered inside the collapsing extras, and absent for the great
  // majority of people, who hold one calling.
  wardSwitcher?: ReactNode;
  // The quick-links button (P3e). It belongs in the STICKY bar, so it is reachable after the
  // extras have collapsed.
  quickLinks?: ReactNode;
};

export function DashboardHeader({
  title,
  callingLabel,
  items,
  pinnedHrefs,
  wardSwitcher,
  quickLinks,
}: DashboardHeaderProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const isCollapsed = useCollapsingHeader();

  return (
    <>
      {/* SIBLING ONE — sticky. bg-background rather than a surface token: this bar is part of the
          page, and --surface inverts meaning between themes, so a panel built on it reads as an
          inset in light and a hole in dark (plans/retros/youth-follow-up-controls.md). */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3">
        {/* min-w-0: a flex item's default `min-width: auto` refuses to shrink below its content,
            so without it this row overflows at 375px
            (plans/retros/youth-g-occasions-and-event-detail.md). */}
        <h1 className="min-w-0 flex-1 font-display text-xl font-semibold text-foreground">
          {title}
        </h1>
        {quickLinks === undefined ? null : (
          <div className="shrink-0">{quickLinks}</div>
        )}
        <SearchBox
          id="dashboard-search"
          label="Search your modules"
          placeholder="Search modules"
          value={searchTerm}
          onValueChange={setSearchTerm}
          className="w-full sm:w-64"
        />
      </div>

      {/* SIBLING TWO — the extras. Not wrapped with the bar above. See the header. */}
      <div
        aria-hidden={isCollapsed}
        className={`origin-top overflow-hidden transition-[transform,opacity] duration-200 motion-reduce:transition-none ${
          isCollapsed ? "pointer-events-none h-0 -translate-y-2 opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex flex-col gap-2 pt-1">
          {/* THE WARD IS NAMED BY THE CHROME BAR, NOT HERE. It used to be named in both, forty
              pixels apart, once the chrome bar started rendering on the dashboard too
              (2026-09-22). The bar is the better home for it: it never collapses, and under the
              calling model naming the ward being acted in is exactly what stops the frame
              describing one ward around another's rows (CLAUDE.md §7). */}
          <p className="text-sm text-muted">You are signed in as {callingLabel}.</p>
          {wardSwitcher === undefined ? null : wardSwitcher}
        </div>
      </div>

      {/* SIBLING THREE — the grid. Still a sibling; the fragment adds no DOM node. */}
      <DashboardGrid items={items} searchTerm={searchTerm} pinnedHrefs={pinnedHrefs} />
    </>
  );
}
