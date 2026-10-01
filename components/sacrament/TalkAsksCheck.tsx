"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import {
  FinalizeSpeakersDialog,
  type FinalizeSpeakersMode,
} from "@/components/sacrament/FinalizeSpeakersDialog";
import { TALKS_LOCK_REASON_TEXT, type TalksAskState } from "@/lib/sacrament/talkAsks";

// THE TALKS PILL'S FINALIZE CHECK — Sacrament slice f1, made a finalize by ITER-036.
//
// The Topics and Refs pills each carry a finalize checkmark attached to their right edge
// (FinalizeToggle). So does Talks now: finalizing the speakers is what sends their asks to the
// conductor's To Do (D1), and it replaces the old "Send asks (N)" button. The tab shows where the
// asks stand, computed by talksAskState():
//   locked         dimmed, with the reason as a tooltip AND as screen-reader text
//   not_finalized  "N to ask" — pressing finalizes and asks them
//   pending        gold, "Asks sent"
//   accepted       green, a solid fill with a check — StatusPill's measured `complete` pair
//   declined       rust, "N declined"
//
// PRESSING OPENS A CONFIRM (FinalizeSpeakersDialog): to finalize, it names whose To Do the asks go
// to (D6); to un-finalize, who is already scheduled or accepted (D4). `settled` decides which —
// a stamp with speakers still to ask finalizes again rather than un-finalizing over their heads.
//
// THE TAB GEOMETRY IS FinalizeToggle's pill variant: a 44px button whose visible tab is 22px high,
// `rounded-l-none rounded-r-full border-l-0`, butted against the pill with no gap, so it reads as
// part of the pill (sacrament-topics-finalize-and-history: a free-standing circle read as
// unattached).
//
// DIMMED IS ALLOWED HERE. StatusPill's rule against a dimmed pill is about a LINK that looks
// broken; this one carries its reason. A locked tab is disabled unless the Sunday is settled — a
// finalized Sunday whose conductor was cleared can still be un-finalized.

// WHOLE LITERALS, never interpolated (components/ui/Pill.tsx, rule 1).
const TAB_TONES: Record<TalksAskState["kind"], string> = {
  locked: "border-border text-muted opacity-60",
  not_finalized: "border-stage-plan text-stage-plan",
  pending: "border-gold text-gold",
  accepted: "border-stage-complete bg-stage-complete text-background",
  declined: "border-rust text-rust",
};

function tabText(state: TalksAskState): string | null {
  switch (state.kind) {
    case "locked":
    case "accepted":
      return null;
    case "not_finalized":
      return state.count > 0 ? `${state.count} to ask` : "Not finalized";
    case "pending":
      return "Asks sent";
    case "declined":
      return `${state.count} declined`;
  }
}

function spokenState(state: TalksAskState): string {
  switch (state.kind) {
    case "locked":
      return TALKS_LOCK_REASON_TEXT[state.reason];
    case "not_finalized":
      return state.count > 0 ? `not finalized, ${state.count} to ask` : "not finalized";
    case "pending":
      return "asks sent, waiting for answers";
    case "accepted":
      return "every speaker accepted";
    case "declined":
      return `${state.count} declined`;
  }
}

export type TalkAsksCheckProps = {
  state: TalksAskState;
  // speakersSettled(): finalized AND nobody left to ask. Pressing then un-finalizes.
  settled: boolean;
  sundayId: string;
  sundayLabel: string;
};

export function TalkAsksCheck({ state, settled, sundayId, sundayLabel }: TalkAsksCheckProps) {
  const [mode, setMode] = useState<FinalizeSpeakersMode | null>(null);

  const text = tabText(state);
  const isLocked = state.kind === "locked";
  const disabled = isLocked && !settled;
  const reason = isLocked ? TALKS_LOCK_REASON_TEXT[state.reason] : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setMode(settled ? "unfinalize" : "finalize")}
        disabled={disabled}
        aria-pressed={settled}
        aria-label={`Finalize speakers — ${sundayLabel}: ${spokenState(state)}`}
        title={reason}
        className="inline-flex h-11 items-center justify-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span
          aria-hidden="true"
          className={`inline-flex h-[22px] items-center gap-1 rounded-l-none rounded-r-full border border-l-0 px-2 text-xs font-medium ${TAB_TONES[state.kind]}`}
        >
          {text === null ? <Check className="h-3.5 w-3.5" /> : text}
        </span>
      </button>

      {mode !== null && (
        <FinalizeSpeakersDialog
          sundayId={sundayId}
          sundayLabel={sundayLabel}
          mode={mode}
          onClose={() => setMode(null)}
        />
      )}
    </>
  );
}
