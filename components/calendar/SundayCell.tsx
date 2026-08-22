import type { ReactNode } from "react";
import Link from "next/link";
import { ConductingLabel } from "@/components/calendar/ConductingLabel";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import type { Sunday } from "@/lib/calendar/queries";
import { holdsSacramentMeeting } from "@/types/domain";

// The three regions Phase 4 fills, as REAL optional props rather than a comment promising a
// refactor. They are `ReactNode` so Phase 4 owns what goes in them, and they render nothing when
// absent — so passing them in changes no layout in this slice. SundayCard takes the same three,
// which is what lets one Phase 4 change fill both the grid and the mobile list.
export type SundayReservedRegions = {
  speakers?: ReactNode;
  pipelineStatus?: ReactNode;
  goalAlerts?: ReactNode;
};

export function ReservedRegions({
  speakers,
  pipelineStatus,
  goalAlerts,
}: SundayReservedRegions) {
  if (!speakers && !pipelineStatus && !goalAlerts) return null;

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
      {speakers}
      {pipelineStatus}
      {goalAlerts}
    </div>
  );
}

export type SundayCellProps = SundayReservedRegions & {
  sunday: Sunday;
  conductingNames: Record<string, string>;
};

// One cell in the month grid. The whole cell is the link — a cell whose only tap target is the
// date number is a cell nobody finds on a phone, and this same component is what the 375px card
// list mirrors.
//
// min-h-40 already accommodates the reserved regions above. Sizing the cell to today's content and
// growing it in Phase 4 is what "design the cell now" (03-calendar.md Step 5) exists to prevent.
export function SundayCell({
  sunday,
  conductingNames,
  speakers,
  pipelineStatus,
  goalAlerts,
}: SundayCellProps) {
  // Sliced from the YYYY-MM-DD string, never from `new Date(sunday.date).getDate()`, which reads
  // back in local time and shows Saturday's number to a browser west of UTC.
  const dayOfMonth = Number(sunday.date.slice(8, 10));

  return (
    <Link
      href={`/calendar/sunday/${sunday.id}`}
      className="flex min-h-40 flex-col rounded-md border border-border bg-surface-raised p-2 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{dayOfMonth}</span>
        <SundayTypeBadge type={sunday.type} />
      </div>

      <p className="mt-1 text-xs text-muted">
        Conducting:{" "}
        <ConductingLabel
          conductingUserId={sunday.conductingUserId}
          names={conductingNames}
          holdsMeeting={holdsSacramentMeeting(sunday.type)}
        />
      </p>

      {sunday.notes && (
        <p className="mt-1 line-clamp-2 text-xs text-muted">{sunday.notes}</p>
      )}

      <ReservedRegions
        speakers={speakers}
        pipelineStatus={pipelineStatus}
        goalAlerts={goalAlerts}
      />
    </Link>
  );
}
