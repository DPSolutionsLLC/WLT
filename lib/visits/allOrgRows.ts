import type { DateOnly } from "@/lib/calendar/dates";
import { compareByPriority, type VisitPriority } from "@/lib/visits/householdStatus";

// The all-organizations ROW SHAPE and the ONE order it is read in.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT IN lib/visits/allOrgProgress.ts
// ---------------------------------------------------------------------------
// That module imports listHouseholds, listVisitLogs and listWardStewardships, all of which reach
// createServerSupabaseClient and therefore next/headers. AllOrganizationsTable is a client
// component that has to SORT, so it needs the comparator as a VALUE — and one value import from
// there would pull next/headers into the client bundle and break the page
// (plans/retros/roster-b-picker-and-orgs.md).
//
// This is the same split lib/visits/householdStatus.ts already is from lib/visits/progress.ts,
// and lib/roster/organizationScope.ts is from lib/roster/organizations.ts. allOrgProgress.ts
// re-exports everything below, so a server caller still finds it where the plan says it lives.
//
// This file imports types and pure comparators, and nothing else — keep it that way.

export type AllOrgSteward = {
  orgId: string;
  orgName: string;
  // NULL when this reader may not see that organization's goal or cadence — which is the RLS
  // policy doing its job, not an error and not an absence of data. The table renders the
  // organization's name with an honest sentence rather than a blank.
  //
  // It is also null for a do-not-contact household, an organization with no goal, and a goal
  // carrying no usable cadence. All four render the same way, because "no band" is the honest
  // answer in every one of them and guessing which it was would put a wrong sentence on screen.
  priority: VisitPriority | null;
};

export type AllOrgHouseholdRow = {
  householdId: string;
  familyName: string;
  doNotContact: boolean;
  // WARD-WIDE AND ALL-TIME, across every organization whose logs this reader may see. The
  // question no org-scoped query can answer, and the reason this view exists at all: the Elders
  // Quorum's own board says "never visited" for a family the Relief Society sat down with last
  // month, and both are correct.
  lastVisitedOn: DateOnly | null;
  lastVisitedByOrgId: string | null;
  lastVisitedByOrgName: string | null;
  // Who WENT, never who typed it in.
  conductedBy: string | null;
  stewards: AllOrgSteward[];
  // TRUE when NO organization has claimed this household. Not simply `stewards.length === 0` —
  // an organization that has narrowed NOTHING claims EVERY household, so on ship day nothing is
  // unclaimed. See §CLAIMING in lib/visits/allOrgProgress.ts.
  unclaimed: boolean;
};

export type AllOrgProgress = {
  // THE INSTANT EVERY ROW WAS JUDGED AGAINST, as an ISO string so it survives the JSON boundary.
  // One clock reading per render, the rule readVisitProgress and the visits page already keep.
  asOf: string;
  rows: AllOrgHouseholdRow[];
  unclaimedCount: number;
  // Organizations this reader can see bands for, so the page can say plainly that it is showing
  // one organization's bands rather than all of them.
  bandedOrgIds: string[];
};

// The most urgent band a reader can ACTUALLY SEE on this row.
//
// A steward with a null priority contributes NOTHING to this answer. It is not "least urgent" —
// it is unknown, and treating an unknown as settled would sort a genuinely overdue family down
// the page for one reader and up it for another, from the same data.
export function mostUrgentVisiblePriority(
  stewards: readonly AllOrgSteward[],
): VisitPriority | null {
  const visible = stewards
    .map((steward) => steward.priority)
    .filter((priority): priority is VisitPriority => priority !== null);

  if (visible.length === 0) return null;

  // compareByPriority is the ONE meaning of "more urgent" in this app, imported rather than
  // approximated. Never a second one.
  return visible.reduce((leading, candidate) =>
    compareByPriority(
      { priority: candidate, familyName: "" },
      { priority: leading, familyName: "" },
    ) < 0
      ? candidate
      : leading,
  );
}

// ONE exported comparator, so the server's order and the client-side re-sort cannot disagree —
// clicking the default column back to ascending returns the list to exactly what arrived.
//
//   1. `unclaimed` first — the pastoral failure this view exists to surface, and the reason
//      ITER-019 D3 (a non-stewardship household vanishing from its organization's dashboard) was
//      safe to take at all.
//   2. Then by the most urgent VISIBLE band, through compareByPriority.
//   3. Then households with no ward-wide visit at all.
//   4. Then family name, as the stable tie-break.
export function compareAllOrgRows(
  left: AllOrgHouseholdRow,
  right: AllOrgHouseholdRow,
): number {
  if (left.unclaimed !== right.unclaimed) return left.unclaimed ? -1 : 1;

  // THE SAME familyName IS PASSED ON BOTH SIDES, AND THAT IS NOT AN OVERSIGHT.
  //
  // compareByPriority ends with its own `familyName.localeCompare` tie-break, which is right on
  // the per-organization table where the name IS the last word. Here it is not: steps 3 and 4
  // below still have to run. Handing it two identical names makes that final clause contribute
  // zero, so what comes back is the band-and-fraction ordering alone — the one meaning of
  // "more urgent" this app has, with its last step deferred to this function.
  //
  // Passing the real names instead let "Aardvark" beat "Zulu" before never-seen was ever
  // consulted, so a family nobody had visited sorted below one visited last month. Caught by
  // tests/lib/allOrgProgress.test.ts.
  const bandDelta = compareByPriority(
    { priority: mostUrgentVisiblePriority(left.stewards), familyName: "" },
    { priority: mostUrgentVisiblePriority(right.stewards), familyName: "" },
  );
  if (bandDelta !== 0) return bandDelta;

  const leftNeverSeen = left.lastVisitedOn === null;
  const rightNeverSeen = right.lastVisitedOn === null;
  if (leftNeverSeen !== rightNeverSeen) return leftNeverSeen ? -1 : 1;

  return left.familyName.localeCompare(right.familyName);
}
