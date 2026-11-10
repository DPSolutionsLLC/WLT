import type { DateOnly } from "@/lib/calendar/dates";
import type { HouseholdWithMembers } from "@/lib/roster/queries";
import type { Cadence } from "@/lib/visits/cadence";
import type { HouseholdVisitCadence } from "@/lib/visits/householdCadences";
import { buildVisitProgress } from "@/lib/visits/progress";
import type { VisitGoal, VisitLogWithContext } from "@/lib/visits/queries";
import type { HouseholdStewardship } from "@/lib/visits/stewardship";
import { toStewardshipScope } from "@/lib/visits/stewardshipScope";
import type { SweepCounts } from "@/lib/visits/sweep";
import { wardDateOnly } from "@/lib/ward/wardDate";
import type { VisitGoalEndReason, VisitGoalKind } from "@/types/domain";

// Goal history (ITER-055 bv4): every ENDED goal with where it stood when it ended.
//
// THE FINAL NUMBERS ARE RECOMPUTED, NEVER STORED (060's `closed_at` precedent). Each ended goal is
// run back through buildVisitProgress() — the same function the Households tab uses — with only the
// visits dated on or before the day it ended, judged at the instant it ended. One meaning of done,
// one denominator rule.
//
// One thing is today's rather than then's: the households. A family that has since moved out is
// no longer counted, because the roster keeps no history of who lived where. That is said on the
// tab rather than hidden.
//
// Pure. The caller reads the data through the reader's own client, so RLS decides which goals and
// visits reach it; the Goal history tab is the bishopric's alone (decided at bv4 start).

export type GoalHistoryEntry = {
  goalId: string;
  orgId: string | null;
  orgName: string;
  title: string | null;
  kind: VisitGoalKind;
  cadence: Cadence | null;
  startedOn: DateOnly;
  // The ward's date the goal ended on.
  endedOn: DateOnly;
  endReason: VisitGoalEndReason;
  // A sweep's counts when it ended, or null for a cadence goal.
  sweep: SweepCounts | null;
  // A cadence goal's standing when it ended, or null for a sweep — and for a goal that carried no
  // usable cadence, which has no numbers to give.
  onTrack: { onTrack: number; counted: number; percent: number } | null;
};

export type BuildGoalHistoryInput = {
  goals: readonly VisitGoal[];
  organizations: readonly { id: string; name: string; type: string }[];
  households: readonly HouseholdWithMembers[];
  logs: readonly VisitLogWithContext[];
  householdCadences: readonly HouseholdVisitCadence[];
  stewardships: readonly HouseholdStewardship[];
  wardTimeZone: string;
};

export function buildGoalHistory({
  goals,
  organizations,
  households,
  logs,
  householdCadences,
  stewardships,
  wardTimeZone,
}: BuildGoalHistoryInput): GoalHistoryEntry[] {
  const bishopricOrgId =
    organizations.find((organization) => organization.type === "bishopric")?.id ?? null;

  const ended = goals
    .filter((goal): goal is VisitGoal & { endedAt: string; endReason: VisitGoalEndReason } =>
      goal.endedAt !== null && goal.endReason !== null,
    )
    .sort((left, right) => (left.endedAt < right.endedAt ? 1 : left.endedAt > right.endedAt ? -1 : 0));

  return ended.map((goal) => {
    const endedAt = new Date(goal.endedAt);
    const endedOn = wardDateOnly(endedAt, wardTimeZone);
    const orgName =
      organizations.find((organization) => organization.id === goal.orgId)?.name ?? "Ward";

    const base = {
      goalId: goal.id,
      orgId: goal.orgId,
      orgName,
      title: goal.title,
      kind: goal.kind,
      cadence: goal.cadence,
      startedOn: goal.startedOn,
      endedOn,
      endReason: goal.endReason,
    };

    // A goal with no organization predates migration 099's Bishopric organization and has no
    // visits to be measured against.
    if (goal.orgId === null) return { ...base, sweep: null, onTrack: null };

    const orgId = goal.orgId;
    const orgLogs = logs.filter(
      (log) => (log.orgId ?? bishopricOrgId) === orgId && log.visitDate <= endedOn,
    );

    const progress = buildVisitProgress({
      orgId,
      households,
      logs: orgLogs,
      goal,
      householdCadences: householdCadences.filter((override) => override.orgId === orgId),
      stewardship: toStewardshipScope(
        stewardships.filter((row) => row.orgId === orgId).map((row) => row.householdId),
      ),
      asOf: endedAt,
    });

    return {
      ...base,
      sweep: progress.sweep,
      onTrack:
        progress.statistics === null
          ? null
          : {
              onTrack: progress.statistics.onTrack,
              counted: progress.statistics.counted,
              percent: progress.statistics.onTrackPercent,
            },
    };
  });
}
