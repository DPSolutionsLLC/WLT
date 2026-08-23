import {
  RELIABILITY_FLAG_KINDS,
  type ReliabilityFlagKind,
} from "@/lib/assignments/reliabilityFlags";

export type { ReliabilityFlagKind };

export type ReliabilityFlagProps = {
  flags: readonly ReliabilityFlagKind[];
};

// THE UNION NOW HAS AN IMPLEMENTATION — lib/assignments/reliabilityFlags.ts, pure and tested at
// every boundary. What it does NOT have is a licence to grow by guesswork, and the rule roster-b
// wrote here still governs the next person who wants a fifth flag:
//
//   A flag that looks right is worse than no flag, because a bishop will have trusted it.
//
// So a new kind is added HERE only once something can compute it from recorded history at a stated
// boundary, with a test that fires on that boundary and not one day before. "Seems disengaged" is
// not a flag. "No completed talk in 24 months" is, because a row in `assignment_history` says so.
//
// The four labels below are worded for a bishop reading one aloud in a bishopric meeting. Not
// "unreliable", not "no-show", nothing that describes a person rather than a record. That wording
// is the feature as much as the arithmetic is (04-talks-pipeline.md §Step 8).
//
// Bishopric-only by virtue of who passes it. `assignment_history` is bishopric-only in migration
// 019, so a non-bishopric caller reads no rows and computes no flags — the leak defence is the
// policy, not this component.
const FLAG_LABELS: Record<ReliabilityFlagKind, string> = {
  frequent_decliner: "Declined twice recently",
  late_canceller: "Cancelled close to the date",
  not_asked_recently: "Not asked in over a year",
  not_spoken_recently: "Has not spoken in two years",
};

export function ReliabilityFlag({ flags }: ReliabilityFlagProps) {
  if (flags.length === 0) return null;

  // Rendered in the enum's order rather than the caller's, so two members with the same flags
  // always read the same way down a list.
  const ordered = RELIABILITY_FLAG_KINDS.filter((kind) => flags.includes(kind));

  return (
    <span className="flex flex-wrap gap-1">
      {ordered.map((flag) => (
        <span
          key={flag}
          className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-warning"
        >
          {FLAG_LABELS[flag]}
        </span>
      ))}
    </span>
  );
}
