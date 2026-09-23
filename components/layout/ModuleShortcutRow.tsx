import Link from "next/link";
import type { NavigationItem } from "@/lib/auth/navigation";

// A PAGE'S ROW OF LINKS TO OTHER MODULES — the prototype's `.sac-nav`.
//
// ---------------------------------------------------------------------------
// A SHARED COMPONENT BECAUSE THE PROTOTYPE SAYS SO IN AS MANY WORDS
// ---------------------------------------------------------------------------
// Build note §global-stylesheet-nav-consistency puts `.sac-nav` / `.sac-nav-link` in the GLOBAL
// stylesheet precisely so it is not re-invented per page, and states it as a rule:
//
//   "STANDING CONVENTION FOR FUTURE BUILDS: any page's row of nav links to other modules should
//    use .sac-nav/.sac-nav-link from the global stylesheet, not a one-off .btn row or new CSS."
//
// It already appears on two prototype pages — the Sacrament hub and the Conducting Sheet — and
// decisions.md §1 says to generalize a component the SECOND time it is needed, not the third. So
// this is a component from the day the first row ships, and the Conducting Sheet slice adds a
// caller rather than a second block of markup.
//
// ---------------------------------------------------------------------------
// TAILWIND, NOT A GLOBAL CLASS
// ---------------------------------------------------------------------------
// WLT has no global stylesheet to put `.sac-nav` in — P1 adopted the prototype's palette at the
// TOKEN level (plans/retros/design-system-tokens-and-primitives.md) and every component styles
// itself. The prototype's REASON for a shared class is "do not re-invent it per page", and a
// shared component satisfies that reason better than a shared class would.
//
// ---------------------------------------------------------------------------
// THE ICON IS THE DESTINATION'S OWN TILE ICON, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------
// It comes off the NavigationItem rather than being chosen here, so a shortcut is RECOGNISABLE —
// the same mark somebody already knows from the dashboard — rather than arbitrary
// (module-map.md §6.4). It is also why this takes NavigationItems and not `{label, href}` pairs:
// a caller that passed its own icons would be the second copy lib/auth/navigation.tsx's header
// refuses.
//
// ---------------------------------------------------------------------------
// FILTERING HAPPENS BEFORE THIS COMPONENT
// ---------------------------------------------------------------------------
// shortcutNavigationItems() has already dropped everything unbuilt and everything this person
// cannot open. There is no locked state and no dimmed link here, which is DashboardGrid's rule in
// a second place: a link somebody cannot act on is a link that should not have been rendered.
//
// No "use client": no state, no handlers. It renders inside a Server Component, and
// lib/auth/navigation.tsx imports nothing server-only — `npm run build` is what proves that.

export type ModuleShortcutRowProps = {
  items: NavigationItem[];
  // Names the row for a screen reader, because a page may eventually carry more than one <nav>
  // and "navigation" repeated twice tells nobody which is which.
  label: string;
};

export function ModuleShortcutRow({ items, label }: ModuleShortcutRowProps) {
  // Nothing at all rather than an empty bordered strip. A heading with nothing under it reads as
  // a section that failed to load, which is the defect plans/retros/youth-h recorded and the
  // reason DashboardGrid renders no empty sections either.
  if (items.length === 0) return null;

  return (
    <nav aria-label={label}>
      {/* Wraps at phone width — four links do not fit on 375px in one line, and a row that
          scrolls sideways hides its own last item. */}
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              // min-h-11 IS 44px. p4-sacrament-a found every pill on this same page rendering as
              // a 19px tap target, so the size is asserted on the anchor rather than inherited
              // from whatever is inside it.
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {/* aria-hidden because the label beside it already names the module — Tile does
                  exactly this with the same icons. */}
              <span aria-hidden="true" className="text-muted">
                {item.icon}
              </span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
