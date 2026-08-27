import { describeCadence, describeDuration } from "@/lib/visits/cadence";
// Type-only, so nothing from the server-only module survives the build (roster-b).
import type {
  VisitProgress,
  VisitProgressGoalSummary,
  VisitProgressStatistics,
} from "@/lib/visits/progress";

// The statistics, and the goal they are statistics OF.
//
// "X of Y households visited" is gone. It only ever meant something inside a period, and it went
// with the period — it was also the half of visits-b's contradiction that disagreed with the
// badges directly beneath it.
//
// NO "use client" DIRECTIVE, and none is needed: this renders no state and handles no events.
// VisitProgressTable imports it, so it compiles into that client bundle and refreshes with the
// numbers beside it — a banner rendered by the server while the table refetched would show one
// organization's counts above another organization's rows.
//
// THE DENOMINATOR IS NOT THE WARD'S HOUSEHOLD COUNT. It excludes every household with no active
// members, and every household marked do-not-contact — see §THE DENOMINATOR in
// lib/visits/progress.ts.

export type VisitProgressBannerProps = {
  // Null when the organization has no goal. There is no default denominator: a made-up number is
  // worse than an absent one.
  statistics: VisitProgressStatistics | null;
  goal: VisitProgressGoalSummary | null;
  goalHasNoCadence: boolean;
  // What the denominator was drawn from. Rendered as a sentence when the organization has
  // narrowed, and NOT AT ALL when it has not — the render-nothing-rather-than-"Never" rule
  // talks-c set. "Measured against every household" is what an un-narrowed organization has
  // always meant, and saying it every time would be noise on every board but one.
  stewardship: VisitProgress["stewardship"];
};

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

// "Every household, every year. Warning 2 months ahead."
//
// TWO DIFFERENT PHRASES, FROM TWO DIFFERENT FUNCTIONS, AND THAT IS THE FIX.
//
// The cadence half asks HOW OFTEN, so it takes describeCadence() with its lead-in stripped —
// "Every 6 months" becomes "every 6 months", and "Every year" becomes "every year", both correct.
//
// The warning half asks HOW LONG, and the same treatment breaks it: "Every month" strips to a
// bare "month" and the sentence read "Warning month ahead." for every goal with a one-unit notice
// window. Walked in scenario 047; it dated from ITER-018 and survived because scenario 045 used a
// two-month window. describeDuration() is the phrase that answers "how long", and it takes the
// article at one — "Warning a month ahead."
function goalSentence(goal: VisitProgressGoalSummary): string {
  const cadence = describeCadence(goal.cadence).replace(/^Every /, "");
  const notice = describeDuration(goal.notice);

  return `Every household, every ${cadence}. Warning ${notice} ahead.`;
}

// Number over label, in PRIORITY ORDER rather than alphabetical or numeric: the dashboard opens
// on what a president has to act on.
//
// The colour is the TEXT on the surrounding surface rather than white on a filled pill, reusing
// the tokens visits-b already measured against --surface-raised in both themes. A fill would
// need its own second measurement per state, and the word beneath the number carries the meaning
// on its own anyway.
function Statistic({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <div className="min-w-20">
      <p className={`text-2xl font-semibold ${tone}`}>{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

export function VisitProgressBanner({
  statistics,
  goal,
  goalHasNoCadence,
  stewardship,
}: VisitProgressBannerProps) {
  // BOTH NULL-STATE MESSAGES SURVIVE, and so does the distinction between them. "No goal has
  // been set" and "the goal that is set cannot be counted" need different actions from the
  // person reading, and collapsing them into one sentence would send half of those readers to
  // the wrong control.
  if (statistics === null || goal === null) {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-4">
        <p className="text-sm font-medium text-foreground">
          {goalHasNoCadence
            ? "This organization's visit goal has no cadence set."
            : "No visit goal is set for this organization."}
        </p>
        <p className="mt-1 text-sm text-muted">
          {goalHasNoCadence
            ? "Open the visit goal below and choose how often each household should be visited. " +
              "Without an interval there is nothing to measure a household against."
            : "Open the visit goal below to set one. Until then there is no denominator to " +
              "count against, and a made-up one would be worse than none."}
        </p>
      </div>
    );
  }

  const { counted, onTrack, approaching, overdue, neverVisited, excluded, onTrackPercent } =
    statistics;

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4">
      {/* THE GOAL COMES FIRST, ABOVE THE NUMBERS. ITER-018 part 6 asks for it explicitly, "so
          the numbers are read against their own definition rather than against an assumption" —
          a count of overdue households means nothing until you know overdue against what. */}
      <p className="text-base font-semibold text-foreground">{goalSentence(goal)}</p>

      {goal.deadline !== null ? (
        <p className="mt-1 text-sm text-muted">Aiming to finish by {goal.deadline}.</p>
      ) : null}

      {/* A band that can never appear is said out loud rather than left to be noticed. */}
      {goal.noticeIgnored ? (
        <p className="mt-1 text-sm text-warning">
          The warning window is not shorter than the cadence, so no household will read
          &ldquo;Approaching&rdquo;. Edit the goal below to shorten it.
        </p>
      ) : null}

      {counted === 0 ? (
        <p className="mt-3 text-sm text-muted">
          There are no households to count for this organization yet.
        </p>
      ) : (
        <>
          {/* Wraps at 375px rather than scrolling — four numbers are the whole summary, and a
              summary a phone reader has to swipe sideways through is not one. */}
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
            <Statistic value={overdue} label="Overdue" tone="text-danger" />
            <Statistic value={neverVisited} label="Never visited" tone="text-danger" />
            <Statistic value={approaching} label="Approaching" tone="text-warning" />
            <Statistic value={onTrack} label="On track" tone="text-success" />
          </div>

          <p className="mt-3 text-sm text-muted">
            {onTrackPercent}% of {counted} counted {plural(counted, "household")} on track.
          </p>

          {/* The bar is decoration on top of the sentence above, never the only way to read the
              number — aria-hidden for exactly that reason, so a screen reader hears the
              percentage once rather than hearing a progress bar recite it again. */}
          <div
            aria-hidden="true"
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface"
          >
            <div
              className="h-full rounded-full bg-success"
              style={{ width: `${onTrackPercent}%` }}
            />
          </div>
        </>
      )}

      {/* UNCOUNTED AND UNHIDDEN. A number that silently shrank is what ITER-018 Decision 4
          refused; the households are still in the list below, marked. */}
      {excluded > 0 ? (
        <p className="mt-3 text-sm text-muted">
          {excluded} {plural(excluded, "household")} marked do not contact{" "}
          {excluded === 1 ? "is" : "are"} not counted.
        </p>
      ) : null}

      {/* THE NARROWED DENOMINATOR, SAID OUT LOUD. Two different sentences beside each other on
          purpose: `excluded` is a household this organization may not call on, and `outOfScope` is
          a household that was never this organization's at all. They are different reasons and
          they must not read as one.

          Deliberately NOT a fifth number beside the four band counts. The invariant
          `onTrack + approaching + overdue + neverVisited === counted` has to stay visibly true,
          and a fifth figure in that row would look like part of the sum when it sits outside it —
          these households are absent from `rows` entirely. */}
      {stewardship.narrowed ? (
        <p className="mt-1 text-sm text-muted">
          Measured against {stewardship.inScope}{" "}
          {plural(stewardship.inScope, "household")} in this stewardship
          {stewardship.outOfScope > 0
            ? ` · ${stewardship.outOfScope} in the ward ${
                stewardship.outOfScope === 1 ? "is" : "are"
              } not`
            : ""}
          .
        </p>
      ) : null}
    </div>
  );
}
