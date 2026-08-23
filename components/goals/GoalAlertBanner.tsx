"use client";

import { useState } from "react";
import { GoalAlerts, type GoalAlert } from "@/components/goals/GoalAlerts";
import {
  buildDismissalCookie,
  readCookie,
  withMonthDismissed,
  GOAL_ALERT_DISMISSAL_COOKIE,
} from "@/lib/goals/alertDismissal";

// Overdue and due-soon goals, shown where somebody has already decided to work on a Sunday.
//
// WHY IT IS NOT ON THE CALENDAR. talks-d put these on the month grid first, filling the third
// region calendar-b reserved. Walking scenario 019 killed that: three overdue goals wrap to nine
// lines in a ~130px grid column, stacked under the speaker names and the pipeline summary, and
// the result reads as clutter on every cell of every month whether or not anyone is planning.
// A warning that is always on is a warning nobody reads.
//
// Here it has a job. You are on one Sunday, about to choose speakers, and this is the moment a
// standing goal ("no member goes two years without being asked") should reach you.
//
// THE SERVER DECIDES WHETHER TO RENDER THIS AT ALL. The dismissal lives in a cookie, so the page
// filters it out before the HTML is built (lib/goals/alertDismissal.ts explains why that matters).
// This component only handles the press itself — the state below exists so the banner disappears
// the instant somebody clicks, rather than on the next navigation.

export type GoalAlertBannerProps = {
  alerts: readonly GoalAlert[];
  // YYYY-MM. The dismissal is keyed by month, so opening a Sunday in the next month asks again.
  monthKey: string;
};

// NAMES BOTH NUMBERS. It used to count only the overdue ones, which was accurate and still read
// wrong: a heading saying "3 ward goals are overdue" above four lines invites the reader to count
// the lines and doubt the number. Walking scenario 019 surfaced that.
//
// The subject is established once and not repeated — "3 ward goals are overdue, 1 is due soon"
// rather than "…, 1 ward goal is due soon", which reads like two separate announcements.
export function summarizeAlerts(overdue: number, dueSoon: number): string {
  const parts: string[] = [];

  if (overdue > 0) {
    parts.push(`${overdue} ward ${overdue === 1 ? "goal is" : "goals are"} overdue`);
  }

  if (dueSoon > 0) {
    parts.push(
      overdue > 0
        ? `${dueSoon} ${dueSoon === 1 ? "is" : "are"} due soon`
        : `${dueSoon} ward ${dueSoon === 1 ? "goal is" : "goals are"} due soon`,
    );
  }

  return parts.join(", ");
}

export function GoalAlertBanner({ alerts, monthKey }: GoalAlertBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  function dismiss(): void {
    // Written straight to document.cookie rather than through a route: this is a per-browser
    // display preference, not ward data, and a round trip would put a spinner on a control whose
    // whole purpose is to make something go away immediately.
    try {
      const next = withMonthDismissed(
        readCookie(document.cookie, GOAL_ALERT_DISMISSAL_COOKIE),
        monthKey,
      );

      document.cookie = buildDismissalCookie(next, window.location.protocol === "https:");
    } catch (error) {
      // A browser with cookies blocked gets the banner back on the next load. Worse than
      // remembering, far better than a crash on a dismiss button.
      console.error("Could not record the goal alert dismissal", error);
    }

    setIsDismissed(true);
  }

  if (alerts.length === 0 || isDismissed) return null;

  const overdue = alerts.filter((alert) => alert.status === "overdue").length;
  const dueSoon = alerts.length - overdue;

  return (
    // COLLAPSED TO ONE LINE, and it expands. At 375px the open version stood 250px tall before the
    // first speaker slot — not clipped, but the top third of the screen somebody opened in order to
    // plan a Sunday. A summary that states the count and gets out of the way is the right weight;
    // the detail is one press away for anyone who wants it.
    //
    // A native <details>, matching the collapsed panels on the calendar page: it is keyboard
    // operable and announced as expandable without any of that being hand-built.
    <div className="rounded-lg border border-border bg-surface-raised p-4">
      {/* Stacked at phone width, side by side from `sm` up. Squeezing the summary into a narrow
          column beside the button turned one line into five at 375px, which defeats the point of
          collapsing it. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <details className="min-w-0 sm:flex-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm">
            <span>
              <span className="font-semibold text-foreground">
                {summarizeAlerts(overdue, dueSoon)}
              </span>{" "}
              <span className="whitespace-nowrap text-primary underline underline-offset-4">
                Show them
              </span>
            </span>
          </summary>

          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
            {/* Says what it wants from the reader, and lives INSIDE the panel: the collapsed line
                has one job, which is to state the count. A banner that only states a fact leaves
                the reader guessing whether it is a task or a note — so the answer is here, where
                somebody who opened it is already paying attention. */}
            <p className="text-sm text-muted">
              Worth a look while you are choosing speakers for this Sunday.
            </p>
            <GoalAlerts alerts={alerts} limit={6} />
          </div>
        </details>

        {/* OUTSIDE the <details>, deliberately. A button inside <summary> toggles the panel when
            pressed, and dismissing is what somebody does INSTEAD of reading the list — making them
            expand it first to find the control would be exactly backwards. */}
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 shrink-0 self-start rounded-md border border-border bg-surface px-3 text-sm text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Dismiss for this month
        </button>
      </div>
    </div>
  );
}
