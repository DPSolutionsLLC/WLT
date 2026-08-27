import {
  BAND_CLASSES,
  BAND_FILL,
  BAND_MARKS,
  NEUTRAL_BADGE_CLASSES,
} from "@/app/(app)/visits/bandStyles";
import type { VisitPriority } from "@/lib/visits/householdStatus";
import { formatOverdueFor, formatVisitDate } from "@/lib/visits/visitDates";
import { VISIT_PRIORITY_BAND_LABELS } from "@/types/domain";

// THE PILL IS THE GAUGE, and there is exactly one implementation of it.
//
// It fills left to right with how much of a household's interval has elapsed, so the badge shows
// at a glance what a percentage used to spell out — and, unlike a percentage, it can be read
// without doing arithmetic. An OVERDUE pill is filled all the way; a NEVER-VISITED pill has no
// fill at all, because there is no completed visit to measure from and an empty pill is the
// honest rendering of "no anchor".
//
// NO "use client" DIRECTIVE, and none is needed: this renders no state and handles no events. It
// compiles into whichever client bundle imports it, and must never gain a server import.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN FILE
// ---------------------------------------------------------------------------
// It was VisitProgressTable's private PriorityBadge until the all-organizations view needed the
// same gauge on its organization chips. Two implementations of one pill would drift on the next
// change to the fill, the marks or the overdue wording — the same reason BAND_CLASSES and its
// siblings were lifted into bandStyles.ts rather than copied.
//
// The two callers differ in exactly two ways, both parameters rather than forks: whether the
// band's WORD is shown, and what text sits in front of it.

export type GaugePillProps = {
  priority: VisitPriority;
  // Text before the band, on the same pill — an organization's name on the all-organizations
  // view, nothing on the per-organization table. It is never a second pill: one household's
  // standing for one organization is one thing, and splitting it would invite a reader to
  // compare the halves.
  prefix?: string;
  // ---------------------------------------------------------------------------
  // WHEN THE WORD IS DROPPED, AND WHY THAT IS SAFE ONLY HERE
  // ---------------------------------------------------------------------------
  // FALSE on the all-organizations view, by a product decision on 2026-08-27: a reader who has
  // learned the colours managing their own organization reads them without the word, and three
  // or four worded pills on one row is a wall of text at 375px.
  //
  // `never_visited` KEEPS ITS WORD REGARDLESS — see below. That exception is the whole reason
  // this is a band-aware rule rather than a flag the caller applies itself.
  showBandWord?: boolean;
  // Needed only to word an overdue pill as a duration. Pass the render's single instant, never a
  // fresh clock reading, or the top of a list is judged against a different moment from the
  // bottom.
  asOf: Date;
};

// A NEVER-VISITED PILL ALWAYS CARRIES ITS WORD, even where every other band has had its word
// dropped.
//
// The other three bands are a POSITION on a scale and the fill communicates the position: a
// nearly-empty green pill and a full red one are legible without reading. `never_visited` has no
// position — it has no anchor to measure from, which is the entire reason the band exists — so
// its pill is empty, and an empty pill with no word is indistinguishable from a household at the
// very start of its interval. Those are opposite situations: one is settled, one is the most
// urgent thing on the page.
//
// So the fill cannot carry this state, and the word has to.
function bandWordIsRequired(band: VisitPriority["band"]): boolean {
  return band === "never_visited";
}

export function GaugePill({
  priority,
  prefix,
  showBandWord = true,
  asOf,
}: GaugePillProps) {
  const { band, elapsedFraction, dueOn } = priority;

  // Clamped for the FILL only. The sort still reads the unclamped fraction, so a household at
  // 140% still leads one at 110% even though both pills are full.
  const fillPercent =
    elapsedFraction === null ? 0 : Math.min(100, Math.max(0, elapsedFraction * 100));

  const wordShown = showBandWord || bandWordIsRequired(band);

  // An overdue pill says HOW LONG overdue, in words, rather than a percentage: "110%" and "109%"
  // are a month apart on a yearly cadence and a day apart on a monthly one, and a reader cannot
  // tell which.
  const word =
    band === "overdue" && dueOn !== null
      ? formatOverdueFor(dueOn, asOf)
      : VISIT_PRIORITY_BAND_LABELS[band];

  const parts = [prefix, wordShown ? word : null].filter(Boolean);

  // THE DUE DATE ON HOVER, for any band that has one. `never_visited` has no due date — there is
  // nothing to compute one from — so it gets no title rather than an invented one.
  //
  // A `title` is a CONVENIENCE AND NEVER THE ONLY CARRIER: it is unreachable by touch and by
  // keyboard, so nothing here may depend on it. The due date is also a column on the
  // per-organization table, which is where somebody goes to act on it.
  const dueTitle = dueOn === null ? undefined : `Due ${formatVisitDate(dueOn)}`;

  return (
    <span
      title={dueTitle}
      className={`relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border px-2 py-0.5 text-xs font-medium ${BAND_CLASSES[band]}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 ${BAND_FILL[band]}`}
        style={{ width: `${fillPercent}%` }}
      />
      {/* aria-hidden: the word beside it already says the band, so a screen reader announcing
          "check mark On track" would read the same fact twice. Where the word has been dropped,
          the mark is still the greyscale-safe separator between the four states — colour alone
          separates them only for somebody who can see all four colours. */}
      <span aria-hidden="true" className="relative">
        {BAND_MARKS[band]}
      </span>
      <span className="relative">{parts.join(" · ")}</span>
      {/* A pill whose word has been dropped still announces its band to a screen reader. The
          visual shorthand is for people who have learned the colours; it is not an excuse to
          publish a control with no accessible name. */}
      {wordShown ? null : (
        <span className="sr-only">{VISIT_PRIORITY_BAND_LABELS[band]}</span>
      )}
    </span>
  );
}

// The pill for a household that is NOT ON THE SCALE — do-not-contact, or an organization with no
// goal to measure against. Shared so the two tables render "not applicable" identically.
export function NeutralPill({ children }: { children: React.ReactNode }) {
  return <span className={NEUTRAL_BADGE_CLASSES}>{children}</span>;
}
