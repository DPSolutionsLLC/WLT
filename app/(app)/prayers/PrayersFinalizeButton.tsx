"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import {
  FinalizeSpeakersDialog,
  type FinalizeSpeakersMode,
} from "@/components/sacrament/FinalizeSpeakersDialog";
import {
  PRAYERS_LOCK_REASON_TEXT,
  type PrayersAskState,
} from "@/lib/prayers/prayerAsks";

// FINALIZE PRAYERS ON THE PRAYERS BOARD — ITER-036 fb (the user asked for it here as well as on the
// hub's Prayer pill, 2026-10-01). The same confirm as the hub (FinalizeSpeakersDialog, kind
// "prayers"), and the same state, computed on the server by loadPrayerAsksBySunday(), so the board
// and the hub cannot disagree.
//
// Rendered only for somebody with `talks.request`, which the finalize route asserts — absent, never
// disabled, for anybody else. A LOCKED state is disabled with its reason in words beside it.

export type PrayersFinalizeButtonProps = {
  sundayId: string;
  sundayLabel: string;
  state: PrayersAskState;
  // prayersSettled(): finalized AND nobody left to ask. Pressing then un-finalizes.
  settled: boolean;
};

function label(state: PrayersAskState, settled: boolean): string {
  if (settled) return state.kind === "accepted" ? "Prayers finalized · confirmed" : "Prayers finalized";
  if (state.kind === "not_finalized" && state.count > 0) {
    return `Finalize prayers (${state.count} to ask)`;
  }
  return "Finalize prayers";
}

export function PrayersFinalizeButton({
  sundayId,
  sundayLabel,
  state,
  settled,
}: PrayersFinalizeButtonProps) {
  const [mode, setMode] = useState<FinalizeSpeakersMode | null>(null);
  const locked = state.kind === "locked" && !settled;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setMode(settled ? "unfinalize" : "finalize")}
        disabled={locked}
        aria-pressed={settled}
        aria-label={`Finalize prayers — ${sundayLabel}`}
        className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 ${
          settled
            ? "border-stage-complete bg-stage-complete text-background"
            : "border-border text-muted"
        }`}
      >
        <Check aria-hidden="true" className="h-4 w-4" />
        {label(state, settled)}
      </button>
      {locked && state.kind === "locked" ? (
        <span className="text-xs text-muted">{PRAYERS_LOCK_REASON_TEXT[state.reason]}</span>
      ) : null}

      {mode !== null && (
        <FinalizeSpeakersDialog
          kind="prayers"
          sundayId={sundayId}
          sundayLabel={sundayLabel}
          mode={mode}
          onClose={() => setMode(null)}
        />
      )}
    </div>
  );
}
