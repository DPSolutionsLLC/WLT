import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateOnly } from "@/lib/calendar/dates";
import { formatDateOnly } from "@/lib/calendar/dates";
import { listHouseholds, type HouseholdWithMembers } from "@/lib/roster/queries";
import { compareByStatus, householdVisitStatus } from "@/lib/visits/householdStatus";
import { listVisitGoals, listVisitLogs, type VisitGoal, type VisitLogWithContext } from "@/lib/visits/queries";
import { CADENCE_MONTHS } from "@/lib/validation/visit";
import type { Database } from "@/types/database";
import type { HouseholdVisitStatus } from "@/types/domain";

// The progress dashboard's numbers.
//
// THIS MODULE NEVER SELECTS FROM `visit_private_notes`, AND NEVER IMPORTS THE MODULE THAT DOES.
// A progress row is a count and a date; a private note belongs to its author and appears in no
// list, ever (CLAUDE.md rule 5).
//
// buildVisitProgress() is PURE and takes already-fetched data, so tests/lib/visitProgress.test.ts
// needs no database at all. readVisitProgress() below is the thin fetching half — it is the only
// part of this file that is server-only.

// ---------------------------------------------------------------------------------------------
// THE DENOMINATOR
// ---------------------------------------------------------------------------------------------
// listHouseholds() filters the members it ATTACHES, not the households it RETURNS. A household
// whose people have all moved out comes back present with `members: []`, and that is deliberate:
// roster-b Decision 4 says the household count must not move underneath somebody applying a
// category filter.
//
// So `households.length` is WRONG here. It counts houses this organization cannot visit and holds
// every ward's progress down permanently — 07-visits.md §Pitfalls: "Counting moved-out households
// makes every org look behind and erodes trust in the number."
//
// DEFAULT_MEMBER_STATUSES is ["active"], and its header in lib/roster/queries.ts names exactly
// this denominator as its reason for existing — so `members` has already excluded both moved_out
// and do_not_contact by the time it reaches here. The status list is REUSED (readVisitProgress
// passes no `statuses` option) rather than re-derived, and what is added here is only the
// household-level consequence of it.
//
// THIS RULE IS ALSO IN app/(app)/visits/page.tsx, on the household picker, and the two must not
// drift. A household offered in the picker but absent from the denominator — or the reverse — is
// a progress number nobody can reconcile against the list beside it.
export function isVisitableHousehold(household: { members: readonly unknown[] }): boolean {
  return household.members.length > 0;
}

export type VisitProgressRow = {
  householdId: string;
  familyName: string;
  // ALL TIME, not the period. A leader wants to know a family was last seen fourteen months ago,
  // not merely that the count for this period is zero. The STATUS uses the period; the column
  // shows the truth.
  lastVisitedOn: DateOnly | null;
  lastAttemptedOn: DateOnly | null;
  // Attempts made SINCE the last completed visit — every attempt ever, when there has been no
  // visit. This is the "we have tried three times" number, and it is deliberately not
  // `attemptCountThisPeriod`: a household knocked on twice in December and twice in January has
  // been failed to reach four times running, and a period boundary is not a fact about that
  // household. Rendered beside `lastAttemptedOn` so a single attempt and a standing pattern of
  // them do not read the same.
  attemptsSinceLastVisit: number;
  // These two are bounded by [goalPeriodStart, goalPeriodEnd], and they are what the banner and
  // the status are built from.
  visitCountThisPeriod: number;
  attemptCountThisPeriod: number;
  // Null when the organization has no goal — see §NO GOAL below. Never a guessed bucket.
  status: HouseholdVisitStatus | null;
  // Who WENT on the visit named by `lastVisitedOn`, never who typed it in. Null reads as
  // "Nobody recorded" rather than falling back to the recorder.
  conductedBy: string | null;
};

export type VisitProgressBannerTotals = {
  visitedCount: number;
  total: number;
  remaining: number;
};

export type VisitProgressGoalSummary = {
  id: string;
  title: string | null;
  cadenceMonths: number;
  goalPeriodStart: DateOnly;
  goalPeriodEnd: DateOnly | null;
};

export type VisitProgress = {
  orgId: string;
  rows: VisitProgressRow[];
  // Null when there is no goal to measure against. A made-up denominator is worse than an absent
  // one, so nothing here invents a cadence.
  banner: VisitProgressBannerTotals | null;
  goal: VisitProgressGoalSummary | null;
  // TRUE when a goal row exists but carries no usable interval — a goal written outside
  // lib/validation/visit.ts, which requires one. The page says something different for "no goal
  // has been set" and "the goal that is set cannot be counted", because they need different
  // actions from the person reading.
  goalHasNoCadence: boolean;
};

// `annual` and `biannual` carry their interval in lib/validation/visit.ts §CADENCE_MONTHS — the
// SAME map the goal form writes against, imported rather than restated, because two copies drift
// and the denominator quietly changes with them.
export function resolveCadenceMonths(goal: VisitGoal): number | null {
  if (goal.cadence === null) return null;
  if (goal.cadence === "custom") return goal.cadenceMonths;
  return CADENCE_MONTHS[goal.cadence];
}

// WHICH goal a dashboard measures against, when an organization has several. The one whose
// period contains today, and otherwise the most recently started — never a silent merge of two.
//
// `goals` arrives ordered by goal_period_start descending (lib/visits/queries.ts), and this
// function does not re-sort it: an order asserted in one place and assumed in another is the
// bug route-tests-and-realtime records.
export function selectActiveGoal(
  goals: readonly VisitGoal[],
  orgId: string,
  today: DateOnly,
): VisitGoal | null {
  const forOrg = goals.filter((goal) => goal.orgId === orgId && goal.goalPeriodStart !== null);
  if (forOrg.length === 0) return null;

  const current = forOrg.find(
    (goal) =>
      goal.goalPeriodStart !== null &&
      goal.goalPeriodStart <= today &&
      (goal.goalPeriodEnd === null || today <= goal.goalPeriodEnd),
  );

  return current ?? forOrg[0]!;
}

type LogTally = {
  lastCompletedOn: DateOnly | null;
  lastAttemptedOn: DateOnly | null;
  lastAttemptedInPeriodOn: DateOnly | null;
  visitCountThisPeriod: number;
  attemptCountThisPeriod: number;
  // Every attempt date, kept so `attemptsSinceLastVisit` can be counted once the last completed
  // visit is known. Logs arrive in no guaranteed order relative to each other, so this cannot be
  // a running counter — an attempt read before the visit that supersedes it would be counted.
  attemptDates: DateOnly[];
  conductedBy: string | null;
};

function emptyTally(): LogTally {
  return {
    lastCompletedOn: null,
    lastAttemptedOn: null,
    lastAttemptedInPeriodOn: null,
    visitCountThisPeriod: 0,
    attemptCountThisPeriod: 0,
    attemptDates: [],
    conductedBy: null,
  };
}

function withinPeriod(
  visitDate: DateOnly,
  periodStart: DateOnly,
  periodEnd: DateOnly | null,
): boolean {
  if (visitDate < periodStart) return false;
  return periodEnd === null || visitDate <= periodEnd;
}

// ---------------------------------------------------------------------------------------------
// EVERY VISIT NUMBER FILTERS `outcome = 'completed'`
// ---------------------------------------------------------------------------------------------
// `lastVisitedOn`, `visitCountThisPeriod` and the banner's `visitedCount` all exclude attempts.
// `lastAttemptedOn` and `attemptCountThisPeriod` are the ONLY fields that see them. An attempt
// folded into a visit count is a ward being told it reached a family it did not.
function tallyLogs(
  logs: readonly VisitLogWithContext[],
  periodStart: DateOnly | null,
  periodEnd: DateOnly | null,
): Map<string, LogTally> {
  const byHousehold = new Map<string, LogTally>();

  for (const log of logs) {
    if (log.householdId === null) continue;

    const tally = byHousehold.get(log.householdId) ?? emptyTally();
    const inPeriod =
      periodStart !== null && withinPeriod(log.visitDate, periodStart, periodEnd);

    if (log.outcome === "completed") {
      // `conductedBy` is taken from the visit `lastVisitedOn` NAMES, not from the most recent
      // one inside the period. A row reading "last visited May 2025 · conducted by nobody"
      // contradicts itself, and a "conducted by" beside a date has to describe THAT visit —
      // the same untruth visits-d removed when "Visited by Miguel Cortez" appeared under a row
      // labelled "Attempted".
      if (tally.lastCompletedOn === null || log.visitDate > tally.lastCompletedOn) {
        tally.lastCompletedOn = log.visitDate;
        tally.conductedBy = log.conductedByLabel;
      }
      if (inPeriod) tally.visitCountThisPeriod += 1;
    } else {
      tally.attemptDates.push(log.visitDate);

      if (tally.lastAttemptedOn === null || log.visitDate > tally.lastAttemptedOn) {
        tally.lastAttemptedOn = log.visitDate;
      }
      if (inPeriod) {
        tally.attemptCountThisPeriod += 1;
        if (
          tally.lastAttemptedInPeriodOn === null ||
          log.visitDate > tally.lastAttemptedInPeriodOn
        ) {
          tally.lastAttemptedInPeriodOn = log.visitDate;
        }
      }
    }

    byHousehold.set(log.householdId, tally);
  }

  return byHousehold;
}

// Counted from the dates rather than tracked while looping, because the logs arrive in no
// guaranteed order relative to one another: an attempt seen before the completed visit that
// supersedes it would be counted by a running total.
function countAttemptsSince(tally: LogTally): number {
  if (tally.lastCompletedOn === null) return tally.attemptDates.length;

  const lastVisit = tally.lastCompletedOn;
  return tally.attemptDates.filter((date) => date > lastVisit).length;
}

export type BuildVisitProgressInput = {
  orgId: string;
  households: readonly HouseholdWithMembers[];
  logs: readonly VisitLogWithContext[];
  goal: VisitGoal | null;
  asOf: Date;
};

export function buildVisitProgress({
  orgId,
  households,
  logs,
  goal,
  asOf,
}: BuildVisitProgressInput): VisitProgress {
  const visitable = households.filter(isVisitableHousehold);

  const cadenceMonths = goal === null ? null : resolveCadenceMonths(goal);
  const periodStart = goal?.goalPeriodStart ?? null;
  const periodEnd = goal?.goalPeriodEnd ?? null;

  // A goal with no interval, or with no period start, cannot produce a status or a denominator.
  // Both are nullable in migration 008 and neither is nullable in lib/validation/visit.ts, so
  // this is a row written outside this app rather than something a user can reach.
  const countable = goal !== null && cadenceMonths !== null && periodStart !== null;

  const tallies = tallyLogs(logs, countable ? periodStart : null, periodEnd);

  const rows: VisitProgressRow[] = visitable.map((household) => {
    const tally = tallies.get(household.id) ?? emptyTally();

    return {
      householdId: household.id,
      familyName: household.familyName,
      lastVisitedOn: tally.lastCompletedOn,
      lastAttemptedOn: tally.lastAttemptedOn,
      attemptsSinceLastVisit: countAttemptsSince(tally),
      visitCountThisPeriod: tally.visitCountThisPeriod,
      attemptCountThisPeriod: tally.attemptCountThisPeriod,
      status: countable
        ? householdVisitStatus(
            tally.lastCompletedOn,
            tally.lastAttemptedInPeriodOn,
            cadenceMonths,
            asOf,
            periodStart,
          )
        : null,
      conductedBy: tally.conductedBy,
    };
  });

  rows.sort(compareByStatus);

  // ---------------------------------------------------------------------------
  // "X OF Y HOUSEHOLDS VISITED" MEANS VISITED THIS PERIOD
  // ---------------------------------------------------------------------------
  // DEVIATION from the plan, which said `visitedCount` is "rows with status `visited`". Those
  // are different numbers and the plan's own scenario 040 asks for this one: a household visited
  // nine months into a twelve-month cadence reads `due_soon`, and it has still been visited.
  // Counting statuses would report "2 of 5" for a ward that has reached three of them, and the
  // banner sits directly above a table where that household plainly shows a date.
  //
  // An attempt is not a visit here either — visitCountThisPeriod is completed-only.
  const visitedCount = rows.filter((row) => row.visitCountThisPeriod > 0).length;
  const total = rows.length;

  return {
    orgId,
    rows,
    banner: countable ? { visitedCount, total, remaining: total - visitedCount } : null,
    goal:
      countable && goal !== null && cadenceMonths !== null && periodStart !== null
        ? {
            id: goal.id,
            title: goal.title,
            cadenceMonths,
            goalPeriodStart: periodStart,
            goalPeriodEnd: periodEnd,
          }
        : null,
    goalHasNoCadence: goal !== null && !countable,
  };
}

// SERVER-ONLY below this line — listHouseholds and listVisitLogs both reach Supabase.
//
// The caller's session client is passed straight through, so RLS decides which logs are visible.
// There is deliberately no belt-and-braces org filter beyond the one the caller asked for: a
// redundant filter would mask a policy regression by hiding rows the policy had started letting
// through.
//
// NOTE what an org-scoped dashboard cannot see: a visit logged by a member of the bishopric is
// written with `org_id = null` (app/api/visits/route.ts), because it was not made on behalf of
// an organization. It is absent from every organization's progress on purpose — attributing it
// to one would inflate that organization's numbers.
export async function readVisitProgress(
  wardId: string,
  orgId: string,
  asOf: Date,
  client?: SupabaseClient<Database>,
): Promise<VisitProgress> {
  const today = formatDateOnly(asOf);

  const [households, logs, goals] = await Promise.all([
    // NO `statuses` option, on purpose. The ["active"] default is what excludes moved_out and
    // do_not_contact members — see §THE DENOMINATOR above.
    listHouseholds(wardId, undefined, client),
    listVisitLogs(wardId, { orgId }, client),
    listVisitGoals(wardId, client),
  ]);

  return buildVisitProgress({
    orgId,
    households,
    logs,
    goal: selectActiveGoal(goals, orgId, today),
    asOf,
  });
}
