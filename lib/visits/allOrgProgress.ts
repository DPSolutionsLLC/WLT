import type { SupabaseClient } from "@supabase/supabase-js";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import type { DateOnly } from "@/lib/calendar/dates";
import { listHouseholds, type HouseholdWithMembers } from "@/lib/roster/queries";
import {
  compareAllOrgRows,
  type AllOrgHouseholdRow,
  type AllOrgProgress,
  type AllOrgSteward,
} from "@/lib/visits/allOrgRows";
import type { Cadence } from "@/lib/visits/cadence";
import {
  listWardVisitCadences,
  type HouseholdVisitCadence,
} from "@/lib/visits/householdCadences";
import { householdVisitPriority } from "@/lib/visits/householdStatus";
import { isVisitableHousehold, resolveHouseholdCadence } from "@/lib/visits/progress";
import {
  listVisitGoals,
  listVisitLogs,
  type VisitGoal,
  type VisitLogWithContext,
} from "@/lib/visits/queries";
import { listWardStewardships, type HouseholdStewardship } from "@/lib/visits/stewardship";
import { toStewardshipScope, type StewardshipScope } from "@/lib/visits/stewardshipScope";
import type { Database } from "@/types/database";

// Every household once, with every organization's standing beside it.
//
// This is the view that makes ITER-019 D3 safe. A household outside an organization's stewardship
// disappears from THAT organization's dashboard — there is nothing for an organization to hand
// the next presidency about a family that was never theirs — and the pastoral failure mode that
// creates is a household in NO organization's stewardship, invisible to everybody. This page is
// where such a household is visibly unclaimed and sorted to the top.
//
// ---------------------------------------------------------------------------------------------
// 1. WHAT A READER SEES IS THE RLS POLICY, NOT A BRANCH IN THIS FILE
// ---------------------------------------------------------------------------------------------
// There is NO `if (isBishopric)` anywhere below deciding what to show. The queries return the
// right rows and this module renders whatever came back (CLAUDE.md rule 2):
//
//   listVisitLogs(wardId, {})      -> `visit_logs_select`              (019)
//   listWardStewardships()         -> `household_stewardships_select`  (052)
//   listVisitGoals()               -> `visit_goals_select`             (053)
//   listWardVisitCadences()        -> `household_visit_cadences_select`(053)
//
// ALL FOUR ARE WIDENED BY THE WARD'S CROSS-ORG VISIBILITY SETTING. Migration 053 moved the last
// two, reversing ITER-018's "a cadence is a presidency's private judgement" and ITER-019 D6's
// "facts are shared, judgements are not" — by a product decision on 2026-08-27, after walking
// scenario 048. A ward turning the setting on is asking to see how the other organizations are
// doing, and a chip that showed WHO had claimed a family while withholding HOW THEY WERE DOING
// was answering a question nobody asked.
//
// The consequence for this file is a simplification rather than a branch: every reader who can
// reach this page reads every goal, so a band is computed for every claiming organization and the
// only null left is a do-not-contact household. See the steward mapping below.
//
// ---------------------------------------------------------------------------------------------
// 2. THIS MODULE NEVER SELECTS FROM `visit_private_notes`, AND NEVER IMPORTS THE MODULE THAT DOES
// ---------------------------------------------------------------------------------------------
// The same sentence lib/visits/progress.ts and app/(app)/visits/page.tsx carry, so a reviewer can
// confirm it from the import list alone (CLAUDE.md rule 5).
//
// ---------------------------------------------------------------------------------------------
// 3. EVERY VISIT NUMBER FILTERS `outcome = 'completed'`
// ---------------------------------------------------------------------------------------------
// `lastVisitedOn` excludes attempts. An attempt must never win "last seen" — a ward being told it
// reached a family it never got past the door of is the untruth visits-d exists to have removed.
//
// buildAllOrgProgress() is PURE and takes already-fetched data, so tests/lib/allOrgProgress.test.ts
// needs no database. readAllOrgProgress() below is the thin fetching half.

// THE ROW SHAPES AND THE COMPARATOR LIVE IN lib/visits/allOrgRows.ts, and are re-exported here
// so a server caller finds them where the plan says they live.
//
// They are not declared in this file because AllOrganizationsTable is a "use client" component
// that has to SORT, and one value import from this module would pull next/headers into the
// client bundle (plans/retros/roster-b-picker-and-orgs.md). The same split
// lib/visits/householdStatus.ts already is from lib/visits/progress.ts.
export type { AllOrgHouseholdRow, AllOrgProgress, AllOrgSteward };
export { compareAllOrgRows };

export type AllOrgOrganization = { id: string; name: string; type: string };

export type BuildAllOrgProgressInput = {
  households: readonly HouseholdWithMembers[];
  logs: readonly VisitLogWithContext[];
  goals: readonly VisitGoal[];
  householdCadences: readonly HouseholdVisitCadence[];
  stewardships: readonly HouseholdStewardship[];
  organizations: readonly AllOrgOrganization[];
  asOf: Date;
};

// ---------------------------------------------------------------------------------------------
// AN ORGANIZATION CLAIMS HOUSEHOLDS ONLY IF IT HAS A VISIT GOAL
// ---------------------------------------------------------------------------------------------
// This replaced a hardcoded `type !== "bishopric"` exclusion, which was a special case standing in
// for a general rule it could not express.
//
// A ward has SEVEN organizations. Excluding only the Bishopric left Young Men, Young Women and
// Sunday School each claiming EVERY household — they have narrowed nothing, and nothing means
// everything (migration 052). Walking scenario 048 showed the consequence plainly: one household
// carried FIVE chips, three of them organizations that will never visit anybody, and `unclaimed`
// could never be true in a ward that had not narrowed those three by hand. The signal this whole
// view exists to carry was dead on arrival in any real ward.
//
// A visit goal is the honest test of "does this organization visit households", because it is the
// thing an organization sets when it decides to. No goal, no denominator, no bands, nothing to
// show on a row — so no chip either.
//
// WHY THIS IS UNIFORMLY EVALUABLE, which is what made it usable at all: the answer must not depend
// on WHO IS READING, or two people would see different `unclaimed` counts from the same data. It
// does not, because this page is reachable only by the bishopric or with cross-org visibility on,
// and migration 053 makes every goal readable in both of those cases. If that widening is ever
// reversed, this rule becomes reader-dependent and must be reconsidered with it.
function isClaimingOrganization(
  organization: AllOrgOrganization,
  goalByOrg: ReadonlyMap<string, VisitGoal>,
): boolean {
  return goalByOrg.get(organization.id)?.cadence != null;
}

type LastVisit = {
  visitDate: DateOnly;
  orgId: string | null;
  conductedBy: string | null;
};

// COMPLETED ONLY. An attempt is not a visit, and the most recent attempt must never displace an
// older completed one in "last seen".
//
// A visit logged by a member of the bishopric carries `org_id = null` (app/api/visits/route.ts),
// because it was not made on behalf of an organization. It still counts as the household having
// been seen — this row is a WARD-WIDE fact — and its organization simply reads as unattributed.
function tallyLastVisits(logs: readonly VisitLogWithContext[]): Map<string, LastVisit> {
  const byHousehold = new Map<string, LastVisit>();

  for (const log of logs) {
    if (log.householdId === null) continue;
    if (log.outcome !== "completed") continue;

    const current = byHousehold.get(log.householdId);

    if (current === undefined || log.visitDate > current.visitDate) {
      byHousehold.set(log.householdId, {
        visitDate: log.visitDate,
        orgId: log.orgId,
        conductedBy: log.conductedByLabel,
      });
    }
  }

  return byHousehold;
}

// ONE organization's last completed visit to one household, keyed `orgId:householdId`.
//
// Indexed once rather than scanned per steward, for the same reason buildVisitProgress indexes
// its overrides: this is a household count times an organization count times a log count if it is
// not, and a ward has more logs than either.
//
// COMPUTED PER ORGANIZATION rather than taken from the ward-wide tally, because a band is a
// statement about what THAT organization has done — attributing the Relief Society's visit to the
// Elders Quorum's band would tell a quorum it had reached a family it had not.
function tallyLastVisitPerOrganization(
  logs: readonly VisitLogWithContext[],
): Map<string, DateOnly> {
  const byPair = new Map<string, DateOnly>();

  for (const log of logs) {
    if (log.householdId === null) continue;
    if (log.orgId === null) continue;
    if (log.outcome !== "completed") continue;

    const key = `${log.orgId}:${log.householdId}`;
    const current = byPair.get(key);

    if (current === undefined || log.visitDate > current) byPair.set(key, log.visitDate);
  }

  return byPair;
}

function scopesByOrganization(
  stewardships: readonly HouseholdStewardship[],
): Map<string, StewardshipScope> {
  const idsByOrg = new Map<string, string[]>();

  for (const row of stewardships) {
    const existing = idsByOrg.get(row.orgId);
    if (existing === undefined) idsByOrg.set(row.orgId, [row.householdId]);
    else existing.push(row.householdId);
  }

  return new Map(
    [...idsByOrg].map(([orgId, householdIds]) => [orgId, toStewardshipScope(householdIds)]),
  );
}

export function buildAllOrgProgress({
  households,
  logs,
  goals,
  householdCadences,
  stewardships,
  organizations,
  asOf,
}: BuildAllOrgProgressInput): AllOrgProgress {
  const visitable = households.filter(isVisitableHousehold);
  const lastVisits = tallyLastVisits(logs);
  const lastVisitPerOrg = tallyLastVisitPerOrganization(logs);
  const scopeByOrg = scopesByOrganization(stewardships);

  const organizationNames = new Map(
    organizations.map((organization) => [organization.id, organization.name]),
  );

  // The most recently created goal per organization, matching selectActiveGoal's rule.
  // listVisitGoals returns `created_at desc` and this does not re-sort it — an order asserted in
  // one place and assumed in another is the bug route-tests-and-realtime.md records.
  const goalByOrg = new Map<string, VisitGoal>();
  for (const goal of goals) {
    if (goal.orgId === null) continue;
    if (!goalByOrg.has(goal.orgId)) goalByOrg.set(goal.orgId, goal);
  }

  // Computed BEFORE the rows, once, because every row asks the same question of the same list.
  const claimingOrganizations = organizations.filter((organization) =>
    isClaimingOrganization(organization, goalByOrg),
  );

  const overrideByPair = new Map(
    householdCadences.map((override) => [
      `${override.orgId}:${override.householdId}`,
      override,
    ]),
  );

  // Every claiming organization is banded, now that claiming REQUIRES a usable goal. The two
  // lists have collapsed into one, and this is kept as a separate field because the page still
  // says out loud how many organizations it is showing standings for.
  const bandedOrgIds = claimingOrganizations.map((organization) => organization.id);

  const rows: AllOrgHouseholdRow[] = visitable.map((household) => {
    // ---------------------------------------------------------------------------
    // CLAIMING, PRECISELY
    // ---------------------------------------------------------------------------
    // An organization that has narrowed NOTHING claims EVERY household — that is what zero rows
    // means (migration 052), and it is why on ship day nothing is unclaimed and this view reads
    // as a plain ward roster with bands. Correct, and worth a test of its own.
    const claimants = claimingOrganizations.filter((organization) => {
      const scope = scopeByOrg.get(organization.id);
      if (scope === undefined) return true;
      return !scope.hasNarrowed || scope.subjectIds.has(household.id);
    });

    const stewards: AllOrgSteward[] = claimants.map((organization) => {
      const goal = goalByOrg.get(organization.id);
      const goalCadence: Cadence | null = goal?.cadence ?? null;

      // NULL FOR EXACTLY ONE REASON NOW: the household is do-not-contact, and is therefore not on
      // the scale at all for anybody (ITER-018 Decision 4).
      //
      // It used to be null for four reasons — no goal, no cadence, a reader who could not read
      // the goal, or do-not-contact — and the chip had to render a sentence that guessed which.
      // Walking scenario 048 caught that sentence being wrong in two of the three states it
      // reached. Two changes removed the ambiguity rather than reworded it: an organization with
      // no usable goal is no longer a CLAIMANT (so it has no chip to explain), and migration 053
      // makes every goal readable to every reader who can reach this page.
      //
      // The remaining null is a fact about the HOUSEHOLD rather than about the reader or the
      // organization, so the table can render it once, plainly, with no guessing.
      const priority =
        goalCadence !== null && !household.doNotContact
          ? (() => {
              const resolved = resolveHouseholdCadence(
                goalCadence,
                overrideByPair.get(`${organization.id}:${household.id}`),
              );

              return householdVisitPriority({
                // MEASURED FROM THAT ORGANIZATION'S OWN VISITS, not from the ward-wide last
                // visit. An organization is judged against the visits IT made — the same rule
                // the per-org dashboard keeps — so the ward-wide `lastVisitedOn` on this row and
                // a steward's band can legitimately disagree, which is precisely what this view
                // exists to show.
                lastCompletedOn:
                  lastVisitPerOrg.get(`${organization.id}:${household.id}`) ?? null,
                cadence: resolved.cadence,
                cadenceSource: resolved.source,
                notice: goal?.notice ?? { amount: 1, unit: "day" },
                asOf,
              });
            })()
          : null;

      return {
        orgId: organization.id,
        orgName: organization.name,
        priority,
      };
    });

    const lastVisit = lastVisits.get(household.id);

    return {
      householdId: household.id,
      familyName: household.familyName,
      doNotContact: household.doNotContact,
      lastVisitedOn: lastVisit?.visitDate ?? null,
      lastVisitedByOrgId: lastVisit?.orgId ?? null,
      lastVisitedByOrgName:
        lastVisit?.orgId == null ? null : (organizationNames.get(lastVisit.orgId) ?? null),
      conductedBy: lastVisit?.conductedBy ?? null,
      stewards,
      unclaimed: claimants.length === 0,
    };
  });

  rows.sort(compareAllOrgRows);

  return {
    asOf: asOf.toISOString(),
    rows,
    unclaimedCount: rows.filter((row) => row.unclaimed).length,
    bandedOrgIds,
  };
}

// SERVER-ONLY below this line.
//
// The caller's session client is passed straight through, so RLS decides which rows are visible —
// see §1 in the header. There is deliberately no application-side org filter on ANY of these
// reads: a redundant filter would mask a policy regression by hiding rows the policy had started
// letting through.
//
// The clock enters ONCE and is handed down as `asOf`, so every row in one render is judged
// against the same instant.
export async function readAllOrgProgress(
  wardId: string,
  asOf: Date,
  client?: SupabaseClient<Database>,
): Promise<AllOrgProgress> {
  const [households, logs, goals, stewardships, organizations, householdCadences] =
    await Promise.all([
      // NO `statuses` option, on purpose. The ["active"] default is what excludes moved_out and
      // do_not_contact MEMBERS (lib/roster/queries.ts §DEFAULT_MEMBER_STATUSES).
      listHouseholds(wardId, undefined, client),
      listVisitLogs(wardId, {}, client),
      listVisitGoals(wardId, client),
      listWardStewardships(wardId, client),
      listWardOrganizations(wardId, client),
      listWardVisitCadences(wardId, client),
    ]);

  return buildAllOrgProgress({
    households,
    logs,
    goals,
    householdCadences,
    stewardships,
    organizations,
    asOf,
  });
}
