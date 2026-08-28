import {
  FOLLOW_UP_STATE_LABELS,
  FOLLOW_UP_STATE_TONES,
  type CoverageTone,
  type FollowUpState,
} from "@/types/domain";

// Whether a past event is waiting on this reader's account of it, as one badge.
//
// A COMPONENT RATHER THAN INLINE MARKUP because the panel on /youth and the event list beneath it
// render the same badge, and two copies would drift the moment a label is retuned — the reasoning
// CoverageBadge's header states, and the same reason this file sits beside it.
//
// `not_due` RENDERS NOTHING AT ALL, exactly as CoverageBadge returns null for `not_expected`. Most
// rows in a schedule are `not_due` — everything upcoming, everything cancelled, everything the
// reader was never down for — and a chip reading "Not due" on all of them is a chip about nothing.
// FOLLOW_UP_STATE_LABELS gives that state the empty string for the same reason, and the two must
// stay in step.
//
// A STATIC Record, never an interpolated class name. Tailwind scans source text for complete class
// strings, so `border-${tone}` compiles to nothing and the badge renders unstyled — the rule
// components/visits/ReportTile.tsx, CoverageBadge and app/(app)/visits/bandStyles.ts all state.
//
// Colour is never the only signal: every badge carries its words. The tone is the text and border
// on the surrounding surface rather than white on a fill, because those tokens were measured
// against --surface and --surface-raised in both themes.
//
// The tone map is CoverageBadge's, and deliberately not imported from it: these two badges sit on
// the same card and must look like siblings, but a shared constant would make retuning one of them
// silently retune the other.
const TONE_CLASSES: Record<CoverageTone, string> = {
  danger: "border-danger text-danger font-semibold",
  warning: "border-warning text-warning",
  warning_quiet: "border-warning/60 text-warning",
  success: "border-success text-success",
  neutral: "border-border text-muted",
  none: "",
};

export type FollowUpBadgeProps = {
  state: FollowUpState;
};

export function FollowUpBadge({ state }: FollowUpBadgeProps) {
  if (state === "not_due") return null;

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[FOLLOW_UP_STATE_TONES[state]]}`}
    >
      {FOLLOW_UP_STATE_LABELS[state]}
    </span>
  );
}
