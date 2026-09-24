"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, Pencil, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Pill, type PillTone } from "@/components/ui/Pill";
import { todoProgress } from "@/lib/todos/progress";
import { todoViewState } from "@/lib/todos/viewState";
import { MAX_STEP_LABEL } from "@/lib/validation/todo";
import { formatAppointmentInstant } from "@/lib/visits/visitDates";
import {
  MEETING_TYPE_LABELS,
  TODO_VIEW_STATE_LABELS,
  type SessionUser,
  type TodoStep,
  type TodoSummary,
  type TodoViewState,
} from "@/types/domain";
import { ScheduleDialog } from "@/app/(app)/todos/ScheduleDialog";
import { RemoveButton, SmallButton } from "@/app/(app)/todos/SmallButton";
import { TodoFormDialog } from "@/app/(app)/todos/TodoFormDialog";
import { TodoTimeline } from "@/app/(app)/todos/TodoTimeline";
import { TODO_DETAIL_QUERY_KEY, fetchTodoLog, sendTodoRequest } from "@/app/(app)/todos/todoApi";
import { useArmedRemoval } from "@/app/(app)/todos/useArmedRemoval";

// One to-do. Collapsed it shows only the result — title, where it stands, its dates and its
// progress — with a small grouped row of actions; tapping the body opens it in place to its steps
// and its timeline (compact-ui-preference; module-map §6.5: a flat list, not a jump target).
//
// PROGRESS APPEARS ONLY FOR A PROJECT. todoProgress() is null with zero steps, and a plain item
// shows nothing at all rather than "0/0". Adding the first step below is what makes it a project;
// there is no mode switch and no "convert" button.

// `do_date` and `due_date` are `date` columns — a day with no zone — so UTC, never the reader's
// zone, which would show the day before to anybody west of Greenwich (lib/calendar/dates.ts).
const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
});

function dayLabel(value: string): string {
  return DAY_LABEL.format(new Date(`${value}T00:00:00Z`));
}

const STATE_TONES: Record<TodoViewState, PillTone> = {
  overdue: "missing",
  due_today: "pending",
  do_today: "pending",
  upcoming: "neutral",
  someday: "neutral",
  done: "ok",
};

// WHERE AN ERROR RENDERS: beside the control that caused it (defect 075-D2). A step error shown
// under the title sat 237px above the step field — off-screen on a phone from where the leader
// tapped.
type ErrorPlace = "card" | "steps";

type CardRequest = {
  url: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  place: ErrorPlace;
};

export type TodoCardProps = {
  todo: TodoSummary;
  today: string;
  wardZone: string;
  user: SessionUser;
  canPickMember: boolean;
  onChanged: () => void;
};

export function TodoCard({
  todo,
  today,
  wardZone,
  user,
  canPickMember,
  onChanged,
}: TodoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [newStep, setNewStep] = useState("");
  const [error, setError] = useState<{ message: string; place: ErrorPlace } | undefined>(
    undefined,
  );
  const { armedKey, arm, disarm } = useArmedRemoval();

  const state = todoViewState(todo, today, wardZone);
  const progress = todoProgress(todo.steps);
  const isDone = todo.completedAt !== null;
  const bodyId = `todo-body-${todo.id}`;
  const stepFieldId = `todo-step-${todo.id}`;

  const logQuery = useQuery({
    queryKey: [TODO_DETAIL_QUERY_KEY, todo.id],
    queryFn: () => fetchTodoLog(todo.id),
    enabled: expanded,
  });

  function changed() {
    setError(undefined);
    onChanged();
    if (expanded) void logQuery.refetch();
  }

  const mutation = useMutation({
    mutationFn: (request: CardRequest) =>
      sendTodoRequest(request.url, request.method, request.body),
    onSuccess: () => {
      disarm();
      changed();
    },
    onError: (mutationError: Error, request) =>
      setError({ message: mutationError.message, place: request.place }),
  });

  const busy = mutation.isPending;
  const cardError = error?.place === "card" ? error.message : undefined;
  const stepsError = error?.place === "steps" ? error.message : undefined;

  function toggleComplete() {
    mutation.mutate({
      url: `/api/todos/${todo.id}`,
      method: "PATCH",
      body: { complete: !isDone },
      place: "card",
    });
  }

  function toggleStep(step: TodoStep) {
    mutation.mutate({
      url: `/api/todo-steps/${step.id}`,
      method: "PATCH",
      body: { done: step.doneAt === null },
      place: "steps",
    });
  }

  function addStep() {
    if (newStep.trim() === "") {
      setError({ message: "Say what the step is.", place: "steps" });
      return;
    }
    mutation.mutate(
      {
        url: `/api/todos/${todo.id}/steps`,
        method: "POST",
        body: { label: newStep },
        place: "steps",
      },
      { onSuccess: () => setNewStep("") },
    );
  }

  const dates = [
    todo.doDate === null ? null : `Do ${dayLabel(todo.doDate)}`,
    todo.dueDate === null ? null : `Due ${dayLabel(todo.dueDate)}`,
  ].filter((part): part is string => part !== null);

  return (
    <Card id={`todo-${todo.id}`} className="flex flex-col gap-2 p-3">
      <div className="flex items-start gap-2">
        {/* THE CHECKBOX IS THE DONE CONTROL — and unticking it reopens, so a mis-tick is
            recoverable without a delete. The box is 20px to see and the label around it is 44×44
            to tap (defect 075-D1: the bare input was a 20×20 target). */}
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={isDone}
            disabled={busy}
            onChange={toggleComplete}
            aria-label={isDone ? `Reopen ${todo.title}` : `Mark ${todo.title} done`}
            className="h-5 w-5"
          />
        </label>

        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span
            className={`break-words text-base font-medium ${isDone ? "text-muted line-through" : "text-foreground"}`}
          >
            {todo.title}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Pill tone={STATE_TONES[state]}>{TODO_VIEW_STATE_LABELS[state]}</Pill>
            {progress === null ? null : (
              <Pill tone="neutral">
                {progress.done}/{progress.total}
              </Pill>
            )}
            {todo.tag === null ? null : <Pill tone="neutral">{todo.tag}</Pill>}
            {dates.length === 0 ? null : (
              <span className="text-xs text-muted">{dates.join(" · ")}</span>
            )}
          </span>
          {/* THE FORWARD KEY (slice p5-b): the meeting completed the item. A flag and never a
              completion — whether their own work is finished is the owner's to say. */}
          {todo.sourceCompletedAt !== null && !isDone ? (
            <Pill tone="pending">Marked complete on the agenda</Pill>
          ) : null}
          {/* A turn-up-at time, so the WARD's zone with the zone named (rule 12) — the same
              formatter the visit appointments use, which is also what My Appointments shows. */}
          {todo.scheduledFor === null ? null : (
            <span className="text-xs font-medium text-foreground">
              Scheduled {formatAppointmentInstant(todo.scheduledFor, wardZone)}
              {todo.scheduledWithMemberName === null ? "" : ` · with ${todo.scheduledWithMemberName}`}
            </span>
          )}
          {todo.agendaSource === null ? null : (
            <span className="text-xs text-muted">
              From the {MEETING_TYPE_LABELS[todo.agendaSource.meetingType]} agenda of{" "}
              {dayLabel(todo.agendaSource.meetingDate)}
            </span>
          )}
        </button>

        <div className="flex shrink-0 items-center">
          {/* Icons alone, so the title keeps its width at 375px (defect 077-D1). */}
          <SmallButton
            accessibleName={`Schedule ${todo.title}`}
            onClick={() => setScheduling(true)}
            disabled={busy}
          >
            <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />
          </SmallButton>
          <SmallButton
            accessibleName={`Edit ${todo.title}`}
            onClick={() => setEditing(true)}
            disabled={busy}
          >
            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
          </SmallButton>
          <RemoveButton
            accessibleName={`Remove ${todo.title}`}
            isArmed={armedKey === "todo"}
            onArm={() => arm("todo")}
            onConfirm={() =>
              mutation.mutate({ url: `/api/todos/${todo.id}`, method: "DELETE", place: "card" })
            }
            disabled={busy}
          />
        </div>
      </div>

      <FormError message={cardError} />

      {expanded ? (
        <div id={bodyId} className="flex flex-col gap-4 border-t border-border pt-3">
          {todo.notes === null ? null : (
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{todo.notes}</p>
          )}

          <section aria-label="Steps" className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-foreground">Steps</h3>
            {todo.steps.length === 0 ? (
              <p className="text-sm text-muted">No steps. Add one to break this into parts.</p>
            ) : (
              <ul className="flex flex-col">
                {todo.steps.map((step) => (
                  <li key={step.id} className="flex min-w-0 items-center gap-2">
                    <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={step.doneAt !== null}
                        disabled={busy}
                        onChange={() => toggleStep(step)}
                        className="h-5 w-5 shrink-0"
                      />
                      <span
                        className={`min-w-0 break-words ${step.doneAt === null ? "text-foreground" : "text-muted line-through"}`}
                      >
                        {step.label}
                      </span>
                    </label>
                    <RemoveButton
                      accessibleName={`Remove step ${step.label}`}
                      isArmed={armedKey === step.id}
                      onArm={() => arm(step.id)}
                      onConfirm={() =>
                        mutation.mutate({
                          url: `/api/todo-steps/${step.id}`,
                          method: "DELETE",
                          place: "steps",
                        })
                      }
                      disabled={busy}
                    />
                  </li>
                ))}
              </ul>
            )}

            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                addStep();
              }}
            >
              <label htmlFor={stepFieldId} className="sr-only">
                Add a step
              </label>
              <input
                id={stepFieldId}
                value={newStep}
                maxLength={MAX_STEP_LABEL}
                placeholder="Add a step"
                onChange={(event) => setNewStep(event.target.value)}
                className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
              <SmallButton label="Add" accessibleName="Add this step" onClick={addStep} disabled={busy}>
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              </SmallButton>
            </form>
            <FormError message={stepsError} />
          </section>

          <TodoTimeline
            todoId={todo.id}
            entries={logQuery.data}
            loadError={logQuery.error instanceof Error ? logQuery.error.message : undefined}
            wardZone={wardZone}
            onChanged={changed}
          />
        </div>
      ) : null}

      {/* Mounted only while open, so each re-reads the to-do's current values every time. */}
      {scheduling ? (
        <ScheduleDialog
          isOpen={scheduling}
          onClose={() => setScheduling(false)}
          onSaved={changed}
          todo={todo}
          wardZone={wardZone}
          user={user}
          canPickMember={canPickMember}
        />
      ) : null}
      {editing ? (
        <TodoFormDialog
          isOpen={editing}
          onClose={() => setEditing(false)}
          onSaved={changed}
          todo={todo}
        />
      ) : null}
    </Card>
  );
}
