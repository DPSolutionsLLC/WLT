"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MemberPicker } from "@/components/roster/MemberPicker";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { instantToWardInputs, wardInputsToInstant } from "@/lib/todos/scheduleInstant";
import { MAX_NOTE_BODY } from "@/lib/validation/todo";
import type { SessionUser, TodoSummary } from "@/types/domain";
import { sendTodoRequest } from "@/app/(app)/todos/todoApi";

// "Schedule this" (p5-c) — give a to-do a time somebody has to turn up at, so it appears on My
// Appointments.
//
// THE DAY AND TIME ARE THE WARD'S WALL CLOCK, converted by lib/todos/scheduleInstant.ts — never by
// `new Date("…T19:30")`, which is whatever zone the browser happens to be in.
//
// THE MEMBER IS OPTIONAL AND ONLY OFFERED WITH `roster.view`. The picker reads /api/members, which
// a music coordinator cannot; offering a control that fails on open is worse than not offering it.
// It offers the WHOLE WARD (`wholeWard`), not the org leader's own organization: the person a
// leader is meeting may belong to any organization — the user's decision walking scenario 077.
// The chosen member's chip carries its own × to clear it, so there is no separate control for that.
// It is a `members` id, ward-scoped by migration 081's composite foreign key, so no
// findUsersOutsideWard() check applies — that is for USER ids.
//
// THE NOTE IS A TIMELINE LINE, not a field of the schedule: it is written after the schedule
// saves, through the same route the timeline's own "Add a note" uses. If it fails, the schedule
// has still happened and the message says exactly that (rule 7).

export type ScheduleDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  todo: TodoSummary;
  wardZone: string;
  user: SessionUser;
  canPickMember: boolean;
};

export function ScheduleDialog({
  isOpen,
  onClose,
  onSaved,
  todo,
  wardZone,
  user,
  canPickMember,
}: ScheduleDialogProps) {
  const existing =
    todo.scheduledFor === null ? null : instantToWardInputs(todo.scheduledFor, wardZone);

  const [date, setDate] = useState(existing?.date ?? todo.doDate ?? "");
  const [time, setTime] = useState(existing?.time ?? "");
  const [memberId, setMemberId] = useState<string | null>(todo.scheduledWithMemberId);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const idPrefix = `todo-schedule-${todo.id}`;

  const save = useMutation({
    mutationFn: async (scheduledFor: string) => {
      await sendTodoRequest(`/api/todos/${todo.id}`, "PATCH", {
        scheduledFor,
        scheduledWithMemberId: memberId,
      });

      if (note.trim() === "") return;

      try {
        await sendTodoRequest(`/api/todos/${todo.id}/notes`, "POST", { body: note });
      } catch (noteError) {
        const reason = noteError instanceof Error ? noteError.message : "Please try again.";
        throw new Error(`It is scheduled, but the note was not saved. ${reason}`);
      }
    },
    onSuccess: () => {
      setError(undefined);
      onSaved();
      onClose();
    },
    onError: (mutationError: Error) => {
      setError(mutationError.message);
      // The schedule may have saved before the note failed; refresh so the card says so.
      onSaved();
    },
  });

  const unschedule = useMutation({
    mutationFn: () => sendTodoRequest(`/api/todos/${todo.id}`, "PATCH", { scheduledFor: null }),
    onSuccess: () => {
      setError(undefined);
      onSaved();
      onClose();
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const busy = save.isPending || unschedule.isPending;

  function submit() {
    if (date.trim() === "" || time.trim() === "") {
      setError("Give the day and the time.");
      return;
    }

    const scheduledFor = wardInputsToInstant(date, time, wardZone);
    if (scheduledFor === null) {
      setError("That day and time could not be read. Check both fields.");
      return;
    }

    save.mutate(scheduledFor);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Schedule this">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="break-words text-sm text-muted">{todo.title}</p>

        {/* min-w-0 on the flex children so the two inputs share a 375px row without overflowing. */}
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-0 flex-1 basis-36 flex-col">
            <Input
              id={`${idPrefix}-date`}
              label="Day"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>
          <div className="flex min-w-0 flex-1 basis-28 flex-col">
            <Input
              id={`${idPrefix}-time`}
              label="Time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
            />
          </div>
        </div>

        {canPickMember ? (
          <div className="flex flex-col gap-1">
            <MemberPicker
              value={memberId === null ? [] : [memberId]}
              onChange={(memberIds) => setMemberId(memberIds[0] ?? null)}
              user={user}
              multiple={false}
              wholeWard
              mode="inline"
              label="With (optional)"
              disabled={busy}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-note`} className="text-sm font-medium text-foreground">
            Note (optional)
          </label>
          <textarea
            id={`${idPrefix}-note`}
            rows={2}
            maxLength={MAX_NOTE_BODY}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <p className="text-xs text-muted">Added to this to-do&apos;s timeline.</p>
        </div>

        <FormError message={error} />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {save.isPending ? "Saving…" : "Schedule"}
          </Button>
          {todo.scheduledFor === null ? null : (
            <Button variant="secondary" onClick={() => unschedule.mutate()} disabled={busy}>
              {unschedule.isPending ? "Removing…" : "Unschedule"}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
