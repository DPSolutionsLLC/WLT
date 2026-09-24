import type { Todo } from "@/types/domain";

// Has the owner done anything with this to-do yet?
//
// Used when an agenda action item is reassigned or deleted (slice p5-b): an UNTOUCHED auto-created
// to-do is removed, while a touched one is unlinked and KEPT — never destroy what somebody wrote.
//
// Untouched means: no steps, no log lines, not completed and not scheduled. Editing the title or
// the dates does NOT count — those are the fields the assignment itself filled in.
export function isTodoUntouched(
  todo: Pick<Todo, "completedAt" | "scheduledFor">,
  stepCount: number,
  logCount: number,
): boolean {
  return (
    stepCount === 0 && logCount === 0 && todo.completedAt === null && todo.scheduledFor === null
  );
}
