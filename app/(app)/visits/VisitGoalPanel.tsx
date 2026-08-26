"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { VISIT_PROGRESS_QUERY_KEY } from "@/app/(app)/visits/VisitProgressTable";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
// Type-only, so nothing from the server-only module survives the build
// (plans/retros/roster-b-picker-and-orgs.md).
import type { VisitGoal } from "@/lib/visits/queries";
import { MAX_CADENCE_MONTHS } from "@/lib/validation/visit";
import { VISIT_CADENCES, VISIT_CADENCE_LABELS, type VisitCadence } from "@/types/domain";

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
  cadence: VisitCadence;
  cadenceMonths: string;
  goalPeriodStart: string;
  goalPeriodEnd: string;
};

function organizationName(
  organizations: OrganizationOption[],
  orgId: string | null,
): string {
  if (orgId === null) return "Ward";
  return organizations.find((organization) => organization.id === orgId)?.label ?? "Unknown";
}

function cadenceLabel(goal: VisitGoal): string {
  if (goal.cadence === null) return "No cadence set";
  if (goal.cadence === "custom") {
    return goal.cadenceMonths === null
      ? "Every so many months"
      : `Every ${goal.cadenceMonths} months`;
  }
  return VISIT_CADENCE_LABELS[goal.cadence];
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
export function VisitGoalPanel({
  goals,
  organizations,
  canManage,
  ownOrgId,
}: VisitGoalPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const emptyDraft: Draft = {
    title: "",
    orgId: ownOrgId ?? "",
    cadence: "annual",
    cadenceMonths: "",
    goalPeriodStart: "",
    goalPeriodEnd: "",
  };

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(): Promise<void> {
    setError(undefined);

    if (draft.orgId === "") {
      setError("Choose which organization this goal belongs to.");
      return;
    }

    if (draft.goalPeriodStart === "" || draft.goalPeriodEnd === "") {
      setError("Give the goal a start and an end date.");
      return;
    }

    if (draft.goalPeriodEnd <= draft.goalPeriodStart) {
      setError("The goal period has to end after it starts.");
      return;
    }

    // Sent only for a custom cadence. `annual` and `biannual` already carry their own interval
    // (lib/validation/visit.ts §CADENCE_MONTHS), and sending a number alongside one of them is
    // refused rather than quietly ignored — two sources of truth for one interval.
    let cadenceMonths: number | null = null;

    if (draft.cadence === "custom") {
      const months = Number(draft.cadenceMonths);

      if (!Number.isInteger(months) || months < 1 || months > MAX_CADENCE_MONTHS) {
        setError(`Give the cadence as a whole number of months, 1 to ${MAX_CADENCE_MONTHS}.`);
        return;
      }

      cadenceMonths = months;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/visit-goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          orgId: draft.orgId,
          targetType: "all_households",
          cadence: draft.cadence,
          cadenceMonths,
          goalPeriodStart: draft.goalPeriodStart,
          goalPeriodEnd: draft.goalPeriodEnd,
        }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        setError(
          typeof payload.error === "string" ? payload.error : "Could not save that goal.",
        );
        return;
      }

      setDraft(emptyDraft);
      setOpen(false);

      // BOTH, because they refresh different things. router.refresh() re-renders the Server
      // Component so this panel lists the new goal; the invalidation is what makes the progress
      // dashboard above recompute against the cadence that just changed.
      //
      // The seeded `initialData` on that query cannot do it: TanStack reads initialData once, on
      // first mount, so a fresh server payload arriving as a new prop would be ignored and the
      // banner would keep counting against the OLD interval until a full reload.
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
          <Button variant="secondary" onClick={() => setOpen((current) => !current)}>
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
              <p className="text-sm font-medium text-foreground">
                {goal.title ?? "Untitled goal"}
              </p>
              <p className="mt-1 text-sm text-muted">
                {organizationName(organizations, goal.orgId)} · {cadenceLabel(goal)} ·{" "}
                {goal.goalPeriodStart ?? "?"} to {goal.goalPeriodEnd ?? "?"}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canManage && open ? (
        <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
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
              disabled={ownOrgId !== null}
              onChange={(event) => update("orgId", event.target.value)}
            >
              <option value="">Choose an organization…</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="goal-cadence" className="text-sm font-medium text-foreground">
              Cadence
            </label>
            <select
              id="goal-cadence"
              className={SELECT_CLASSES}
              value={draft.cadence}
              onChange={(event) => update("cadence", event.target.value as VisitCadence)}
            >
              {VISIT_CADENCES.map((cadence) => (
                <option key={cadence} value={cadence}>
                  {VISIT_CADENCE_LABELS[cadence]}
                </option>
              ))}
            </select>
          </div>

          {draft.cadence === "custom" ? (
            <Input
              id="goal-cadence-months"
              label="Months between visits"
              type="number"
              min={1}
              max={MAX_CADENCE_MONTHS}
              value={draft.cadenceMonths}
              onChange={(event) => update("cadenceMonths", event.target.value)}
            />
          ) : null}

          <Input
            id="goal-period-start"
            label="Period starts"
            type="date"
            value={draft.goalPeriodStart}
            onChange={(event) => update("goalPeriodStart", event.target.value)}
          />

          <Input
            id="goal-period-end"
            label="Period ends"
            type="date"
            value={draft.goalPeriodEnd}
            onChange={(event) => update("goalPeriodEnd", event.target.value)}
          />

          <FormError message={error} />

          <div>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? "Saving…" : "Save goal"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
