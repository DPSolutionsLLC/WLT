import { GaugePill, NeutralPill } from "@/app/(app)/visits/GaugePill";
import { SmallButton } from "@/app/(app)/todos/SmallButton";
import { Pill, type PillTone } from "@/components/ui/Pill";
import type { VisitProgressRow } from "@/lib/visits/progress";
import type { SweepStatus } from "@/lib/visits/sweep";
import { formatVisitDate } from "@/lib/visits/visitDates";
import { VISIT_NEEDS_ANOTHER_REASON_LABELS } from "@/types/domain";

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
  onContact?: () => void;
  onLogVisit?: () => void;
  onOpenCadence?: () => void;
  // Who the bishopric gave this household to, by calling (ITER-055 bv5). Absent when nobody holds it
  // or the reader is not looking at the Bishopric's households.
  assigneeLabel?: string;
};

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

// A sweep has no band, so its card carries the sweep's own three words (ITER-055 bv4), in the
// shared P1 tones: missing for what is left, pending for partly, ok for done.
const SWEEP_PILL: Record<SweepStatus, { label: string; tone: PillTone }> = {
  not_yet: { label: "Not yet", tone: "missing" },
  partly_reached: { label: "Partly reached", tone: "pending" },
  done: { label: "Done", tone: "ok" },
};

export function describeHouseholdStanding(row: VisitProgressRow): string {
  if (row.doNotContact) return "Marked do not contact — not counted toward the goal.";
  if (row.sweep !== null) {
    if (row.sweep.status === "done") {
      return `Done in this sweep · ${formatVisitDate(row.sweep.on)}`;
    }
    if (row.sweep.status === "partly_reached") return "Still needs a visit in this sweep.";
    return "Not yet visited in this sweep.";
  }
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

// ITER-055 bv3: somebody went, and the household still needs a visit. Its own line in the
// attention colour, because the band beside it has not moved and the reason is why.
export function describePartlyReached(row: VisitProgressRow): string | null {
  if (row.partlyReached === null) return null;
  return (
    `Partly reached ${formatVisitDate(row.partlyReached.on)} — ` +
    VISIT_NEEDS_ANOTHER_REASON_LABELS[row.partlyReached.reason].toLowerCase()
  );
}

export function HouseholdPriorityCard({
  row,
  asOf,
  onContact,
  onLogVisit,
  onOpenCadence,
  assigneeLabel,
}: HouseholdPriorityCardProps) {
  const history = describeHouseholdHistory(row);
  const partlyReached = describePartlyReached(row);
  const hasActions =
    onContact !== undefined || onLogVisit !== undefined || onOpenCadence !== undefined;

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
          ) : row.sweep !== null ? (
            <Pill tone={SWEEP_PILL[row.sweep.status].tone}>{SWEEP_PILL[row.sweep.status].label}</Pill>
          ) : row.priority === null ? null : (
            <GaugePill priority={row.priority} asOf={asOf} />
          )}
        </div>

        {!hasActions ? null : (
          <div className="flex shrink-0 items-center">
            {onContact === undefined ? null : (
              <SmallButton
                label="Contact"
                accessibleName={`Contact the ${row.familyName} household`}
                onClick={onContact}
              />
            )}
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
      {assigneeLabel === undefined ? null : (
        <p className="text-xs text-muted">Assigned to {assigneeLabel}</p>
      )}
      {partlyReached === null ? null : (
        <p className="text-xs font-medium text-warning">{partlyReached}</p>
      )}
    </li>
  );
}
