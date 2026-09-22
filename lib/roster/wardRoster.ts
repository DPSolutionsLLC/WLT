import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listHouseholds,
  listMembers,
  type HouseholdWithMembers,
  type Member,
} from "@/lib/roster/queries";
import type { Database } from "@/types/database";
import type { MemberStatus } from "@/types/domain";

// ---------------------------------------------------------------------------
// "GET THE CURRENT ROSTER FOR THIS WARD" — ONE INTERFACE, SO THERE IS ONE PLACE TO REPLACE
// ---------------------------------------------------------------------------
//
// [plans/prototype/decisions.md](../../plans/prototype/decisions.md) §4.9 asks for this by name:
// if a real LCR integration ever arrives, existing wards get real unit and stake ids, and real
// data is pulled and reconciled with mandatory person-by-person review. The difficulty it names
// is NOT name matching — it is that every module references a person by an app-generated id, so
// reconciliation means re-pointing every one of those references.
//
// A SEAM DRAWN NOW IS CHEAP; ONE DRAWN LATER IS AN ARCHAEOLOGY EXERCISE. P2 is already touching
// the access model and no roster work is otherwise in flight, which is exactly when this costs
// nothing. That is the whole justification — it buys one file to change instead of a search
// across every module that happens to ask for a roster.
//
// ---------------------------------------------------------------------------
// WHAT THIS IS NOT
// ---------------------------------------------------------------------------
// IT IS A SEAM, NOT A REWRITE, and it is deliberately ONE READ. It does not wrap
// `lib/roster/queries.ts`'s searching, org scoping, pagination, CRUD or CSV import — those are
// the roster MODULE's surface, and hiding them behind a second interface would be the
// parallel-model mistake that key requirement 1 of plans/p2-admin-and-access.md forbids one level
// up, for the permission matrix. Callers that need a filtered or searched list keep calling
// `listMembers` and `listHouseholds` directly; this answers only "who is in this ward".
//
// ROSTER IMPORT STAYS WARD-LEVEL AND WARD-OWNED. Nothing about this boundary makes the roster
// something a super admin manages centrally, and nothing should.
//
// NOTHING GOES BEHIND IT YET. There is one implementation, it delegates to the reads the app
// already makes, and RLS remains the boundary exactly as before (CLAUDE.md rule 2). The point is
// that there is now somewhere for a second implementation to go.
//
// `wardId` IS THE WARD THE SESSION IS ACTING IN — pass `user.wardId`, which session_context()
// resolves from the active calling (migration 070e) and which every other roster read already
// takes. It is NOT the home ward, and it is never recomputed in TypeScript.

export type WardRoster = {
  // Households with their members attached — `listHouseholds` already returns this shape, so
  // nothing is regrouped here. Regrouping would be a second implementation of the household ↔
  // member join, free to disagree with the first.
  households: HouseholdWithMembers[];
  // Flat, for callers that want people rather than families.
  members: Member[];
};

export type ReadWardRosterOptions = {
  // ACTIVE MEMBERS ONLY BY DEFAULT — `resolveMemberStatuses()` applies that default when
  // `statuses` is absent, exactly as it does for every other caller. A roster is who is here now;
  // the moved-out and do-not-contact rows are a different question, and a caller that wants them
  // asks by naming the statuses.
  //
  // ⚠️ `households.do_not_contact` IS A SEPARATE AXIS from `members.status` and this option does
  // not touch it. A do-not-contact household stays on the roster, stays visible and marked, and
  // is counted in nothing — see `describeHouseholdForVisits()`, which is the one place that rule
  // lives. Do not add a flag here that filters it out.
  statuses?: readonly MemberStatus[];
};

export async function readWardRoster(
  wardId: string,
  options: ReadWardRosterOptions = {},
  client?: SupabaseClient<Database>,
): Promise<WardRoster> {
  // Both reads take the same status option, so the flat list and the households cannot disagree
  // about who is on the roster — which is the kind of drift a seam like this exists to prevent
  // rather than introduce.
  const [households, members] = await Promise.all([
    listHouseholds(wardId, { statuses: options.statuses }, client),
    listMembers(wardId, { statuses: options.statuses }, client),
  ]);

  return { households, members };
}
