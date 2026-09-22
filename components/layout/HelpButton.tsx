"use client";

import { useState } from "react";
import { CircleQuestionMark } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { HELP_NOT_WRITTEN_YET } from "@/types/domain";

// ---------------------------------------------------------------------------
// IT SAYS PLAINLY THAT PER-PAGE HELP HAS NOT BEEN WRITTEN. DO NOT FABRICATE ANY.
// ---------------------------------------------------------------------------
// The phase file and build note §issue-reporting both insist on this, and the reason is worth
// keeping in front of whoever "finishes" this component: help that describes a screen nobody has
// read will be wrong, and a leader who follows it will do the wrong thing CONFIDENTLY. An honest
// "not written yet" costs a moment; invented help costs somebody a mistake they had no reason to
// doubt.
//
// The sentence lives in types/domain.ts because a "use client" component importing a constant
// out of a module with a server dependency pulls next/headers into the browser bundle, which only
// `npm run build` catches (youth-b, youth-c).
//
// When real per-page help arrives, it arrives as a prop with this as the fallback — not as a
// lookup table keyed on the pathname, which would be a second copy of the module list
// (plans/retros/notification-trigger-drift.md).

export function HelpButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="sr-only">Help</span>
        {/* Decorative: the accessible name above says what this is. */}
        <CircleQuestionMark aria-hidden="true" className="size-5" />
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Help">
        <p className="text-sm text-foreground">{HELP_NOT_WRITTEN_YET}</p>
      </Modal>
    </>
  );
}
