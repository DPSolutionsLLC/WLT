"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { describeLogEntry } from "@/lib/todos/logLines";
import { MAX_NOTE_BODY } from "@/lib/validation/todo";
import type { TodoLogEntry } from "@/types/domain";
import { sendTodoRequest } from "@/app/(app)/todos/todoApi";

// ONE TIMELINE. Written notes and automatic lines are rows of one table, oldest first, so a
// "Checked off …" line sits BETWEEN the notes written either side of it — never in a list of its
// own. Notes read as ordinary text; automatic lines are smaller and muted.
//
// ---------------------------------------------------------------------------
// STAMPED IN THE WARD'S ZONE, WITH THE TIME
// ---------------------------------------------------------------------------
// Rule 12 says a "when did this happen" stamp renders in UTC, and the existing ones
// (VersionHistory, ContactStagePanel) do — as a DATE alone. A timeline is different: lines here
// sit minutes apart, so the time is the point, and a UTC time would show a note written at 8pm in
// Denver as 2am the next day. The WARD's zone is equally deterministic between server and browser
// (the property rule 12 exists to protect), so it is used instead — named explicitly, as the rule
// and tests/lib/explicitTimeZone.test.ts require.

function formatStamp(iso: string, wardZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: wardZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export type TodoTimelineProps = {
  todoId: string;
  entries: TodoLogEntry[] | undefined;
  loadError: string | undefined;
  wardZone: string;
  onChanged: () => void;
};

export function TodoTimeline({ todoId, entries, loadError, wardZone, onChanged }: TodoTimelineProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const noteFieldId = `todo-note-${todoId}`;

  const addNote = useMutation({
    mutationFn: (body: string) => sendTodoRequest(`/api/todos/${todoId}/notes`, "POST", { body }),
    onSuccess: () => {
      setDraft("");
      setError(undefined);
      onChanged();
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  return (
    <section aria-label="Timeline" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">Timeline</h3>

      {loadError !== undefined ? (
        <FormError message={loadError} />
      ) : entries === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet. Notes you write and steps you check off appear here.</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col">
              <span className="text-xs text-muted">{formatStamp(entry.createdAt, wardZone)}</span>
              <span
                className={
                  entry.kind === "note"
                    ? "whitespace-pre-wrap break-words text-sm text-foreground"
                    : "break-words text-xs italic text-muted"
                }
              >
                {describeLogEntry(entry)}
              </span>
            </li>
          ))}
        </ol>
      )}

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim() === "") {
            setError("Write something first.");
            return;
          }
          addNote.mutate(draft);
        }}
      >
        <label htmlFor={noteFieldId} className="sr-only">
          Add a note
        </label>
        <textarea
          id={noteFieldId}
          rows={2}
          maxLength={MAX_NOTE_BODY}
          placeholder="Add a note"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
        <FormError message={error} />
        <div>
          <Button type="submit" variant="secondary" disabled={addNote.isPending}>
            {addNote.isPending ? "Saving…" : "Add note"}
          </Button>
        </div>
      </form>
    </section>
  );
}
