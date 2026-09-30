"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";

// "Comments on this Sunday" — the meeting-level thread, moved OFF the Topics screen into a window
// (Topics rebuild t3). It is WLT's, not the prototype's, and kept on purpose: it is where the
// bishopric talks about the meeting as a whole rather than one speaker. The thread arrives already
// rendered by the server page.

export type SundayCommentsButtonProps = {
  count: number;
  children: ReactNode;
};

export function SundayCommentsButton({ count, children }: SundayCommentsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="min-h-11 self-start text-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Comments on this Sunday{count > 0 ? ` (${count})` : ""}
      </button>
      {isOpen && (
        <Modal isOpen onClose={() => setIsOpen(false)} title="Comments on this Sunday">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              About the meeting as a whole, rather than about one speaker.
            </p>
            {children}
          </div>
        </Modal>
      )}
    </>
  );
}
