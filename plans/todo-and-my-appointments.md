# Plan: To Do & My Appointments (P5)

**Created:** 2026-09-24
**Type:** feature
**Phase:** P5 — fleshes out the stub [P5-todo-and-appointments.md](P5-todo-and-appointments.md)
**Structure:** Three slices, `p5-a` → `p5-b` → `p5-c`, each its own commit(s). Slices `a` and `b`
each own one migration (P4's rule: a behaviour needing a migration is its own slice).

> ⚠️ **File name.** This is `todo-and-my-appointments.md`, not `p5-todo-and-appointments.md`: the
> stub is `P5-todo-and-appointments.md` and Windows paths are case-insensitive, so the obvious
> name would overwrite the stub.

## Overview

To Do is the **spine** other modules hang work on: Sacrament's finalize → ask → accept/decline
(P4 slices `f`/`g`), Agendas' delegate-to-absent-leader (P4 module 4), and Zoom's referral
assignment (P10). My Appointments is the leader's one chronological list of what they have
personally committed to.

### Decisions settled with the user before planning (2026-09-24)

| # | Question | Answer |
|---|---|---|
| D1 | Where does the agenda linkage land? | **P5 builds the link and the two-key rules; the Agendas assignee PICKER waits for P4's Agendas slice.** P5 adds `action_items.assigned_user_id` and accepts it through the existing API; the free-text `assigned_to` stays untouched. |
| D2 | Who can read a to-do? | **Owner only.** The assigner (e.g. the bishopric via an agenda item) sees only the review flag on *their own* agenda item — never the to-do, its steps or its log. The prototype's "settled" rule. |
| D3 | Can a leader put a to-do on somebody else's list directly? | **No — self only.** Another person's to-do arrives only through a source that owns the assignment (agenda item now; speaker ask and Zoom referral later). Enforced by the INSERT policy, not by the route. |
| D4 | Role-addressed meeting invites + conflict check? | **Deferred to P6** (they need Ward Calendar events). My Appointments is built as ONE aggregation over a list of sources, so P6 adds invites as a fourth source — never a second computation (P5 stub, "One computation, not two"). |

### Decisions made in this plan (flag to the user if they read wrong)

- **Person, not role, for every P5 entity** (the stub's first trap): a to-do, a step, a log line and
  every My Appointments source belong to a **person** (`auth.uid()`). Only P6's meeting invites
  will be role-addressed.
- **A to-do lives in the ward it was created in** (rule 1). A leader holding callings in two wards
  sees ward B's to-dos only while acting in ward B. Same for My Appointments.
- **One new permission, `personal_tools.use`**, gating both tiles, held by every adult ward role,
  and **non-overridable**: a ward switching To Do off for a role would make every agenda assignment
  to that role land in a list its owner cannot open. Stake officers, `resource_center_specialist`
  and `sacrament_manager` do not hold it (they reach nothing / one module).
- **No notification trigger is added.** An auto-created to-do simply appears on the list. Adding a
  trigger key means seed + SPEC + harness in step (`notification-trigger-drift`); do it when a walk
  shows it is needed, not speculatively.
- **"Untouched"** (for unassign cleanup) = zero steps AND zero log entries AND `completed_at` null
  AND `scheduled_for` null. Editing the title or dates does not count as touching it.
- **A to-do linked to an OPEN agenda item cannot be deleted by its owner** — 409 naming the
  alternative ("Mark it complete instead; that asks the bishopric to review the agenda item").
  Deleting would silently orphan an assignment the meeting made.

### Success criteria

- A leader can create a to-do with separate do-date and due-date, add steps, see progress computed
  from steps (none shown with zero steps), write notes, and read ONE timeline where automatic step
  lines interleave with notes by time.
- Nobody but the owner can read or write a to-do — proven at the table by an RLS test, including
  the bishop.
- Assigning an agenda action item to a user creates that user's linked to-do; reassigning deletes
  the old one only if untouched, otherwise unlinks and keeps it.
- Completing the action item flags the linked to-do (never deletes it); completing the to-do flags
  the action item for review only when a link exists.
- `/appointments` lists the leader's own visit appointments, scheduled to-dos and youth sign-ups
  in one chronological list, times in the **ward's** zone, past items behind a toggle and never
  removed. Google Calendar is a disabled card with an honest note.
- Lint, typecheck, full test suite and production build pass; `explicitTimeZone.test.ts`,
  `navigationRoutesExist.test.ts`, `user-author-fks.test.ts` and `ward-isolation.test.ts` stay green.

## Relevant Files

**Slice p5-a — To Do core**
- `supabase/migrations/081_todos.sql` — create — `todos`, `todo_steps`, `todo_log_entries`, owner-only RLS
- `types/database.ts` — regenerate — `npm run db:types`
- `types/domain.ts` — modify — `Todo`, `TodoStep`, `TodoLogEntry`, `TODO_LOG_KINDS`, `TodoViewState`
- `lib/auth/permissions.ts` — modify — add `personal_tools.use`, grant it, make it non-overridable
- `lib/auth/navigation.tsx` — modify — To Do tile (`built: true`); My Appointments row (`built: false` until p5-c); update the "EMPTY TODAY" comment on the `tasks` section
- `lib/todos/progress.ts` — create — pure `todoProgress(steps)`
- `lib/todos/viewState.ts` — create — pure `todoViewState(todo, today)` + `compareTodos`
- `lib/todos/untouched.ts` — create — pure `isTodoUntouched(todo, stepCount, logCount)`
- `lib/todos/logLines.ts` — create — pure `describeLogEntry(entry)` → the sentence rendered for an automatic line
- `lib/todos/queries.ts` — create — server-client reads/writes (owner-scoped)
- `lib/validation/todo.ts` — create — Zod schemas
- `app/api/todos/route.ts` — create — GET list, POST create
- `app/api/todos/[id]/route.ts` — create — PATCH (edit / complete / reopen / schedule), DELETE
- `app/api/todos/[id]/steps/route.ts` — create — POST add step
- `app/api/todo-steps/[id]/route.ts` — create — PATCH (label / done), DELETE
- `app/api/todos/[id]/notes/route.ts` — create — POST a written note
- `app/(app)/todos/page.tsx` — create — Server Component, `assertCan(personal_tools.use)`
- `app/(app)/todos/TodoList.tsx` — create — client list + filters
- `app/(app)/todos/TodoCard.tsx` — create — collapsed card; expands inline to steps + timeline
- `app/(app)/todos/TodoFormDialog.tsx` — create — create/edit window (shared `Modal`)
- `app/(app)/todos/TodoTimeline.tsx` — create — the one combined log
- `SPEC.md`, `FEATURES.md` — modify — schema, routes, permission, module status

**Slice p5-b — Agenda link and two-key completion**
- `supabase/migrations/082_action_item_todo_link.sql` — create — `action_items.assigned_user_id`, `action_items.completion_review_requested_at`, `todos.action_item_id`, `todos.source_completed_at`
- `types/database.ts` — regenerate
- `types/domain.ts` — modify — new `Todo` fields
- `lib/agendas/queries.ts` — modify — `ActionItem` type, column list, mapper, create/update patch for the two new columns (rule 9)
- `lib/validation/agenda.ts` — modify — `assignedUserId` (uuid | null, optional) on create + update schemas
- `lib/todos/sourceLinks.ts` — create — service-role writes to ANOTHER user's to-dos: `syncActionItemTodo()`, `flagTodosForCompletedActionItem()`
- `lib/todos/queries.ts` — modify — complete path flags the linked action item; delete refusal when linked
- `app/api/action-items/[id]/route.ts` — modify — assignee change + completion call into `sourceLinks`
- `app/api/agendas/[id]/action-items/route.ts` — modify — create with `assignedUserId` creates the to-do
- `app/api/todos/[id]/route.ts` — modify — 409 on delete when linked to an open item; flag on complete
- `app/(app)/agendas/[id]/…` action-item row component — modify — read-only "Marked done by the assignee — review" badge when `completionReviewRequestedAt` is set (find the component that renders an action item; no picker change)
- `app/(app)/todos/TodoCard.tsx` — modify — "Marked complete on the agenda" flag + "From the agenda of <date>" source line

**Slice p5-c — Schedule this, and My Appointments**
- `app/(app)/todos/ScheduleDialog.tsx` — create — "Schedule this" window (date + time in ward zone, optional member, notes)
- `lib/appointments/myAppointments.ts` — create — pure `buildMyAppointments(sources, asOf)`
- `lib/appointments/queries.ts` — create — reads the three sources for `auth.uid()`
- `app/(app)/appointments/page.tsx` — create
- `app/(app)/appointments/AppointmentList.tsx` — create — upcoming list + "Show past (N)" toggle
- `app/(app)/appointments/CalendarSyncCard.tsx` — create — disabled Google Calendar card
- `lib/auth/navigation.tsx` — modify — My Appointments `built: true`
- `app/(app)/sacrament/page.tsx` — modify — add `/todos` to `SACRAMENT_SHORTCUT_HREFS` (last, the prototype's position)
- `components/layout/ContextualBackLink.tsx` — modify — add `sacrament` → `/sacrament` origin if not already present, so `/todos?from=sacrament` renders a back link

**All slices — docs, tests, harness**
- `plans/P5-todo-and-appointments.md` — modify — status line pointing here, and per-slice progress
- `plans/INDEX.md` — modify — P5 row status
- `plans/prototype/module-map.md` — modify — §2.10 "BUILT" note; §6.5 unchanged
- `CLAUDE.md` §9 — modify — one entry recording D1–D4 and the person-not-role rule
- Tests and scenarios listed under Testing Strategy

## Dependencies

- **No new libraries.** Icons from `lucide-react`, imported per icon (`ListTodo`, `CalendarClock` — verify both exist in the installed version; pick close alternatives if not).
- **Existing utilities to reuse — do not re-derive:**
  - `writeAuditLog()` (`lib/audit/writeAuditLog.ts`) — every mutation, module `"todos"`
  - `requireSessionUser()`, `resolveRoleAccess(supabase, wardId, orgType)`, `assertCan()`
  - `readJsonBody()`, `respondToRouteError()` (`lib/auth/routeErrors.ts`) — follow `app/api/action-items/[id]/route.ts` exactly
  - `findUsersOutsideWard()` (`lib/callings/queries.ts`) — for `assigned_user_id` (a SUBJECT column written from a request body)
  - `createServiceSupabaseClient()` (`lib/supabase/service.ts`) — only in `lib/todos/sourceLinks.ts`
  - `readWardTimezone()` / `parseWardTimezone()` (`lib/ward/wardTimezone.ts`) and the `wallClockToInstant` helper used by the youth module — for "Schedule this" input and all rendering
  - `appointmentViewState()` (`lib/visits/appointmentStatus.ts`) — a visit appointment's `missed` state
  - `Modal`, `Pill`, `Card`, `Button` from `components/ui/*`; `ContextualBackLink`; `ModuleShortcutRow`
  - `tests/helpers/routeClient.ts` (`actAs`, `jsonRequest`, `readResponse`), `tests/helpers/seed.ts` (`seedFixtures`)
- **Configuration:** none. Two migrations pushed with `npm run db:push` against the hosted project; `npm run db:types` after each.

## Known Pitfalls (from retro context)

- **ward-callings-model** — never write a composite `(user_col, ward_id) → users (id, ward_id)` foreign key. Every user reference here is a plain `references users (id)`. `tests/db/user-author-fks.test.ts` fails otherwise. `assigned_user_id` is a **subject** written from a request body, so the route must call `findUsersOutsideWard()` and answer 400 with a sentence.
- **visits-d / migration 047** — a composite FK with `on delete set null` nulls `ward_id` too and fails NOT NULL. For `todos.action_item_id` use `on delete set null (action_item_id)` (column-list form, as 047/054/059 do). `action_items` has no `unique (id, ward_id)`, so a plain single-column FK is the honest choice anyway.
- **p3-shell-and-tile-dashboard** — `.insert().select()` applies the SELECT policy to RETURNING. Owner inserts are fine (owner can read). Any insert **for another user** (auto-create on assignment) must use the service-role client, never the caller's client, or it raises 42501.
- **youth-h (060-D2)** — a failed WITH CHECK *raises*, a failed USING returns zero rows. Keep USING and WITH CHECK **identical** on every todo policy, and treat zero rows from an UPDATE/DELETE as a 404.
- **role-access-overrides / p2-admin-and-access** — `can()`/`assertCan()` need the resolved `roleAccess`; `resolveRoleAccess` needs `user.orgType` with no default. Resolve once per request.
- **Rule 12 / `explicitTimeZone.test.ts`** — every `Intl.DateTimeFormat` / `toLocale*` names its zone. `do_date`/`due_date` are `date` columns → UTC. `scheduled_for`, visit appointments and youth events are turn-up-at times → the **ward's** zone. "Today" for overdue/do-today is the **ward's** date, never `new Date().toISOString().slice(0, 10)` (UTC, wrong after 6pm Mountain).
- **notification-trigger-drift** — no trigger key is added in P5; if one ever is, seed, SPEC and harness change together.
- **p4-sacrament-music-month / music-collapsed-list** — no test imports a page; the walk finds the defects. §6.5: To Do is a **flat list + filters**, My Appointments a **flat list + `showPast`**. Neither is a jump target, so neither needs single-open state, and neither gets an "Expand all".
- **sacrament-references-over-pgvector** — `npm run build` while `npm run dev` is running makes every API route 404. Stop the dev server before building.
- **compact-ui-preference (memory)** — results-only lists, small grouped per-item buttons opening windows, ✕ to remove, popups fit content.

## Tasks

### Slice p5-a — To Do core (commit 1: schema + API; commit 2: page)

#### Task 1: Migration 081 — tables and owner-only RLS
**File:** `supabase/migrations/081_todos.sql` (create)
**Action:** Three tables, RLS enabled, four policies each. Header comment states D2 and D3 and why.
**Details:**
```sql
create table todos (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,
  user_id       uuid not null references users (id) on delete cascade,  -- the OWNER
  assigned_by   uuid references users (id) on delete set null,          -- null means self (visit_participants' idiom)
  title         text not null check (length(btrim(title)) between 1 and 300),
  notes         text,
  tag           text check (tag is null or length(btrim(tag)) between 1 and 40),
  do_date       date,     -- when I intend to work on it
  due_date      date,     -- when it must be done
  scheduled_for timestamptz,  -- "Schedule this" (p5-c) — an EVENT, so timestamptz (CLAUDE.md §6)
  scheduled_with_member_id uuid,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (scheduled_with_member_id, ward_id) references members (id, ward_id)
    on delete set null (scheduled_with_member_id)
);
create table todo_steps (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references wards (id) on delete cascade,
  todo_id uuid not null,
  label text not null check (length(btrim(label)) between 1 and 200),
  position integer not null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (todo_id, ward_id) references todos (id, ward_id) on delete cascade
);
create table todo_log_entries (
  id uuid primary key default gen_random_uuid(),
  ward_id uuid not null references wards (id) on delete cascade,
  todo_id uuid not null,
  kind text not null check (kind in ('note','step_done','step_undone','completed','reopened','scheduled','unscheduled','source_completed')),
  body text,  -- the note text for 'note'; the step label SNAPSHOT for step kinds (a renamed or deleted step keeps its history)
  created_at timestamptz not null default now(),
  check ((kind = 'note') = (body is not null and length(btrim(body)) > 0) or kind <> 'note'),
  foreign key (todo_id, ward_id) references todos (id, ward_id) on delete cascade
);
```
- `scheduled_for` and `scheduled_with_member_id` go in 081, not p5-c's own migration: they are columns of the core entity and p5-c then needs none. `source_completed` is in the kind CHECK now so 082 does not have to rewrite the constraint.
- Indexes: `todos (ward_id, user_id, completed_at)`, `todos (user_id, scheduled_for) where scheduled_for is not null`, `todo_steps (todo_id, position)`, `todo_log_entries (todo_id, created_at)`.
- **Policies — `todos`:** SELECT/UPDATE/DELETE `using (ward_id = current_ward_id() and user_id = auth.uid())`; UPDATE `with check` the identical predicate; INSERT `with check (ward_id = current_ward_id() and user_id = auth.uid() and assigned_by is null)` — **this is where D3 lives**: an authenticated client cannot create a to-do for anyone else, or claim one was assigned.
- **Policies — `todo_steps`, `todo_log_entries`:** all four verbs `ward_id = current_ward_id() and exists (select 1 from todos t where t.id = todo_id and t.ward_id = <table>.ward_id and t.user_id = auth.uid())`, identical USING/WITH CHECK.
- **No bishopric arm anywhere.** Say so in the header: rule 5's shape, applied by product decision rather than by rule.
- Log entries are **append-only for the owner in practice** (no route updates them), but the policy permits owner DELETE so deleting the parent cascades cleanly under the owner's own client.

#### Task 2: Types
**Files:** `types/database.ts` (regenerate with `npm run db:types`), `types/domain.ts` (modify)
**Details:**
- `TODO_LOG_KINDS` as a `const` tuple mirroring the CHECK, `TodoLogKind`.
- `Todo = { id; title; notes: string|null; tag: string|null; doDate: DateOnly|null; dueDate: DateOnly|null; scheduledFor: string|null; scheduledWithMemberId: string|null; completedAt: string|null; assignedBy: string|null; createdAt; updatedAt }` (p5-b adds `actionItemId`, `sourceCompletedAt`).
- `TodoStep = { id; todoId; label; position; doneAt: string|null }`, `TodoLogEntry = { id; todoId; kind: TodoLogKind; body: string|null; createdAt }`.
- `TodoViewState = "done" | "overdue" | "due_today" | "do_today" | "upcoming" | "someday"` with a `TODO_VIEW_STATE_LABELS` record.

#### Task 3: Permission `personal_tools.use`
**File:** `lib/auth/permissions.ts` (modify)
**Details:**
- Append `"personal_tools.use"` to `PERMISSIONS` (bishopric inherits it via `BISHOPRIC_PERMISSIONS = PERMISSIONS`).
- Add to `WARD_SECRETARY_PERMISSIONS`, `EXECUTIVE_SECRETARY_PERMISSIONS`, `ORG_LEADERSHIP_BASE`, `ORG_SECRETARY_BASE`, `MUSIC_COORDINATOR_PERMISSIONS`, `WARD_COUNCIL_MEMBER_PERMISSIONS`. **Not** stake officers, `resource_center_specialist`, `sacrament_manager`. Check what `super_admin`'s entry holds and follow its existing pattern.
- Extend `NON_OVERRIDABLE_PERMISSIONS`' filter with `|| permission === "personal_tools.use"`, and add a paragraph to its comment giving the reason (switching it off would strand agenda assignments).
- Run `tests/lib/permissions.test.ts` and `tests/lib/accessModules.test.ts`; update any exact-list assertion **deliberately** and say which in the retro. `lib/access/accessModules.ts` must not offer it (it is non-overridable, which the existing assertion enforces).
- Grep `SPEC.md` for the permission list and add it there.

#### Task 4: Pure logic
**Files:** `lib/todos/progress.ts`, `lib/todos/viewState.ts`, `lib/todos/untouched.ts`, `lib/todos/logLines.ts` (create). `@/types/domain` imports only, **no clock** — `today` is a parameter.
**Details:**
- `todoProgress(steps): { done: number; total: number; fraction: number } | null` — `null` for zero steps (a plain item shows no progress at all, never "0/0").
- `todoViewState(todo, today: DateOnly): TodoViewState` — branch order: `completedAt` → `done`; `dueDate < today` → `overdue`; `dueDate === today` → `due_today`; `doDate <= today` → `do_today`; any date set → `upcoming`; else `someday`. Due beats do: a missed deadline is the louder fact.
- `compareTodos(a, b, today)` — open before done; then state rank (overdue, due_today, do_today, upcoming, someday); then earliest of due/do date ascending, nulls last; then `createdAt`. Done items: `completedAt` descending.
- `isTodoUntouched({ completedAt, scheduledFor }, stepCount, logCount)` — the definition in Overview.
- `describeLogEntry(entry)` — `step_done` → `Checked off "<body>"`, `step_undone` → `Unchecked "<body>"`, `completed` → `Marked complete`, `reopened` → `Reopened`, `scheduled` → `Scheduled`, `unscheduled` → `Unscheduled`, `source_completed` → `Marked complete on the agenda`; `note` → the body. Exhaustive `switch` with a `never` check so a new kind is a compile error.

#### Task 5: Queries
**File:** `lib/todos/queries.ts` (create) — server client only; follow `lib/visits/appointments.ts`' shape (one-line column literal, explicit mapper, `toX()` guards that throw on an unknown CHECK value).
**Functions:** `listTodos(wardId, filter)`, `getTodoDetail(wardId, id)` → `{ todo, steps, log }`, `createTodo(wardId, userId, input)`, `updateTodo(wardId, id, patch)` (returns `null` on zero rows), `setTodoCompleted(wardId, id, completed)` (writes `completed_at` **and** a `completed`/`reopened` log line), `deleteTodo`, `addStep`, `updateStep` (on a `doneAt` change writes a `step_done`/`step_undone` line with the label snapshot), `deleteStep`, `addNote`.
- Positions: new step = max + 1. No reorder route in P5 (note it as a follow-up).
- **Two writes, no transaction** (step then log line): if the second write fails, throw — the route answers 500 with "The step was saved but its log line was not. Please refresh." Never swallow it (rule 7). Say in a comment that the step row is the truth and the log is the narrative.
- Every write filters `.eq("ward_id", wardId)` (rule 1) even though RLS also does.

#### Task 6: Validation
**File:** `lib/validation/todo.ts` (create)
- `createTodoSchema`: title (trimmed, 1–300), notes?, tag? (1–40), doDate?, dueDate? (`isValidDateOnly`). **No refinement forcing do ≤ due** — a leader can intend to start after a soft due date; do not invent a rule.
- `updateTodoSchema`: all optional + `complete?: boolean` + `scheduledFor?: string (ISO instant) | null` + `scheduledWithMemberId?: uuid | null`; `.refine` at least one key.
- `createStepSchema`, `updateStepSchema` (`label?`, `done?`), `createNoteSchema` (body 1–2000), `todoIdSchema`.
- **No `userId` or `assignedBy` field on any schema** — the owner is always `user.id` from the session.

#### Task 7: Routes
**Files:** `app/api/todos/route.ts`, `app/api/todos/[id]/route.ts`, `app/api/todos/[id]/steps/route.ts`, `app/api/todo-steps/[id]/route.ts`, `app/api/todos/[id]/notes/route.ts` (create)
**Details:** Copy `app/api/action-items/[id]/route.ts`' skeleton: `requireSessionUser` → server client → `resolveRoleAccess` → `assertCan(user, "personal_tools.use", roleAccess)` → Zod parse → query → `null` ⇒ **404** "That to-do could not be found." → `writeAuditLog({ module: "todos", action: "todo_created" | "todo_updated" | "todo_completed" | "todo_reopened" | "todo_deleted" | "todo_step_added" | "todo_step_updated" | "todo_step_deleted" | "todo_note_added", detail: { todoId, … } })`.
- **The audit detail never carries a note body or step label** — to-dos are private (D2); the audit log is readable by `audit.view`. Ids and field names only.
- `params` is a Promise (Next 16).

#### Task 8: Navigation
**File:** `lib/auth/navigation.tsx` (modify)
- `{ label: "To Do", href: "/todos", permission: "personal_tools.use", section: "tasks", blurb: "Your own tasks and projects — and what meetings have asked of you.", icon: <ListTodo />, accent: "gold", built: true }`
- `{ label: "My Appointments", href: "/appointments", …, icon: <CalendarClock />, accent: "gold", built: false }` — flipped in p5-c.
- Rewrite the `tasks` section comment: the section now renders; Message and Zoom are P10.
- `tests/lib/navigation.test.ts` asserts accent = section accent; confirm gold matches.

#### Task 9: `/todos` page
**Files:** `app/(app)/todos/page.tsx`, `TodoList.tsx`, `TodoCard.tsx`, `TodoFormDialog.tsx`, `TodoTimeline.tsx` (create)
**Details:**
- `page.tsx` (Server Component): `requireSessionUser`, `assertCan(personal_tools.use)`, `readWardTimezone` once, compute `today` as the **ward's** date (look for an existing ward-date helper in `lib/ward/` or `lib/youth/` first; if none exists, add a tiny `wardDateOnly(instant, zone)` to `lib/ward/wardTimezone.ts` using `Intl.DateTimeFormat("en-CA", { timeZone: zone, … })`, with a test), fetch `listTodos`, pass `initialData` + `today` + `wardZone` to the client list. `ContextualBackLink from={searchParams.from}`.
- **Shape (§6.5): flat list + filters.** Filter pills: **Open** (default) · **Done**; a tag filter appears only when at least one tag exists. No month navigation, no expand-all.
- `TodoCard` collapsed: title, state pill (`TODO_VIEW_STATE_LABELS`), due/do dates (UTC formatter — `date` columns), progress `2/5` only when `todoProgress` is non-null, tag. Actions as a small grouped button row: **Done** (checkbox-style), **Edit** (opens `TodoFormDialog`), **✕** (delete, with confirm). Tapping the card body expands it inline.
- Expanded: steps (checkbox + label, ✕ to remove, "Add a step" input — adding the first step is what makes it a project, **no mode switch, no "convert" button**), then `TodoTimeline`: one list ordered by `createdAt` ascending, notes in normal text, automatic lines muted/smaller via `describeLogEntry`, each stamped in the **ward's** zone ("when did this happen" stamps are UTC by rule 12 — **use UTC** here, matching `VersionHistory`; say so in a comment), plus an "Add a note" textarea.
- TanStack Query for mutations; on error show the route's `error` sentence inline next to the control (rule 7). Use the P3 `Tile`/`Card` tokens; test 375px and dark mode during the walk.

### Slice p5-b — Agenda link and two-key completion (one commit)

#### Task 10: Migration 082
**File:** `supabase/migrations/082_action_item_todo_link.sql` (create)
```sql
alter table action_items
  add column assigned_user_id uuid references users (id) on delete set null,
  add column completion_review_requested_at timestamptz;
alter table todos
  add column action_item_id uuid references action_items (id) on delete set null,
  add column source_completed_at timestamptz;
create unique index todos_one_per_action_item_owner on todos (action_item_id, user_id) where action_item_id is not null;
```
- Header: `assigned_to` (free text) is **not** touched or backfilled — a typed name cannot be resolved to an account honestly. The Agendas slice (P4 module 4) replaces the free-text control with a picker writing `assigned_user_id`. Until then the column is written only through the API and the harness seed.
- **No policy moves.** `action_items` sits in migration 019's ward-wide loop, so a to-do owner may already write `completion_review_requested_at` with their own client. `todos` stays owner-only, which is why the forward direction needs the service role (Task 12).
- The partial unique index makes auto-create idempotent under a double submit.

#### Task 11: Action item type and schemas
**Files:** `lib/agendas/queries.ts`, `lib/validation/agenda.ts` (modify)
- Add `assigned_user_id, completion_review_requested_at` to the column literal (one line), the row type, `ActionItem` (`assignedUserId`, `completionReviewRequestedAt`) and the mapper — **rule 9, same change**.
- `createActionItem` / `updateActionItem` accept `assignedUserId`. When `complete` flips to **false** (reopen), also clear `completion_review_requested_at`; when it flips to **true**, clear it too (the review was answered by completing).
- Schemas: `assignedUserId: z.uuid().nullable().optional()`.
- Check `carryForward.ts`: a carried-forward item keeps `assignedUserId` (the assignment stands) — map it through and note that the to-do link stays on the ORIGINAL item row, which is correct because carry-forward copies the item.

  > ⚠️ **Open question for the executor to confirm in code:** if carry-forward *copies* an open item into a new agenda and the original stays open, the to-do stays linked to the original. Read `carryForward.ts` and state which row is "the" live item; if the original is marked complete when carried, the two-key flag would fire wrongly — in that case skip the flag when the completion comes from carry-forward, and test it.

#### Task 12: Service-role link writes
**File:** `lib/todos/sourceLinks.ts` (create)
**Header:** why the service role is used (owner-only RLS; the caller has passed `assertCan(agendas.manage)`, and the action item was read through the caller's own RLS-scoped client first, so its `ward_id` is trusted). Every write sets and filters `ward_id` explicitly — the service role has no RLS behind it.
**Functions:**
- `syncActionItemTodo({ wardId, actionItem, previousAssignedUserId, assignedByUserId })`:
  - If the assignee is unchanged, do nothing.
  - Previous assignee's linked to-do: load it with step and log counts; `isTodoUntouched` ⇒ delete; else set `action_item_id = null` (kept, unlinked — "never destroy what somebody wrote").
  - New assignee (non-null, item still open): insert `{ ward_id, user_id: newAssignee, assigned_by: assignedByUserId, title: actionItem.description, due_date: actionItem.dueDate, action_item_id }`. On the unique-index conflict, treat as already created (idempotent).
  - Returns `{ created: string | null; deleted: string | null; unlinked: string | null }` for the audit detail.
- `flagTodosForCompletedActionItem({ wardId, actionItemId })`: `update todos set source_completed_at = now() where action_item_id = … and completed_at is null and source_completed_at is null`, plus insert a `source_completed` log line on each. **Never deletes.** On reopen of the action item, clear `source_completed_at` (a mis-tick must be recoverable — 060a's rule).

#### Task 13: Wire the agenda routes
**Files:** `app/api/action-items/[id]/route.ts`, `app/api/agendas/[id]/action-items/route.ts` (modify)
- Before writing, when `assignedUserId` is present and non-null: `findUsersOutsideWard(user.wardId, [assignedUserId])` → non-empty ⇒ throw `InvalidInputError` ("That person does not hold a calling in this ward.") ⇒ 400.
- PATCH: read the item's current `assignedUserId` first (RLS client), update, then `syncActionItemTodo` when it changed; on `complete: true` call `flagTodosForCompletedActionItem`; on `complete: false` clear the flags.
- DELETE of an action item: the FK sets the to-do's `action_item_id` null automatically (the to-do survives). Before deleting, delete the linked to-do **only if untouched**, via the same helper — otherwise an untouched auto-created to-do would outlive a line typed by mistake.
- Audit detail gains `assignedUserId` and the `syncActionItemTodo` result ids. **Order:** item write → link write → audit. If the link write fails, return 500 with "The action item was saved, but the assignee's to-do could not be updated. Please try again." (rule 7) — re-running is safe because the helper is idempotent.

#### Task 14: The reverse key
**Files:** `lib/todos/queries.ts`, `app/api/todos/[id]/route.ts` (modify)
- On `complete: true` for a to-do with `action_item_id` whose item is still `open`: set `action_items.completion_review_requested_at = now()` with the **caller's own client** (ward-wide policy). With no link it is a plain one-step complete. On reopen, clear it if still set.
- DELETE: if `action_item_id` is set and the item is `open` ⇒ **409** "This came from an agenda item that is still open. Mark it complete instead — that asks the bishopric to review it." Disclose nothing else.

#### Task 15: Surface both flags
- **Agenda side:** in the component that renders an action item row under `app/(app)/agendas/[id]/`, a small `Pill` "Assignee marked done — review" when `completionReviewRequestedAt` is set and the item is open. Read-only; completing the item is the existing control. This is not the assignee picker (D1) — it is the minimum that stops the flag being invisible, which was the prototype's own named gap.
- **To-do side:** `TodoCard` shows "Marked complete on the agenda" (warning tone) when `sourceCompletedAt` is set and the to-do is open, plus a quiet "From the <meeting type> agenda" source line when `actionItemId` is set. The owner completes or deletes it themselves; nothing auto-completes (rule "confirm, don't silently act").

### Slice p5-c — Schedule this, and My Appointments (commit 1: schedule; commit 2: page)

#### Task 16: "Schedule this" on a to-do
**File:** `app/(app)/todos/ScheduleDialog.tsx` (create); `TodoCard.tsx`, `lib/todos/queries.ts` (modify)
- A **Schedule** button in the card's button group opens a window: date + time inputs read as the **ward's** wall clock and converted with the youth module's `wallClockToInstant` (never `new Date("…T19:30")`, which is the browser's zone), an optional member picker (reuse the roster picker the visits module uses), optional notes appended as a `note` line.
- PATCH `scheduledFor` (+ `scheduledWithMemberId`) writes a `scheduled` log line; clearing writes `unscheduled`. The member id is a `members` id, ward-scoped by its composite FK — no `findUsersOutsideWard` needed (that is for **user** ids).
- The card shows the scheduled time in the ward's zone with an explicit `timeZone`.

#### Task 17: The one aggregation
**File:** `lib/appointments/myAppointments.ts` (create) — pure, `@/types/domain` imports only.
```ts
export type MyAppointmentSource =
  | { kind: "visit"; id: string; startsAt: string; allDay: false; title: string; href: string; viewState: AppointmentViewState }
  | { kind: "todo"; id: string; startsAt: string; allDay: false; title: string; href: string }
  | { kind: "youth"; id: string; startsAt: string; allDay: boolean; title: string; href: string };
export function buildMyAppointments(sources: readonly MyAppointmentSource[], asOf: Date, wardZone: string):
  { upcoming: MyAppointmentSource[]; past: MyAppointmentSource[] };
```
- Upcoming ascending by `startsAt`; past **descending** (most recent first). An all-day youth event is past only when its **ward** date is before today's ward date — not at midnight UTC.
- **Nothing is dropped.** A past item is moved to `past`, never filtered out (the stub: "never destroyed").
- The header states that P6 adds `{ kind: "meeting_invite" }` here and that a conflict check must call **this** function — the prototype forked it once and had to fold it back.

#### Task 18: Source reads
**File:** `lib/appointments/queries.ts` (create) — server client, each read filtered to the caller:
- **Visit appointments:** `visit_appointments` where `made_by = user.id` and `status <> 'cancelled'`, joined to `households (family_name)`; title "Visit — <family> family"; `viewState` from `appointmentViewState`; href `/visits`. (Companion invites are P4 Visits behaviour 1; when they land, invited-and-accepted rows join this read.)
- **Scheduled to-dos:** `todos` where `scheduled_for is not null`; href `/todos#todo-<id>` (give `TodoCard` that `id`). Completed scheduled to-dos still appear (in past, if past) — the commitment happened.
- **Youth sign-ups:** `activity_attendees` where `user_id = user.id`, joined to `activity_events (id, title, event_date, all_day, status)` excluding `cancelled`; href `/youth/events/<event_id>`. Read the existing `lib/youth/attendees.ts` embed names (the `…_user_id_ward_id_fkey` hints may have been renamed by migration 069 — check `types/database.ts` for the current constraint names before copying an embed hint).
- Run the three reads with `Promise.all`; any error throws (the page's error boundary shows it) — never render a partial list silently.

#### Task 19: `/appointments` page
**Files:** `app/(app)/appointments/page.tsx`, `AppointmentList.tsx`, `CalendarSyncCard.tsx` (create); `lib/auth/navigation.tsx` (flip `built: true`)
- Shape (§6.5): flat list + a **"Show past (N)"** toggle, collapsed by default. Each row: time (ward zone, explicit `timeZone`), kind icon + label, title, a link to the source, and the inline action for its kind: **Cancel** for a visit appointment (existing `PATCH /api/visit-appointments/[id]` — read its schema for the exact body), **Unschedule** for a to-do (`PATCH /api/todos/[id] { scheduledFor: null }`). Youth rows have no inline action.
- Empty state: one sentence ("Nothing scheduled. Visit appointments, scheduled to-dos and youth events you've signed up for appear here.").
- `CalendarSyncCard`: a disabled **Connect Google Calendar** button with the note "Not available yet — connecting a calendar needs Google sign-in, which this app does not have. Your appointments are listed here in the meantime." Never a button that pretends.

#### Task 20: Shortcut row and back link
- `app/(app)/sacrament/page.tsx`: append `"/todos"` to `SACRAMENT_SHORTCUT_HREFS` and pass `?from=sacrament` if the row supports per-link query params; otherwise leave the back link to the chrome bar and note it.
- `components/layout/ContextualBackLink.tsx`: add a `sacrament` origin if absent.

### Docs (last task of each slice, same commit)

#### Task 21: Keep the specs true
- `SPEC.md`: tables, routes, `personal_tools.use`.
- `FEATURES.md`: Modules 18/19 status (`✅ P5`) and one sentence each for D2/D3.
- `plans/P5-todo-and-appointments.md`: status → pointer to this file + slice progress.
- `plans/INDEX.md`: P5 row status.
- `plans/prototype/module-map.md` §2.10: a "BUILT" note naming what was deferred (assignee picker → P4 Agendas; meeting invites + conflict check → P6; Google sync → out of scope).
- `CLAUDE.md` §9: one entry — "A to-do is private to its owner and created only by its owner; other people's work arrives through a source (service role behind the source's guard). Person, not role, for everything in P5; P6's meeting invites are the first role-addressed entity."

## Testing Strategy

Priority order per CLAUDE.md §8.

**RLS (highest value)**
- `tests/rls/todos.test.ts` (create): seed two wards with `seedFixtures`; as owner: create/read/update/delete own to-do, step, log line. As **bishop in the same ward**: `select` returns zero rows for the org president's to-do, step and log; UPDATE/DELETE are zero-row (assert by **re-reading with the service client**); INSERT with `user_id = <other>` **raises**; INSERT with `assigned_by` set **raises**; ward B user sees nothing. Anchor: the owner's own read returns exactly one row, so an all-empty result cannot pass by accident. `fixtures.cleanup()` in `afterAll`.
- `tests/rls/ward-isolation.test.ts`: run it; the three new tables carry `ward_id`, so the exact exception list must not change.

**Permissions**
- `tests/lib/permissions.test.ts`: `personal_tools.use` held by every adult ward role, not by stake officers / RCS / `sacrament_manager`; `mergeRoleAccess` refuses a delta removing it.

**Pure logic**
- `tests/lib/todoProgress.test.ts`: zero steps → `null`; 0/3, 2/3, 3/3.
- `tests/lib/todoViewState.test.ts`: each branch; due beats do; done beats everything; `compareTodos` ordering including nulls last.
- `tests/lib/todoUntouched.test.ts`: each of the four conditions alone makes it touched.
- `tests/lib/todoLogLines.test.ts`: every `TODO_LOG_KINDS` value has a sentence (loop over the tuple).
- `tests/lib/myAppointments.test.ts`: interleaves three kinds chronologically; past descending; nothing dropped (input length = upcoming + past); an all-day youth event today in Denver is **upcoming** at 23:00 local (= 05:00 UTC next day) — the zone trap as a test.
- If `wardDateOnly` is added: a 7:30pm Denver instant returns the Denver date, not the UTC one.

**Routes** (`// @vitest-environment node`, `routeClient` helper)
- `tests/routes/todos.test.ts`: create → 201 + audit row; PATCH step done writes a `step_done` log line; another user's to-do id → 404; a role without `personal_tools.use` (a stake officer fixture, if the fixtures have one; otherwise `resource_center_specialist`) → 403; audit detail contains no note text.
- `tests/routes/action-item-todo-link.test.ts` (p5-b): assign → assignee has one linked to-do (read with service client); assign twice → still one; reassign untouched → old deleted; reassign after adding a step → old kept with `action_item_id` null; complete item → to-do gets `source_completed_at` + log line and **still exists**; reopen item → flag cleared; to-do owner completes → item gets `completion_review_requested_at`; unlinked to-do complete touches no action item; delete linked open to-do → 409; assignee outside the ward → 400 and no to-do created.

**Mechanical guards to keep green:** `explicitTimeZone.test.ts`, `navigationRoutesExist.test.ts`, `user-author-fks.test.ts`, `tests/db/migrations.test.ts`.

## Test Scenarios (Harness)

New area folder `testing/scenarios/todos/` (copy `_templates/`). Numbers continue from 074.

### Scenario 075: A to-do that became a project
**Tags:** todos, full, P5
**Purpose:** The shape of the list only shows with data — overdue vs do-today vs someday ordering, a project's computed progress, and a timeline where automatic lines and notes interleave. Seeding gives all of them at once.
**Seed data summary:**
- `todos` — 5 for the org president: plain someday item; item due yesterday (overdue); item with do-date today; project with 3 steps (1 done); a completed item
- `todo_steps` — 3 on the project; `todo_log_entries` — a `step_done` line between two notes, timestamps 10 minutes apart
- One to-do owned by the **bishop** (the privacy check)
**Tester action:** Sign in as the org president; open To Do from the dashboard; work the project; add a step to the plain item; switch to Done.
**Verification checklist:**
- [ ] The Tasks & Communication section appears on the dashboard with a To Do tile
- [ ] Order is overdue → do-today → project/someday; the done item is only under **Done**
- [ ] The plain item shows **no** progress; after adding one step it shows `0/1` with no mode switch
- [ ] Checking a step adds a muted "Checked off …" line **between** the notes by time, not in a separate list
- [ ] The bishop's to-do is not visible to the org president, and signing in as the bishop does not show the president's
- [ ] At 375px, the button group stays on one row and titles wrap; dark mode timeline lines stay legible
- [ ] Does the difference between "Do" and "Due" read clearly without explanation? (judgement)

### Scenario 076: Two keys, one agenda item
**Tags:** todos, agendas, full, P5
**Purpose:** The two-key rules cross two people and two modules, and the assignee picker does not exist yet (D1), so the only way to reach the state is to seed it.
**Seed data summary:**
- `agendas` — one bishopric agenda; `action_items` — A: assigned (`assigned_user_id`) to the org president, linked to-do untouched; B: assigned to the org president, linked to-do with 2 steps and a note
- The linked `todos` rows with `assigned_by` = bishop
**Tester action:** As the bishop, complete item A on the agenda. As the org president, open To Do; then complete the to-do for B. As the bishop, open the agenda.
**Verification checklist:**
- [ ] After the bishop completes A, the president's to-do for A is **still there**, marked "Marked complete on the agenda", with a timeline line saying so
- [ ] The president completing B's to-do shows "Assignee marked done — review" on item B in the agenda; B is **not** completed automatically
- [ ] Deleting B's to-do before completing it is refused with the sentence naming "Mark it complete instead"
- [ ] The bishop cannot see the president's steps or notes anywhere
- [ ] Audit rows exist for each action; none contains the note text
- [ ] Does "review" on the agenda read as something the bishop is expected to act on? (judgement)

### Scenario 077: Everything I've said I'll be at
**Tags:** appointments, visits, youth, todos, full, P5
**Purpose:** My Appointments aggregates three modules and renders times in the ward's zone; the evening-event zone defect only shows with a real evening time seeded.
**Seed data summary:**
- Ward timezone `America/Denver`
- `visit_appointments` made by the org president — one tomorrow 19:00 local, one last week (kept), one cancelled
- `todos` — one scheduled for Friday 19:30 local, one scheduled last week and not completed
- `activity_attendees` — the president signed up for an upcoming Friday 19:30 game and a past all-day tournament; a cancelled event they had signed up for
**Tester action:** Open My Appointments; toggle past; cancel the visit; unschedule the to-do.
**Verification checklist:**
- [ ] Upcoming shows three items in time order; Friday's game reads **7:30 PM Friday**, not Saturday 1:30/2:30 AM
- [ ] Neither cancelled item appears anywhere
- [ ] Past is collapsed with a count; opening it shows the most recent first; the past unresolved to-do is there, not gone
- [ ] Cancel removes the visit from the list and `/visits` shows it cancelled; Unschedule removes the to-do from the list and it is still on `/todos`
- [ ] Each row's link opens its module (the youth row opens that event's page)
- [ ] The Google Calendar card's button is disabled and the note says why
- [ ] The deployed build shows the same times as local (run once against production — the defect was invisible in dev)

## Validation Commands

```bash
# Migrations (per slice) and types
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests — targeted first, then the full suite
npx vitest run tests/rls/todos.test.ts tests/lib/todoProgress.test.ts tests/lib/todoViewState.test.ts tests/lib/todoUntouched.test.ts tests/lib/todoLogLines.test.ts tests/lib/myAppointments.test.ts tests/routes/todos.test.ts tests/routes/action-item-todo-link.test.ts tests/lib/permissions.test.ts
npm test

# Production build — stop `npm run dev` first, or every API route 404s
npm run build

# Harness manifest after adding scenarios
npm run manifest
```

## Integration Notes

- **What P4 picks up:** the Agendas slice replaces the free-text assignee with a user picker writing `assignedUserId` and adds delegate-to-absent's annotation to the auto-created to-do (a `note` log line or the to-do `notes` — decide there). Sacrament slices `f`/`g` create speaker/prayer asks as to-dos owned by the **conducting** user (`sundays.conducting_user_id`), using `sourceLinks.ts`' pattern with their own link column — **not** a generic polymorphic `source_type/source_id`, which would lose foreign-key integrity. Accept/decline renders on the to-do card in place of **Done**.
- **What P6 picks up:** meeting invites as a fourth `MyAppointmentSource` kind, role-addressed, and the conflict check calling `buildMyAppointments`.
- **What P10 picks up:** the Zoom referral to-do, plain **Done** with no accept/decline.
- **Breaking changes:** none. `ActionItem` gains two fields (all construction sites must supply them — let the compiler find them). The free-text `assigned_to` keeps working.
- **Migrations:** 081 and 082 are purely additive; neither needs to be held back. Apply 081 before deploying p5-a and 082 before deploying p5-b.
- **Follow-ups deliberately not built:** step reordering, editing/deleting a written note, notifications on assignment, the assigner seeing *why* something was marked done (the prototype's own open item — D2 means they never see the to-do).
