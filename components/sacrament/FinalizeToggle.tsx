"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

// THE FINALIZE CHECKMARK, GENERALIZED — p4-sacrament-c. It was FinalizeTopicsButton's body; the
// References pill is the second thing that needs it, which is decisions.md §1.7's "generalize the
// second time it is needed". FinalizeTopicsButton is now a thin wrapper and its header keeps the
// reasoning for the shape — sibling of the pill, never nested; router.refresh() rather than local
// state; optimistic only while in flight.
//
// ⚠️ THE PILL-VARIANT GEOMETRY IS LOAD-BEARING. The h-11 w-11 button, the 22px tab with
// `rounded-l-none rounded-r-full border-l-0`, and gap 0 at the call site are what make the tick
// read as ATTACHED to its pill. A free-standing circle is the defect walking scenario 073 found
// (plans/retros/sacrament-topics-finalize-and-history.md). Change nothing here without re-walking.
//
// DISABLED IS NEW, and it carries its reason twice: as a `title` for a pointer, and as visually
// hidden text for everybody else — a tooltip alone is unreachable by touch and by keyboard.

export type FinalizeToggleVariant = "pill" | "panel";

export type FinalizeToggleProps = {
  url: string;
  pressed: boolean;
  // Sent when the control is pressed while UNPRESSED, and while PRESSED, respectively.
  pressedBody: unknown;
  unpressedBody: unknown;
  // One name in both states, so a screen reader announces the state changing, not the control.
  ariaLabel: string;
  variant?: FinalizeToggleVariant;
  // The visible words on the `panel` variant.
  panelLabels?: { pressed: string; unpressed: string };
  disabled?: boolean;
  disabledReason?: string;
};

export function FinalizeToggle({
  url,
  pressed,
  pressedBody,
  unpressedBody,
  ariaLabel,
  variant = "pill",
  panelLabels,
  disabled = false,
  disabledReason,
}: FinalizeToggleProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function toggle(): Promise<void> {
    setErrorMessage(undefined);
    setIsSaving(true);

    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pressed ? unpressedBody : pressedBody),
      });

      if (!response.ok) {
        // The route's own sentence where it has one. A silent failure here would leave a reader
        // believing a Sunday was settled (CLAUDE.md rule 7).
        const payload: { error?: string } = await response.json().catch(() => ({}));
        setErrorMessage(payload.error ?? "Could not save that. Please try again.");
        return;
      }

      router.refresh();
    } catch (error) {
      console.error("Could not toggle a finalize control", { url, error });
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const shownPressed = isSaving ? !pressed : pressed;

  // WHOLE LITERALS, never an interpolated class name (components/ui/Pill.tsx, rule 1).
  // `text-background` on the filled state is StatusPill's measured `complete` pair.
  const toneClasses = shownPressed
    ? "border-stage-complete bg-stage-complete text-background"
    : "border-border text-muted";

  const buttonClasses =
    variant === "pill"
      ? "h-11 w-11 justify-start"
      : `min-h-11 gap-2 rounded-md border px-3 text-sm font-medium ${toneClasses}`;

  const isDisabled = isSaving || disabled;
  const showsReason = disabled && disabledReason !== undefined;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={isDisabled}
        aria-pressed={shownPressed}
        aria-label={ariaLabel}
        title={showsReason ? disabledReason : undefined}
        className={`inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 ${buttonClasses}`}
      >
        {variant === "pill" ? (
          // THE SEAM IS THE PILL'S OWN RIGHT BORDER, so this drops its left one. The height is
          // pinned to components/ui/Pill.tsx's `px-2 py-0.5 text-xs` so the seam never steps.
          <span
            aria-hidden="true"
            className={`inline-flex h-[22px] items-center rounded-l-none rounded-r-full border border-l-0 px-2 ${toneClasses}`}
          >
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : (
          <>
            <Check aria-hidden="true" className="h-4 w-4" />
            <span aria-hidden="true">
              {shownPressed ? panelLabels?.pressed : panelLabels?.unpressed}
            </span>
          </>
        )}
      </button>

      {showsReason && <span className="sr-only">{disabledReason}</span>}

      {/* Inline rather than a toast, so it says WHICH Sunday failed. */}
      {errorMessage !== undefined && (
        <span role="alert" className="text-xs text-danger">
          {errorMessage}
        </span>
      )}
    </>
  );
}
