import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateOnly } from "@/lib/calendar/dates";
import { listHouseholds, type HouseholdWithMembers } from "@/lib/roster/queries";
import type { Cadence } from "@/lib/visits/cadence";
import { compareCadences } from "@/lib/visits/cadence";
import {
  listHouseholdVisitCadences,
  type HouseholdVisitCadence,
} from "@/lib/visits/householdCadences";
import {
  compareByPriority,
  householdVisitPriority,
  type VisitPriority,
} from "@/lib/visits/householdStatus";
import {
  listVisitGoals,
  listVisitLogs,
  type VisitGoal,
  type VisitLogWithContext,
} from "@/lib/visits/queries";
import { readStewardshipScope } from "@/lib/visits/stewardship";
import { isInScope, type StewardshipScope } from "@/lib/visits/stewardshipScope";
import type { Database } from "@/types/database";

// The progress dashboard's numbers.
//
// THIS MODULE NEVER SELECTS FROM `visit_private_notes`, AND NEVER IMPORTS THE MODULE THAT DOES.
// A progress row is a count and a date; a private note belongs to its author and appears in no
// list, ever (CLAUDE.md rule 5).
//
// buildVisitProgress() is PURE and takes already-fetched data, so tests/lib/visitProgress.test.ts
// needs no database at all. readVisitProgress() below is the thin fetching half — it is the only
// part of this file that is server-only.
//
// ---------------------------------------------------------------------------
// THERE IS NO PERIOD, AND THAT IS THE WHOLE POINT
// ---------------------------------------------------------------------------
// The first build measured progress between two dates. A household visited last December read
// "✓ Visited" in its row while the banner above counted it as unvisited for the period that
// began in January — two correct numbers, disagreeing, an inch apart on the screen.
//
// Progress is now measured from EACH household's own last completed visit against its own
// cadence. `*ThisPeriod` is gone from every shape in this file, and `banner` is renamed to
// `statistics`: two names for one number is how the last contradiction started.

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
// and do_not_contact MEMBERS by the time it reaches here. The status list is REUSED
// (readVisitProgress passes no `statuses` option) rather than re-derived, and what is added here
// is only the household-level consequence of it.
//
// THE PICKER ON app/(app)/visits/page.tsx APPLIES THE SAME RULE, and it no longer applies it
// SEPARATELY — see describeHouseholdForVisits() below, which both now go through. There used to
// be a pair of comments here and there insisting the two must not drift; there is now one
// function, so they cannot.
//
// `households.do_not_contact` IS A SEPARATE AXIS AND IS NOT CHECKED HERE. This function answers
// "does anybody live here"; do-not-contact answers "may we call". Conflating them would make a
// do-not-contact household VANISH, which ITER-018 Decision 4 explicitly refused — it is shown,
// marked, and counted in nothing.
export function isVisitableHousehold(household: { members: readonly unknown[] }): boolean {
  return household.members.length > 0;
}

export type HouseholdVisitDisposition = {
  // TRUE when this household is in the dashboard's denominator.
  inDenominator: boolean;
  // What the household picker shows. Never omits a household the denominator counts.
  pickerLabel: string;
};

// ---------------------------------------------------------------------------------------------
// THREE REASONS A HOUSEHOLD IS NOT COUNTED, AND THEY MUST STAY DISTINCT
// ---------------------------------------------------------------------------------------------
// ONE function, deciding both what the picker offers and what the denominator counts. It replaces
// the pair of "these two must not drift" comments that used to sit here and on the visits page —
// the reason they can no longer drift is that there is one function.
//
//   No active members        -> ABSENT from both. Nobody lives here (a ward-wide fact).
//   Do not contact           -> IN the picker, marked; NOT in the denominator. A ward-wide
//                               PASTORAL fact: shown, marked, counted in nothing (ITER-018 D4).
//   Outside the stewardship  -> IN the picker, marked; NOT in the denominator, and NOT in `rows`.
//                               A PER-ORGANIZATION fact: this family was never ours (ITER-019 D3).
//   Otherwise                -> in both, plain label.
//
// A do-not-contact household is SHOWN AND MARKED; a non-stewardship household is GONE from the
// dashboard. They look different on purpose, because they are different questions, and collapsing
// any two of them loses information a presidency needs.
//
// THE ASYMMETRY IS DELIBERATE AND IS WRITTEN DOWN HERE: the picker is a SUPERSET of the
// denominator and marks the difference. A leader who visited a family anyway — a do-not-contact
// household that asked for help, or a family outside their stewardship they happened to call on —
// must be able to RECORD it. What the picker may never do is show LESS than the denominator
// counts: a household counted against an organization with no way to log a visit to it is a
// number nobody can move.
//
// Returns null for "not offered at all", which is the one case with no label to render.
export function describeHouseholdForVisits(
  household: {
    id: string;
    familyName: string;
    members: readonly unknown[];
    doNotContact: boolean;
  },
  scope: StewardshipScope,
): HouseholdVisitDisposition | null {
  if (!isVisitableHousehold(household)) return null;

  if (household.doNotContact) {
    return {
      inDenominator: false,
      pickerLabel: `${household.familyName} (do not contact)`,
    };
  }

  if (!isInScope(scope, household.id)) {
    return {
      inDenominator: false,
      pickerLabel: `${household.familyName} (not in your stewardship)`,
    };
  }

  return { inDenominator: true, pickerLabel: household.familyName };
}

export type VisitProgressRow = {
  householdId: string;
  familyName: string;
  // ALL TIME. A leader wants to know a family was last seen fourteen months ago, and now that
  // there is no period there is nothing else this could have meant.
  lastVisitedOn: DateOnly | null;
  lastAttemptedOn: DateOnly | null;
  // Attempts made SINCE the last completed visit — every attempt ever, when there has been no
  // visit. This is the "we have tried three times" number. It is deliberately not a period
  // count: a household knocked on twice in December and twice in January has been failed to
  // reach four times running, and a period boundary is not a fact about that household.
  //
  // It sits BESIDE the band rather than replacing it (the old `attempted_never_reached`), because
  // somebody having knocked four times is a different problem from nobody having been, at every
  // level of urgency.
  attemptsSinceLastVisit: number;
  // Shown and marked, counted in nothing (ITER-018 Decision 4).
  doNotContact: boolean;
  // Null for THREE reasons: the organization has no goal, the goal carries no usable cadence, or
  // the household is do-not-contact. The table tells them apart from `doNotContact` and the
  // progress-level `goal`/`goalHasNoCadence`, never by guessing which one it was.
  priority: VisitPriority | null;
  // Who WENT on the visit named by `lastVisitedOn`, never who typed it in. Null reads as
  // "Nobody recorded" rather than falling back to the recorder.
  conductedBy: string | null;
};

// THE COUNTS, and the invariant they hold:
//
//   onTrack + approaching + overdue + neverVisited === counted
//
// worth a test, and tests/lib/visitProgress.test.ts has one. A statistics block whose parts do
// not add up to its whole is the shape of the contradiction this slice removed.
export type VisitProgressStatistics = {
  // Visitable, IN THIS ORGANIZATION'S STEWARDSHIP, and not do-not-contact. THE DENOMINATOR.
  counted: number;
  onTrack: number;
  approaching: number;
  overdue: number;
  neverVisited: number;
  // Do-not-contact households. Shown on the page, counted in nothing. Reported so the page can
  // say so out loud — a number that silently shrank is what Decision 4 refused.
  excluded: number;
  onTrackPercent: number;
};

export type VisitProgressGoalSummary = {
  id: string;
  title: string | null;
  cadence: Cadence;
  notice: Cadence;
  // TRUE when the notice window is not shorter than the cadence, so nothing can ever read
  // "Approaching" (see §THE CLAMP in lib/visits/householdStatus.ts). Reported so the banner can
  // say it plainly rather than letting a band silently never appear.
  noticeIgnored: boolean;
  deadline: DateOnly | null;
};

export type VisitProgress = {
  orgId: string;
  // THE INSTANT EVERY ROW WAS JUDGED AGAINST, as an ISO string so it survives the JSON boundary.
  //
  // The table needs it to render "3 weeks overdue" without reading its own clock. A `new Date()`
  // in the badge would judge the top of the list against a different instant from the bottom on a
  // slow render, and — worse — would disagree with the band the server already computed, so a row
  // could read "Overdue" beside "due today". One instant, computed once, passed down.
  asOf: string;
  rows: VisitProgressRow[];
  // Null when there is no goal to measure against. A made-up denominator is worse than an absent
  // one, so nothing here invents a cadence.
  statistics: VisitProgressStatistics | null;
  goal: VisitProgressGoalSummary | null;
  // TRUE when a goal row exists but carries no usable cadence — a goal written outside
  // lib/validation/visit.ts, which requires one. The page says something different for "no goal
  // has been set" and "the goal that is set cannot be counted", because they need different
  // actions from the person reading.
  goalHasNoCadence: boolean;
  // WHAT THIS ORGANIZATION IS MEASURED AGAINST. Reported rather than left implicit, because a
  // denominator that silently SHRANK is the same erosion of trust visits-b recorded in the other
  // direction — there, counting households an organization could not visit made every org look
  // behind; here, a number quietly dropping from 200 to 38 with no sentence beside it would make
  // a president wonder what the app had decided on their behalf.
  stewardship: {
    // FALSE = the whole ward. The Elders Quorum's ship-day state, and the reason nothing moves
    // on the day this is deployed.
    narrowed: boolean;
    // Visitable households IN scope — the population `counted` is drawn from. Note it is not
    // `counted` itself: a do-not-contact household inside the stewardship is in this number and
    // not in that one.
    inScope: number;
    // Visitable households this organization has narrowed AWAY. Absent from `rows` entirely, so
    // this is the only place they are represented at all.
    outOfScope: number;
  };
};

// WHICH goal a dashboard measures against, when an organization has several: the most recently
// created one.
//
// The old version searched for the goal whose PERIOD contained today. There is no period to
// contain anything now, and — more to the point — visit goals became editable in this same
// slice, so stacking a second goal to change one's mind is no longer how anybody changes a goal.
// The disambiguation this function existed for has stopped arising.
//
// `goals` arrives ordered `created_at desc` from listVisitGoals(), and this function does not
// re-sort it: an order asserted in one place and assumed in another is the bug
// plans/retros/route-tests-and-realtime.md records.
export function selectActiveGoal(
  goals: readonly VisitGoal[],
  orgId: string,
): VisitGoal | null {
  return goals.find((goal) => goal.orgId === orgId) ?? null;
}

// Which cadence one household is actually judged against, and where it came from.
//
// EXPORTED because the assembler and anything rendering the control have to agree. Absent means
// "use the organization's goal" — there is no sentinel row meaning "default", so this is a
// lookup with a fallback rather than a three-way branch.
export function resolveHouseholdCadence(
  goalCadence: Cadence,
  override: HouseholdVisitCadence | undefined,
): { cadence: Cadence; source: "household" | "goal" } {
  return override === undefined
    ? { cadence: goalCadence, source: "goal" }
    : { cadence: override.cadence, source: "household" };
}

type LogTally = {
  lastCompletedOn: DateOnly | null;
  lastAttemptedOn: DateOnly | null;
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
    attemptDates: [],
    conductedBy: null,
  };
}

// ---------------------------------------------------------------------------------------------
// EVERY VISIT NUMBER FILTERS `outcome = 'completed'`
// ---------------------------------------------------------------------------------------------
// `lastVisitedOn` — and therefore every band, every due date and every count built on it —
// excludes attempts. `lastAttemptedOn` and `attemptsSinceLastVisit` are the ONLY fields that see
// them. An attempt folded into a visit count is a ward being told it reached a family it did not.
function tallyLogs(logs: readonly VisitLogWithContext[]): Map<string, LogTally> {
  const byHousehold = new Map<string, LogTally>();

  for (const log of logs) {
    if (log.householdId === null) continue;

    const tally = byHousehold.get(log.householdId) ?? emptyTally();

    if (log.outcome === "completed") {
      // `conductedBy` is taken from the visit `lastVisitedOn` NAMES. A row reading "last visited
      // May 2025 · conducted by nobody" contradicts itself, and a "conducted by" beside a date
      // has to describe THAT visit — the same untruth visits-d removed when "Visited by Miguel
      // Cortez" appeared under a row labelled "Attempted".
      if (tally.lastCompletedOn === null || log.visitDate > tally.lastCompletedOn) {
        tally.lastCompletedOn = log.visitDate;
        tally.conductedBy = log.conductedByLabel;
      }
    } else {
      tally.attemptDates.push(log.visitDate);

      if (tally.lastAttemptedOn === null || log.visitDate > tally.lastAttemptedOn) {
        tally.lastAttemptedOn = log.visitDate;
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
  // This organization's per-household overrides. Indexed into a Map once rather than searched
  // per row.
  householdCadences: readonly HouseholdVisitCadence[];
  // REQUIRED, not optional. A missing one must be a TYPE ERROR at every call site, the way
  // resolveRoleAccess is a required third argument to can() — a defaulted parameter is how 25
  // call sites came to silently ignore the ward's configuration (ITER-005). An organization that
  // has narrowed nothing passes `toStewardshipScope([])`, which says so explicitly.
  stewardship: StewardshipScope;
  asOf: Date;
};

export function buildVisitProgress({
  orgId,
  households,
  logs,
  goal,
  householdCadences,
  stewardship,
  asOf,
}: BuildVisitProgressInput): VisitProgress {
  // BOTH COUNTS COME FROM ONE PASS OVER THE UNFILTERED LIST, before the stewardship filter is
  // applied — `outOfScope` cannot be recovered afterwards, because a household outside the
  // stewardship never reaches `rows` at all.
  const allVisitable = households.filter(isVisitableHousehold);
  const visitable = allVisitable.filter((household) => isInScope(stewardship, household.id));

  const tallies = tallyLogs(logs);

  const goalCadence = goal?.cadence ?? null;
  const goalNotice = goal?.notice ?? null;

  // A goal with no cadence cannot produce a band or a denominator. `cadence_amount` and
  // `cadence_unit` are nullable in migration 050 and neither is optional in
  // lib/validation/visit.ts, so this is a row written outside this app rather than something a
  // user can reach — but it is representable, so it is reported rather than assumed away.
  //
  // A goal with a cadence and NO notice window is countable: the window only decides whether a
  // household reads "Approaching", and a zero-length one simply means it never does. Defaulted
  // to one day so the comparison below has something to make, which the clamp then ignores only
  // if the cadence is itself a day.
  const countable = goal !== null && goalCadence !== null;
  const notice: Cadence = goalNotice ?? { amount: 1, unit: "day" };

  const overridesByHousehold = new Map(
    householdCadences.map((override) => [override.householdId, override]),
  );

  const rows: VisitProgressRow[] = visitable.map((household) => {
    const tally = tallies.get(household.id) ?? emptyTally();

    // A do-not-contact household gets NO priority at all — not a band, not a due date. It stays
    // in `rows` with its history intact (ITER-018 Decision 4): the record of what happened
    // before the decision is exactly what the next presidency needs.
    const priority =
      countable && goalCadence !== null && !household.doNotContact
        ? (() => {
            const resolved = resolveHouseholdCadence(
              goalCadence,
              overridesByHousehold.get(household.id),
            );

            return householdVisitPriority({
              lastCompletedOn: tally.lastCompletedOn,
              cadence: resolved.cadence,
              cadenceSource: resolved.source,
              notice,
              asOf,
            });
          })()
        : null;

    return {
      householdId: household.id,
      familyName: household.familyName,
      lastVisitedOn: tally.lastCompletedOn,
      lastAttemptedOn: tally.lastAttemptedOn,
      attemptsSinceLastVisit: countAttemptsSince(tally),
      doNotContact: household.doNotContact,
      priority,
      conductedBy: tally.conductedBy,
    };
  });

  rows.sort(compareByPriority);

  // ---------------------------------------------------------------------------
  // THE STATISTICS
  // ---------------------------------------------------------------------------
  // Counted from `priority`, which is null for exactly the households that must not be counted:
  // a do-not-contact family, and every household when there is no cadence. So the four band
  // counts and `counted` are read from ONE source and cannot disagree.
  const excluded = rows.filter((row) => row.doNotContact).length;
  const banded = rows.filter((row) => row.priority !== null);

  const countBand = (band: VisitPriority["band"]): number =>
    banded.filter((row) => row.priority!.band === band).length;

  const counted = banded.length;
  const onTrack = countBand("on_track");

  // Guarded rather than assumed: an organization whose households have all moved out has a
  // total of zero, and a percentage of nothing is a division nobody wants to render.
  const onTrackPercent = counted === 0 ? 0 : Math.round((onTrack / counted) * 100);

  return {
    orgId,
    asOf: asOf.toISOString(),
    rows,
    statistics: countable
      ? {
          counted,
          onTrack,
          approaching: countBand("approaching"),
          overdue: countBand("overdue"),
          neverVisited: countBand("never_visited"),
          excluded,
          onTrackPercent,
        }
      : null,
    goal:
      countable && goal !== null && goalCadence !== null
        ? {
            id: goal.id,
            title: goal.title,
            cadence: goalCadence,
            notice,
            noticeIgnored: compareCadences(notice, goalCadence) >= 0,
            deadline: goal.deadline,
          }
        : null,
    goalHasNoCadence: goal !== null && !countable,
    stewardship: {
      narrowed: stewardship.hasNarrowed,
      inScope: visitable.length,
      outOfScope: allVisitable.length - visitable.length,
    },
  };
}

// SERVER-ONLY below this line — listHouseholds, listVisitLogs, listVisitGoals and
// listHouseholdVisitCadences all reach Supabase.
//
// The caller's session client is passed straight through, so RLS decides which rows are visible.
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
  const [households, logs, goals, householdCadences, stewardship] = await Promise.all([
    // NO `statuses` option, on purpose. The ["active"] default is what excludes moved_out and
    // do_not_contact members — see §THE DENOMINATOR above.
    listHouseholds(wardId, undefined, client),
    listVisitLogs(wardId, { orgId }, client),
    listVisitGoals(wardId, client),
    listHouseholdVisitCadences(wardId, orgId, client),
    // Zero rows resolves to "the whole ward", so an organization that has narrowed nothing gets
    // exactly the denominator it had before ITER-019 shipped.
    readStewardshipScope(wardId, orgId, client),
  ]);

  return buildVisitProgress({
    orgId,
    households,
    logs,
    goal: selectActiveGoal(goals, orgId),
    householdCadences,
    stewardship,
    asOf,
  });
}
