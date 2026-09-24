"use client";

import {
  FinalizeToggle,
  type FinalizeToggleVariant,
} from "@/components/sacrament/FinalizeToggle";

// SINCE p4-sacrament-c THE BODY LIVES IN components/sacrament/FinalizeToggle.tsx, shared with the
// References pill. This wrapper supplies the topics route and its wording; its props did not
// change, so StatusPill and TopicsFinalizedPanel were not touched. The reasoning below still
// describes what the control does.
//
// THE CHECKMARK ATTACHED TO THE TOPICS PILL — the prototype's `FinalizablePill`, built there
// "per direct request ('handy to be able to just do it from the pill')"
// (build note §topics-pill-and-finalize-checkmark).
//
// ---------------------------------------------------------------------------
// IT WRITES THE SAME FACT AS THE PAGE'S OWN BUTTON. THERE IS NO SECOND SYSTEM.
// ---------------------------------------------------------------------------
// The prototype says this explicitly about its own version — the pill "reuses the exact same
// topicsFinalized state and toggle logic the Topics module's own Finalize button already wrote
// to, not a second, parallel finalization system". Here that is one column
// (`sundays.topics_finalized_at`), one route (PATCH /api/sundays/[id]/topics-finalized) and one
// data-layer function (setTopicsFinalized), so finalizing from either place shows up identically
// in both.
//
// ---------------------------------------------------------------------------
// ⚠️ A SIBLING OF THE PILL'S ANCHOR, NEVER NESTED INSIDE IT
// ---------------------------------------------------------------------------
// A <button> inside an <a> is invalid HTML and leaves a screen reader with no way to reach
// either. components/sacrament/SundayCard.tsx already avoided exactly this with a stretched
// pseudo-element for the card link, and app/(app)/music/SundayMusicCard.tsx states the same rule
// for its accordion. StatusPill renders the two side by side in one flex row so they READ as one
// control while remaining two elements.
//
// It also carries `relative z-10` at its call site, because the card's heading link stretches a
// pseudo-element over the whole card — without it every press would land on the programme link.
//
// ---------------------------------------------------------------------------
// ABSENT, NEVER DISABLED, FOR ANYBODY WITHOUT `topics.manage`
// ---------------------------------------------------------------------------
// StatusPill decides that; this component assumes it may write. The permission it gates on is the
// one the route asserts, which is youth-a-D1's rule — never hide a control the API would allow,
// and never show one it would refuse.
//
// ---------------------------------------------------------------------------
// `router.refresh()` RATHER THAN LOCAL STATE
// ---------------------------------------------------------------------------
// Finalizing changes what OTHER things on the page say — and on /music, a whole card's
// appearance. Keeping the answer in this component's state would make the checkmark the only
// thing that moved, which is the two-numbers-one-state failure ITER-022 recorded. The server
// re-reads and everything derived from the column moves together.
//
// The pressed state is held optimistically ONLY while the request is in flight, so a slow network
// does not leave a control that looks inert; it is replaced by the server's answer either way.

// TWO SHAPES, ONE WRITE. The prototype has the same two — a checkmark attached to the calendar
// pill, and the Topics module's own "Finalize" button — and says in as many words that the pill
// "reuses the exact same … toggle logic … not a second, parallel finalization system". So the
// AFFORDANCE differs and everything behind it does not: one component, one route, one column.
//
// A row of six pills has no room for a word, and a page that is about one Sunday has no reason to
// make the reader guess what a bare tick means.
export type FinalizeTopicsVariant = FinalizeToggleVariant;

export type FinalizeTopicsButtonProps = {
  sundayId: string;
  finalized: boolean;
  // Names the Sunday, because this control repeats once per card and up to six times on a month.
  // "Topics are decided — Sunday, March 1" is what a screen reader needs, not "Finalize" six times.
  sundayLabel: string;
  variant?: FinalizeTopicsVariant;
};

export function FinalizeTopicsButton({
  sundayId,
  finalized,
  sundayLabel,
  variant = "pill",
}: FinalizeTopicsButtonProps) {
  return (
    <FinalizeToggle
      url={`/api/sundays/${sundayId}/topics-finalized`}
      pressed={finalized}
      pressedBody={{ finalized: true }}
      unpressedBody={{ finalized: false }}
      ariaLabel={`Topics are decided — ${sundayLabel}`}
      variant={variant}
      panelLabels={{ pressed: "Topics are decided", unpressed: "Mark topics decided" }}
    />
  );
}
