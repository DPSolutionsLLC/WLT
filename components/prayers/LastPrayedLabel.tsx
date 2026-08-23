import { lastPrayedLabel } from "@/lib/prayers/lastPrayed";
import type { DateOnly } from "@/lib/calendar/dates";

export type LastPrayedLabelProps = {
  lastPrayedAt: DateOnly | null;
};

// Renders NOTHING when there is no history — not "Never", not an em dash, not an empty span
// holding space. See lib/prayers/lastPrayed.ts for why.
export function LastPrayedLabel({ lastPrayedAt }: LastPrayedLabelProps) {
  const label = lastPrayedLabel(lastPrayedAt);

  if (label === null) return null;

  return <span className="text-xs text-muted">{label}</span>;
}
