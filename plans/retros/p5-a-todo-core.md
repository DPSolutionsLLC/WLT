---
id: p5-a-todo-core
type: feature
iter: null
commits: []
date: 2026-09-24
files:
  - supabase/migrations/081_todos.sql
  - lib/auth/permissions.ts
  - lib/auth/navigation.tsx
  - lib/todos/queries.ts
  - lib/todos/routeErrors.ts
  - lib/todos/progress.ts
  - lib/todos/viewState.ts
  - lib/todos/untouched.ts
  - lib/todos/logLines.ts
  - lib/validation/todo.ts
  - lib/ward/wardDate.ts
  - app/api/todos/route.ts
  - app/api/todos/[id]/route.ts
  - app/api/todos/[id]/steps/route.ts
  - app/api/todos/[id]/notes/route.ts
  - app/api/todo-steps/[id]/route.ts
  - app/(app)/todos/page.tsx
  - app/(app)/todos/TodoList.tsx
  - app/(app)/todos/TodoCard.tsx
  - app/(app)/todos/TodoTimeline.tsx
  - app/(app)/todos/TodoFormDialog.tsx
  - types/domain.ts
related: [ward-callings-model, p3-shell-and-tile-dashboard, youth-h-season-close-and-safe-remove, visits-d-attempts-appointments-and-participants, role-access-overrides, notification-trigger-drift, sacrament-references-over-pgvector]
---

## What was done
P5 slice a, the first of three from [plans/todo-and-my-appointments.md](../todo-and-my-appointments.md).
It adds a leader's own To Do list:
- migration 081: `todos`, `todo_steps` and `todo_log_entries`, owner-only on every verb with no
  bishopric arm, and an INSERT that refuses anyone else's `user_id` or any `assigned_by`
- a new non-overridable permission, `personal_tools.use`
- nine route handlers across five files, and a `/todos` page: a flat list with Open/Done and tag
  filters, cards that open in place to steps (progress computed, with no mode switch) and one
  timeline in which automatic lines interleave with notes by time

The Tasks & Communication dashboard section renders for the first time. Scenario 075 was walked by
an agent; the user passed all four judgement checks, and the walk's two defects were fixed the same
day.

## Key decisions
- **Privacy is enforced at the table.** D2 (owner-only) and D3 (self-created only) both live in
  RLS, which `tests/rls/todos.test.ts` asserts against the bishop on every verb, not in the route.
  Someone else's to-do can only ever be written by a source's service-role helper (p5-b).
- **The audit detail carries ids and field names only**, never a title, a step label or a note, and
  never a key containing "note": `writeAuditLog()` redacts such keys, so an id stored as `noteId`
  would arrive as `[redacted]`. The note route uses `logEntryId`.
- **Timeline stamps show the ward's date and time**, not the app's usual date-only UTC stamp. The
  plan contradicted itself here; timeline lines sit minutes apart, and a UTC time puts an 8pm
  Denver note on the next day. The user accepted it on the walk.
- **Deviations from the plan, all recorded in code:**
  - `wardDateOnly` got its own pure file, because `wardTimezone.ts` imports the server client and
    p5-c's pure aggregation needs the helper.
  - The page uses `can()` + `NotPermitted`, not `assertCan()`, because a throw in a Server
    Component is a 500.
  - Added: `GET /api/todos/[id]` for the timeline, and `respondToTodoError()` for the "saved, but
    the timeline line was not" 500.
  - Scheduling is already handled by PATCH, so p5-c only builds UI.
- **Two exact-list tests were changed deliberately.** `permissions.test.ts`'s non-overridable
  assertion now names `personal_tools.use`, and `navigation.test.ts`'s narrowed music coordinator
  keeps `/todos`.

## What broke, and the pattern behind it
- **Python rewrites on Windows turned 11 files to CRLF.** `open(p, "w")` is text mode and writes
  `\r\n`. `notification-triggers-seed.test.ts` then failed, because its `--.*$` strip does not match
  across the `\r`, so SPEC.md's trigger list stopped parsing. Fixed with `sed -i 's/\r$//'`.
  **Pattern:** a scripted rewrite on Windows must preserve line endings (`newline=""`, or the
  Edit/Write tools). The test that caught it had nothing to do with the files being edited.
- **075-D1:** the card's bare "mark done" checkbox was a 20×20 tap target, where the step
  checkboxes passed only because a label wrapped them. **Pattern:** a checkbox with an `aria-label`
  and no `<label>` around it has no hit area beyond its glyph; wrap it in a 44×44 label.
- **075-D2:** one card-level error slot put a step error 237px above the step field. **Pattern:**
  one mutation shared by several controls needs to carry where its error belongs (a `place` field
  on the variables), or every error lands in one spot.
- **`npm run build` ran while the user's dev server was up.** The build check came from memory and
  was skipped. It did no damage this time, but check the port first: this retro's own `related`
  entry (`sacrament-references-over-pgvector`) records that it can 404 every API route.
- **A controlled checkbox fails Playwright's `.check()`** ("did not change its state"), because it
  only flips after the server answers. That is not a defect: click, then read the database.
