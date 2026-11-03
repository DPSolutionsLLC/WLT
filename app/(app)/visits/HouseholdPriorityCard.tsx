import { GaugePill, NeutralPill } from "@/app/(app)/visits/GaugePill";
import { SmallButton } from "@/app/(app)/todos/SmallButton";
import type { VisitProgressRow } from "@/lib/visits/progress";
import { formatVisitDate } from "@/lib/visits/visitDates";

// One household on the Households tab (ITER-055 bv2, prototype HouseholdPriorityCard). The title
// line carries the name, where the household stands, and the small buttons that open its windows
// (the user's compact-UI rule); the line under it says why.
//
// THE PILL IS THE GAUGE. GaugePill already fills with the share of the interval used, so a second
// bar under it would say the same thing twice.

export type HouseholdPriorityCardProps = {
  row: VisitProgressRow;
  asOf: Date;
  // Absent when the reader cannot do it, so the button is absent rather than refused.
  onLogVisit?: () => void;
  onOpenCadence?: () => void;
};

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

export function describeHouseholdStanding(row: VisitProgressRow): string {
  if (row.doNotContact) return "Marked do not contact — not counted toward the goal.";
  if (row.priority === null) return "No visit goal to measure against yet.";
  if (row.priority.band === "never_visited") return "Never visited.";

  const due = `Due ${formatVisitDate(row.priority.dueOn)}`;
  return row.priority.cadenceSource === "household" ? `${due} · this household's own cadence` : due;
}

export function describeHouseholdHistory(row: VisitProgressRow): string | null {
  const parts: string[] = [];

  if (row.lastVisitedOn !== null) {
    parts.push(
      `Last visited ${formatVisitDate(row.lastVisitedOn)}` +
        (row.conductedBy === null ? "" : ` by ${row.conductedBy}`),
    );
  }

  if (row.attemptsSinceLastVisit > 0) {
    parts.push(
      `${row.attemptsSinceLastVisit} ${plural(row.attemptsSinceLastVisit, "attempt")} since` +
        (row.lastVisitedOn === null ? "" : " then"),
    );
  }

  return parts.length === 0 ? null : parts.join(" · ");
}

export function HouseholdPriorityCard({
  row,
  asOf,
  onLogVisit,
  onOpenCadence,
}: HouseholdPriorityCardProps) {
  const history = describeHouseholdHistory(row);

  return (
    <li
      className={`rounded-lg border border-border bg-surface-raised px-3 py-2 ${
        row.doNotContact ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 py-1">
          <p className="text-sm font-medium text-foreground">{row.familyName}</p>
          {row.doNotContact ? (
            <NeutralPill>Do not contact</NeutralPill>
          ) : row.priority === null ? null : (
            <GaugePill priority={row.priority} asOf={asOf} />
          )}
        </div>

        {onLogVisit === undefined && onOpenCadence === undefined ? null : (
          <div className="flex shrink-0 items-center">
            {onLogVisit === undefined ? null : (
              <SmallButton
                label="Log visit"
                accessibleName={`Log a visit to the ${row.familyName} household`}
                onClick={onLogVisit}
              />
            )}
            {onOpenCadence === undefined ? null : (
              <SmallButton
                label="Cadence"
                accessibleName={`How often to visit the ${row.familyName} household`}
                onClick={onOpenCadence}
              />
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-muted">{describeHouseholdStanding(row)}</p>
      {history === null ? null : <p className="text-xs text-muted">{history}</p>}
    </li>
  );
}
