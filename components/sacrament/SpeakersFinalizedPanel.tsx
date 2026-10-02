"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import {
  FinalizeSpeakersDialog,
  type FinalizeSpeakersMode,
} from "@/components/sacrament/FinalizeSpeakersDialog";

// FINALIZE SPEAKERS ON THE TOPICS SCREEN — ITER-036. TopicsFinalizedPanel's shape, beside it at the
// bottom of the screen, where the decision is made once the talks above are settled. The same
// confirm as the hub's Talks tab (FinalizeSpeakersDialog), so the two cannot word it differently.
//
// The PANEL renders for everybody who can open the page; only the CONTROL is gated on
// `talks.request`, which the finalize route asserts.

// `speakers_finalized_at` is a "when did this happen" stamp, rendered in UTC (CLAUDE.md rule 12).
function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export type SpeakersFinalizedPanelProps = {
  sundayId: string;
  sundayLabel: string;
  speakersFinalizedAt: string | null;
  // speakersSettled(): finalized AND nobody left to ask.
  settled: boolean;
  // How many speakers finalizing would ask now.
  toAsk: number;
  canFinalize: boolean;
};

export function SpeakersFinalizedPanel({
  sundayId,
  sundayLabel,
  speakersFinalizedAt,
  settled,
  toAsk,
  canFinalize,
}: SpeakersFinalizedPanelProps) {
  const [mode, setMode] = useState<FinalizeSpeakersMode | null>(null);

  const status = settled
    ? "✓ Speakers finalized"
    : speakersFinalizedAt !== null
      ? `${toAsk} still to ask`
      : "Speakers not finalized yet";
  const help = settled
    ? "Their asks are on the conductor's To Do. Changing a speaker un-finalizes it again."
    : "Once you’ve prayed about these speakers and decided, finalize them — that puts an “Ask ___ to speak” on the conductor’s To Do for each one.";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${settled ? "text-success" : "text-foreground"}`}>
          {status}
        </p>
        <p className="mt-0.5 text-xs text-muted">{help}</p>
        {settled && speakersFinalizedAt !== null && (
          <p className="mt-0.5 text-xs text-muted">
            Finalized on {formatStamp(speakersFinalizedAt)}.
          </p>
        )}
      </div>

      {canFinalize && (
        <button
          type="button"
          onClick={() => setMode(settled ? "unfinalize" : "finalize")}
          aria-pressed={settled}
          aria-label={`Finalize speakers — ${sundayLabel}`}
          className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            settled
              ? "border-stage-complete bg-stage-complete text-background"
              : "border-border text-muted"
          }`}
        >
          <Check aria-hidden="true" className="h-4 w-4" />
          {settled ? "Undo" : "Finalize speakers"}
        </button>
      )}

      {mode !== null && (
        <FinalizeSpeakersDialog
          kind="speakers"
          sundayId={sundayId}
          sundayLabel={sundayLabel}
          mode={mode}
          onClose={() => setMode(null)}
        />
      )}
    </div>
  );
}
