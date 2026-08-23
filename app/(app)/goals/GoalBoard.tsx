"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { GoalStatusBadge } from "@/components/goals/GoalStatusBadge";
import { Input } from "@/components/ui/Input";
// Type-only, so nothing from the server-only module survives the build (roster-b).
import type { GoalWithStatus } from "@/lib/goals/queries";
import { compareGoalsByStatus } from "@/lib/goals/goalStatus";
import {
  CREATABLE_GOAL_TARGET_TYPES,
  MAX_FREQUENCY_MONTHS,
  type CreatableGoalTargetType,
} from "@/lib/validation/goal";
import { GOAL_TARGET_TYPES, type GoalTargetType } from "@/types/domain";

export const GOALS_QUERY_KEY = "goals";

export type GoalTargetOption = { id: string; label: string };

export type GoalTargetOptions = Record<CreatableGoalTargetType, GoalTargetOption[]>;

export type GoalBoardProps = {
  initialGoals: GoalWithStatus[];
  targetOptions: GoalTargetOptions;
  canManage: boolean;
};

const TARGET_TYPE_LABELS: Record<GoalTargetType, string> = {
  member: "Member",
  household: "Household",
  org: "Organization",
  group: "Group",
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

type Filters = { targetType: GoalTargetType | "all" };

type GoalDraft = {
  title: string;
  // Never "group". `group` is readable but not creatable (lib/validation/goal.ts), so the draft
  // cannot hold a value the schema would refuse on save.
  targetType: CreatableGoalTargetType | "none";
  targetId: string;
  desiredFrequencyMonths: string;
  notes: string;
};

const EMPTY_DRAFT: GoalDraft = {
  title: "",
  targetType: "none",
  targetId: "",
  desiredFrequencyMonths: "12",
  notes: "",
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

// The parameter name is `targetType`, checked against app/api/goals/route.ts rather than assumed.
// A name that handler does not read is silently IGNORED (roster-b).
async function fetchGoals(filters: Filters): Promise<GoalWithStatus[]> {
  const params = new URLSearchParams();
  if (filters.targetType !== "all") params.set("targetType", filters.targetType);

  const query = params.toString();
  const response = await fetch(query === "" ? "/api/goals" : `/api/goals?${query}`);
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Could not load the goals.",
    );
  }

  return (payload.goals ?? []) as GoalWithStatus[];
}

// Turns the draft into the request body the schema expects, or returns a message. The number
// conversion happens HERE rather than in the input, because an empty box is not NaN months — it
// is a question the person has not answered yet.
function toRequestBody(draft: GoalDraft): { body: Record<string, unknown> } | { error: string } {
  const months = Number(draft.desiredFrequencyMonths);

  if (!Number.isInteger(months) || months < 1 || months > MAX_FREQUENCY_MONTHS) {
    return {
      error: `Give the frequency as a whole number of months, 1 to ${MAX_FREQUENCY_MONTHS}.`,
    };
  }

  if (draft.targetType !== "none" && draft.targetId === "") {
    return { error: "Choose which one this goal is about, or set the target to none." };
  }

  return {
    body: {
      title: draft.title,
      targetType: draft.targetType === "none" ? null : draft.targetType,
      targetId: draft.targetType === "none" ? null : draft.targetId,
      desiredFrequencyMonths: months,
      notes: draft.notes.trim() === "" ? null : draft.notes,
    },
  };
}

export function GoalBoard({ initialGoals, targetOptions, canManage }: GoalBoardProps) {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Filters>({ targetType: "all" });
  const [draft, setDraft] = useState<GoalDraft>(EMPTY_DRAFT);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  // Not memoised: TanStack Query hashes the key structurally, so a fresh object each render is
  // the same key (roster-b).
  const goalsQuery = useQuery({
    queryKey: [GOALS_QUERY_KEY, filters.targetType],
    queryFn: () => fetchGoals(filters),
    // The server render seeded the DEFAULT filter only. Any other value is a real fetch, so
    // seeding it here would show the wrong list for a moment.
    initialData: filters.targetType === "all" ? initialGoals : undefined,
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: [GOALS_QUERY_KEY] });
  }

  // Returns a MESSAGE on failure and null on success.
  async function send(
    url: string,
    method: "POST" | "PATCH",
    body: unknown,
    fallback: string,
  ): Promise<string | null> {
    setIsSaving(true);

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        return typeof payload.error === "string" ? payload.error : fallback;
      }

      // The refetch is what makes a fulfilled goal move buckets with no reload: status is
      // computed on the server from the new last_fulfilled_at, never patched in place here.
      await refresh();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : fallback;
    } finally {
      setIsSaving(false);
    }
  }

  async function submitDraft(goalId: string | null): Promise<void> {
    setErrorMessage(undefined);

    const prepared = toRequestBody(draft);

    if ("error" in prepared) {
      setErrorMessage(prepared.error);
      return;
    }

    const failure =
      goalId === null
        ? await send("/api/goals", "POST", prepared.body, "Could not create that goal.")
        : await send(
            `/api/goals/${goalId}`,
            "PATCH",
            { action: "update", ...prepared.body },
            "Could not save that goal.",
          );

    if (failure !== null) {
      setErrorMessage(failure);
      return;
    }

    setDraft(EMPTY_DRAFT);
    setIsAdding(false);
    setEditingId(null);
  }

  async function fulfill(goalId: string): Promise<void> {
    setErrorMessage(undefined);

    const failure = await send(
      `/api/goals/${goalId}`,
      "PATCH",
      { action: "fulfill" },
      "Could not record that goal as fulfilled.",
    );

    if (failure !== null) setErrorMessage(failure);
  }

  function startEditing(goal: GoalWithStatus): void {
    setErrorMessage(undefined);
    setIsAdding(false);
    setEditingId(goal.id);
    setDraft({
      title: goal.title,
      // `group` is readable but not creatable (lib/validation/goal.ts), so an existing group goal
      // opens with no target rather than with a value the schema would reject on save.
      targetType:
        goal.targetType === null || goal.targetType === "group" ? "none" : goal.targetType,
      targetId: goal.targetType === "group" ? "" : (goal.targetId ?? ""),
      desiredFrequencyMonths: String(goal.desiredFrequencyMonths ?? 12),
      notes: goal.notes ?? "",
    });
  }

  const goals = [...(goalsQuery.data ?? [])].sort(compareGoalsByStatus);
  const queryError = goalsQuery.error instanceof Error ? goalsQuery.error.message : undefined;

  const draftOptions: GoalTargetOption[] =
    draft.targetType === "none" ? [] : (targetOptions[draft.targetType] ?? []);

  const form = (
    <div className="flex flex-col gap-3">
      <Input
        id="goal-title"
        label="Goal"
        value={draft.title}
        maxLength={160}
        onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
        placeholder="Every quorum presidency speaks once a year"
      />

      <div className="flex flex-col gap-3 md:flex-row">
        <label
          htmlFor="goal-target-type"
          className="flex flex-col gap-1 text-sm font-medium text-foreground"
        >
          This goal is about
          <select
            id="goal-target-type"
            value={draft.targetType}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                targetType: event.target.value as CreatableGoalTargetType | "none",
                targetId: "",
              }))
            }
            className={SELECT_CLASSES}
          >
            <option value="none">The whole ward</option>
            {CREATABLE_GOAL_TARGET_TYPES.map((targetType) => (
              <option key={targetType} value={targetType}>
                {TARGET_TYPE_LABELS[targetType]}
              </option>
            ))}
          </select>
        </label>

        {draft.targetType !== "none" && (
          <label
            htmlFor="goal-target-id"
            className="flex flex-col gap-1 text-sm font-medium text-foreground"
          >
            Which one
            <select
              id="goal-target-id"
              value={draft.targetId}
              onChange={(event) =>
                setDraft((current) => ({ ...current, targetId: event.target.value }))
              }
              className={SELECT_CLASSES}
            >
              <option value="">Choose one</option>
              {draftOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <Input
        id="goal-frequency"
        label="How often, in months"
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_FREQUENCY_MONTHS}
        value={draft.desiredFrequencyMonths}
        onChange={(event) =>
          setDraft((current) => ({ ...current, desiredFrequencyMonths: event.target.value }))
        }
      />

      <label htmlFor="goal-notes" className="flex flex-col gap-1 text-sm font-medium text-foreground">
        Notes
        <textarea
          id="goal-notes"
          value={draft.notes}
          maxLength={2000}
          rows={3}
          onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          className="rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={isSaving} onClick={() => submitDraft(editingId)}>
          {editingId === null ? "Add the goal" : "Save"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setIsAdding(false);
            setEditingId(null);
            setDraft(EMPTY_DRAFT);
            setErrorMessage(undefined);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <label
          htmlFor="goal-filter-target"
          className="flex flex-col gap-1 self-start text-sm font-medium text-foreground"
        >
          Showing
          <select
            id="goal-filter-target"
            value={filters.targetType}
            onChange={(event) =>
              setFilters({ targetType: event.target.value as GoalTargetType | "all" })
            }
            className={SELECT_CLASSES}
          >
            <option value="all">Every goal</option>
            {GOAL_TARGET_TYPES.map((targetType) => (
              <option key={targetType} value={targetType}>
                {TARGET_TYPE_LABELS[targetType]}
              </option>
            ))}
          </select>
        </label>

        <FormError message={errorMessage ?? queryError} />

        {canManage && !isAdding && editingId === null && (
          <Button
            type="button"
            className="self-start"
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setIsAdding(true);
            }}
          >
            Add a goal
          </Button>
        )}

        {canManage && isAdding && (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-foreground">Add a goal</h2>
            {form}
          </Card>
        )}
      </div>

      {goals.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            {filters.targetType === "all"
              ? "No goals yet."
              : "No goals with that kind of target."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {goals.map((goal) => (
            <li key={goal.id}>
              <Card>
                {editingId === goal.id ? (
                  form
                ) : (
                  <>
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h2 className="text-sm font-semibold text-foreground">{goal.title}</h2>
                      <GoalStatusBadge status={goal.status} />
                      {/* Who OWNS the goal, which a bishopric viewer needs because they are the
                          only role that sees more than one organization's board at once. A
                          ward-level goal shows nothing rather than "None" — for the bishopric,
                          who see every goal, an unlabelled one IS the ward-level one. */}
                      {goal.ownerName && (
                        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted">
                          {goal.ownerName}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-sm text-muted">
                      {goal.targetType === null ? (
                        "The whole ward"
                      ) : goal.targetLabel === null ? (
                        // A polymorphic target carries no foreign key (migration 010), so a
                        // deleted household leaves a goal pointing at nothing. Saying so is the
                        // honest answer; a blank row reads as a rendering fault.
                        <span className="text-warning">
                          {TARGET_TYPE_LABELS[goal.targetType]} — this record no longer exists
                        </span>
                      ) : (
                        `${TARGET_TYPE_LABELS[goal.targetType]}: ${goal.targetLabel}`
                      )}
                      {goal.desiredFrequencyMonths !== null &&
                        ` · every ${goal.desiredFrequencyMonths} ${
                          goal.desiredFrequencyMonths === 1 ? "month" : "months"
                        }`}
                    </p>

                    <p className="mt-1 text-sm text-muted">
                      {goal.lastFulfilledAt === null
                        ? "Never marked fulfilled"
                        : `Last fulfilled ${goal.lastFulfilledAt.slice(0, 10)}`}
                    </p>

                    {goal.notes && <p className="mt-2 text-sm text-muted">{goal.notes}</p>}

                    {canManage && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" disabled={isSaving} onClick={() => fulfill(goal.id)}>
                          Mark fulfilled
                          <span className="sr-only"> {goal.title}</span>
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => startEditing(goal)}
                        >
                          Edit
                          <span className="sr-only"> {goal.title}</span>
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
