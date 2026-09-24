import type { ReactNode } from "react";

// SMALL TO SEE, 44px TO TAP — the compact per-item button the user asked for walking scenario 074.
// The BUTTON keeps the 44px target every control in this app clears; the bordered span inside is
// what you see. The same shape as ReferencesEditor's private IconTextButton.
//
// `label` IS OPTIONAL: with none, the button is the icon alone, square, and `accessibleName` is the
// only name it has. Walking scenario 077 found that three labelled buttons on a to-do card squeezed
// its title to a word per line at 375px, and the user chose icons over moving the buttons.

export function SmallButton({
  label,
  accessibleName,
  onClick,
  disabled = false,
  children,
}: {
  label?: string;
  accessibleName: string;
  onClick: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={accessibleName}
      className={
        "group inline-flex min-h-11 items-center justify-center px-0.5 focus-visible:outline-none disabled:opacity-60 " +
        (label === undefined ? "min-w-11" : "")
      }
    >
      <span
        aria-hidden="true"
        className={
          "inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border text-xs font-medium text-foreground group-hover:bg-surface group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary " +
          (label === undefined ? "w-7" : "px-2")
        }
      >
        {children}
        {label}
      </span>
    </button>
  );
}

// A ✕ that asks once. The first tap arms it and the glyph becomes the word "Remove?"; the second
// removes. Arming clears itself after 4 seconds, as ConfirmDeleteButton's does, so a row left
// armed is not a trap for the next tap. An affordance against a misplaced thumb, never a
// security boundary.
export function RemoveButton({
  accessibleName,
  isArmed,
  onArm,
  onConfirm,
  disabled = false,
}: {
  accessibleName: string;
  isArmed: boolean;
  onArm: () => void;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={isArmed ? onConfirm : onArm}
      aria-label={isArmed ? `Confirm: ${accessibleName}` : accessibleName}
      className={
        "inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-2 text-muted " +
        "hover:bg-surface hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 " +
        "focus-visible:outline-primary disabled:opacity-60"
      }
    >
      <span aria-live="polite" className={isArmed ? "text-xs font-semibold text-danger" : "text-base"}>
        {isArmed ? "Remove?" : "✕"}
      </span>
    </button>
  );
}
