import Link from "next/link";
import { ConductingLabel } from "@/components/calendar/ConductingLabel";
import {
  ReservedRegions,
  type SundayReservedRegions,
} from "@/components/calendar/SundayCell";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { formatSundayLabel } from "@/lib/calendar/dates";
import type { Sunday } from "@/lib/calendar/queries";
import { holdsSacramentMeeting } from "@/types/domain";

export type SundayCardProps = SundayReservedRegions & {
  sunday: Sunday;
  conductingNames: Record<string, string>;
};

// The mobile layout: the same fields stacked, one card per Sunday. The date is spelled out in full
// because a card has no grid position to give a bare "8" its context.
//
// It takes the same three reserved-region props as SundayCell so Phase 4 fills both layouts from
// one change rather than discovering the mobile list a week later.
export function SundayCard({
  sunday,
  conductingNames,
  speakers,
  pipelineStatus,
  goalAlerts,
}: SundayCardProps) {
  return (
    <Link
      href={`/calendar/sunday/${sunday.id}`}
      className="flex min-h-11 flex-col rounded-lg border border-border bg-surface-raised p-4 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">
          {formatSundayLabel(sunday.date)}
        </span>
        <SundayTypeBadge type={sunday.type} />
      </div>

      <p className="mt-2 text-sm text-muted">
        Conducting:{" "}
        <ConductingLabel
          conductingUserId={sunday.conductingUserId}
          names={conductingNames}
          holdsMeeting={holdsSacramentMeeting(sunday.type)}
        />
      </p>

      {sunday.notes && <p className="mt-1 line-clamp-2 text-sm text-muted">{sunday.notes}</p>}

      <ReservedRegions
        speakers={speakers}
        pipelineStatus={pipelineStatus}
        goalAlerts={goalAlerts}
      />
    </Link>
  );
}
