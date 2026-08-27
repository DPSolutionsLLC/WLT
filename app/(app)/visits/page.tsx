import Link from "next/link";
import { AppointmentPanel, type AppointmentRow } from "@/app/(app)/visits/AppointmentPanel";
import { CollapsibleSection } from "@/app/(app)/visits/CollapsibleSection";
import {
  VisitFlagButton,
  VisitLogForm,
  type AppointmentPrefill,
} from "@/app/(app)/visits/VisitLogForm";
import { VisitGoalPanel } from "@/app/(app)/visits/VisitGoalPanel";
import { VisitProgressTable } from "@/app/(app)/visits/VisitProgressTable";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listWardOrganizations, listWardUsers } from "@/lib/auth/adminUsers";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { formatDateOnly } from "@/lib/calendar/dates";
import { listHouseholds } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readAppointmentParam } from "@/lib/visits/appointmentLink";
import { listAppointments } from "@/lib/visits/appointments";
import { readVisitProgress, type VisitProgress } from "@/lib/visits/progress";
import { listVisitGoals, listVisitLogs } from "@/lib/visits/queries";
import { canManageVisitLog } from "@/lib/visits/visitOwnership";
import {
  VISIT_ARRANGEMENT_LABELS,
  VISIT_CONDUCTED_PREFIX,
  VISIT_NOBODY_RECORDED,
  VISIT_OUTCOME_LABELS,
  VISIT_TYPE_LABELS,
} from "@/types/domain";

// The visit tracker, at /visits — where lib/auth/navigation.ts has linked since auth-a.
//
// THE PROGRESS DASHBOARD IS THE PAGE. Everything else collapses beneath it, because a president
// opens /visits to answer "where are we?" and the four panels this page had accumulated made
// that answer the fourth thing on a four-screen scroll at 375px.
//
// THIS PAGE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT. A private note belongs to
// its author and appears in no list, ever (CLAUDE.md rule 5) — the import list above is where a
// reviewer can see that in one glance, without reading a query.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
// whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
//
// ---------------------------------------------------------------------------
// EVERY VISIT NAMES BOTH ROLES
// ---------------------------------------------------------------------------
// CONDUCTED BY is who went, built from visit_participants. RECORDED BY is who typed it in. They
// are frequently different people and visits-a had one column for both, which is what visits-d
// split. A visit with no participants reads "Nobody recorded as visiting" rather than falling
// back to the recorder — falling back would re-create the exact ambiguity being removed. The
// dashboard's "Conducted by" column follows the same rule.

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
  const isBishopric = (BISHOPRIC_ROLES as readonly string[]).includes(user.role);

  // The clock enters ONCE and is handed down, so every appointment and every household in one
  // render is judged against the same instant rather than against a fresh `new Date()` per row.
  const asOf = new Date();

  const [visits, goals, organizations, appointments] = await Promise.all([
    listVisitLogs(user.wardId, {}, supabase),
    listVisitGoals(user.wardId, supabase),
    listWardOrganizations(user.wardId, supabase),
    listAppointments(user.wardId, {}, asOf, supabase),
  ]);

  const organizationOptions = organizations.map((organization) => ({
    id: organization.id,
    label: organization.name,
  }));

  // WHICH organization the dashboard opens on. An org leader has exactly one and cannot change
  // it; the bishopric opens on one and switches from the control on the table. There is no
  // ward-wide option, because there is no ward-wide visit goal to supply a denominator —
  // migration 019 makes an `org_id = null` goal bishopric-only and FEATURES.md §Module 9
  // describes progress per organization.
  //
  // THE FIRST ORGANIZATION THAT HAS A GOAL, not simply the first organization. The org list is
  // ordered with the Bishopric at the front, and the bishopric is the one organization that will
  // essentially never carry household visit goals — so `[0]` landed every bishop on "No visit
  // goal is set for this organization" and left them to work out that they had to switch. An
  // honest message on a useless default is still a useless default. Found walking scenario 040.
  const organizationWithGoal = organizationOptions.find((organization) =>
    goals.some((goal) => goal.orgId === organization.id),
  );

  const initialOrgId = isBishopric
    ? (organizationWithGoal?.id ?? organizationOptions[0]?.id ?? null)
    : user.orgId;

  const initialProgress: VisitProgress | null =
    initialOrgId === null
      ? null
      : await readVisitProgress(user.wardId, initialOrgId, asOf, supabase);

  // listHouseholds() filters the members it ATTACHES, not the households it RETURNS, so a
  // household whose people have all moved out comes back present with `members: []`. Offering it
  // here would invite a leader to log a visit to an empty house.
  //
  // DEFAULT_MEMBER_STATUSES is ["active"] and its header in lib/roster/queries.ts names a visit
  // goal's denominator as its reason for existing. The status filter is reused rather than
  // re-derived; what is added here is the household-level consequence of it.
  //
  // THE DASHBOARD'S DENOMINATOR APPLIES THE SAME RULE, in isVisitableHousehold() in
  // lib/visits/progress.ts. The two must not drift: a household offered in this picker but
  // absent from the count above it — or the reverse — is a progress number nobody can reconcile
  // against the list beside it.
  const households = canLog ? await listHouseholds(user.wardId, undefined, supabase) : [];

  // A DO-NOT-CONTACT HOUSEHOLD IS LABELLED, NOT REMOVED. Removing it would make this picker and
  // the dashboard's row list disagree — the dashboard SHOWS such a household, marked — and both
  // this comment and the one in lib/visits/progress.ts insist the two must not drift. Marking
  // keeps one predicate and one list, and a leader who has to record an unavoidable contact can
  // still do it.
  const householdOptions = households
    .filter((household) => household.members.length > 0)
    .map((household) => ({
      id: household.id,
      label: household.doNotContact
        ? `${household.familyName} (do not contact)`
        : household.familyName,
    }));

  // A plain id -> name lookup for the chip a MemberPicker selection produces. The picker hands
  // back ids only, and re-deriving its member list inside the field is the documented bug in
  // roster-b's retro — so the households already fetched above supply the names instead.
  const memberNames = Object.fromEntries(
    households.flatMap((household) =>
      household.members.map((member) => [
        member.id,
        `${member.firstName} ${member.lastName}`.trim(),
      ]),
    ),
  );

  // Leaders, for the "add a leader" half of the participants field. Read through the caller's
  // client, so migration 020's ward-scoped policy is what decides who is listed.
  const leaders = canLog
    ? (await listWardUsers(user.wardId, supabase))
        .filter((wardUser) => wardUser.isActive)
        .map((wardUser) => ({
          id: wardUser.id,
          label: `${wardUser.firstName ?? ""} ${wardUser.lastName ?? ""}`.trim() || "A leader",
        }))
    : [];

  const appointmentRows: AppointmentRow[] = appointments.map((appointment) => ({
    id: appointment.id,
    householdId: appointment.householdId,
    householdName: appointment.householdName,
    scheduledFor: appointment.scheduledFor,
    status: appointment.status,
    visitLogId: appointment.visitLogId,
    madeByName: appointment.madeByName,
    notes: appointment.notes,
  }));

  // `?appointment=` is the whole protocol between the panel and the form — see the header of
  // lib/visits/appointmentLink.ts, which owns BOTH halves so they cannot drift. An id for an
  // appointment this caller cannot see simply resolves to nothing and the form opens empty,
  // which is the same answer a stale link gets.
  //
  // The parameter NAME comes from that module rather than from AppointmentPanel: imported from a
  // `"use client"` module it arrived here as a function instead of a string, and the prefill
  // silently never ran.
  const requestedAppointmentId = readAppointmentParam(await searchParams);

  // An appointment whose household was deleted since it was booked cannot prefill anything, so
  // it resolves to undefined and the form opens empty — the same answer a stale link gets.
  const prefilled = appointments.find(
    (appointment) => appointment.id === requestedAppointmentId,
  );
  const prefilledHouseholdId = prefilled?.householdId ?? null;

  const appointmentPrefill: AppointmentPrefill | undefined =
    prefilled === undefined || prefilledHouseholdId === null
      ? undefined
      : {
          id: prefilled.id,
          householdId: prefilledHouseholdId,
          householdName: prefilled.householdName ?? "that household",
          scheduledFor: prefilled.scheduledFor,
        };

  const today = formatDateOnly(new Date());

  const scheduledCount = appointmentRows.filter(
    (appointment) => appointment.status === "scheduled",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* A LINK, not a tab. This page is a dashboard with four collapsible panels stacked under
            it; a tab bar would fight them for the same space at 375px, and the feed is a place
            you go rather than a second view of what is already here. */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-foreground">Visits</h1>
          <Link
            href="/visits/feed"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            Return and report
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted">
          Every visit carries shared notes the other leaders read, and private notes only you can
          ever see.
        </p>
      </div>

      <VisitProgressTable
        initialProgress={initialProgress}
        organizations={organizationOptions}
        canSwitchOrganizations={isBishopric}
        canManageGoals={canManageGoals}
      />

      {/* The cadence driving the numbers sits directly under them, so changing it and seeing the
          statuses move is one scroll rather than two pages. */}
      <CollapsibleSection
        id="visits-goal-section"
        title="Visit goal"
        summary="How often each household should be visited"
      >
        <VisitGoalPanel
          goals={goals}
          organizations={organizationOptions}
          canManage={canManageGoals}
          ownOrgId={user.orgId}
        />
      </CollapsibleSection>

      <CollapsibleSection
        id="visits-appointments-section"
        title="Appointments"
        summary={
          scheduledCount === 1 ? "1 still scheduled" : `${scheduledCount} still scheduled`
        }
      >
        <AppointmentPanel
          appointments={appointmentRows}
          households={householdOptions}
          canBook={canLog}
        />
      </CollapsibleSection>

      {canLog ? (
        // OPEN when an appointment is being logged. "Log this visit" navigates here with
        // `?appointment=`, and landing on a collapsed panel would be the same silent dead flow
        // the prefill has already had once.
        <CollapsibleSection
          id="visits-log-section"
          title="Log a visit"
          summary="Record a visit, or an attempt nobody answered"
          defaultOpen={appointmentPrefill !== undefined}
        >
          {/* `key` IS THE FIX, not decoration. VisitLogForm seeds its draft in a useState
              initializer, which React runs ONCE per mount — and "Log this visit" is a client-side
              navigation, so the component stays mounted and a new `appointment` prop would be
              ignored. The server rendered the right prefill and the form quietly showed the old
              empty draft, which is exactly the stale-form trap plans/retros/ai-a-client-and-settings
              records for router.refresh().

              Changing the key remounts the form, so the initializer re-runs against the new
              appointment. It also discards anything half-typed — correct here, because pressing
              "Log this visit" on a specific appointment is an explicit request for a different
              form. Collapsing the section does NOT remount it: CollapsibleSection hides its
              children with `hidden` rather than unmounting them, so a half-typed note survives
              being folded away. */}
          <VisitLogForm
            key={appointmentPrefill?.id ?? "no-appointment"}
            households={householdOptions}
            today={today}
            user={user}
            leaders={leaders}
            memberNames={memberNames}
            appointment={appointmentPrefill}
          />
        </CollapsibleSection>
      ) : null}

      {/* KEPT, collapsed, rather than replaced by the dashboard.

          This list is the ONLY place VisitFlagButton renders and the only place a shared note is
          readable, so deleting it would have taken visits-a's ward-council flagging off the app
          with it. visits-c moves this to /visits/feed; until then it stays here, one click away,
          for the same reason VisitLogForm does. */}
      <CollapsibleSection
        id="visits-recent-section"
        title="Recent visits"
        summary={visits.length === 1 ? "1 logged" : `${visits.length} logged`}
      >
        <Card>
          {visits.length === 0 ? (
            <p className="text-sm text-muted">No visits logged yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {visits.map((visit) => (
                <li key={visit.id} className="rounded-md border border-border bg-surface p-3">
                  <p className="text-sm font-medium text-foreground">
                    {visit.householdName ?? "Unknown household"}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {visit.visitDate} · {VISIT_TYPE_LABELS[visit.visitType]} ·{" "}
                    {VISIT_ARRANGEMENT_LABELS[visit.arrangement]}
                  </p>

                  {/* The outcome carries the attention colour when it is an attempt, because an
                      attempt that reads like a visit is worse than no record at all — it counts
                      towards no goal and the household still needs reaching. */}
                  <p
                    className={`mt-1 text-sm font-medium ${
                      visit.outcome === "attempted" ? "text-warning" : "text-success"
                    }`}
                  >
                    {VISIT_OUTCOME_LABELS[visit.outcome]}
                  </p>

                  {/* Both roles, and the recorder is quieter. Never a fallback from one to the
                      other: "Nobody recorded as visiting" is a fact about the visit, and crediting
                      the person who typed it in would be an invention.

                      The verb FOLLOWS THE OUTCOME. An attempt that says "Visited by" is a row
                      contradicting its own label one line above it. */}
                  <p className="mt-1 text-sm text-foreground">
                    {visit.conductedByLabel === null
                      ? VISIT_NOBODY_RECORDED[visit.outcome]
                      : `${VISIT_CONDUCTED_PREFIX[visit.outcome]} ${visit.conductedByLabel}`}
                  </p>
                  {visit.recordedByName === null ? null : (
                    <p className="text-xs text-muted">Recorded by {visit.recordedByName}</p>
                  )}

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

                  {/* `visits.create` is not enough on its own. It says this leader may LOG
                      visits; it says nothing about WHICH visits they may edit, and with
                      cross-org visibility on this list carries other organizations' visits too.
                      canManageVisitLog() mirrors visit_logs_update, so the button is absent
                      exactly where the policy would refuse the write.

                      Gating on canLog alone put a "Flag for ward council" button on every
                      organization's visits the moment the ward turned visibility on. RLS refused
                      them and nothing leaked — but the leader was offered a consequential action,
                      confirmed it, and got a generic failure. Found walking scenario 042. */}
                  {canLog && canManageVisitLog(user, visit.orgId) ? (
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
      </CollapsibleSection>
    </div>
  );
}
