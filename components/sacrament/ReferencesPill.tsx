"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FinalizeToggle } from "@/components/sacrament/FinalizeToggle";
import { ReferencesEditor } from "@/components/sacrament/ReferencesEditor";
import { STATUS_TONES } from "@/components/sacrament/StatusPill";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import type { SundayPill } from "@/lib/sacrament/sundayStatus";

// THE REFERENCES PILL ON THE SACRAMENT HUB — p4-sacrament-c.
//
// ---------------------------------------------------------------------------
// A BUTTON, NOT A LINK, AND THE ONE EXCEPTION TO StatusPill's "ALWAYS AN <a>"
// ---------------------------------------------------------------------------
// The prototype opens References as a modal over the calendar (`HomeCalendar` →
// `ReferencesModal`), decided with the user as this slice's editor. There is no page for it to
// link to, and a fake href would be the broken-link bug P3 closed. It keeps StatusPill's other
// rules unchanged: never dimmed, always pressable, a 44px target (`min-h-11` on the BUTTON so the
// visible pill stays badge-height), and the same measured tones.
//
// THE CHECKMARK IS A SIBLING, as on Topics — a button inside a button is as invalid as a button
// inside a link. It is DISABLED (with its reason) rather than absent while there is nothing to
// finalize: the reader may write it, just not yet.
//
// RENDERED ONLY FOR THE BISHOPRIC. SundayCard filters this pill out for anybody without
// `talks.plan` (migration 080, defect 074-D2), so every reader here may write.
//
// The modal body mounts ONLY WHILE OPEN, so a month of closed pills fetches nothing.

export type ReferencesPillProps = {
  pill: SundayPill;
  sundayLabel: string;
  sundayId: string;
};

const DISABLED_REASON = "Add a reference or skip first";

export function ReferencesPill({ pill, sundayLabel, sundayId }: ReferencesPillProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const showsFinalizeControl = pill.finalized !== null;
  const finalized = pill.finalized === true;

  // `Refs: skipped` is the prototype's own wording; a count reads `Refs 3`.
  const visibleText =
    pill.countText === "skipped" ? `${pill.label}: skipped` : `${pill.label} ${pill.countText}`;

  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-label={`References, ${pill.spokenCount} — ${sundayLabel}`}
        className="inline-flex min-h-11 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Pill
          toneClassName={STATUS_TONES[pill.status]}
          className={showsFinalizeControl ? "font-medium rounded-r-none" : "font-medium"}
        >
          <span aria-hidden="true">{visibleText}</span>
        </Pill>
      </button>

      {showsFinalizeControl && (
        <FinalizeToggle
          url={`/api/sundays/${sundayId}/references-decision`}
          pressed={finalized}
          // Un-pressing clears BOTH a finalize and a skip — the prototype's toggle does the same.
          pressedBody={{ decision: "finalized" }}
          unpressedBody={{ decision: null }}
          ariaLabel={`References are ready — ${sundayLabel}`}
          disabled={!finalized && pill.filled === 0}
          disabledReason={DISABLED_REASON}
        />
      )}

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={`References — ${sundayLabel}`}
      >
        {isOpen && (
          <ReferencesEditor sundayId={sundayId} onChanged={() => router.refresh()} />
        )}
      </Modal>
    </span>
  );
}
