"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppointmentPanel, type AppointmentRow } from "@/app/(app)/visits/AppointmentPanel";
import { AssignWindow } from "@/app/(app)/visits/AssignWindow";
import { ContactPanel, type HouseholdContact } from "@/app/(app)/visits/ContactPanel";
import { HouseholdCadenceControl } from "@/app/(app)/visits/HouseholdCadenceControl";
import { HouseholdPriorityCard } from "@/app/(app)/visits/HouseholdPriorityCard";
import { VISIT_PROGRESS_QUERY_KEY } from "@/app/(app)/visits/progressQueryKey";
import { StewardshipPanel, type StewardshipPayload } from "@/app/(app)/visits/StewardshipPanel";
import type { LeaderOption } from "@/app/(app)/visits/VisitParticipantsField";
import { VisitGoalPanel } from "@/app/(app)/visits/VisitGoalPanel";
import {
  VisitLogForm,
  type AppointmentPrefill,
  type HouseholdOption,
} from "@/app/(app)/visits/VisitLogForm";
import { VisitProgressBanner } from "@/app/(app)/visits/VisitProgressBanner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import {
  assignmentShares,
  bishopricCallingLabel,
  describeAssignmentShares,
  openAssigneeByHousehold,
  type BishopricMember,
} from "@/lib/visits/assignmentShares";
import { compareByPriority } from "@/lib/visits/householdStatus";
import { compareSweepStatus } from "@/lib/visits/sweep";
// Type-only, so nothing from the server-only module survives the build (roster-b).
import type { VisitProgress, VisitProgressRow } from "@/lib/visits/progress";
import {
  VISIT_HOUSEHOLD_SORTS,
  VISIT_HOUSEHOLD_SORT_LABELS,
  type VisitHouseholdSort,
} from "@/lib/visits/visitsView";
import type { VisitGoal } from "@/lib/visits/queries";
import type { SessionUser, VisitAssignment } from "@/types/domain";

// The Households tab of /visits (ITER-055 bv2): one organization's households as cards, in
// priority order, with the goal, the stewardship, appointments and logging a visit each in a
// window opened from a button above the list (the user's compact-UI rule).
//
// THE WINDOWS FOLLOW THE SELECTED ORGANIZATION (bv1 follow-up). A leader reading an organization
// the bishopric shared with theirs sees its goal and stewardship read-only — migration 099 widens
// reads and never writes, so offering a control there would offer a write the policy refuses.
//
// SORTING IS CLIENT-SIDE over the already-fetched rows; only the organization is a refetch.

type OpenWindow =
  | { kind: "log"; householdId?: string }
  | { kind: "goal" }
  | { kind: "stewardship" }
  | { kind: "appointments"; householdId?: string }
  | { kind: "contact"; row: VisitProgressRow }
  | { kind: "cadence"; row: VisitProgressRow }
  | { kind: "assign" }
  | null;

// The Bishopric's households divided among its three members (ITER-055 bv5). Present for the
// bishopric only; `goalId` is null when the Bishopric has no active goal, which is when nothing can
// be assigned.
export type HouseholdAssignments = {
  orgId: string;
  goalId: string | null;
  members: BishopricMember[];
  assignments: VisitAssignment[];
  canAssign: boolean;
};

export type HouseholdsPanelProps = {
  initialProgress: VisitProgress | null;
  organizations: { id: string; label: string }[];
  // Null for the bishopric, who may change every organization's goal, stewardship and cadences.
  editableOrgId: string | null;
  canManageGoals: boolean;
  canLog: boolean;
  user: SessionUser;
  sort: VisitHouseholdSort;
  onSortChange: (sort: VisitHouseholdSort) => void;
  goals: VisitGoal[];
  goalOrganizations: { id: string; label: string }[];
  householdOptions: HouseholdOption[];
  stewardshipHouseholds: { id: string; label: string }[];
  initialStewardship: StewardshipPayload | null;
  appointments: AppointmentRow[];
  // Each household's members and their phones, for the Contact window (ITER-055 bv3). Read through
  // the caller's own client, so RLS decides whose numbers are here.
  householdContacts: Record<string, HouseholdContact[]>;
  wardTimeZone: string;
  today: string;
  // The ward's date, for a new goal's default start (rule 12).
  wardToday: string;
  // The reader has the Past goals tab (bishopric only).
  showsPastGoals: boolean;
  leaders: LeaderOption[];
  memberNames: Record<string, string>;
  appointmentPrefill?: AppointmentPrefill;
  // Rendered by the server so this client file never touches a visit's notes query.
  recentVisits: ReactNode;
  assignments: HouseholdAssignments | null;
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

async function fetchProgress(orgId: string): Promise<VisitProgress> {
  const response = await fetch(`/api/visits/progress?orgId=${encodeURIComponent(orgId)}`);
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Could not load the visit progress.",
    );
  }

  return payload.progress as VisitProgress;
}

// A missing value always sorts last, so the households that have no date stay together.
function compareNullable(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortHouseholdRows(
  rows: readonly VisitProgressRow[],
  sort: VisitHouseholdSort,
): VisitProgressRow[] {
  const sorted = [...rows];

  sorted.sort((left, right) => {
    let order: number;

    // A sweep has no band (ITER-055 bv4): what is left to do comes first.
    if (sort === "priority") {
      order =
        left.sweep !== null || right.sweep !== null
          ? compareSweepStatus(left.sweep, right.sweep)
          : compareByPriority(left, right);
    }
    else if (sort === "familyName") order = left.familyName.localeCompare(right.familyName);
    else if (sort === "dueOn") {
      order = compareNullable(left.priority?.dueOn ?? null, right.priority?.dueOn ?? null);
    } else order = compareNullable(left[sort], right[sort]);

    return order === 0 ? left.familyName.localeCompare(right.familyName) : order;
  });

  return sorted;
}

export function HouseholdsPanel({
  initialProgress,
  organizations,
  editableOrgId,
  canManageGoals,
  canLog,
  user,
  sort,
  onSortChange,
  goals,
  goalOrganizations,
  householdOptions,
  stewardshipHouseholds,
  initialStewardship,
  appointments,
  householdContacts,
  wardTimeZone,
  today,
  wardToday,
  showsPastGoals,
  leaders,
  memberNames,
  appointmentPrefill,
  recentVisits,
  assignments,
}: HouseholdsPanelProps) {
  const [orgId, setOrgId] = useState<string | null>(initialProgress?.orgId ?? null);
  const [openWindow, setOpenWindow] = useState<OpenWindow>(
    appointmentPrefill === undefined ? null : { kind: "log" },
  );

  // An appointment's "Log this visit" is a client-side navigation to `?appointment=`, so this
  // component stays mounted and its initial state never re-runs. A new appointment opens the form.
  const [seenPrefillId, setSeenPrefillId] = useState(appointmentPrefill?.id);
  if (appointmentPrefill?.id !== seenPrefillId) {
    setSeenPrefillId(appointmentPrefill?.id);
    if (appointmentPrefill !== undefined) setOpenWindow({ kind: "log" });
  }

  const progressQuery = useQuery({
    queryKey: [VISIT_PROGRESS_QUERY_KEY, orgId],
    queryFn: () => fetchProgress(orgId!),
    enabled: orgId !== null,
    // The server rendered ONE organization; seeding another would show the wrong households.
    initialData: orgId === initialProgress?.orgId ? (initialProgress ?? undefined) : undefined,
  });

  const orgName = organizations.find((organization) => organization.id === orgId)?.label ?? null;
  const canEditSelected = editableOrgId === null || editableOrgId === orgId;
  const sharedReadOnly = orgId !== null && !canEditSelected;
  const canEditCadence = canManageGoals && canEditSelected;
  // A call or an appointment is recorded for the reader's own organization, so neither is offered
  // while a shared one is selected — the window still shows the phone numbers.
  const canContactAndBook = canLog && canEditSelected;

  const progress = progressQuery.data;
  const rows = progress === undefined ? [] : sortHouseholdRows(progress.rows, sort);
  // The server's own instant, never `new Date()`: every pill is judged against the moment the
  // bands were computed.
  const asOf = progress === undefined ? new Date(0) : new Date(progress.asOf);

  // Active goals only: an ended goal is on the Past goals tab (ITER-055 bv4).
  const activeGoals = goals.filter((goal) => goal.endedAt === null);
  const goalsShown =
    orgId === null ? activeGoals : activeGoals.filter((goal) => goal.orgId === orgId);
  const scheduledCount = appointments.filter((row) => row.status === "scheduled").length;
  // EACH WINDOW CLOSES ONLY ITSELF (defect 100-D1). Contact's "Schedule an appointment" swaps one
  // window for another; the browser then fires the Contact dialog's own `close` event, and a
  // plain `setOpenWindow(null)` there would shut the Appointments window that just replaced it.
  const closeWindow = (kind: NonNullable<OpenWindow>["kind"]) =>
    setOpenWindow((current) => (current?.kind === kind ? null : current));

  // THE BISHOPRIC'S HOUSEHOLDS ARE DIVIDED UP ONLY WHILE ITS GOAL IS ACTIVE (decided at bv5 start).
  const dividing =
    assignments !== null && assignments.goalId !== null && orgId === assignments.orgId
      ? assignments
      : null;
  const openAssignments =
    dividing === null ? [] : dividing.assignments.filter((assignment) => assignment.endedAt === null);
  const assigneeByHousehold = openAssigneeByHousehold(openAssignments);
  const memberById = new Map((dividing?.members ?? []).map((member) => [member.id, member]));
  const assigneeLabelFor = (householdId: string): string | undefined => {
    const userId = assigneeByHousehold.get(householdId);
    if (userId === undefined) return undefined;
    const member = memberById.get(userId);
    return member === undefined ? "a former member of the bishopric" : bishopricCallingLabel(member);
  };

  return (
    <div className="flex flex-col gap-4">
      {organizations.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="progress-org" className="text-sm font-medium text-foreground">
            Organization
          </label>
          <select
            id="progress-org"
            className={SELECT_CLASSES}
            value={orgId ?? ""}
            onChange={(event) => setOrgId(event.target.value)}
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {sharedReadOnly ? (
        <p className="text-sm text-muted">
          The bishopric has shared the {orgName ?? "this organization"}&rsquo;s visits with yours.
          You can read them here; only its own leaders change them.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canLog ? (
          <Button onClick={() => setOpenWindow({ kind: "log" })}>Log a visit</Button>
        ) : null}
        <Button variant="secondary" onClick={() => setOpenWindow({ kind: "goal" })}>
          Visit goal
        </Button>
        <Button variant="secondary" onClick={() => setOpenWindow({ kind: "stewardship" })}>
          Which households
        </Button>
        <Button variant="secondary" onClick={() => setOpenWindow({ kind: "appointments" })}>
          {scheduledCount === 0 ? "Appointments" : `Appointments · ${scheduledCount}`}
        </Button>
        {dividing?.canAssign === true ? (
          <Button variant="secondary" onClick={() => setOpenWindow({ kind: "assign" })}>
            Assign
          </Button>
        ) : null}
      </div>

      {orgId === null ? (
        <Card>
          <p className="text-sm text-muted">
            {editableOrgId === null
              ? "This ward has no organizations yet, so there is nothing to measure progress for."
              : "Your account is not attached to an organization, so there is no visit goal to " +
                "measure against. Ask a member of the bishopric to set your organization."}
          </p>
        </Card>
      ) : progress === undefined ? (
        <Card>
          <p className="text-sm text-muted">
            {progressQuery.isError ? "" : "Loading this organization's progress…"}
          </p>
          <FormError
            message={progressQuery.isError ? (progressQuery.error as Error).message : undefined}
          />
        </Card>
      ) : (
        <>
          <VisitProgressBanner
            statistics={progress.statistics}
            goal={progress.goal}
            goalHasNoCadence={progress.goalHasNoCadence}
            stewardship={progress.stewardship}
            sweep={progress.sweep}
            activeGoal={progress.activeGoal}
            excludedCount={progress.rows.filter((row) => row.doNotContact).length}
          />

          {dividing === null || dividing.assignments.length === 0 ? null : (
            <p className="text-sm text-muted">
              {describeAssignmentShares(assignmentShares(dividing.assignments, dividing.members))}
            </p>
          )}

          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-foreground">
              Households, by {VISIT_HOUSEHOLD_SORT_LABELS[sort].toLowerCase()}
            </h2>
            <label className="flex items-center gap-2 text-sm text-muted">
              Sort by
              <select
                className={SELECT_CLASSES}
                value={sort}
                onChange={(event) => onSortChange(event.target.value as VisitHouseholdSort)}
              >
                {VISIT_HOUSEHOLD_SORTS.map((option) => (
                  <option key={option} value={option}>
                    {VISIT_HOUSEHOLD_SORT_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-muted">
              No households with active members, so there is nothing to visit yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <HouseholdPriorityCard
                  key={row.householdId}
                  row={row}
                  asOf={asOf}
                  onContact={
                    row.doNotContact
                      ? undefined
                      : () => setOpenWindow({ kind: "contact", row })
                  }
                  onLogVisit={
                    canLog && !row.doNotContact
                      ? () => setOpenWindow({ kind: "log", householdId: row.householdId })
                      : undefined
                  }
                  onOpenCadence={
                    row.priority === null ? undefined : () => setOpenWindow({ kind: "cadence", row })
                  }
                  assigneeLabel={assigneeLabelFor(row.householdId)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-base font-semibold text-foreground">Recent visits</h2>
        {recentVisits}
      </section>

      <Modal isOpen={openWindow?.kind === "log"} onClose={() => closeWindow("log")} title="Log a visit">
        {openWindow?.kind === "log" ? (
          // A new key per opening re-runs the form's initializer, so a card's household or the
          // appointment being kept is what the form starts on.
          <VisitLogForm
            key={appointmentPrefill?.id ?? openWindow.householdId ?? "any-household"}
            households={householdOptions}
            today={today}
            user={user}
            leaders={leaders}
            memberNames={memberNames}
            appointment={openWindow.householdId === undefined ? appointmentPrefill : undefined}
            initialHouseholdId={openWindow.householdId}
          />
        ) : null}
      </Modal>

      <Modal
        isOpen={openWindow?.kind === "goal"}
        onClose={() => closeWindow("goal")}
        title={orgName === null ? "Visit goal" : `Visit goal — ${orgName}`}
      >
        {openWindow?.kind === "goal" ? (
          <VisitGoalPanel
            goals={goalsShown}
            organizations={orgId === null ? goalOrganizations : organizations}
            canManage={canManageGoals && canEditSelected}
            ownOrgId={orgId ?? user.orgId}
            today={wardToday}
            showsPastGoals={showsPastGoals}
            openAssignmentCounts={
              dividing === null || dividing.goalId === null
                ? {}
                : { [dividing.goalId]: openAssignments.length }
            }
          />
        ) : null}
      </Modal>

      <Modal isOpen={openWindow?.kind === "stewardship"} onClose={() => closeWindow("stewardship")} title="Which households are ours">
        {openWindow?.kind === "stewardship" ? (
          <StewardshipPanel
            orgId={orgId}
            orgName={orgName}
            canManageGoals={canManageGoals && canEditSelected}
            households={stewardshipHouseholds}
            initialStewardship={initialStewardship}
          />
        ) : null}
      </Modal>

      <Modal isOpen={openWindow?.kind === "appointments"} onClose={() => closeWindow("appointments")} title="Appointments">
        {openWindow?.kind === "appointments" ? (
          <AppointmentPanel
            key={openWindow.householdId ?? "any-household"}
            appointments={appointments}
            households={householdOptions}
            canBook={canLog}
            wardTimeZone={wardTimeZone}
            initialHouseholdId={openWindow.householdId}
          />
        ) : null}
      </Modal>

      <Modal
        isOpen={openWindow?.kind === "contact"}
        onClose={() => closeWindow("contact")}
        title={
          openWindow?.kind === "contact"
            ? `Contact — ${openWindow.row.familyName}`
            : "Contact"
        }
      >
        {openWindow?.kind === "contact" ? (
          <ContactPanel
            key={openWindow.row.householdId}
            householdId={openWindow.row.householdId}
            familyName={openWindow.row.familyName}
            contacts={householdContacts[openWindow.row.householdId] ?? []}
            canLog={canContactAndBook}
            today={today}
            onSchedule={
              canContactAndBook
                ? () =>
                    setOpenWindow({
                      kind: "appointments",
                      householdId: openWindow.row.householdId,
                    })
                : undefined
            }
          />
        ) : null}
      </Modal>

      <Modal isOpen={openWindow?.kind === "assign"} onClose={() => closeWindow("assign")} title="Assign households">
        {openWindow?.kind === "assign" && dividing !== null && progress !== undefined ? (
          <AssignWindow
            households={sortHouseholdRows(
              progress.rows.filter((row) => !row.doNotContact),
              "familyName",
            ).map((row) => ({ id: row.householdId, familyName: row.familyName }))}
            members={dividing.members}
            openAssignments={openAssignments}
            appointments={appointments}
            onDone={() => closeWindow("assign")}
          />
        ) : null}
      </Modal>

      <Modal
        isOpen={openWindow?.kind === "cadence"}
        onClose={() => closeWindow("cadence")}
        title={
          openWindow?.kind === "cadence"
            ? `How often — ${openWindow.row.familyName}`
            : "How often"
        }
      >
        {openWindow?.kind === "cadence" && openWindow.row.priority !== null && orgId !== null ? (
          <HouseholdCadenceControl
            householdId={openWindow.row.householdId}
            orgId={orgId}
            cadence={openWindow.row.priority.cadence}
            source={openWindow.row.priority.cadenceSource}
            canManage={canEditCadence}
            startOpen
            onSaved={() => closeWindow("cadence")}
          />
        ) : null}
      </Modal>
    </div>
  );
}
