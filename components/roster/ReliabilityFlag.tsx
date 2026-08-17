export type ReliabilityFlagKind = "declined_recently" | "no_show" | "spoke_recently";

export type ReliabilityFlagProps = {
  flags: readonly ReliabilityFlagKind[];
};

// AN INTERFACE, NOT AN IMPLEMENTATION. Phase 4 (plans/04-talks-pipeline.md) owns what makes a
// member "unreliable" — declined twice, no-showed, spoke a month ago — because Phase 4 is where
// assignment history exists. Nothing in the roster can compute any of these today.
//
// The temptation is to guess one rule from the data at hand and ship it. Do not: a flag that
// looks right is worse than no flag, because Phase 4 will build on top of it and a bishop will
// have trusted it in the meantime. Rendering nothing is the honest answer until the pipeline
// can answer the question.
//
// The union above is a starting point Phase 4 will EXTEND, not a contract it must satisfy.
//
// Bishopric-only by virtue of who passes it: MemberPicker renders this only when showFlags is
// true, and only a bishopric caller ever sets showFlags.
const FLAG_LABELS: Record<ReliabilityFlagKind, string> = {
  declined_recently: "Declined recently",
  no_show: "Did not show",
  spoke_recently: "Spoke recently",
};

export function ReliabilityFlag({ flags }: ReliabilityFlagProps) {
  if (flags.length === 0) return null;

  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
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
