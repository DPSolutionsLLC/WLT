import Link from "next/link";
import type { ReactNode } from "react";

// The dashboard card. P3 builds the four-section tile grid out of these, so the prop shape here
// is written to P3's stated needs rather than to this phase's — P3 should consume it, not
// redesign it.
//
// ---------------------------------------------------------------------------
// A LOCKED TILE IS NOT A LINK, AND IT SAYS WHY IN WORDS
// ---------------------------------------------------------------------------
// Two separate rules, and the second is the one that gets dropped.
//
// It must not be a LINK because a disabled anchor is not a thing the platform has: an <a href>
// styled at 50% opacity is still focusable, still activates on Enter, and still navigates. The
// only correct disabled link is no link, so `locked` renders a <div>.
//
// And it must say WHY IN TEXT because greying out is a colour-only signal, and this app does not
// use those — the rule MemberStatusBadge states for do_not_contact ("a member whose only marker
// is a red dot is a member somebody will phone by mistake") and ITER-022 restates. A tile a
// leader cannot open, with nothing on it explaining that, reads as a page that failed to load.
// `lockedReason` is therefore rendered, not merely announced.
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
  locked?: boolean;
  // Why it is locked, in words. Rendered on the tile, because opacity is not a signal.
  lockedReason?: string;
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
  locked = false,
  lockedReason,
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
      {locked ? (
        <span className="text-sm text-muted">
          {lockedReason ?? "You do not have access to this yet."}
        </span>
      ) : null}
    </>
  );

  if (locked) {
    return (
      <div
        // No href, no tabIndex, no role="link". There is nothing here to activate.
        className={`${BASE_CLASSES} ${accentClasses} opacity-75 ${className}`.trim()}
      >
        {body}
      </div>
    );
  }

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
