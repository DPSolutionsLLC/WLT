import { PIPELINE_STAGE_LABELS, type PipelineStage } from "@/types/domain";

// The nine --stage-<name> tokens, rendered. The token names are the contract between Phase 3 and
// Phase 4 and match PIPELINE_STAGES exactly, so this map is a lookup rather than a template
// string: Tailwind reads class names statically and a `text-stage-${stage}` built at runtime
// produces no CSS at all.
const STAGE_TEXT_CLASSES: Record<PipelineStage, string> = {
  plan: "text-stage-plan",
  review: "text-stage-review",
  approve: "text-stage-approve",
  request: "text-stage-request",
  confirm: "text-stage-confirm",
  notify: "text-stage-notify",
  speak: "text-stage-speak",
  appreciate: "text-stage-appreciate",
  complete: "text-stage-complete",
};

const STAGE_BORDER_CLASSES: Record<PipelineStage, string> = {
  plan: "border-stage-plan",
  review: "border-stage-review",
  approve: "border-stage-approve",
  request: "border-stage-request",
  confirm: "border-stage-confirm",
  notify: "border-stage-notify",
  speak: "border-stage-speak",
  appreciate: "border-stage-appreciate",
  complete: "border-stage-complete",
};

export type StageBadgeProps = {
  stage: PipelineStage;
};

// The stage colour carries the label as TEXT on the surrounding surface, not as white text on a
// filled pill. Every token was measured against --surface and --surface-raised in both themes
// (app/globals.css records the numbers), and those are the ratios this shape actually produces —
// a filled pill would need a second measurement per stage against its own fill.
//
// Colour is never the only signal: the label is always present, so the badge reads the same to
// somebody who cannot distinguish request from confirm.
export function StageBadge({ stage }: StageBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STAGE_TEXT_CLASSES[stage]} ${STAGE_BORDER_CLASSES[stage]}`}
    >
      {PIPELINE_STAGE_LABELS[stage]}
    </span>
  );
}
