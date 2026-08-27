import Link from "next/link";
import { AllOrganizationsTable } from "@/app/(app)/visits/AllOrganizationsTable";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readAllOrgProgress } from "@/lib/visits/allOrgProgress";
import { readCrossOrgVisibility } from "@/lib/ward/crossOrgVisibility";

// Every household once, with each organization's standing beside it, at /visits/all-organizations.
//
// ---------------------------------------------------------------------------
// WHY THIS PAGE EXISTS
// ---------------------------------------------------------------------------
// ITER-019 D3 makes a household outside an organization's stewardship VANISH from that
// organization's dashboard — there is nothing for an organization to hand the next presidency
// about a family that was never theirs. The pastoral failure that creates is a household in NO
// organization's stewardship, invisible to everybody. This page is where such a household is
// visibly unclaimed and sorted to the top, and it is what made D3 safe to take.
//
// ---------------------------------------------------------------------------
// TWO GATES, AND THE SECOND IS NOT A PERMISSION
// ---------------------------------------------------------------------------
// `visits.view` says whether this person may see visit data at all. The ward's cross-org
// visibility setting says whether SEEING EVERY ORGANIZATION AT ONCE is something this ward does —
// which is a ward's decision rather than a role's, and it is the same setting migration 052's
// SELECT policy reads. A bishopric member is past it either way, because they can already read
// every organization's goals and logs.
//
// Refusing here is belt to the policy's braces: with the setting off, RLS would return only the
// caller's own organization's stewardships anyway, and the page would render as a ward roster
// with one chip per row — technically correct and completely misleading about what it was for.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
//
// THERE IS NO API ROUTE BEHIND THIS PAGE. The table is a client component for SORTING only and
// receives its rows as props, so there is no second read path to keep in step with this one.
//
// THIS PAGE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT. A private note belongs to
// its author and appears in no list, ever (CLAUDE.md rule 5) — the import list above is where a
// reviewer confirms that in one glance.

export default async function AllOrganizationsPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "visits.view", roleAccess)) {
    return (
      <NotPermitted detail="The visit tracker is limited to ward and organization leadership." />
    );
  }

  const isBishopric = (BISHOPRIC_ROLES as readonly string[]).includes(user.role);
  const crossOrgVisibility = await readCrossOrgVisibility(user.wardId, supabase);

  if (!isBishopric && !crossOrgVisibility) {
    return (
      <NotPermitted detail="Seeing every organization at once is turned off for this ward. A member of the bishopric can turn on cross-organization visibility." />
    );
  }

  // The clock enters ONCE and is handed down, so every row in this render is judged against the
  // same instant rather than against a fresh `new Date()` per row.
  const progress = await readAllOrgProgress(user.wardId, new Date(), supabase);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-foreground">All organizations</h1>
          <Link
            href="/visits"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            Back to visits
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted">
          One row per household, with every organization that has claimed it. A household nobody
          has claimed sorts to the top.
        </p>
      </div>

      {/* No reader-tier prop. Migration 053 widened goals and cadences with the same ward setting
          that gates this page, so everybody who gets this far reads every organization's standing
          — there is no longer a second tier for the page to describe. Which rows arrive is still
          decided by RLS before this render, never by a branch here
          (lib/visits/allOrgProgress.ts §1). */}
      <AllOrganizationsTable progress={progress} />
    </div>
  );
}
