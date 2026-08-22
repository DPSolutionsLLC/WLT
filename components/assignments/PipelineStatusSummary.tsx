import { stageIndex } from "@/lib/assignments/pipeline";
import type { PipelineStage } from "@/types/domain";

// The `pipelineStatus` reserved region. One line, because SundayCell is min-h-40 and already
// sized for exactly one (calendar-b designed the cell around this arriving).

export type PipelineStatusSummaryProps = {
  stages: readonly PipelineStage[];
};

// Phrases, not the PIPELINE_STAGE_LABELS. "1 In Review, 2 Confirmed" reads like a database
// dump; "1 awaiting approval, 2 confirmed" reads like a sentence. A Record rather than a lookup
// with a fallback, for the same reason PIPELINE_STAGE_LABELS is one — a stage added to the enum
// fails to compile until somebody decides how it reads here.
const STAGE_SUMMARY_PHRASES: Record<PipelineStage, string> = {
  plan: "still planning",
  review: "awaiting approval",
  approve: "approved",
  request: "asked",
  confirm: "confirmed",
  notify: "notified",
  speak: "ready to speak",
  appreciate: "awaiting a thank-you",
  complete: "complete",
};

// Furthest-behind FIRST. A bishopric opening the month is looking for what still needs doing,
// and burying "1 still planning" behind "2 complete" hides the only part of the line that is
// asking for anything.
export function summarizeStages(stages: readonly PipelineStage[]): string | null {
  if (stages.length === 0) return null;

  const counts = new Map<PipelineStage, number>();
  for (const stage of stages) {
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => stageIndex(left) - stageIndex(right))
    .map(([stage, count]) => `${count} ${STAGE_SUMMARY_PHRASES[stage]}`)
    .join(", ");
}

export function PipelineStatusSummary({ stages }: PipelineStatusSummaryProps) {
  const summary = summarizeStages(stages);

  // Nothing planned yet says nothing here. SpeakerList above has already said "Slot 1 — open"
  // three times, and a second line repeating it in other words is noise in a cell this small.
  if (summary === null) return null;

  return <p className="truncate text-xs text-muted">{summary}</p>;
}
