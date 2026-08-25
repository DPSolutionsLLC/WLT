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
// MEASURED, not eyeballed (talks-b retuned two stage tokens after measuring). Against both
// backgrounds a badge sits on in each theme — --surface and --surface-raised — the worst ratio
// of the four, WCAG AA needing 4.5:1 for text this size:
//
//   draft (foreground)        light 17.13 / 17.93   dark 15.74 / 14.56
//   pending_approval (warning) light  4.80 /  5.02   dark 11.04 / 10.21
//   approved (success)         light  4.79 /  5.02   dark 10.57 /  9.78
//   distributed (primary)      light  6.41 /  6.70   dark  7.25 /  6.70
//
// `draft` uses --foreground rather than --muted deliberately. Muted measured 4.55 on --surface,
// which is the exact figure talks-b called "no headroom at all" for small text — and draft is by
// far the most common status, so it is the one that must not be the marginal one.
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
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {PROGRAM_STATUS_LABELS[status]}
    </span>
  );
}
