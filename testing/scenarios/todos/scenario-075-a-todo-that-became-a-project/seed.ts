import { wardDateOnly } from "../../../../lib/ward/wardDate.ts";
import {
  createTestUser,
  createTodo,
  createTodoLogEntry,
  createTodoStep,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// ONE OF EACH STATE ON THE PRESIDENT'S LIST, PLUS ONE TO-DO THAT IS THE BISHOP'S
// ---------------------------------------------------------------------------
//   overdue     due yesterday                              "Send the ministering assignments"
//   do today    do date today                              "Call Brother Okafor about the move"
//   project     3 steps (1 done), due in 10 days, tagged   "Plan the quorum service project"
//   someday     no dates, no steps — gets its first step   "Order new hymnbooks for the quorum"
//   done        completed yesterday                        "Return the chapel key"
//   BISHOP'S    only the bishop may ever see this          "Draft the tithing declaration schedule"
//
// RELATIVE TO THE WARD'S TODAY (America/Denver), NOT FIXED DATES — "overdue" and "do today" are
// decided by the clock, and scenario 073's walk found that fixed dates drift. Computed with the
// app's own wardDateOnly(), so the seed and the page agree about which day it is.
//
// THE PROJECT'S TIMELINE is a note, then a `step_done` line 10 minutes later, then a second note
// 10 minutes after that — so the automatic line must render BETWEEN the two notes.

const WARD_ZONE = "America/Denver";
const DAY_MS = 86_400_000;

const now = new Date();
const today = wardDateOnly(now, WARD_ZONE);
const yesterday = wardDateOnly(new Date(now.getTime() - DAY_MS), WARD_ZONE);
const inTenDays = wardDateOnly(new Date(now.getTime() + 10 * DAY_MS), WARD_ZONE);

const minutesAgo = (minutes: number): string =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const president = await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  await createTodo({
    userId: president.id,
    title: "Send the ministering assignments",
    dueDate: yesterday,
  });

  await createTodo({
    userId: president.id,
    title: "Call Brother Okafor about the move",
    doDate: today,
  });

  const project = await createTodo({
    userId: president.id,
    title: "Plan the quorum service project",
    tag: "Service project",
    dueDate: inTenDays,
    notes: "Food bank on a Saturday morning, if they have room for twelve.",
  });

  await createTodoStep({
    todoId: project,
    label: "Call the food bank coordinator",
    position: 1,
    doneAt: minutesAgo(20),
  });
  await createTodoStep({ todoId: project, label: "Book the Saturday slot", position: 2 });
  await createTodoStep({ todoId: project, label: "Announce it in quorum meeting", position: 3 });

  await createTodoLogEntry({
    todoId: project,
    kind: "note",
    body: "The coordinator is Sister Whitfield — best reached after 5pm.",
    createdAt: minutesAgo(30),
  });
  await createTodoLogEntry({
    todoId: project,
    kind: "step_done",
    body: "Call the food bank coordinator",
    createdAt: minutesAgo(20),
  });
  await createTodoLogEntry({
    todoId: project,
    kind: "note",
    body: "She has room on the 2nd Saturday. Needs a head count by Thursday.",
    createdAt: minutesAgo(10),
  });

  await createTodo({
    userId: president.id,
    title: "Order new hymnbooks for the quorum",
  });

  await createTodo({
    userId: president.id,
    title: "Return the chapel key",
    completedAt: minutesAgo(24 * 60),
  });

  await createTodo({
    userId: bishop.id,
    title: "Draft the tithing declaration schedule",
    dueDate: inTenDays,
  });

  console.log(
    `  ward, 2 users, 6 to-dos (5 the president's, 1 the bishop's), 3 steps, 3 timeline lines — today is ${today} in ${WARD_ZONE}`,
  );
}
