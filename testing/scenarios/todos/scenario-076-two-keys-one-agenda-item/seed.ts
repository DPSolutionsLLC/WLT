import { agendaTemplate } from "../../../../lib/agendas/sections.ts";
import { wardDateOnly } from "../../../../lib/ward/wardDate.ts";
import {
  createActionItem,
  createAgenda,
  createTestUser,
  createTodo,
  createTodoLogEntry,
  createTodoStep,
  ensureTestWard,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// TWO ACTION ITEMS ASSIGNED TO THE PRESIDENT, EACH WITH ITS LINKED TO-DO
// ---------------------------------------------------------------------------
//   A  "Visit the Okafor family before they move"   linked to-do UNTOUCHED
//   B  "Organise the quorum's move-in crew"          linked to-do with 2 steps (1 done) and a note
//
// Seeded rather than assigned through the app, because the assignee PICKER does not exist yet
// (decision D1 — P4's Agendas slice builds it). Seeding the link is exactly what
// lib/todos/sourceLinks.ts writes: `assigned_user_id` on the item, and a to-do owned by the
// assignee with `assigned_by` = the bishop and `action_item_id` = the item.
//
// The agenda is a DRAFT bishopric agenda dated today, built from the app's own template, so it
// opens as the working screen with its action-items section.

const WARD_ZONE = "America/Denver";
const DAY_MS = 86_400_000;

const now = new Date();
const today = wardDateOnly(now, WARD_ZONE);
const inAWeek = wardDateOnly(new Date(now.getTime() + 7 * DAY_MS), WARD_ZONE);

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

  const agendaId = await createAgenda({
    meetingType: "bishopric",
    meetingDate: today,
    status: "draft",
    // The app's own template, so the carry-forward section exists — the builder renders action
    // items only inside it, and a null `sections` would hide both items.
    sections: agendaTemplate(),
  });

  const itemA = await createActionItem({
    id: testUuid("scenario-076:item-a"),
    agendaId,
    description: "Visit the Okafor family before they move",
    assignedTo: "Brother Cortez",
    assignedUserId: president.id,
    dueDate: inAWeek,
  });

  const itemB = await createActionItem({
    id: testUuid("scenario-076:item-b"),
    agendaId,
    description: "Organise the quorum's move-in crew for the Nguyen family",
    assignedTo: "Brother Cortez",
    assignedUserId: president.id,
    dueDate: inAWeek,
  });

  await createTodo({
    userId: president.id,
    assignedBy: bishop.id,
    actionItemId: itemA,
    title: "Visit the Okafor family before they move",
    dueDate: inAWeek,
  });

  const todoB = await createTodo({
    userId: president.id,
    assignedBy: bishop.id,
    actionItemId: itemB,
    title: "Organise the quorum's move-in crew for the Nguyen family",
    dueDate: inAWeek,
  });

  await createTodoStep({
    todoId: todoB,
    label: "Ask for six volunteers in quorum meeting",
    position: 1,
    doneAt: minutesAgo(40),
  });
  await createTodoStep({ todoId: todoB, label: "Borrow the stake's trailer", position: 2 });

  await createTodoLogEntry({
    todoId: todoB,
    kind: "step_done",
    body: "Ask for six volunteers in quorum meeting",
    createdAt: minutesAgo(40),
  });
  await createTodoLogEntry({
    todoId: todoB,
    kind: "note",
    body: "Brother Ashby has a truck but is away the first weekend — PRIVATE NOTE TEXT.",
    createdAt: minutesAgo(30),
  });

  console.log(
    `  ward, 2 users, 1 draft bishopric agenda (${today}), 2 assigned action items, 2 linked to-dos (B has 2 steps and a note)`,
  );
}
