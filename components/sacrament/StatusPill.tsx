import type { ReactNode } from "react";
import Link from "next/link";
import { FinalizeTopicsButton } from "@/components/sacrament/FinalizeTopicsButton";
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
// EXPORTED FOR components/sacrament/ReferencesPill.tsx, which wraps the same Pill in a button
// rather than a link. One Record, so the two cannot drift apart.
export const STATUS_TONES: Record<PillStatus, string> = {
  empty: "border-stage-plan text-stage-plan",
  partial: "border-warning text-warning",
  complete: "border-stage-complete bg-stage-complete text-background",
};

// ---------------------------------------------------------------------------
// THE FINALIZE CHECKMARK IS A SIBLING, NOT A CHILD — p4-sacrament-b2
// ---------------------------------------------------------------------------
// The pill above is an `<a>`. A `<button>` inside it would be invalid HTML and would leave a
// screen reader unable to reach either, which is the same interactive-nesting trap SundayCard
// avoided with a stretched pseudo-element and SundayMusicCard states for its accordion. So the
// two sit side by side in one flex row: they READ as one control and remain two elements, which
// is exactly what the prototype's `FinalizablePill` is.
//
// IT APPEARS ON A PILL WHOSE `finalized` IS A BOOLEAN, AND ONLY IF THE READER MAY WRITE IT. Today
// that is `topics` alone; the other three carry null and cannot grow a control by accident
// (lib/sacrament/sundayStatus.ts). Somebody without `topics.manage` sees the pill and NO
// checkmark — absent, never disabled, which is the rule this file's header already states for the
// pill itself.
export type StatusPillProps = {
  pill: SundayPill;
  href: string;
  // Names the Sunday, because the label alone repeats six times per card and up to thirty times
  // on a month. A screen reader moving link to link needs "Topics, 2 of 3 — Sunday, March 1",
  // not "Topics" thirty times over.
  sundayLabel: string;
  // Needed only by the finalize control, which writes to this Sunday.
  sundayId: string;
  // `topics.manage` — the permission PATCH /api/sundays/[id]/topics-finalized asserts. Resolved
  // once per page and handed down, never re-derived here (CLAUDE.md rule 10).
  canFinalizeTopics: boolean;
  // Attached to the pill's right edge in place of a finalize checkmark — the Talks pill's ask
  // check (components/sacrament/TalkAsksCheck.tsx). A sibling, never a child of the anchor, for the
  // reason the header gives.
  trailing?: ReactNode;
};

export function StatusPill({
  pill,
  href,
  sundayLabel,
  sundayId,
  canFinalizeTopics,
  trailing,
}: StatusPillProps) {
  const showsFinalizeControl = pill.finalized !== null && canFinalizeTopics;
  const hasAttachment = showsFinalizeControl || trailing !== undefined;

  return (
    // NO GAP. The pill and the checkmark are ONE segmented control, and the whole reason this
    // wrapper exists is to hold them against each other — see the header above.
    <span className="inline-flex items-center">
    <Link
      href={href}
      aria-label={`${pill.label}, ${pill.spokenCount} — ${sundayLabel}`}
      // min-h-11 IS 44px, AND IT IS THE POINT OF THE WRAPPER BEING A FLEX BOX.
      // Walking scenario 072 found every pill 19px high: `Pill` is `px-2 py-0.5 text-xs`, which
      // was right for all ten of its previous callers because every one of them was a BADGE.
      // These are the first INTERACTIVE Pills in the app, and nothing in the primitive or its
      // tests noticed the change of role. The tap target grows on the ANCHOR rather than on
      // `Pill`, so the badge shape is untouched everywhere else it is used.
      className="inline-flex min-h-11 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {/* `rounded-r-none` SQUARES OFF THE SIDE THE CHECKMARK ATTACHES TO, and only when one is
          there — a pill with a flat right edge and nothing beside it would just look broken.
          Tailwind emits the per-corner utilities after the `rounded-full` shorthand, which is what
          makes `rounded-full rounded-r-none` resolve the way it reads. */}
      <Pill
        toneClassName={STATUS_TONES[pill.status]}
        className={hasAttachment ? "font-medium rounded-r-none" : "font-medium"}
      >
        {/* aria-hidden on the visible text, because the anchor's own aria-label already says all
            of it and more. Without this a screen reader reads the pill twice. */}
        <span aria-hidden="true">
          {pill.label} {pill.countText}
        </span>
      </Pill>
    </Link>

      {showsFinalizeControl && (
        <FinalizeTopicsButton
          sundayId={sundayId}
          // Narrowed by showsFinalizeControl above; the boolean is what makes a pill finalizable.
          finalized={pill.finalized === true}
          sundayLabel={sundayLabel}
        />
      )}

      {trailing}
    </span>
  );
}
