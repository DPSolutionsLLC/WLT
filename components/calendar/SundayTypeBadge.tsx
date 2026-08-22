import { SUNDAY_TYPE_LABELS, type SundayType } from "@/types/domain";

export type SundayTypeBadgeProps = {
  type: SundayType;
};

// Theme tokens only, following MemberStatusBadge. A hardcoded hex here breaks dark mode
// (conventions.md §Styling), and the label is always rendered so the badge never depends on
// colour alone.
const CLASSES: Record<SundayType, string> = {
  standard: "border-border bg-surface text-muted",
  fast_sunday: "border-primary bg-surface text-primary font-semibold",
  stake_conference: "border-warning bg-surface text-warning",
  general_conference: "border-warning bg-surface text-warning",
  holiday: "border-border bg-surface text-muted",
  // Distinct from the two `warning` types, which now form the no-meeting group, and from
  // fast_sunday, which is the same colour but adds font-semibold. A ward conference holds a
  // completely ordinary meeting, so it must not read as a cancellation.
  ward_conference: "border-primary bg-surface text-primary",
  special: "border-success bg-surface text-success",
};

// A `standard` Sunday renders NOTHING. Badging the default state is noise on the 46 Sundays a year
// that are ordinary and it drowns out the 6 that are not.
export function SundayTypeBadge({ type }: SundayTypeBadgeProps) {
  if (type === "standard") return null;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${CLASSES[type]}`}
    >
      {SUNDAY_TYPE_LABELS[type]}
    </span>
  );
}
