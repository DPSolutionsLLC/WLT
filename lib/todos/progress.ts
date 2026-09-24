// A to-do's progress, COMPUTED from its steps and never stored.
//
// ZERO STEPS IS A PLAIN ITEM, AND A PLAIN ITEM SHOWS NO PROGRESS AT ALL — `null`, never "0/0".
// Adding the first step is what makes a to-do a project; there is no mode to switch.

export type TodoProgress = {
  done: number;
  total: number;
  fraction: number;
};

export function todoProgress(steps: readonly { doneAt: string | null }[]): TodoProgress | null {
  if (steps.length === 0) return null;

  const done = steps.filter((step) => step.doneAt !== null).length;

  return { done, total: steps.length, fraction: done / steps.length };
}
