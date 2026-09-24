import { wardDateOnly } from "@/lib/ward/wardDate";
import type { Todo, TodoViewState } from "@/types/domain";

// Where a to-do stands today. COMPUTED on read — "overdue" is decided by the clock, and nothing in
// this project refreshes a stored value.
//
// NO CLOCK IN THIS FILE. `today` is the WARD's date (lib/ward/wardDate.ts), passed in by the
// caller, so every branch is testable from literals.
//
// DUE BEATS DO. A missed deadline is the louder fact: an item due yesterday that I also meant to
// start today is overdue, not "do today".
//
// A SCHEDULED TIME COUNTS LIKE A DO DATE, ON THE WARD'S DAY (p5-c, defect 077-D2). Without it a
// to-do scheduled for Friday with no other dates read "Someday" beside its own time. One
// difference from a do date: a scheduled day that has PASSED without the to-do being done is
// overdue — an appointment is a commitment to a moment, where a do date is only an intention. The
// instant becomes a day in the ward's zone, never UTC (rule 12), so `wardZone` is a parameter.

type TodoDates = Pick<Todo, "completedAt" | "doDate" | "dueDate" | "scheduledFor">;

function scheduledDay(todo: TodoDates, wardZone: string): string | null {
  return todo.scheduledFor === null ? null : wardDateOnly(new Date(todo.scheduledFor), wardZone);
}

export function todoViewState(todo: TodoDates, today: string, wardZone: string): TodoViewState {
  if (todo.completedAt !== null) return "done";
  const scheduled = scheduledDay(todo, wardZone);
  if (todo.dueDate !== null && todo.dueDate < today) return "overdue";
  if (scheduled !== null && scheduled < today) return "overdue";
  if (todo.dueDate === today) return "due_today";
  if (todo.doDate !== null && todo.doDate <= today) return "do_today";
  if (scheduled === today) return "do_today";
  if (todo.doDate !== null || todo.dueDate !== null || scheduled !== null) return "upcoming";
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

// The earliest of the three days, because that is the one the leader next has to act on.
function earliestDate(todo: TodoDates, wardZone: string): string | null {
  const days = [todo.doDate, todo.dueDate, scheduledDay(todo, wardZone)].filter(
    (day): day is string => day !== null,
  );
  return days.length === 0 ? null : days.reduce((a, b) => (a < b ? a : b));
}

// Open before done; open items by state, then by their earliest date (undated last), then by when
// they were created. Done items most-recently-completed first.
export function compareTodos(
  a: ComparableTodo,
  b: ComparableTodo,
  today: string,
  wardZone: string,
): number {
  const stateA = todoViewState(a, today, wardZone);
  const stateB = todoViewState(b, today, wardZone);

  if (stateA === "done" && stateB === "done") {
    return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
  }
  if (stateA === "done") return 1;
  if (stateB === "done") return -1;

  const byState = OPEN_STATE_RANK[stateA] - OPEN_STATE_RANK[stateB];
  if (byState !== 0) return byState;

  const dateA = earliestDate(a, wardZone);
  const dateB = earliestDate(b, wardZone);
  if (dateA !== dateB) {
    if (dateA === null) return 1;
    if (dateB === null) return -1;
    return dateA.localeCompare(dateB);
  }

  return a.createdAt.localeCompare(b.createdAt);
}
