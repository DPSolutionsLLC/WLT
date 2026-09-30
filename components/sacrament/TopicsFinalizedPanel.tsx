import { FinalizeTopicsButton } from "@/components/sacrament/FinalizeTopicsButton";

// "ARE THIS SUNDAY'S TOPICS DECIDED?" — stated in words, on the page that is about one Sunday.
//
// The Sacrament hub carries the same fact as a checkmark on the Topics pill. This is the other
// half of the pair the prototype ships (build note §topics-pill-and-finalize-checkmark): the
// module's own Finalize button. Both write ONE column through ONE route, so finalizing in either
// place shows up in both — there is no second system, and there must never be one.
//
// ---------------------------------------------------------------------------
// IT SAYS THE STATE EVEN TO SOMEBODY WHO CANNOT CHANGE IT
// ---------------------------------------------------------------------------
// The CONTROL is gated on `topics.manage` and is absent, never disabled, for anybody else — the
// rule StatusPill and DashboardGrid both state. The SENTENCE is not gated: whether the topics are
// settled is exactly the thing a planner without that permission needs to know before working on
// the day, and withholding it would leave them guessing at a fact the /music card states plainly
// to a music coordinator.
//
// ---------------------------------------------------------------------------
// THE STAMP RENDERS IN UTC
// ---------------------------------------------------------------------------
// `topics_finalized_at` is a "when did this happen" timestamptz, not a turn-up-at time, so it is
// UTC — CLAUDE.md rule 12's second case, the same call VersionHistory and ContactStagePanel make.
// The ward's zone is for a time somebody has to be somewhere at; using it here would be the
// reverse of the bug that rule exists to prevent. tests/lib/explicitTimeZone.test.ts reads this
// file's source and fails on a bare toLocaleDateString.
function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export type TopicsFinalizedPanelProps = {
  sundayId: string;
  sundayLabel: string;
  // Null means nobody has finalized this Sunday — the starting state, and the state a real change
  // to its topics returns it to (lib/topics/finalize.ts).
  topicsFinalizedAt: string | null;
  // `topics.manage`, which PATCH /api/sundays/[id]/topics-finalized asserts.
  canFinalize: boolean;
};

export function TopicsFinalizedPanel({
  sundayId,
  sundayLabel,
  topicsFinalizedAt,
  canFinalize,
}: TopicsFinalizedPanelProps) {
  const finalized = topicsFinalizedAt !== null;

  // THE PROTOTYPE'S WORDS (Topics rebuild t3), at the BOTTOM of the Topics screen, where the
  // decision is made once the talks above it are settled. They still name the person the work sits
  // with, which is the user's 2026-09-23 framing: the music coordinator is waiting, or can start.
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${finalized ? "text-success" : "text-foreground"}`}>
          {finalized ? "✓ Finalized" : "Not finalized yet"}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {finalized
            ? "Ready for the music coordinator to work on. Any change you make here will un-finalize it again."
            : "Once you’re done deciding speakers and topics for this day, finalize it — that’s what tells the music coordinator it’s ready to work on, even before speakers accept."}
        </p>
        {finalized && (
          <p className="mt-0.5 text-xs text-muted">Finalized on {formatStamp(topicsFinalizedAt)}.</p>
        )}
      </div>

      {canFinalize && (
        <FinalizeTopicsButton
          sundayId={sundayId}
          finalized={finalized}
          sundayLabel={sundayLabel}
          variant="panel"
          panelLabels={{ pressed: "Undo", unpressed: "Finalize topics" }}
        />
      )}
    </div>
  );
}
