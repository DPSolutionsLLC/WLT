import { type AppointmentRow } from "@/app/(app)/visits/AppointmentPanel";
import { type HouseholdContact } from "@/app/(app)/visits/ContactPanel";
import { VisitFlagButton, type AppointmentPrefill } from "@/app/(app)/visits/VisitLogForm";
import { VisitsScreen } from "@/app/(app)/visits/VisitsScreen";
import { ContextualBackLink } from "@/components/layout/ContextualBackLink";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listWardOrganizations, listWardUsers } from "@/lib/auth/adminUsers";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { listBishopricUsers } from "@/lib/calendar/queries";
import { requireSessionUser } from "@/lib/auth/session";
import { formatDateOnly } from "@/lib/calendar/dates";
import { listHouseholds } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readPageView } from "@/lib/users/userSettings";
import { DEFAULT_FEED_PAGE_SIZE } from "@/lib/validation/report";
import { readAllOrgProgress } from "@/lib/visits/allOrgProgress";
import { readAppointmentParam } from "@/lib/visits/appointmentLink";
import { buildGoalHistory } from "@/lib/visits/goalHistory";
import { listWardVisitCadences } from "@/lib/visits/householdCadences";
import { listAppointments } from "@/lib/visits/appointments";
import { listGoalAssignments, resolveAssignmentContext } from "@/lib/visits/assignments";
import {
  describeHouseholdForVisits,
  readVisitProgress,
  type VisitProgress,
} from "@/lib/visits/progress";
import { listVisitGoals, listVisitLogs, type VisitLogWithContext } from "@/lib/visits/queries";
import { readVisitReportFeed } from "@/lib/visits/reportFeed";
import { listWardStewardships, readStewardshipScope } from "@/lib/visits/stewardship";
import { compareStewardshipDrift, toStewardshipScope } from "@/lib/visits/stewardshipScope";
import {
  describeVisitSharingForReader,
  orgIdsSharedWith,
  readVisitSharing,
} from "@/lib/visits/sharing";
import { isDoneVisit } from "@/lib/visits/householdStatus";
import { describeVisitOutcome } from "@/lib/visits/visitOutcome";
import {
  canAssignVisits,
  canManageVisitLog,
  canManageVisitSharing,
} from "@/lib/visits/visitOwnership";
import {
  initialVisitsTab,
  parseVisitsTabParam,
  parseVisitsView,
  visibleVisitsTabs,
} from "@/lib/visits/visitsView";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import {
  VISIT_ARRANGEMENT_LABELS,
  VISIT_CONDUCTED_PREFIX,
  VISIT_NOBODY_RECORDED,
  VISIT_TYPE_LABELS,
  type SessionUser,
} from "@/types/domain";

// Visits, at /visits — the prototype's sub-view machine since ITER-055 bv2: Households (the
// progress dashboard, with the goal, stewardship, appointments, assigning and logging a visit in
// windows), My visits (bishopric, bv5), Feed, All organizations, Past goals and Sharing (bishopric). /visits/feed and
// /visits/all-organizations redirect here with `?tab=`.
//
// THIS PAGE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT. A private note belongs to
// its author and appears in no list, ever (CLAUDE.md rule 5) — the import list above is where a
// reviewer can see that in one glance, without reading a query.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
// whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
//
// EVERY VISIT NAMES BOTH ROLES. Conducted by is who went (visit_participants); recorded by is who
// typed it in. A visit with no participants reads "Nobody recorded as visiting" rather than
// falling back to the recorder, which would re-create the ambiguity visits-d removed.

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  if (!can(user, "visits.view", roleAccess)) {
    return (
      <NotPermitted detail="The visit tracker is limited to ward and organization leadership." />
    );
  }

  const params = await searchParams;
  const canLog = can(user, "visits.create", roleAccess);
  const canManageGoals = can(user, "visits.manage_goals", roleAccess);
  const isBishopric = (BISHOPRIC_ROLES as readonly string[]).includes(user.role);

  // The clock enters ONCE and is handed down, so every appointment and every household in one
  // render is judged against the same instant rather than against a fresh `new Date()` per row.
  const asOf = new Date();

  // The ward's zone enters ONCE, beside the clock and for the same reason: an appointment is a
  // timestamptz, and formatting one in "the reader's zone" is impossible on a server, which is
  // where a client component renders first. formatAppointmentInstant's header has the whole story.
  const [visits, goals, organizations, appointments, sharingGrants, wardTimeZone] =
    await Promise.all([
      listVisitLogs(user.wardId, {}, supabase),
      listVisitGoals(user.wardId, supabase),
      listWardOrganizations(user.wardId, supabase),
      listAppointments(user.wardId, {}, asOf, supabase),
      readVisitSharing(user.wardId, supabase),
      readWardTimezone(user.wardId, supabase),
    ]);

  const organizationOptions = organizations.map((organization) => ({
    id: organization.id,
    label: organization.name,
  }));

  // THE ORGANIZATIONS THIS READER MAY LOOK AT (ITER-055). The bishopric reads every one. Anybody
  // else reads their own, plus each organization the bishopric has shared with theirs — read-only,
  // because migration 099 widens reads and never writes. Mirrors visit_org_visible_to_caller(); the
  // policies are still the boundary and a stale list here would only show an empty table.
  //
  // THE BISHOPRIC IS A CHOICE AGAIN (ITER-055 bv4). Defect 099-D1 removed it because its visits
  // are stored with org_id = null and progress filtered on an organization's id, so it always read
  // "never visited". readVisitProgress() now reads the no-organization visits for the ward's
  // bishopric-typed organization, which is where the bishopric's own goal lives. It is listed
  // first, because for the bishopric it is their own.
  const sharedOrgIds = isBishopric ? [] : orgIdsSharedWith(sharingGrants, user.orgId);
  const progressOrganizations = organizations
    .filter(
      (organization) =>
        isBishopric || organization.id === user.orgId || sharedOrgIds.includes(organization.id),
    )
    .sort(
      (left, right) =>
        Number(right.type === "bishopric") - Number(left.type === "bishopric"),
    )
    .map((organization) => ({ id: organization.id, label: organization.name }));
  const canManageSharing = canManageVisitSharing(user, roleAccess);

  // THE FIRST ORGANIZATION THAT HAS A GOAL, not simply the first organization: the bishopric
  // essentially never carries household visit goals, so `[0]` landed every bishop on "No visit
  // goal is set". Found walking scenario 040. There is no ward-wide option, because there is no
  // ward-wide visit goal to supply a denominator.
  const organizationWithGoal = progressOrganizations.find((organization) =>
    goals.some((goal) => goal.orgId === organization.id && goal.endedAt === null),
  );

  const initialOrgId = isBishopric
    ? (organizationWithGoal?.id ?? progressOrganizations[0]?.id ?? null)
    : user.orgId;

  const initialProgress: VisitProgress | null =
    initialOrgId === null
      ? null
      : await readVisitProgress(user.wardId, initialOrgId, asOf, supabase);

  // Read whether or not the dashboard rendered: the PICKER needs it too, so a household outside
  // the stewardship can be offered and marked rather than silently missing. Zero rows resolves to
  // "the whole ward" (lib/visits/stewardshipScope.ts).
  const stewardshipScope =
    initialOrgId === null
      ? toStewardshipScope([])
      : await readStewardshipScope(user.wardId, initialOrgId, supabase);

  // The whole ward's households, for both the picker and the stewardship panel's list. Not
  // narrowed by an `organizationId` filter — the derivation is the ROUTE's job (roster-b,
  // Decision 4).
  const households = await listHouseholds(user.wardId, undefined, supabase);

  // ONE FUNCTION DECIDES BOTH what the picker offers and what the dashboard counts. The picker is
  // a SUPERSET of the denominator and marks the difference: a leader who visited a do-not-contact
  // or out-of-stewardship household anyway must be able to record it.
  const householdOptions = households.flatMap((household) => {
    const disposition = describeHouseholdForVisits(household, stewardshipScope);
    if (disposition === null) return [];
    return [{ id: household.id, label: disposition.pickerLabel }];
  });

  // The stewardship panel lists every VISITABLE household with its plain name — a checkbox row
  // reading "Okonkwo (not in your stewardship)" in the control that decides that would be circular.
  const stewardshipHouseholds = households
    .filter((household) => household.members.length > 0)
    .map((household) => ({ id: household.id, label: household.familyName }));

  const initialStewardship =
    initialOrgId === null
      ? null
      : {
          orgId: initialOrgId,
          narrowed: stewardshipScope.hasNarrowed,
          householdIds: [...stewardshipScope.subjectIds].sort(),
          // The live derivation, matching GET /api/visits/stewardship exactly: listHouseholds()
          // narrows the members it ATTACHES, not the households it RETURNS.
          matchingHouseholdIds: (
            await listHouseholds(user.wardId, { organizationId: initialOrgId }, supabase)
          )
            .filter((household) => household.members.length > 0)
            .map((household) => household.id)
            .sort(),
        };

  const initialStewardshipPayload =
    initialStewardship === null
      ? null
      : {
          ...initialStewardship,
          drift: compareStewardshipDrift(
            stewardshipScope,
            initialStewardship.matchingHouseholdIds,
          ),
        };

  // THE ALL-ORGANIZATIONS VIEW IS THE BISHOPRIC'S ALONE since ITER-055 (P4). Its "unclaimed" count
  // rests on every organization's goal being readable, and per-organization sharing would give two
  // readers two different answers from the same data.
  const canSeeAllOrganizations = isBishopric;

  // A plain id -> name lookup for the chip a MemberPicker selection produces (roster-b).
  const memberNames = Object.fromEntries(
    households.flatMap((household) =>
      household.members.map((member) => [
        member.id,
        `${member.firstName} ${member.lastName}`.trim(),
      ]),
    ),
  );

  // Each household's members and phones, for the Contact window (ITER-055 bv3). From the same
  // roster read as everything above, through the caller's client.
  const householdContacts: Record<string, HouseholdContact[]> = Object.fromEntries(
    households.map((household) => [
      household.id,
      household.members.map((member) => ({
        memberId: member.id,
        name: `${member.firstName} ${member.lastName}`.trim(),
        phone: member.phone,
      })),
    ]),
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

  // `?appointment=` is the whole protocol between the appointments window and the log form — see
  // lib/visits/appointmentLink.ts, which owns BOTH halves so they cannot drift. An id this caller
  // cannot see resolves to nothing and the form opens empty, the same answer a stale link gets.
  const requestedAppointmentId = readAppointmentParam(params);
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
  // A new goal's default start: the WARD's date, not the server's UTC one (rule 12).
  const wardToday = wardDateOnly(asOf, wardTimeZone);

  // GOAL HISTORY IS THE BISHOPRIC'S ALONE (decided at bv4 start). Every ended goal, its final
  // numbers recomputed from the same reads this page already made plus every organization's
  // cadences and stewardship.
  const goalHistory = isBishopric
    ? await (async () => {
        const [wardCadences, wardStewardships] = await Promise.all([
          listWardVisitCadences(user.wardId, supabase),
          listWardStewardships(user.wardId, supabase),
        ]);
        return buildGoalHistory({
          goals,
          organizations,
          households,
          logs: visits,
          householdCadences: wardCadences,
          stewardships: wardStewardships,
          wardTimeZone,
        });
      })()
    : null;

  // THE BISHOPRIC'S HOUSEHOLDS, DIVIDED AMONG ITS THREE MEMBERS (ITER-055 bv5). The bishopric's
  // alone: only its members are assigned households, so nobody else has a My visits tab. Read
  // through the caller's client — migration 103a's policy decides what is visible. Nothing can be
  // assigned while the Bishopric has no active goal (decided at bv5 start).
  const assignmentContext = isBishopric
    ? await resolveAssignmentContext(user.wardId, supabase)
    : null;
  const householdAssignments =
    assignmentContext === null || assignmentContext.kind === "no_bishopric_organization"
      ? null
      : await (async () => {
          const [members, assignments] = await Promise.all([
            listBishopricUsers(user.wardId, supabase),
            assignmentContext.kind === "ready"
              ? listGoalAssignments(user.wardId, assignmentContext.goalId, supabase)
              : Promise.resolve([]),
          ]);
          return {
            orgId: assignmentContext.orgId,
            goalId: assignmentContext.kind === "ready" ? assignmentContext.goalId : null,
            members,
            assignments,
            canAssign: canAssignVisits(user, roleAccess),
          };
        })();

  // My visits reads the Bishopric's own progress rows, so its cards say exactly what the
  // Households tab says. The page already read them when the Bishopric is the selected organization.
  const myVisitRows =
    householdAssignments === null || householdAssignments.goalId === null
      ? null
      : await (async () => {
          const bishopricProgress =
            initialProgress?.orgId === householdAssignments.orgId
              ? initialProgress
              : await readVisitProgress(user.wardId, householdAssignments.orgId, asOf, supabase);
          const mine = new Set(
            householdAssignments.assignments
              .filter((assignment) => assignment.endedAt === null && assignment.assignedTo === user.id)
              .map((assignment) => assignment.householdId),
          );
          return bishopricProgress.rows.filter((row) => mine.has(row.householdId));
        })();

  // THE FEED AND THE ALL-ORGANIZATIONS VIEW ARE TABS NOW, and their first page is still read here,
  // on the server, for the reason /visits/feed always gave: read state is correct on first paint
  // instead of every tile flashing unread (talks-d measured 268 ms).
  const [feedPage, allOrganizations, storedView] = await Promise.all([
    readVisitReportFeed(user.wardId, { limit: DEFAULT_FEED_PAGE_SIZE }, null, supabase),
    canSeeAllOrganizations
      ? readAllOrgProgress(user.wardId, asOf, supabase)
      : Promise.resolve(null),
    readPageView(user.id, "visits", supabase),
  ]);

  const sharingSentence = describeVisitSharingForReader(
    isBishopric,
    organizations
      .filter((organization) => sharedOrgIds.includes(organization.id))
      .map((organization) => organization.name),
  );

  const visibleTabs = visibleVisitsTabs({ isBishopric, canManageSharing });
  const storedVisitsView = parseVisitsView(storedView);
  // "Log this visit" lands on the Households tab whatever was left open, because that is where
  // the form opens.
  const requestedTab =
    appointmentPrefill === undefined ? parseVisitsTabParam(params.tab) : "households";
  const initialView = {
    ...storedVisitsView,
    tab: initialVisitsTab(storedVisitsView.tab, visibleTabs, requestedTab),
  };
  const from = Array.isArray(params.from) ? params.from[0] : params.from;

  return (
    <div className="flex flex-col gap-4">
      <ContextualBackLink from={from} />

      <div>
        <p className="text-sm text-muted">People &amp; Care</p>
        <h1 className="font-display text-xl font-semibold text-foreground">Visits</h1>
        <p className="mt-1 text-sm text-muted">
          Every visit carries shared notes the other leaders read, and private notes only you can
          ever see.
        </p>
      </div>

      {/* bv6 puts pending visit invites here, above the tabs whatever tab is open (prototype). */}

      <VisitsScreen
        visibleTabs={visibleTabs}
        initialView={initialView}
        households={{
          initialProgress,
          organizations: progressOrganizations,
          editableOrgId: isBishopric ? null : user.orgId,
          canManageGoals,
          canLog,
          user,
          goals,
          goalOrganizations: organizationOptions,
          householdOptions,
          stewardshipHouseholds,
          initialStewardship: initialStewardshipPayload,
          appointments: appointmentRows,
          householdContacts,
          wardTimeZone,
          today,
          wardToday,
          showsPastGoals: visibleTabs.includes("goal_history"),
          leaders,
          memberNames,
          appointmentPrefill,
          recentVisits: <RecentVisits visits={visits} canLog={canLog} user={user} />,
          assignments: householdAssignments,
        }}
        feed={{ initialPage: feedPage, ownOrganizationId: user.orgId, sharingSentence }}
        allOrganizations={allOrganizations}
        goalHistory={goalHistory}
        myVisits={
          !isBishopric
            ? null
            : {
                rows: myVisitRows,
                asOf: asOf.toISOString(),
                canLog,
                user,
                householdOptions,
                householdContacts,
                appointments: appointmentRows,
                wardTimeZone,
                today,
                leaders,
                memberNames,
              }
        }
        sharing={
          canManageSharing
            ? {
                organizations: organizations.map((organization) => ({
                  id: organization.id,
                  name: organization.name,
                  type: organization.type,
                })),
                initialGrants: sharingGrants,
              }
            : null
        }
      />
    </div>
  );
}

// THE ONLY PLACE A WHOLE SHARED NOTE IS READABLE, and the only place VisitFlagButton renders.
// Every visit this reader may see, Bishopric visits included, whichever organization is selected.
function RecentVisits({
  visits,
  canLog,
  user,
}: {
  visits: VisitLogWithContext[];
  canLog: boolean;
  user: SessionUser;
}) {
  if (visits.length === 0) return <p className="text-sm text-muted">No visits logged yet.</p>;

  return (
    <ul className="flex flex-col gap-2">
      {visits.map((visit) => (
        <li key={visit.id} className="rounded-lg border border-border bg-surface-raised px-3 py-2">
          <p className="py-1 text-sm font-medium text-foreground">
            {visit.householdName ?? "Unknown household"}
          </p>

          {/* Anything short of done carries the attention colour: an attempt, or a visit that
              still needs another, that reads like a finished visit is worse than no record. */}
          <p className="text-xs text-muted">
            {visit.visitDate} · {VISIT_TYPE_LABELS[visit.visitType]} ·{" "}
            {/* A call is neither booked nor dropped in on, though the column must hold one of the
                two (defect 100-D2), so a call shows no arrangement. */}
            {visit.visitType === "phone" ? null : <>{VISIT_ARRANGEMENT_LABELS[visit.arrangement]} · </>}
            <span
              className={`font-medium ${isDoneVisit(visit) ? "text-success" : "text-warning"}`}
            >
              {describeVisitOutcome(visit)}
            </span>
          </p>

          {/* Both roles, never a fallback from one to the other; the verb follows the outcome. */}
          <p className="text-xs text-foreground">
            {visit.conductedByLabel === null
              ? VISIT_NOBODY_RECORDED[visit.outcome]
              : `${VISIT_CONDUCTED_PREFIX[visit.outcome]} ${visit.conductedByLabel}`}
            {visit.recordedByName === null ? null : (
              <span className="text-muted"> · Recorded by {visit.recordedByName}</span>
            )}
          </p>

          {/* Shared notes, and only ever shared notes: VisitLogWithContext has no private field. */}
          {visit.sharedNotes === null ? null : (
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{visit.sharedNotes}</p>
          )}

          {visit.flaggedForWardCouncil ? (
            <p className="mt-1 text-xs font-medium text-warning">Flagged for ward council</p>
          ) : null}

          {/* canManageVisitLog() mirrors visit_logs_update, so the button is absent exactly where
              the policy would refuse the write (found walking scenario 042). */}
          {canLog && canManageVisitLog(user, visit.orgId) ? (
            <div className="mt-1">
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
  );
}
