"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

// A shared primitive, not a roster component — SPEC.md §Component Structure lists it under
// /components/ui and Phases 4, 6, 7 and 10 will all use it.
//
// Built on the native <dialog> with showModal(), which gives focus trapping, the backdrop,
// Escape-to-close, inertness of the page behind, and focus returning to the trigger on close —
// all from the platform. Every one of those is a bug waiting to happen when hand-written, and
// three of them are things screen-reader users notice first.
//
// Deliberately not configurable. Sizes, placements, and a stack of nested dialogs are not
// needed by any caller in this app, and the minimum that is correct is easier to keep correct.
export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Driven by the isOpen prop rather than by calling showModal() from a click handler, so the
  // parent's state is the single source of truth. The dialog's own close event calls back up,
  // which is what keeps Escape from leaving the parent thinking it is still open.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // showModal() makes the page behind inert but does not stop it scrolling, so a swipe over the
  // backdrop on a phone scrolls the roster underneath the picker. The overflow lock is what the
  // platform does not give us.
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      // The backdrop is part of the dialog element itself, so a click landing on the dialog
      // rather than on its content is a backdrop click.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className={
        "m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 " +
        "backdrop:bg-black/50 md:m-auto md:h-auto md:max-h-[85vh] md:w-full md:max-w-lg"
      }
    >
      {/* Full height with its own internal scroll on a phone; a centred card from md up. */}
      <div className="flex h-full max-h-full flex-col overflow-hidden bg-surface-raised text-foreground md:rounded-lg md:border md:border-border">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-sm font-medium text-muted hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </dialog>
  );
}
