"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

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
export type FinalizeTopicsVariant = "pill" | "panel";

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
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function toggle(): Promise<void> {
    setErrorMessage(undefined);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/sundays/${sundayId}/topics-finalized`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalized: !finalized }),
      });

      if (!response.ok) {
        // The route's own sentence where it has one. A silent failure here is the worst possible
        // outcome: the reader would believe a whole month was settled (CLAUDE.md rule 7).
        const payload: { error?: string } = await response.json().catch(() => ({}));
        setErrorMessage(payload.error ?? "Could not save that. Please try again.");
        return;
      }

      router.refresh();
    } catch (error) {
      console.error("Could not set a Sunday's topics-finalized state", { sundayId, error });
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const pressed = isSaving ? !finalized : finalized;

  // WHOLE LITERALS, never an interpolated class name. Tailwind scans source text for complete
  // class strings, so a composed `border-${tone}` compiles and produces NO CSS at all — the
  // control renders unstyled and nothing anywhere errors (components/ui/Pill.tsx, rule 1).
  //
  // `text-background` on the filled state is the same measured pair StatusPill's `complete` uses:
  // --background inverts in lockstep with --stage-complete, so one static class is correct in both
  // themes where a literal `text-white` would fail badly in dark.
  const toneClasses = pressed
    ? "border-stage-complete bg-stage-complete text-background"
    : "border-border text-muted";

  // THE BUTTON'S BOX IS THE TAP TARGET; THE SPAN INSIDE IT IS THE THING YOU SEE.
  //
  // `pill`: 44px for the thumb, with the visible tab left-aligned so it ABUTS the pill. The rest
  // of the button's width is invisible but clickable, and it sits in the gap BEFORE the next pill
  // rather than over it — this button's box ends where the next list item begins.
  //
  // `panel`: there is no pill to attach to, so the button itself is the visible control.
  const buttonClasses =
    variant === "pill"
      ? "h-11 w-11 justify-start"
      : `min-h-11 gap-2 rounded-md border px-3 text-sm font-medium ${toneClasses}`;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={isSaving}
        // aria-pressed, not a checkbox role: this is a toggle button, and its label stays the same
        // in both states so a screen reader announces the STATE changing rather than the name.
        aria-pressed={pressed}
        // NAMED IDENTICALLY IN BOTH VARIANTS, and the visible word below is aria-hidden so the two
        // cannot disagree. A control whose accessible name changes with its state reads as a
        // different control each time it is pressed.
        aria-label={`Topics are decided — ${sundayLabel}`}
        className={`inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 ${buttonClasses}`}
      >
        {variant === "pill" ? (
          // THE SEAM IS THE PILL'S OWN RIGHT BORDER, so this drops its left one. `border-l-0` plus
          // `rounded-l-none` is what turns two adjacent boxes into one segmented control.
          //
          // The height is pinned to match components/ui/Pill.tsx's `px-2 py-0.5 text-xs` rather
          // than inherited, because this is a BUTTON and not a Pill — and if the two disagree by a
          // pixel the seam shows as a step, which is worse than the gap this replaced.
          <span
            aria-hidden="true"
            className={`inline-flex h-[22px] items-center rounded-l-none rounded-r-full border border-l-0 px-2 ${toneClasses}`}
          >
            {/* COLOUR IS NEVER THE ONLY SIGNAL (Pill's rule 2). The mark is present in both states
                and the difference is the FILL plus aria-pressed, so the state survives being read
                aloud and being seen by somebody who cannot tell the two greens apart. */}
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : (
          <>
            <Check aria-hidden="true" className="h-4 w-4" />
            {/* aria-hidden because the button's own aria-label already names it. Without this a
                screen reader reads the control twice and the two readings differ. */}
            <span aria-hidden="true">
              {pressed ? "Topics are decided" : "Mark topics decided"}
            </span>
          </>
        )}
      </button>

      {/* Inline rather than a toast, because this control lives inside a row of six and a toast
          would not say WHICH Sunday failed. */}
      {errorMessage !== undefined && (
        <span role="alert" className="text-xs text-danger">
          {errorMessage}
        </span>
      )}
    </>
  );
}
