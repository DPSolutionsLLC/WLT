import { Pill } from "@/components/ui/Pill";
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
//
// THE SHAPE IS components/ui/Pill.tsx's; THE NINE TOKENS ARE STILL THIS FILE'S. P1 moved the
// `rounded-full border px-2 py-0.5 text-xs` out of ten badges into one primitive, and the reason
// the two Records above survived that move is that flattening nine measured stage colours into
// Pill's four generic tones would have deleted the progression silently — nothing would fail, the
// badges would just stop telling nine things apart. `toneClassName` is the escape hatch that
// exists for exactly this.
//
// tests/components/assignments/StageBadge.test.tsx asserts `text-stage-${stage}` lands on the
// element carrying the LABEL TEXT, which is Pill's own span. That test is not asserting on a
// class name by accident — it is the only thing standing between this file and nine invisible
// badges, because an interpolated class compiles to no CSS at all.
export function StageBadge({ stage }: StageBadgeProps) {
  return (
    <Pill
      toneClassName={`${STAGE_TEXT_CLASSES[stage]} ${STAGE_BORDER_CLASSES[stage]}`}
      className="font-medium"
    >
      {PIPELINE_STAGE_LABELS[stage]}
    </Pill>
  );
}
