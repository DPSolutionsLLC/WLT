import { VisitFlagButton, VisitLogForm } from "@/app/(app)/visits/VisitLogForm";
import { VisitGoalPanel } from "@/app/(app)/visits/VisitGoalPanel";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { formatDateOnly } from "@/lib/calendar/dates";
import { listHouseholds } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listVisitGoals, listVisitLogs } from "@/lib/visits/queries";
import { VISIT_TYPE_LABELS } from "@/types/domain";

// The visit tracker, at /visits — where lib/auth/navigation.ts has linked since auth-a.
//
// A LIST AND A FORM, DELIBERATELY PLAIN. visits-b replaces this body with the progress
// dashboard, so there is no layout worth investing in here; what this slice owes is a working
// write surface and a visible notes boundary.
//
// THIS PAGE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT. A private note belongs to
// its author and appears in no list, ever (CLAUDE.md rule 5) — the import list above is where a
// reviewer can see that in one glance, without reading a query.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
// whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).

export default async function VisitsPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "visits.view", roleAccess)) {
    return (
      <NotPermitted detail="The visit tracker is limited to ward and organization leadership." />
    );
  }

  const canLog = can(user, "visits.create", roleAccess);
  const canManageGoals = can(user, "visits.manage_goals", roleAccess);

  const [visits, goals, organizations] = await Promise.all([
    listVisitLogs(user.wardId, {}, supabase),
    listVisitGoals(user.wardId, supabase),
    listWardOrganizations(user.wardId, supabase),
  ]);

  // listHouseholds() filters the members it ATTACHES, not the households it RETURNS, so a
  // household whose people have all moved out comes back present with `members: []`. Offering it
  // here would invite a leader to log a visit to an empty house, and — the reason that actually
  // bites — visits-b computes its progress denominator over this same set, so those households
  // would hold a ward's visit progress down permanently.
  //
  // DEFAULT_MEMBER_STATUSES is ["active"] and its header in lib/roster/queries.ts names exactly
  // this denominator as its reason for existing. The status filter is reused rather than
  // re-derived; what is added here is the household-level consequence of it.
  //
  // visits-b MUST apply the same rule to its denominator. Found by walking scenario 038.
  const households = canLog ? await listHouseholds(user.wardId, undefined, supabase) : [];

  const householdOptions = households
    .filter((household) => household.members.length > 0)
    .map((household) => ({
      id: household.id,
      label: household.familyName,
    }));

  const organizationOptions = organizations.map((organization) => ({
    id: organization.id,
    label: organization.name,
  }));

  const today = formatDateOnly(new Date());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Visits</h1>
        <p className="mt-1 text-sm text-muted">
          Every visit carries shared notes the other leaders read, and private notes only you can
          ever see.
        </p>
      </div>

      <VisitGoalPanel
        goals={goals}
        organizations={organizationOptions}
        canManage={canManageGoals}
        ownOrgId={user.orgId}
      />

      {canLog ? <VisitLogForm households={householdOptions} today={today} /> : null}

      <Card>
        <h2 className="text-base font-semibold text-foreground">Recent visits</h2>

        {visits.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No visits logged yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {visits.map((visit) => (
              <li key={visit.id} className="rounded-md border border-border bg-surface p-3">
                <p className="text-sm font-medium text-foreground">
                  {visit.householdName ?? "Unknown household"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {visit.visitDate} · {VISIT_TYPE_LABELS[visit.visitType]}
                  {visit.visitedByName === null ? "" : ` · ${visit.visitedByName}`}
                </p>

                {/* Shared notes, and only ever shared notes. There is no private-note field on
                    this row to render — VisitLogWithContext has none. */}
                {visit.sharedNotes === null ? null : (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                    {visit.sharedNotes}
                  </p>
                )}

                {visit.flaggedForWardCouncil ? (
                  <p className="mt-2 text-sm font-medium text-warning">
                    Flagged for ward council
                  </p>
                ) : null}

                {canLog ? (
                  <div className="mt-3">
                    <VisitFlagButton
                      visitId={visit.id}
                      familyName={visit.householdName ?? "this household"}
                      flagged={visit.flaggedForWardCouncil}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
