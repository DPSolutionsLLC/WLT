"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { MAX_TODO_NOTES, MAX_TODO_TAG, MAX_TODO_TITLE } from "@/lib/validation/todo";
import type { Todo } from "@/types/domain";
import { sendTodoRequest } from "@/app/(app)/todos/todoApi";

// Create or edit one to-do, in the shared window.
//
// "DO" AND "DUE" ARE TWO FIELDS, AND NEITHER CONSTRAINS THE OTHER. When I mean to work on it and
// when it must be done are different facts. Each says which it is in its own hint, because a
// reader seeing two date fields side by side should not have to guess.
//
// Steps are NOT here: the first step is added on the card itself, which is what makes a to-do a
// project with no mode to switch.

export type TodoFormDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  // Absent means "create".
  todo?: Todo;
};

type FormState = {
  title: string;
  doDate: string;
  dueDate: string;
  tag: string;
  notes: string;
};

function initialState(todo: Todo | undefined): FormState {
  return {
    title: todo?.title ?? "",
    doDate: todo?.doDate ?? "",
    dueDate: todo?.dueDate ?? "",
    tag: todo?.tag ?? "",
    notes: todo?.notes ?? "",
  };
}

function orNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

export function TodoFormDialog({ isOpen, onClose, onSaved, todo }: TodoFormDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialState(todo));
  const [error, setError] = useState<string | undefined>(undefined);
  const idPrefix = todo === undefined ? "todo-new" : `todo-edit-${todo.id}`;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title,
        doDate: orNull(form.doDate),
        dueDate: orNull(form.dueDate),
        tag: orNull(form.tag),
        notes: orNull(form.notes),
      };
      return todo === undefined
        ? sendTodoRequest("/api/todos", "POST", body)
        : sendTodoRequest(`/api/todos/${todo.id}`, "PATCH", body);
    },
    onSuccess: () => {
      setError(undefined);
      if (todo === undefined) setForm(initialState(undefined));
      onSaved();
      onClose();
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  function update(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={todo === undefined ? "New to-do" : "Edit to-do"}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (form.title.trim() === "") {
            setError("Give it a title.");
            return;
          }
          save.mutate();
        }}
      >
        <Input
          id={`${idPrefix}-title`}
          label="Title"
          value={form.title}
          maxLength={MAX_TODO_TITLE}
          onChange={(event) => update("title", event.target.value)}
          required
        />

        {/* min-w-0 on the flex children so two date inputs share a 375px row without overflowing
            (scenario 059's <select> lesson). */}
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-0 flex-1 basis-36 flex-col gap-1">
            <Input
              id={`${idPrefix}-do`}
              label="Do"
              type="date"
              value={form.doDate}
              onChange={(event) => update("doDate", event.target.value)}
            />
            <p className="text-xs text-muted">When you mean to work on it.</p>
          </div>
          <div className="flex min-w-0 flex-1 basis-36 flex-col gap-1">
            <Input
              id={`${idPrefix}-due`}
              label="Due"
              type="date"
              value={form.dueDate}
              onChange={(event) => update("dueDate", event.target.value)}
            />
            <p className="text-xs text-muted">When it must be done.</p>
          </div>
        </div>

        <Input
          id={`${idPrefix}-tag`}
          label="Tag (optional)"
          value={form.tag}
          maxLength={MAX_TODO_TAG}
          onChange={(event) => update("tag", event.target.value)}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-notes`} className="text-sm font-medium text-foreground">
            Notes (optional)
          </label>
          <textarea
            id={`${idPrefix}-notes`}
            rows={3}
            maxLength={MAX_TODO_NOTES}
            value={form.notes}
            onChange={(event) => update("notes", event.target.value)}
            className="min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
        </div>

        <FormError message={error} />

        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
