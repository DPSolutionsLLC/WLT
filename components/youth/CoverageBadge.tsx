import {
  COVERAGE_STATE_LABELS,
  COVERAGE_STATE_TONES,
  type CoverageState,
  type CoverageTone,
} from "@/types/domain";
import type { EventCoverage } from "@/lib/youth/coverage";

// Whether anybody is going, as one badge.
//
// A COMPONENT RATHER THAN INLINE MARKUP because /youth and /youth/calendar render the same badge,
// and two copies would drift the moment a label is retuned — program-b's one-diff-panel-shared-by-
// two-flows decision, and visits-c's instruction to parameterise rather than fork.
//
// ---------------------------------------------------------------------------
// `not_expected` RENDERS NOTHING AT ALL, AND THAT IS THE POINT
// ---------------------------------------------------------------------------
// A badge on a cancelled game reading "not expected" is noise on the one row that already
// explains itself — the card carries a "Cancelled" chip of its own. talks-c's last-prayed nudge
// renders nothing rather than "Never" for the same reason.
//
// tests/components/youth/CoverageBadge.test.tsx guards this as a PAIR: nothing for
// `not_expected`, AND a label for every other state. Guarding only the first would make "delete
// the badge" a passing fix for an over-eager one (the youth-b all-day lesson).
//
// A STATIC Record, never an interpolated class name. Tailwind scans source text for complete
// class strings, so `border-${tone}` compiles to nothing and the badge renders unstyled — the
// rule components/visits/ReportTile.tsx and app/(app)/visits/bandStyles.ts both state.
//
// Colour is never the only signal: every badge carries its words. The tone is the text and border
// on the surrounding surface rather than white on a fill, matching bandStyles.ts, because the
// tokens were measured against --surface in both themes.
const TONE_CLASSES: Record<CoverageTone, string> = {
  danger: "border-danger text-danger font-semibold",
  warning: "border-warning text-warning",
  warning_quiet: "border-warning/60 text-warning",
  success: "border-success text-success",
  neutral: "border-border text-muted",
  none: "",
};

// ---------------------------------------------------------------------------
// THE CARD'S OWN EDGE, BECAUSE THE BADGE ALONE WAS NOT ENOUGH
// ---------------------------------------------------------------------------
// Found by walking scenario 053 on 2026-08-28. The reader saw the banner at the top of
// /youth/calendar, then had to READ THE SIX CARDS CLOSELY to work out which one it was talking
// about — the "Nobody going" badge was there, and it did not carry.
//
// So an uncovered card is marked on its EDGE as well, which is what
// components/visits/ReportTile.tsx does for an unread report. An edge stripe is visible in
// peripheral vision at a glance down a list, where a pill inside a card is not.
//
// ONLY `uncovered` GETS ONE. A page where several states all shout is a page with no emphasis at
// all — that is the same reasoning that keeps `awareness` out of the warning tone. Every other
// state keeps a transparent edge of the SAME WIDTH, so the cards stay aligned and the marked one
// is the only thing that moves the eye.
//
// A STATIC Record for the Tailwind reason stated above, and exported so /youth and
// /youth/calendar cannot drift apart on it.
export const COVERAGE_EDGE_CLASSES: Record<CoverageState, string> = {
  uncovered: "border-l-4 border-l-danger",
  needs_type: "border-l-4 border-l-transparent",
  unassigned: "border-l-4 border-l-transparent",
  covered: "border-l-4 border-l-transparent",
  awareness: "border-l-4 border-l-transparent",
  not_expected: "border-l-4 border-l-transparent",
};

export type CoverageBadgeProps = {
  coverage: EventCoverage;
};

export function CoverageBadge({ coverage }: CoverageBadgeProps) {
  const { state } = coverage;
  if (state === "not_expected") return null;

  const label = COVERAGE_STATE_LABELS[state];

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[COVERAGE_STATE_TONES[state]]}`}
    >
      {label}
      {/* THE NUMBER, ONLY WHERE IT ADDS SOMETHING. "Covered" answers the question; "Covered · 3"
          answers the follow-up a leader deciding whether to step in actually has. On every other
          state the count is zero and repeating it would say the same thing twice. */}
      {state === "covered" ? ` · ${coverage.attendeeCount}` : null}
    </span>
  );
}
