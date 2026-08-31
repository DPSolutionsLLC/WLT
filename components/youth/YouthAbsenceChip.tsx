import { describeYouthAbsence } from "@/lib/youth/coverage";

// That the young person is not taking part, as one chip.
//
// A COMPONENT RATHER THAN INLINE MARKUP because /youth, /youth/calendar and /youth/events/[id] all
// render it, and three copies would drift the moment the wording is retuned — the reasoning
// CoverageBadge's header states, and the same reason this file sits beside it.
//
// ---------------------------------------------------------------------------
// THE WORDS COME FROM describeYouthAbsence(), NOT FROM THIS FILE
// ---------------------------------------------------------------------------
// The sentence lives beside the computation that decides it, which is describeSeasonNeed()'s and
// describeActivitySupport()'s rule. Three screens render this chip and they must not word it
// differently, and the wording is TENSE-FREE on purpose — it appears on a game played last month
// and on next Friday's alike (lib/youth/coverage.ts argues it in full).
//
// RETURNS null FOR `true` AND FOR `null`. Taking part is the ordinary case, and a chip on every
// card saying so is noise — exactly as CoverageBadge returns null for `not_expected` and
// FollowUpBadge for `not_due`.
//
// ---------------------------------------------------------------------------
// A DIFFERENT TONE FROM `Cancelled`, DELIBERATELY
// ---------------------------------------------------------------------------
// The Cancelled chip in EventList owns --warning. A called-off game and a young person who is not
// taking part are DIFFERENT FACTS and must not read as one thing. This is quiet on purpose: it is
// information, not an alarm, and the whole point of the feature is that it REMOVES alarm — a
// marked game raises no coverage badge and asks for no follow-up.
//
// DASHED rather than solid, which is what separates it from the plain type chip beside it, whose
// border is `border-border` solid. --border and --muted are both redefined in the dark block of
// app/globals.css, so the pill carries its meaning in both themes.
//
// COLOUR IS NEVER THE ONLY SIGNAL (ITER-022): the chip carries a whole sentence, and it is the
// sentence rather than the tone that says what happened.
//
// A STATIC class string, never an interpolated one. Tailwind scans source text for complete class
// strings, so `border-${tone}` compiles to nothing and the chip renders unstyled — the rule
// CoverageBadge, FollowUpBadge and app/(app)/visits/bandStyles.ts all state.
const CHIP_CLASSES =
  "rounded-full border border-dashed border-muted px-2 py-0.5 text-xs font-medium text-muted";

export type YouthAbsenceChipProps = {
  youthAttended: boolean | null;
  // Null where the profile is not in the reader's list, which describeYouthAbsence() words as
  // "This young person" rather than leaving a blank.
  memberName: string | null;
};

export function YouthAbsenceChip({ youthAttended, memberName }: YouthAbsenceChipProps) {
  const label = describeYouthAbsence(youthAttended, memberName);
  if (label === null) return null;

  return <span className={CHIP_CLASSES}>{label}</span>;
}
