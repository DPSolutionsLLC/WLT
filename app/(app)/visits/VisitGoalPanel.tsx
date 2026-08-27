"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { VISIT_PROGRESS_QUERY_KEY } from "@/app/(app)/visits/VisitProgressTable";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { compareCadences, describeCadence, type Cadence } from "@/lib/visits/cadence";
// Type-only, so nothing from the server-only module survives the build
// (plans/retros/roster-b-picker-and-orgs.md).
import type { VisitGoal } from "@/lib/visits/queries";
import { MAX_CADENCE_BY_UNIT } from "@/lib/validation/visit";
import { CADENCE_UNITS, CADENCE_UNIT_LABELS, type CadenceUnit } from "@/types/domain";

export type OrganizationOption = { id: string; label: string };

export type VisitGoalPanelProps = {
  goals: VisitGoal[];
  organizations: OrganizationOption[];
  // Resolved ONCE on the server and passed down. A client component never re-derives a
  // permission — it has no role access to resolve it against, and a second answer that
  // disagreed with the route's would be a UI that offers a control the API refuses.
  canManage: boolean;
  // Null for a bishopric member, who has to choose which organization the goal is for.
  ownOrgId: string | null;
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

type Draft = {
  title: string;
  orgId: string;
  cadenceAmount: string;
  cadenceUnit: CadenceUnit;
  noticeAmount: string;
  noticeUnit: CadenceUnit;
  deadline: string;
};

// A NEW goal defaults to the rolling shape, because that is the shape now (ITER-018 part 1).
// Every year, warning two months ahead — which is what the outgoing `annual` cadence plus
// DUE_SOON_FRACTION = 0.8 produced, so a ward creating its first goal after this change gets the
// behaviour it would have got before it.
const EMPTY_DRAFT: Omit<Draft, "orgId"> = {
  title: "",
  cadenceAmount: "1",
  cadenceUnit: "year",
  noticeAmount: "2",
  noticeUnit: "month",
  deadline: "",
};

function organizationName(
  organizations: OrganizationOption[],
  orgId: string | null,
): string {
  if (orgId === null) return "Ward";
  return organizations.find((organization) => organization.id === orgId)?.label ?? "Unknown";
}

// "Every year · warns 2 months ahead", plus "· by 2026-12-24" only when a deadline is set.
//
// The old line ended "{start} to {end}". There is no period any more, so a line naming two dates
// would be describing something that no longer exists — and the deadline is genuinely optional,
// so printing "?" for an absent one would invent an absence rather than report it.
function goalSummaryLine(goal: VisitGoal, organizations: OrganizationOption[]): string {
  const parts = [organizationName(organizations, goal.orgId)];

  parts.push(goal.cadence === null ? "No cadence set" : describeCadence(goal.cadence));

  if (goal.notice !== null) {
    parts.push(`warns ${describeCadence(goal.notice).replace(/^Every /, "")} ahead`);
  }

  if (goal.deadline !== null) {
    parts.push(`by ${goal.deadline}`);
  }

  return parts.join(" · ");
}

function draftFromGoal(goal: VisitGoal): Draft {
  return {
    title: goal.title ?? "",
    orgId: goal.orgId ?? "",
    cadenceAmount: String(goal.cadence?.amount ?? 1),
    cadenceUnit: goal.cadence?.unit ?? "year",
    noticeAmount: String(goal.notice?.amount ?? 2),
    noticeUnit: goal.notice?.unit ?? "month",
    deadline: goal.deadline ?? "",
  };
}

// Reads an amount field into a Cadence, or null when it is not a whole number inside this unit's
// ceiling. Null is the caller's cue to show a message naming the field.
function readCadence(amount: string, unit: CadenceUnit): Cadence | null {
  const value = Number(amount);

  if (!Number.isInteger(value) || value < 1 || value > MAX_CADENCE_BY_UNIT[unit]) {
    return null;
  }

  return { amount: value, unit };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

// Each organization sets and tracks its OWN goals (FEATURES.md §Module 9). The bishopric
// configures any of them; an org president or counselor configures their own; an org SECRETARY
// reads and cannot write.
//
// That last distinction is not made here by comparing a role string. `canManage` arrives from
// can(user, "visits.manage_goals", roleAccess) on the server, which is the only reading that
// honours the ward's role_access override (plans/retros/role-access-overrides.md). Hiding the
// form is a courtesy; the route's assertCan is the boundary.
//
// ONE FORM, TWO MODES, distinguished by `editingGoalId` — following HouseholdForm's `isEditing`
// shape rather than inventing a second one. Until this slice there was no edit path for a visit
// goal anywhere in the app, even though the route and updateVisitGoal() have both existed since
// visits-a; a ward that changed its mind had to stack a second goal on top of the first.
export function VisitGoalPanel({
  goals,
  organizations,
  canManage,
  ownOrgId,
}: VisitGoalPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const emptyDraft: Draft = { ...EMPTY_DRAFT, orgId: ownOrgId ?? "" };

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [open, setOpen] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const isEditing = editingGoalId !== null;

  function update<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function startCreating(): void {
    setError(undefined);
    setEditingGoalId(null);
    setDraft(emptyDraft);
    setOpen(true);
  }

  function startEditing(goal: VisitGoal): void {
    setError(undefined);
    setEditingGoalId(goal.id);
    setDraft(draftFromGoal(goal));
    setOpen(true);
  }

  function close(): void {
    setOpen(false);
    setEditingGoalId(null);
    setDraft(emptyDraft);
    setError(undefined);
  }

  async function submit(): Promise<void> {
    setError(undefined);

    // The organization is only ever chosen when CREATING. `org_id` is not patchable, and the
    // select below is disabled while editing for exactly that reason.
    if (!isEditing && draft.orgId === "") {
      setError("Choose which organization this goal belongs to.");
      return;
    }

    const cadence = readCadence(draft.cadenceAmount, draft.cadenceUnit);

    if (cadence === null) {
      setError(
        `Give the cadence as a whole number, 1 to ${MAX_CADENCE_BY_UNIT[draft.cadenceUnit]} ` +
          `${draft.cadenceUnit}s.`,
      );
      return;
    }

    const notice = readCadence(draft.noticeAmount, draft.noticeUnit);

    if (notice === null) {
      setError(
        `Give the warning window as a whole number, 1 to ` +
          `${MAX_CADENCE_BY_UNIT[draft.noticeUnit]} ${draft.noticeUnit}s.`,
      );
      return;
    }

    // THE SAME COMPARISON THE SCHEMA RUNS, using the same function
    // (conventions.md §Validation). If the two diverged the form would accept what the server
    // rejects, and the user would get a failure with no field to fix. compareCadences() rather
    // than a day conversion, because 2 months and 60 days are not the same length.
    if (compareCadences(notice, cadence) >= 0) {
      setError(
        "The warning has to start inside the interval, so it must be shorter than the cadence.",
      );
      return;
    }

    setSaving(true);

    try {
      const deadline = draft.deadline === "" ? null : draft.deadline;

      const body = isEditing
        ? {
            title: draft.title,
            cadenceAmount: cadence.amount,
            cadenceUnit: cadence.unit,
            noticeAmount: notice.amount,
            noticeUnit: notice.unit,
            deadline,
          }
        : {
            title: draft.title,
            orgId: draft.orgId,
            targetType: "all_households",
            cadenceAmount: cadence.amount,
            cadenceUnit: cadence.unit,
            noticeAmount: notice.amount,
            noticeUnit: notice.unit,
            deadline,
          };

      const response = await fetch(
        isEditing ? `/api/visit-goals/${editingGoalId}` : "/api/visit-goals",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const payload = await readJson(response);

      if (!response.ok) {
        setError(
          typeof payload.error === "string" ? payload.error : "Could not save that goal.",
        );
        return;
      }

      close();

      // BOTH, because they refresh different things. router.refresh() re-renders the Server
      // Component so this panel lists the saved goal; the invalidation is what makes the progress
      // dashboard above recompute against the cadence that just changed.
      //
      // The seeded `initialData` on that query cannot do it: TanStack reads initialData once, on
      // first mount, so a fresh server payload arriving as a new prop would be ignored and the
      // statistics would keep counting against the OLD interval until a full reload. That is the
      // bug visits-b shipped twice, and the edit path is a third way to reach it.
      router.refresh();
      await queryClient.invalidateQueries({ queryKey: [VISIT_PROGRESS_QUERY_KEY] });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Visit goals</h2>
        {canManage ? (
          <Button variant="secondary" onClick={() => (open ? close() : startCreating())}>
            {open ? "Cancel" : "Set a goal"}
          </Button>
        ) : (
          // Said out loud rather than left as an absent button. A secretary who cannot find the
          // control needs to know it is a role boundary, not a page that failed to load.
          <p className="text-sm text-muted">View only — your role does not set goals.</p>
        )}
      </div>

      {goals.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No visit goals yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {goals.map((goal) => (
            <li key={goal.id} className="rounded-md border border-border bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {goal.title ?? "Untitled goal"}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {goalSummaryLine(goal, organizations)}
                  </p>
                </div>

                {canManage ? (
                  <Button variant="secondary" onClick={() => startEditing(goal)}>
                    {editingGoalId === goal.id ? "Editing" : "Edit"}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && open ? (
        <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">
            {isEditing ? "Editing this goal" : "New goal"}
          </p>

          <Input
            id="goal-title"
            label="Title"
            value={draft.title}
            onChange={(event) => update("title", event.target.value)}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="goal-org" className="text-sm font-medium text-foreground">
              Organization
            </label>
            <select
              id="goal-org"
              className={SELECT_CLASSES}
              value={draft.orgId}
              // Disabled while EDITING for everyone, the bishopric included, because `org_id` is
              // not patchable (app/api/visit-goals/[id]/route.ts). Offering a control the route
              // refuses is worse than not offering it.
              disabled={isEditing || ownOrgId !== null}
              onChange={(event) => update("orgId", event.target.value)}
            >
              <option value="">Choose an organization…</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.label}
                </option>
              ))}
            </select>
            {isEditing ? (
              <p className="text-sm text-muted">
                A goal cannot be moved between organizations. Create a new one instead.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Visit every</span>
            <div className="flex gap-2">
              <Input
                id="goal-cadence-amount"
                label="How many"
                type="number"
                min={1}
                max={MAX_CADENCE_BY_UNIT[draft.cadenceUnit]}
                value={draft.cadenceAmount}
                onChange={(event) => update("cadenceAmount", event.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="goal-cadence-unit"
                  className="text-sm font-medium text-foreground"
                >
                  Unit
                </label>
                <select
                  id="goal-cadence-unit"
                  className={SELECT_CLASSES}
                  value={draft.cadenceUnit}
                  onChange={(event) =>
                    update("cadenceUnit", event.target.value as CadenceUnit)
                  }
                >
                  {CADENCE_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {CADENCE_UNIT_LABELS[unit].many}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Start warning</span>
            <div className="flex gap-2">
              <Input
                id="goal-notice-amount"
                label="How many"
                type="number"
                min={1}
                max={MAX_CADENCE_BY_UNIT[draft.noticeUnit]}
                value={draft.noticeAmount}
                onChange={(event) => update("noticeAmount", event.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="goal-notice-unit"
                  className="text-sm font-medium text-foreground"
                >
                  Unit
                </label>
                <select
                  id="goal-notice-unit"
                  className={SELECT_CLASSES}
                  value={draft.noticeUnit}
                  onChange={(event) =>
                    update("noticeUnit", event.target.value as CadenceUnit)
                  }
                >
                  {CADENCE_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {CADENCE_UNIT_LABELS[unit].many}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-sm text-muted">
              Before a household is due. It has to be shorter than the cadence — a warning as
              long as the cadence would mark every household as approaching.
            </p>
          </div>

          <Input
            id="goal-deadline"
            label="Deadline (optional)"
            type="date"
            value={draft.deadline}
            onChange={(event) => update("deadline", event.target.value)}
          />
          <p className="-mt-2 text-sm text-muted">
            A date to aim to have got round everybody by. It is shown on the dashboard and
            changes no number.
          </p>

          <FormError message={error} />

          <div className="flex gap-2">
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? "Saving…" : isEditing ? "Save changes" : "Save goal"}
            </Button>
            <Button variant="secondary" onClick={close} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
