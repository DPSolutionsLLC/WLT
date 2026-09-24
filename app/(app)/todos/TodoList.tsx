"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { compareTodos } from "@/lib/todos/viewState";
import type { TodoSummary } from "@/types/domain";
import { TodoCard } from "@/app/(app)/todos/TodoCard";
import { TodoFormDialog } from "@/app/(app)/todos/TodoFormDialog";
import { TODOS_QUERY_KEY, fetchTodos, type TodoStatusFilter } from "@/app/(app)/todos/todoApi";

// A FLAT LIST WITH FILTERS — module-map §6.5. No month navigation, no expand-all: To Do is not a
// jump target, so nothing opens a card from outside.
//
// Open by default, Done behind its own pill. A tag filter appears only once a tag exists — a
// control with nothing to choose from is clutter.
//
// `today` is the WARD's date, computed once by the page and handed down, so every card's
// "Overdue" is judged against the same day and the server and browser agree about it.

const STATUS_OPTIONS: readonly { value: TodoStatusFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
];

export type TodoListProps = {
  initialOpenTodos: TodoSummary[];
  today: string;
  wardZone: string;
};

function FilterPill({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="group inline-flex min-h-11 items-center focus-visible:outline-none"
    >
      <span
        className={
          "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium " +
          "group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary " +
          (selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border text-foreground group-hover:bg-surface")
        }
      >
        {label}
      </span>
    </button>
  );
}

export function TodoList({ initialOpenTodos, today, wardZone }: TodoListProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TodoStatusFilter>("open");
  const [tag, setTag] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const todosQuery = useQuery({
    queryKey: [TODOS_QUERY_KEY, status],
    queryFn: () => fetchTodos(status),
    initialData: status === "open" ? initialOpenTodos : undefined,
  });

  const todos = todosQuery.data ?? [];

  const tags = [
    ...new Set(todos.map((todo) => todo.tag).filter((value): value is string => value !== null)),
  ].sort();

  const visible = todos
    .filter((todo) => tag === null || todo.tag === tag)
    .sort((a, b) => compareTodos(a, b, today));

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: [TODOS_QUERY_KEY] });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Show">
          {STATUS_OPTIONS.map((option) => (
            <FilterPill
              key={option.value}
              label={option.label}
              selected={status === option.value}
              onSelect={() => {
                setStatus(option.value);
                setTag(null);
              }}
            />
          ))}
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          New to-do
        </Button>
      </div>

      {tags.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Tag">
          <FilterPill label="All tags" selected={tag === null} onSelect={() => setTag(null)} />
          {tags.map((value) => (
            <FilterPill key={value} label={value} selected={tag === value} onSelect={() => setTag(value)} />
          ))}
        </div>
      )}

      {todosQuery.error instanceof Error ? <FormError message={todosQuery.error.message} /> : null}

      {todosQuery.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            {status === "open"
              ? "Nothing on your list. Add a to-do above — anything a meeting asks of you will appear here too."
              : "Nothing completed yet."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((todo) => (
            <li key={todo.id}>
              <TodoCard todo={todo} today={today} wardZone={wardZone} onChanged={refresh} />
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <TodoFormDialog isOpen={creating} onClose={() => setCreating(false)} onSaved={refresh} />
      ) : null}
    </div>
  );
}
