import type { GoalStatus } from "@/types/domain";

// The `goalAlerts` reserved region, and the LAST of the three calendar-b left on SundayCell and
// SundayCard. talks-b filled `speakers` and `pipelineStatus`; this completes the Phase 3 -> Phase 4
// contract, and nothing about either component needed restructuring to take it — which is what
// 03-calendar.md §Step 5 sized `min-h-40` for.

export type GoalAlert = {
  id: string;
  title: string;
  status: GoalStatus;
};

export type GoalAlertsProps = {
  alerts: readonly GoalAlert[];
  // How many to name before collapsing to a count. The default suits a tight space; the planning
  // banner passes a larger one, because there the reader came looking.
  limit?: number;
};

// Three, then a count. A cell is a glance, not a list: a bishopric with eleven overdue goals needs
// to know that from the calendar and then open the board, and eleven lines in a grid cell push the
// speakers and the pipeline summary off the bottom of it.
const VISIBLE_ALERTS = 3;

const STATUS_CLASSES: Record<GoalStatus, string> = {
  overdue: "text-danger",
  due_soon: "text-warning",
  on_track: "text-muted",
};

export function GoalAlerts({ alerts, limit = VISIBLE_ALERTS }: GoalAlertsProps) {
  // An on-track goal on a calendar cell is noise, so the caller filters to overdue and due-soon
  // before it gets here. Nothing at all renders when there is nothing to say — an empty region
  // would put a border and a gap on every cell in the month for no information.
  if (alerts.length === 0) return null;

  const visible = alerts.slice(0, limit);
  const remaining = alerts.length - visible.length;

  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {visible.map((alert) => (
        <li key={alert.id} className={STATUS_CLASSES[alert.status]}>
          {/* The word, not only the colour. A cell read in greyscale still says "Overdue". */}
          <span className="font-medium">
            {alert.status === "overdue" ? "Overdue" : "Due soon"}:
          </span>{" "}
          <span className="text-muted">{alert.title}</span>
        </li>
      ))}

      {remaining > 0 && (
        <li className="text-muted">
          +{remaining} more {remaining === 1 ? "goal" : "goals"}
        </li>
      )}
    </ul>
  );
}
