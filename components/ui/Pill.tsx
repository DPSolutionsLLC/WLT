import type { ReactNode } from "react";

// THE ONE PILL SHAPE IN THIS CODEBASE.
//
// Ten components rendered their own `inline-flex items-center rounded-full border px-2 py-0.5
// text-xs` before P1 — StageBadge, SundayTypeBadge, GoalStatusBadge, UnverifiedHymnBadge,
// ProgramStatusBadge, MemberStatusBadge, CoverageBadge, FollowUpBadge, YouthAbsenceChip and the
// two in app/(app)/visits/GaugePill.tsx. Ten copies of one shape drift on the next change to the
// padding or the radius, which is the reason conventions.md moves a component rather than copying
// it. P4 re-skins module by module, and it can only be a re-skin if there is one pill to re-skin.
//
// ---------------------------------------------------------------------------
// `Pill` OWNS THE SHAPE. EACH CALLER KEEPS ITS OWN SEMANTICS.
// ---------------------------------------------------------------------------
// This is the distinction the whole migration turns on. There are nine measured pipeline-stage
// tokens, six coverage tones, four visit bands, three member statuses and seven Sunday types in
// this app, and every one of those palettes was measured against the surfaces in both themes and
// argued for in its own file's header. Flattening them into four generic tones would delete those
// decisions silently — nothing would fail, the badges would simply stop saying different things.
//
// So `tone` exists for a caller with no palette of its own, and `toneClassName` is the escape
// hatch for every caller that has one. `Pill` never inspects, filters or rewrites what it is
// given: it concatenates.
//
// ---------------------------------------------------------------------------
// THE THREE RULES THIS COMPONENT EXISTS TO HOLD
// ---------------------------------------------------------------------------
// 1. NEVER AN INTERPOLATED CLASS NAME. Tailwind scans source text for complete class strings, so
//    `border-${tone}` compiles fine and produces NO CSS AT ALL — the pill renders unstyled and
//    nothing anywhere errors. Every tone below is a whole literal, and every caller passing
//    `toneClassName` must pass whole literals from a static Record too. StageBadge,
//    CoverageBadge, FollowUpBadge and app/(app)/visits/bandStyles.ts all state this rule in their
//    own headers; it is stated here because this is now the file they all pass through.
//
// 2. COLOUR IS NEVER THE ONLY SIGNAL. Every caller passes words. `Pill` renders its children
//    verbatim and adds no colour-only affordance of its own — no dot, no bare glyph. Seven hues
//    separate seven things only for somebody who can see all seven.
//
// 3. THE TONE IS TEXT AND BORDER ON THE SURROUNDING SURFACE, NEVER WHITE ON A FILL. Every token
//    in app/globals.css was measured against --background, --surface and --surface-raised. A
//    solid fill would owe a second measurement per state per theme, and nobody would take it.
//
//    ⚠️ ONE CALLER NOW FILLS, AND IT TOOK THE MEASUREMENT: components/sacrament/StatusPill.tsx
//    fills its `complete` state only, by the user's decision while walking scenario 072 — a
//    filled pill differs in WEIGHT rather than in hue, which is what a month of Sundays needed
//    to be scannable. The rule above is intact, not weakened: what makes it safe there is
//    `text-background`, a TOKEN that inverts in lockstep with the fill, so one static class pair
//    is correct in both themes. A literal `text-white` is the failure this rule exists to
//    prevent — it passes in light and fails badly in dark. Any future fill owes the same
//    measurement and must state it in its own header, as that file does.
//
// `toneClassName` WINS OVER `tone` when both are given, and the type comment says to pass one.
// Deliberately not a throw: a runtime throw in a presentational component turns a styling slip
// into a blank page, which is worse than a defined precedence a reader can look up.
//
// No "use client". It holds no state and no handlers, so it renders in a Server Component and in
// a client one alike — the rule UnverifiedHymnBadge and bandStyles.ts both record.

export type PillTone = "ok" | "pending" | "missing" | "neutral";

export type PillProps = {
  children: ReactNode;
  // The three P1 tones plus neutral, for callers with no palette of their own.
  tone?: PillTone;
  // THE ESCAPE HATCH, and the reason this phase does not flatten ten badges into four tones.
  // A caller with its own measured palette — nine pipeline stages, six coverage tones, four
  // visit bands — passes its own STATIC border/text classes here instead of `tone`.
  // Pass exactly one of `tone` or `toneClassName`.
  toneClassName?: string;
  className?: string;
  // A CONVENIENCE AND NEVER THE ONLY CARRIER: a title is unreachable by touch and by keyboard,
  // so nothing may depend on it. GaugePill's due date and UnverifiedHymnBadge's warning both
  // repeat elsewhere on the page.
  title?: string;
};

const SHAPE_CLASSES = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs";

const TONE_CLASSES: Record<PillTone, string> = {
  ok: "border-success text-success",
  pending: "border-warning text-warning",
  missing: "border-danger text-danger font-semibold",
  neutral: "border-border text-muted",
};

export function Pill({
  children,
  tone = "neutral",
  toneClassName,
  className = "",
  title,
}: PillProps) {
  const toneClasses = toneClassName ?? TONE_CLASSES[tone];

  return (
    <span className={`${SHAPE_CLASSES} ${toneClasses} ${className}`.trim()} title={title}>
      {children}
    </span>
  );
}
