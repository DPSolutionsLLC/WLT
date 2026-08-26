// Type-only, so nothing from the server-only module survives the build (roster-b).
import type { VisitProgressBannerTotals } from "@/lib/visits/progress";

// "X of Y households visited — Z remaining".
//
// NO "use client" DIRECTIVE, and none is needed: this renders no state and handles no events.
// VisitProgressTable imports it, so it compiles into that client bundle and refreshes with the
// numbers beside it — a banner rendered by the server while the table refetched would show one
// organization's count above another organization's rows.
//
// Y IS NOT THE WARD'S HOUSEHOLD COUNT. It excludes every household with no active members, which
// is the one number on this page a reader has to be able to trust — see §THE DENOMINATOR in
// lib/visits/progress.ts.

export type VisitProgressBannerProps = {
  // Null when the organization has no goal. There is no default denominator: a made-up number is
  // worse than an absent one.
  banner: VisitProgressBannerTotals | null;
  goalTitle: string | null;
  goalHasNoCadence: boolean;
};

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

export function VisitProgressBanner({
  banner,
  goalTitle,
  goalHasNoCadence,
}: VisitProgressBannerProps) {
  if (banner === null) {
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

  const { visitedCount, total, remaining } = banner;

  // Guarded rather than assumed: an organization whose households have all moved out has a total
  // of zero, and a percentage of nothing is a division nobody wants to render.
  const percent = total === 0 ? 0 : Math.round((visitedCount / total) * 100);

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4">
      <p className="text-base font-semibold text-foreground">
        {total === 0
          ? "No households to visit yet"
          : `${visitedCount} of ${total} ${plural(total, "household")} visited — ${remaining} remaining`}
      </p>

      <p className="mt-1 text-sm text-muted">
        {total === 0
          ? "Every household in this ward has no active members, so there is nothing to count."
          : goalTitle ?? "This organization's visit goal"}
      </p>

      {/* The bar is decoration on top of the sentence above, never the only way to read the
          number — aria-hidden for exactly that reason, so a screen reader hears the count once
          rather than hearing a progress bar recite it again. */}
      {total === 0 ? null : (
        <div
          aria-hidden="true"
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface"
        >
          <div className="h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}
