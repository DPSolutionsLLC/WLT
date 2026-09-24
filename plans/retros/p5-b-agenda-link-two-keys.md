---
id: p5-b-agenda-link-two-keys
type: feature
iter: null
commits: ["303ed3d"]
date: 2026-09-24
files:
  - supabase/migrations/082_action_item_todo_link.sql
  - lib/todos/sourceLinks.ts
  - lib/todos/queries.ts
  - lib/todos/routeErrors.ts
  - lib/agendas/assignee.ts
  - lib/agendas/queries.ts
  - lib/agendas/carryForward.ts
  - lib/validation/agenda.ts
  - app/api/action-items/[id]/route.ts
  - app/api/agendas/[id]/action-items/route.ts
  - app/api/agendas/route.ts
  - app/api/todos/[id]/route.ts
  - app/(app)/agendas/[id]/AgendaBuilder.tsx
  - app/(app)/todos/TodoCard.tsx
  - types/domain.ts
related: [p5-a-todo-core, ward-callings-model, p3-shell-and-tile-dashboard, youth-h-season-close-and-safe-remove, sacrament-references-over-pgvector]
---

## What was done
P5 slice b of [plans/todo-and-my-appointments.md](../todo-and-my-appointments.md): an agenda action
item can be assigned to an account (`action_items.assigned_user_id`, migration 082), which creates
and links that person's to-do. Completion is a **flag in both directions and never a completion**:
- the meeting completing the item sets `todos.source_completed_at` and a timeline line
- the owner completing the to-do sets `action_items.completion_review_requested_at`, shown on the
  agenda as "Assignee marked done — review"

Reassigning deletes the previous assignee's to-do if untouched and otherwise unlinks and keeps it.
A to-do linked to an open item answers 409 on delete. The assignee **picker** is P4's Agendas slice
(D1); until then the link is reachable only through the API and the harness seed.

Scenario 076 was walked by an agent with no defects, and the user passed all three judgement
checks.

## Key decisions
- **Carry-forward MOVES the link onto the copy — a deviation from the plan, settled in code.** The
  plan asked the executor to confirm which row is live. Carry-forward copies an open item and leaves
  the original open for ever, as a record of the earlier meeting. Left on the original, the link
  would have broken three things:
  - the next meeting's completion would never flag the to-do
  - the review flag would land on an old agenda
  - the owner could never delete the to-do
  The copy is the live item. `pairCarriedCopies()` checks the RETURNING order rather than trusting
  it, and any relink failure answers its own 500 ("the agenda was created, but…"), because
  "Could not create the agenda" would be untrue.
- **`lib/todos/sourceLinks.ts` is the only writer to another person's to-do.** It uses the service
  role, behind `agendas.manage`, only after the caller's own RLS client has read the item, and it
  filters `ward_id` on every write. The reverse key needs no service role, because `action_items`
  is ward-wide (019).
- **"Ensure the to-do exists", not "create it on change".** A PATCH naming the same assignee still
  runs the create, guarded by the partial unique index (082c; 23505 is treated as success). That is
  what makes re-sending a request after a "saved, but the to-do was not" 500 actually repair it.
- **Order: item → link → audit, and the audit row is written even when the link write failed.**
  The item change happened (rule 6); the 500 names what did not (rule 7).
  - The create route's sentence differs from the PATCH's, because re-sending a POST would add the
    item twice.
  - DELETE releases the to-dos *before* deleting the item, so a failure there removes nothing.
- **`assigned_user_id` is a SUBJECT**, so both routes call `findUsersOutsideWard()` through the new
  `assertAssigneeInWard()` (400 with a sentence).
- **Added beyond the plan:**
  - `TodoSummary.agendaSource` (read through the ward-wide action_items embed with an FK hint,
    because `action_items` has two FKs to `agendas`)
  - `getActionItem()`
  - `TodoLinkWriteError`
  - a pure carry-forward test

## What broke, and the pattern behind it
- **A `cat > file` before a heredoc consumed the heredoc meant for the next command.** The Python
  edit then ran on empty stdin, and nothing was written. It was caught only because `git diff
  --stat` showed an 11-line change to a file that should have had fifty. **Pattern:** one heredoc
  per command, and after any scripted edit, check the diff rather than the script's exit.
- **`npm run typecheck | tail` reported exit 0 over a real type error.** A pipe hides the exit code.
  Redirect to a file and echo `$?`.
- **Full suite: 5 failures in two untouched files** (program-ai-edit, assignment-approve). The first
  in each was a 30s timeout, and the program-ai-edit ones after it were knock-on mock state. Both
  files pass 32/32 in isolation, so this is shared-hosted-DB load, not a regression.
- **Walk artifacts, not defects:**
  - ✕ → Remove? disarms after 4s, so slow agent clicks re-arm instead of confirming.
  - The 409's alert renders after the response arrives, so read the page after waiting.
  - The Playwright profile was locked by another live Claude session's Chrome; closed with the
    user's approval.
  - `npm run build` was held until the user said to stop their dev server (the
    `sacrament-references-over-pgvector` lesson, applied this time).
