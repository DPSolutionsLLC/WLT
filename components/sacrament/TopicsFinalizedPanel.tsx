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

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-foreground">
          {finalized
            ? `Topics decided on ${formatStamp(topicsFinalizedAt)}.`
            : "The topics for this Sunday are not decided yet."}
        </p>
        {/* ---------------------------------------------------------------------------
            IT NAMES WHO IS WAITING, NOT WHO BENEFITS — the user's decision, 2026-09-23
            ---------------------------------------------------------------------------
            A flag whose only consequence is on somebody else's screen gets pressed at random, so
            this line says where it lands. It first read "the music coordinator CAN SEE this
            Sunday is ready", and the user asked for the other framing: name the person the work
            now sits with, "that way if it's not getting done they can reach out to them and say
            hey did you miss this".
            So the un-finalized sentence names somebody who is BLOCKED, and the finalized one
            names somebody who can now act. Both are about a person, which is what makes the line
            worth its space — a sentence about a database column would not be. */}
        <p className="mt-0.5 text-xs text-muted">
          {finalized
            ? "The music coordinator can choose hymns for this Sunday now."
            : "The music coordinator is waiting on this before they can choose hymns."}
        </p>
      </div>

      {canFinalize && (
        <FinalizeTopicsButton
          sundayId={sundayId}
          finalized={finalized}
          sundayLabel={sundayLabel}
          variant="panel"
        />
      )}
    </div>
  );
}
