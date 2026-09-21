"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

// Two clicks to delete. The first ARMS and changes the visible label; the second deletes.
//
// ---------------------------------------------------------------------------
// THIS IS AN AFFORDANCE, NOT A SECURITY BOUNDARY
// ---------------------------------------------------------------------------
// Both of these are true and they are different layers. youth-h is right that a dialog you can
// click through is not protection — the reason `Remove` on an activity is gated on the SERVER
// with a 409 when a follow-up exists, and the reason it is hidden in the UI as well. This button
// is the second of those two, never the first. It stops a misplaced thumb on a phone; it stops
// nothing else. Never let a caller reach for this INSTEAD of a server refusal.
//
// NEVER window.confirm. It is blocked outright in sandboxed preview contexts, which the prototype
// found the hard way (plans/prototype/decisions.md section 1.5) — and a blocked confirm() returns
// false, so the delete silently does not happen and nobody is told why. It is also unstyleable
// and it freezes the whole tab.
//
// ARMING SELF-CLEARS AFTER 4 SECONDS. A button left reading "Confirm?" is a trap: the next person
// to touch that row deletes something while believing they are opening it. The timer is cleared
// on unmount in the effect's cleanup, so a row removed mid-arm neither leaks the timeout nor
// fires setState on a component that is gone.
//
// aria-live="polite" ON THE LABEL so the arming is ANNOUNCED and not merely seen. A state change
// that only exists as a word swap on screen does not exist at all for a screen-reader user, and
// they are exactly the user who most needs to know this button's meaning just changed.

const ARM_TIMEOUT_MS = 4000;

export type ConfirmDeleteButtonProps = {
  onConfirm: () => void;
  label?: string;
  confirmLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function ConfirmDeleteButton({
  onConfirm,
  label = "Remove",
  confirmLabel = "Confirm?",
  disabled = false,
  className = "",
}: ConfirmDeleteButtonProps) {
  const [isArmed, setIsArmed] = useState(false);

  // The effect depends on `isArmed` ALONE and deliberately does not read `onConfirm`. If it did,
  // every parent re-render passing a fresh arrow function would restart the 4 seconds, and a busy
  // list would leave a button armed indefinitely. The callback is read in the click handler
  // instead, where it is always the current render's.
  useEffect(() => {
    if (!isArmed) return;

    const timer = setTimeout(() => setIsArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isArmed]);

  return (
    <Button
      variant={isArmed ? "danger" : "secondary"}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;

        if (!isArmed) {
          setIsArmed(true);
          return;
        }

        setIsArmed(false);
        onConfirm();
      }}
      className={className}
    >
      {/* The live region is the label itself, so the announcement carries the new word rather
          than a separate sentence that could drift from it. */}
      <span aria-live="polite">{isArmed ? confirmLabel : label}</span>
    </Button>
  );
}
