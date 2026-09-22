import type { ReactNode } from "react";
import Link from "next/link";
import { DashboardGrid } from "@/components/layout/DashboardGrid";
import type { NavigationItem } from "@/lib/auth/navigation";

// The tile grid, one level down — Admin and its pages today, and whatever else grows a section
// index later.
//
// ---------------------------------------------------------------------------
// IT REUSES DashboardGrid AND Tile. IT IS NOT A LOOKALIKE.
// ---------------------------------------------------------------------------
// That is the phase file's word and decisions.md §1.7's rule ("one mechanism, not two"). A second
// grid built to look the same is a second set of locked-tile rules, a second empty-section rule
// and a second answer to what a pinned tile looks like — all of which start identical and none of
// which stay that way.
//
// ---------------------------------------------------------------------------
// ONE PLAIN STICKY HEADER — NO COLLAPSING EXTRAS
// ---------------------------------------------------------------------------
// Build note §dashboard-header-scroll scoped the collapsing behaviour to the MAIN dashboard,
// deliberately. A sub-dashboard is a short page reached on purpose; hiding its title to win back
// forty pixels on a page that barely scrolls is motion for its own sake. There is also no search
// box: a section with four tiles does not need filtering, and an empty search box teaches people
// the control does nothing.
//
// ---------------------------------------------------------------------------
// THE BACK LINK POINTS AT A FIXED PARENT, NOT AT WHEREVER YOU CAME FROM — AND IT IS OPTIONAL
// ---------------------------------------------------------------------------
// `backHref` is a genuine parent-child relationship — a page under /admin belongs UNDER /admin,
// always, however you arrived. That is what §app-wide-back-link-extension got right and it is safe
// for exactly the reason the chrome bar's is: it is computed from structure rather than from
// history, so it cannot cycle.
//
// ⚠️ OMIT IT WHEN THE PARENT IS THE DASHBOARD. The chrome bar already carries an unconditional
// "← Dashboard" on every page, so passing `backHref="/dashboard"` here renders THE SAME LINK
// TWICE, stacked about fifty pixels apart. Walking scenario 070 found exactly that on /admin.
// A section index whose parent is home therefore passes neither prop and lets the chrome bar do
// its job; only a page nested deeper than one level needs this.
//
// No "use client": no state, no handlers.

export type SubDashboardProps = {
  title: string;
  description?: ReactNode;
  // Both or neither. See the header: omit them when the parent is the dashboard, which the chrome
  // bar already links to.
  backHref?: string;
  backLabel?: string;
  items: NavigationItem[];
  // Anything belonging to this section that is not a tile — a settings toggle, a form.
  children?: ReactNode;
};

export function SubDashboard({
  title,
  description,
  backHref,
  backLabel,
  items,
  children,
}: SubDashboardProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* bg-background rather than a surface token: this bar is part of the page, and --surface
          inverts meaning between themes, so a panel built on it reads as an inset in light and a
          hole in dark (plans/retros/youth-follow-up-controls.md). */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-3">
        {backHref === undefined || backLabel === undefined ? null : (
          <Link
            href={backHref}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span aria-hidden="true">←</span>
            {backLabel}
          </Link>
        )}
        {/* min-w-0 (plans/retros/youth-g-occasions-and-event-detail.md). */}
        <h1 className="min-w-0 flex-1 font-display text-xl font-semibold text-foreground">
          {title}
        </h1>
      </div>

      {description === undefined ? null : <p className="text-sm text-muted">{description}</p>}

      {/* searchTerm is empty and pinnedHrefs is []: a sub-dashboard has no search box, and pins
          are a dashboard-level idea. Both are real props rather than optional ones, so the grid
          has one shape wherever it is used.

          showSectionHeadings is false because the page title above already names the section —
          see DashboardGrid's prop comment. */}
      <DashboardGrid items={items} searchTerm="" pinnedHrefs={[]} showSectionHeadings={false} />

      {children}
    </div>
  );
}
