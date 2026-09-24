import type { Todo, TodoViewState } from "@/types/domain";

// Where a to-do stands today. COMPUTED on read — "overdue" is decided by the clock, and nothing in
// this project refreshes a stored value.
//
// NO CLOCK IN THIS FILE. `today` is the WARD's date (lib/ward/wardDate.ts), passed in by the
// caller, so every branch is testable from literals.
//
// DUE BEATS DO. A missed deadline is the louder fact: an item due yesterday that I also meant to
// start today is overdue, not "do today".

type TodoDates = Pick<Todo, "completedAt" | "doDate" | "dueDate">;

export function todoViewState(todo: TodoDates, today: string): TodoViewState {
  if (todo.completedAt !== null) return "done";
  if (todo.dueDate !== null && todo.dueDate < today) return "overdue";
  if (todo.dueDate === today) return "due_today";
  if (todo.doDate !== null && todo.doDate <= today) return "do_today";
  if (todo.doDate !== null || todo.dueDate !== null) return "upcoming";
  return "someday";
}

const OPEN_STATE_RANK: Record<Exclude<TodoViewState, "done">, number> = {
  overdue: 0,
  due_today: 1,
  do_today: 2,
  upcoming: 3,
  someday: 4,
};

type ComparableTodo = TodoDates & Pick<Todo, "createdAt">;

// The earlier of the two dates, because that is the one the leader next has to act on.
function earliestDate(todo: TodoDates): string | null {
  if (todo.doDate === null) return todo.dueDate;
  if (todo.dueDate === null) return todo.doDate;
  return todo.doDate < todo.dueDate ? todo.doDate : todo.dueDate;
}

// Open before done; open items by state, then by their earliest date (undated last), then by when
// they were created. Done items most-recently-completed first.
export function compareTodos(a: ComparableTodo, b: ComparableTodo, today: string): number {
  const stateA = todoViewState(a, today);
  const stateB = todoViewState(b, today);

  if (stateA === "done" && stateB === "done") {
    return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
  }
  if (stateA === "done") return 1;
  if (stateB === "done") return -1;

  const byState = OPEN_STATE_RANK[stateA] - OPEN_STATE_RANK[stateB];
  if (byState !== 0) return byState;

  const dateA = earliestDate(a);
  const dateB = earliestDate(b);
  if (dateA !== dateB) {
    if (dateA === null) return 1;
    if (dateB === null) return -1;
    return dateA.localeCompare(dateB);
  }

  return a.createdAt.localeCompare(b.createdAt);
}
