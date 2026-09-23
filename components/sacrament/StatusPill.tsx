import Link from "next/link";
import { Pill } from "@/components/ui/Pill";
import type { PillStatus, SundayPill } from "@/lib/sacrament/sundayStatus";

// One pill in a Sunday's row on the Sacrament hub: a label, a count, and a link to the page that
// owns it.
//
// ---------------------------------------------------------------------------
// ALWAYS AN `<a>`. NEVER A DISABLED BUTTON, AND NEVER DIMMED.
// ---------------------------------------------------------------------------
// P3 deleted `Tile.locked` outright rather than restyling it, and replaced its tests with the
// inverse guarantee asserted on SHAPE: a root anchor, keyboard reachable, with no `opacity-`
// class anywhere on it. The reasoning carries here unchanged — a pill somebody cannot act on is
// a pill that should not have been rendered, and a dimmed control is one that looks broken while
// claiming to be a rule. Every pill in this row goes somewhere, including the empty ones: an
// empty Topics pill is the single most useful thing on the page to be able to press.
//
// ---------------------------------------------------------------------------
// COMPLETE IS A SOLID FILL. THE OTHER TWO STAY OUTLINED.
// ---------------------------------------------------------------------------
// ⚠️ THIS DEPARTS FROM components/ui/Pill.tsx's THIRD RULE, DELIBERATELY AND WITH THE USER'S
// DECISION BEHIND IT (walking scenario 072, 2026-09-22). That header says a tone is "text and
// border on the surrounding surface, NEVER white on a fill", because every token in
// app/globals.css was measured against --background, --surface and --surface-raised, and a fill
// would owe a second measurement per state per theme "and nobody would take it".
//
// THE MEASUREMENT WAS TAKEN RATHER THAN SKIPPED. `text-background` is what makes one static
// class pair correct in both themes, because --background inverts in lockstep with
// --stage-complete:
//
//   light   fill #15803d (dark green)   text #faf7f1 (near-white)   ~5.9:1
//   dark    fill #4ade80 (light green)  text #1b1d1f (near-black)   ~11:1
//
// A literal `text-white` would pass in light and fail badly in dark, which is the exact trap
// Pill's rule exists to prevent. Do not replace the token with a literal.
//
// WHY A FILL AT ALL: the row is scanned, not read. Three outlined tones differ only in hue, so
// "which Sundays are done" needed colour discrimination; a filled pill differs in WEIGHT, which
// survives being skimmed at arm's length and does not depend on telling green from grey.
// Only `complete` fills — if every state filled, the row would be a block of colour again.
//
// NEVER AN INTERPOLATED CLASS NAME. Tailwind reads source text for whole class strings, so
// `border-stage-${status}` compiles fine and produces NO CSS AT ALL — the pill renders unstyled
// and nothing anywhere errors. The Record below holds whole literals, which is the rule
// StageBadge, CoverageBadge and bandStyles.ts each state in their own headers.
//
// COLOUR IS NEVER THE ONLY SIGNAL: the pill always reads `Topics 2/3`, so the state is in the
// numbers for anybody who cannot tell three treatments apart.
const STATUS_TONES: Record<PillStatus, string> = {
  empty: "border-stage-plan text-stage-plan",
  partial: "border-warning text-warning",
  complete: "border-stage-complete bg-stage-complete text-background",
};

export type StatusPillProps = {
  pill: SundayPill;
  href: string;
  // Names the Sunday, because the label alone repeats six times per card and up to thirty times
  // on a month. A screen reader moving link to link needs "Topics, 2 of 3 — Sunday, March 1",
  // not "Topics" thirty times over.
  sundayLabel: string;
};

export function StatusPill({ pill, href, sundayLabel }: StatusPillProps) {
  return (
    <Link
      href={href}
      aria-label={`${pill.label}, ${pill.filled} of ${pill.total} — ${sundayLabel}`}
      // min-h-11 IS 44px, AND IT IS THE POINT OF THE WRAPPER BEING A FLEX BOX.
      // Walking scenario 072 found every pill 19px high: `Pill` is `px-2 py-0.5 text-xs`, which
      // was right for all ten of its previous callers because every one of them was a BADGE.
      // These are the first INTERACTIVE Pills in the app, and nothing in the primitive or its
      // tests noticed the change of role. The tap target grows on the ANCHOR rather than on
      // `Pill`, so the badge shape is untouched everywhere else it is used.
      className="inline-flex min-h-11 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Pill toneClassName={STATUS_TONES[pill.status]} className="font-medium">
        {/* aria-hidden on the visible text, because the anchor's own aria-label already says all
            of it and more. Without this a screen reader reads the pill twice. */}
        <span aria-hidden="true">
          {pill.label} {pill.filled}/{pill.total}
        </span>
      </Pill>
    </Link>
  );
}
