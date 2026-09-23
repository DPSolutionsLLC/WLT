import Link from "next/link";

// "Back to where you came from", for one page at a time.
//
// ---------------------------------------------------------------------------
// THIS DOES NOT CONFLICT WITH THE CHROME BAR, AND THE REASONING IS ALREADY WRITTEN DOWN
// ---------------------------------------------------------------------------
// components/layout/ChromeBar.tsx keeps its own back link unconditionally `/dashboard`, and its
// header says why in as many words:
//
//   "The prototype made it dynamic, following one step of history, and got genuinely stuck: that
//    mechanism tracks ONE step, overwritten on every navigation, so after a couple of hops it
//    ping-pongs between the last two pages and PERMANENTLY LOSES THE PATH HOME."
//
//   "Per-page 'Back to wherever you came from' links are fine and safe BECAUSE this one is
//    unconditional ... This phase builds none of those; the rule is recorded for the pages that
//    will."
//
// This is the first of those pages (module-map.md §6.3 catalogues ~17 in the prototype). The
// guarantee holds only while the chrome bar's link stays static — do not make that one dynamic
// because this one exists.
//
// ---------------------------------------------------------------------------
// A QUERY PARAMETER, NOT HISTORY
// ---------------------------------------------------------------------------
// No router.back(), no document.referrer, no stored previous page. Those are how the prototype's
// version broke. The origin is in the URL, so it is still correct on a refresh, on a shared link
// and on a restored tab — and it is a Server Component, holding no state at all.
//
// ---------------------------------------------------------------------------
// NO ORIGIN, NO LINK. IT RENDERS NOTHING RATHER THAN FALLING BACK TO THE DASHBOARD.
// ---------------------------------------------------------------------------
// It first shipped falling back to "Back to Dashboard", which is what the prototype does. Walking
// scenario 072 showed why that is wrong HERE and not there: WLT's chrome bar already carries an
// unconditional "← Dashboard" on every page, so a page arrived at from the navigation rendered
// two back links, stacked, both going to the same place. The user's decision, 2026-09-23: render
// it only for a real origin.
//
// Nothing is lost by the absence, and that is the point — the chrome bar's link is the guaranteed
// escape hatch, which is the same fact that makes a per-page link safe at all (see the quote
// above). This component says "you came from somewhere specific" or it says nothing.
//
// ---------------------------------------------------------------------------
// ⚠️ THE ALLOWLIST IS THE WHOLE SECURITY SURFACE OF THIS COMPONENT
// ---------------------------------------------------------------------------
// `from` is a URL parameter, so it is attacker-supplied. It is NEVER rendered and NEVER navigated
// to as free text: it selects an entry from the map below or it selects nothing, and selecting
// nothing now means rendering nothing.
//
// A `Map` rather than an object literal, deliberately. A bare `ORIGINS[from]` on an object
// returns a TRUTHY value for `?from=toString` — Object.prototype.toString — and the link would
// then render with `href={undefined}`. A Map has no prototype keys to inherit, so the trap does
// not exist rather than being guarded against.
const ORIGINS = new Map<string, { href: string; label: string }>([
  ["sacrament", { href: "/sacrament", label: "Back to Sacrament Calendar" }],
]);

export type ContextualBackLinkProps = {
  from: string | undefined;
};

export function ContextualBackLink({ from }: ContextualBackLinkProps) {
  const origin = from === undefined ? undefined : ORIGINS.get(from);

  if (origin === undefined) return null;

  return (
    <Link
      href={origin.href}
      className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span aria-hidden="true">←</span>
      {origin.label}
    </Link>
  );
}
