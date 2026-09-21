import { Pill } from "@/components/ui/Pill";
import { PROGRAM_STATUS_LABELS, type ProgramStatus } from "@/types/domain";

// The four program statuses, rendered the way StageBadge renders the nine pipeline stages: the
// colour carries the label as TEXT inside a bordered pill on the surrounding surface, never as
// white text on a fill. The label is always present, so the badge reads the same to somebody who
// cannot distinguish approved from distributed.
//
// EXISTING SEMANTIC TOKENS, NOT FOUR NEW --program-* ONES. Four more hexes would be four more
// things to measure and retune; these four are already in app/globals.css and already carry the
// meanings the statuses need.
//
// MEASURED, not eyeballed (talks-b retuned two stage tokens after measuring). RE-MEASURED for
// P1's warmer palette — the old numbers here were taken against --surface #f8fafc and
// --surface-raised #ffffff, backgrounds that no longer exist, and --primary moved from blue
// #1d4ed8 to pine #2c5a4d. A comment that states a measured fact and is wrong is worse than no
// comment.
//
// Worst of the THREE surfaces a badge can sit on in each theme — --background, --surface and
// --surface-raised — WCAG AA needing 4.5:1 for text this size:
//
//   draft (foreground)         light 14.19   dark 12.82
//   pending_approval (warning) light  4.70   dark  8.99
//   approved (success)         light  4.69   dark  8.62
//   distributed (primary)      light  7.34   dark  7.88
//
// `distributed` is the one that moved most, and it moved UP: pine clears 7.34 where the old blue
// cleared 6.41.
//
// `draft` uses --foreground rather than --muted deliberately. On the old palette muted measured
// 4.55, the exact figure talks-b called "no headroom at all" for small text; on the new one it
// measures 4.84, which clears AA but only just. Draft is by far the most common status, so it
// remains the one that must not be the marginal one — the reasoning survives the retune even
// though its number changed.
//
// A lookup, never a template string: Tailwind reads class names statically and a
// `text-${status}` built at runtime produces no CSS at all.
const STATUS_CLASSES: Record<ProgramStatus, string> = {
  draft: "border-border text-foreground",
  pending_approval: "border-warning text-warning",
  approved: "border-success text-success",
  distributed: "border-primary text-primary",
};

export type ProgramStatusBadgeProps = {
  status: ProgramStatus;
};

export function ProgramStatusBadge({ status }: ProgramStatusBadgeProps) {
  return (
    <Pill toneClassName={STATUS_CLASSES[status]} className="font-medium">
      {PROGRAM_STATUS_LABELS[status]}
    </Pill>
  );
}
