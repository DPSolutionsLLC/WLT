import Link from "next/link";
import type { ReactNode } from "react";

// The dashboard card. P3 builds the four-section tile grid out of these, so the prop shape here
// is written to P3's stated needs rather than to this phase's — P3 should consume it, not
// redesign it.
//
// ---------------------------------------------------------------------------
// A TILE IS ALWAYS A LINK. THERE IS NO LOCKED STATE, AND ADDING ONE BACK IS A PRODUCT DECISION.
// ---------------------------------------------------------------------------
// This primitive used to carry `locked` + `lockedReason`, rendering a <div> instead of a <Link>
// with a sentence saying why somebody could not open it. P3 built the dashboard on it, and
// walking scenario 069 showed what that produces: a music coordinator with 4 usable tiles and 11
// locks, and a stake officer with FIFTEEN locks and nothing to do — each advising them to ask a
// bishopric with no power to grant it.
//
// The user's decision, 2026-09-22: **a person sees only what they can open**. A grid is a place to
// start work from, not an inventory of what the app contains, and telling a leader eleven times
// over what they may not touch is noise on every visit to make a point that matters at most once.
// So the capability was removed rather than left unused — dead code with an elaborate rationale
// invites somebody to "restore" it.
//
// Filtering happens BEFORE this component: visibleNavigationItems() in lib/auth/navigation.tsx
// decides what a person is offered, and components/layout/DashboardGrid.tsx renders only that.
// Hiding a tile is cosmetic, never a security boundary — every guarded page still calls
// assertCan() and RLS still blocks the query behind it.
//
// ---------------------------------------------------------------------------
// THE ACCENT CARRIES NO MEANING
// ---------------------------------------------------------------------------
// pine / rust / gold label dashboard SECTIONS the way CONTEXT_TONES labels organizations — they
// are an aid to finding the same tile in the same place twice, and nothing anywhere should read a
// state out of them. The semantic tokens (--success, --warning, --danger, the nine --stage-*) are
// the ones that carry meaning and they are deliberately not offered here.
//
// A STATIC Record, never an interpolated class name: `border-${accent}` compiles to nothing and
// the tile renders unstyled.
//
// No "use client": no state, no handlers. Link is a Client Component internally but imports
// nothing server-only.

export type TileAccent = "pine" | "rust" | "gold";

export type TileProps = {
  href: string;
  label: string;
  blurb?: string;
  icon?: ReactNode;
  accent?: TileAccent;
  pinned?: boolean;
  className?: string;
};

const ACCENT_CLASSES: Record<TileAccent, string> = {
  pine: "border-l-4 border-l-pine",
  rust: "border-l-4 border-l-rust",
  gold: "border-l-4 border-l-gold",
};

const BASE_CLASSES =
  "flex min-h-11 flex-col gap-1 rounded-lg border border-border bg-surface-raised p-4 text-left";

export function Tile({
  href,
  label,
  blurb,
  icon,
  accent,
  pinned = false,
  className = "",
}: TileProps) {
  const accentClasses = accent === undefined ? "" : ACCENT_CLASSES[accent];

  const body = (
    <>
      <span className="flex items-center gap-2">
        {icon === undefined ? null : (
          // Decorative: the label beside it already names the tile.
          <span aria-hidden="true" className="inline-flex shrink-0 items-center">
            {icon}
          </span>
        )}
        <span className="min-w-0 font-display text-base font-semibold text-foreground">
          {label}
        </span>
        {pinned ? (
          // The word, not just a glyph — a pin shape alone says nothing in greyscale or to a
          // screen reader.
          <span className="ml-auto shrink-0 text-xs text-muted">Pinned</span>
        ) : null}
      </span>
      {blurb === undefined ? null : <span className="text-sm text-muted">{blurb}</span>}
    </>
  );

  return (
    <Link
      href={href}
      // HOVER STRENGTHENS THE HAIRLINE, IT DOES NOT MOVE THE ELEVATION. A tile rests at
      // --surface-raised, which is the TOP of the ladder in light mode, so there is nowhere
      // lighter to go and a hover that darkened it would recede where a secondary Button's
      // hover advances. A neutral border at greater strength is the fix
      // plans/retros/youth-follow-up-controls.md section 6 landed on, and it reads the same way
      // in both themes.
      className={`${BASE_CLASSES} ${accentClasses} transition-colors hover:border-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`.trim()}
    >
      {body}
    </Link>
  );
}
