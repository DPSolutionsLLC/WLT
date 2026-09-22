"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { HelpButton } from "@/components/layout/HelpButton";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ReportIssueButton } from "@/components/layout/ReportIssueButton";
import type { SessionUser } from "@/types/domain";

// The bar above every page except the dashboard: the way home, where you are, and the five
// controls that belong to the app rather than to the page.
//
// ---------------------------------------------------------------------------
// ⚠️ THE BACK LINK IS STATIC — ALWAYS /dashboard, UNCONDITIONALLY
// ---------------------------------------------------------------------------
// The prototype made it dynamic, following one step of history, and got genuinely stuck: that
// mechanism tracks ONE step, overwritten on every navigation, so after a couple of hops it
// ping-pongs between the last two pages and PERMANENTLY LOSES THE PATH HOME. Build note
// §dashboard-back-link-regression-fix calls it "a real design flaw, not an edge case".
//
// THIS ONE LINK IS A GUARANTEED ESCAPE HATCH. Do not read usePathname() to compute it, do not
// call router.back(), do not accept a `backHref` prop. tests/components/layout/ChromeBar.test.tsx
// asserts it from several deep pathnames, because it is the regression the phase file names as
// the one most likely to be reintroduced.
//
// Per-page "Back to wherever you came from" links are fine and safe BECAUSE this one is
// unconditional — each page captures its previous page once at mount via a ref, so it cannot
// cycle. This phase builds none of those; the rule is recorded for the pages that will.
//
// ---------------------------------------------------------------------------
// THE TITLE IS A PROP. IT IS NOT DERIVED FROM THE PATHNAME.
// ---------------------------------------------------------------------------
// A pathname → title lookup table would be a second copy of the module list, and one list
// hand-maintained in two places always drifts (plans/retros/notification-trigger-drift.md).
//
// What the layout can honestly supply is the WARD BEING ACTED IN, and that is what it passes.
// It is the more useful thing to carry here anyway: under the calling model a person may hold
// callings in two wards, and CLAUDE.md §7 is explicit that the frame must never name one ward
// around another's rows. Each page keeps its own <h1> — the page's title belongs to the page,
// where it already is, not duplicated into the chrome.
//
// ---------------------------------------------------------------------------
// THE BAR RENDERS ON EVERY PAGE, INCLUDING /dashboard. ONLY THE BACK LINK IS CONDITIONAL.
// ---------------------------------------------------------------------------
// It first shipped returning `null` on /dashboard, reasoning that a "← Dashboard" link on the
// dashboard is a control that does nothing. That reasoning was right about the LINK and wrong
// about the BAR: returning null took the whole icon row with it, so the page sign-in lands on had
// no Sign out, no theme toggle, no notification bell, no Report an issue and no Help. The only way
// to sign out was to navigate into a module first.
//
// Found by walking scenario 069 and fixed on the user's instruction, 2026-09-22: "I would like
// that bar to be present at all times."
//
// ⚠️ tests/components/layout/ChromeBar.test.tsx ASSERTED THE OLD BEHAVIOUR AND PASSED — it pinned
// the bug as though it were the specification, which is why the walk caught it and 3795 tests did
// not. A test that encodes a decision has to be changed deliberately when the decision changes.
//
// So usePathname is read for one thing only: whether to render the back link.

export type ChromeBarProps = {
  title: string;
  user: SessionUser;
  callingLabel: string;
};

export function ChromeBar({ title, user, callingLabel }: ChromeBarProps) {
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard";

  return (
    <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2">
      {isDashboard ? null : (
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span aria-hidden="true">←</span>
          Dashboard
        </Link>
      )}

      {/* min-w-0: a flex item's default `min-width: auto` refuses to shrink below its content, so
          without it this row overflows at 375px beside five controls
          (plans/retros/youth-g-occasions-and-event-detail.md). */}
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</p>

      <div className="flex shrink-0 items-center gap-1">
        {/* pagePath is the pathname this bar already read, so a report is tagged with the page
            it was opened from rather than with /dashboard. */}
        <ReportIssueButton pagePath={pathname} />
        <HelpButton />
        <NotificationBell />
        <AccountMenu user={user} callingLabel={callingLabel} wardName={title} />
      </div>
    </header>
  );
}
