"use client";

import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import { MAX_ANSWER_NOTE } from "@/lib/validation/talkAsk";
import {
  DECLINE_REASON_LABELS,
  DECLINE_REASONS,
  type DeclineReason,
} from "@/types/domain";
import { sendTodoRequest } from "@/app/(app)/todos/todoApi";

// THE DECLINE WINDOW for a talk's ask (Sacrament slice f1). Accepted needs no window: it is one
// press on the card. A decline asks why, because the reason reaches speaker history ("declines
// talks but accepts prayers" is read at a glance there, build note 351). The optional note stays
// on the talk and never appears in a timeline line or an audit row.
//
// What recording it does is said on the button's own sentence below, not left to be discovered:
// the slot reopens and the speaker's name is cleared.
//
// It takes the to-do's id and title rather than the to-do, because My Appointments opens it too,
// from a row that is not a TodoSummary.

const FIELD_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export type AskAnswerDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  todoId: string;
  title: string;
};

export function AskAnswerDialog({ isOpen, onClose, onSaved, todoId, title }: AskAnswerDialogProps) {
  const idPrefix = useId();
  const [reason, setReason] = useState<DeclineReason>("not_available");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();

  const record = useMutation({
    mutationFn: () =>
      sendTodoRequest(`/api/todos/${todoId}/answer`, "POST", {
        outcome: "declined",
        declineReason: reason,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="They declined">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError(undefined);
          record.mutate();
        }}
      >
        <p className="break-words text-sm text-muted">{title}</p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-reason`} className="text-sm font-medium text-foreground">
            Why?
          </label>
          <select
            id={`${idPrefix}-reason`}
            value={reason}
            disabled={record.isPending}
            onChange={(event) => setReason(event.target.value as DeclineReason)}
            className={FIELD_CLASSES}
          >
            {DECLINE_REASONS.map((value) => (
              <option key={value} value={value}>
                {DECLINE_REASON_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-note`} className="text-sm font-medium text-foreground">
            A quick note (optional)
          </label>
          <textarea
            id={`${idPrefix}-note`}
            rows={2}
            maxLength={MAX_ANSWER_NOTE}
            value={note}
            disabled={record.isPending}
            onChange={(event) => setNote(event.target.value)}
            className={FIELD_CLASSES}
          />
        </div>

        <p className="text-xs text-muted">
          This reopens the talk&apos;s slot and clears the speaker&apos;s name, so somebody else can
          be asked.
        </p>

        <FormError message={error} />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={record.isPending}>
            {record.isPending ? "Recording…" : "Record decline"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
