-- ITER-055 slice bv5, migration 103: the bishopric divides its households among the bishop and the
-- two counselors, and each assignment puts "Visit the ___ family" on the assignee's To Do
-- (plans/bishopric-visits.md D4, D8, P9, P10).
--
-- ---------------------------------------------------------------------------
-- A SELECT POLICY AND NO WRITE POLICY ON `visit_assignments` (P9)
-- ---------------------------------------------------------------------------
-- The only writer is lib/visits/assignments.ts, on the service role, behind `visits.assign` AND a
-- bishopric calling (POST / PATCH /api/visit-assignments). `assigned_to` is a SUBJECT column written
-- from a request body, so the route also checks the person holds an active bishopric calling in
-- this ward (CLAUDE.md §7, the 069 warning). The 073 / 089 / 094 / 099 shape: the rule lives in one
-- route and RLS cannot be talked past it. Do not add a write policy "for convenience".
--
-- ENDED, NEVER DELETED. An assignment that is reassigned, unassigned, visited or outlived by its goal
-- keeps its row with `ended_at` and `end_reason`, so who held which household is history.
--
-- `org_id` IS THE ORGANIZATION WHOSE GOAL THIS IS — for the bishopric, the ward's `bishopric`-typed
-- organization, where its goal is stored (bv4). Never null: unlike a visit row, an assignment always
-- belongs to a goal, and a goal always carries an organization id.
--
-- ---------------------------------------------------------------------------
-- THE TO-DO (P10)
-- ---------------------------------------------------------------------------
-- `todos.visit_assignment_id` links "Visit the ___ family" to its assignment. Written only by
-- lib/todos/visitLinks.ts with the service role. It has no checkbox and cannot be deleted while
-- open (the Zoom pattern): a finished bishopric visit closes it, and so does the assignment ending.

-- ---------------------------------------------------------------------------
-- 103a. The assignments
-- ---------------------------------------------------------------------------
create table visit_assignments (
  id           uuid        primary key default gen_random_uuid(),
  ward_id      uuid        not null references wards (id) on delete cascade,
  org_id       uuid        not null,
  household_id uuid        not null,
  goal_id      uuid        not null references visit_goals (id) on delete cascade,
  -- Single-column keys to users, never `(user, ward_id)`: migration 069 narrowed all forty-eight of
  -- those, because a leader acting under a calling in a second ward fails them as a 500.
  assigned_to  uuid        not null references users (id) on delete cascade,
  assigned_by  uuid        references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz,
  end_reason   text        check (end_reason in ('reassigned', 'unassigned', 'visited', 'goal_ended')),
  constraint visit_assignments_org_fkey
    foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade,
  constraint visit_assignments_household_fkey
    foreign key (household_id, ward_id) references households (id, ward_id) on delete cascade,
  -- Both halves or neither, written so it can actually fail (050's note on CHECKs that are NULL).
  constraint visit_assignments_end_complete check ((ended_at is null) = (end_reason is null))
);

-- One open assignment per household per organization: two people must never both think a family is
-- theirs to visit. Reassigning ends the old row first (lib/visits/assignments.ts).
create unique index visit_assignments_one_open_per_household
  on visit_assignments (household_id, org_id)
  where ended_at is null;

create index visit_assignments_ward_idx on visit_assignments (ward_id, org_id) where ended_at is null;
create index visit_assignments_assignee_idx on visit_assignments (assigned_to) where ended_at is null;
create index visit_assignments_goal_idx on visit_assignments (goal_id);

comment on table visit_assignments is
  'Which bishopric member is to visit which household for the current visit goal (ITER-055 bv5). '
  'Ended, never deleted. Written only by lib/visits/assignments.ts with the service role.';

alter table visit_assignments enable row level security;

-- The bishopric reads every assignment; an organization the owner shared its visits with reads them
-- too (migration 099's one question); and an assignee always reads their own.
create policy visit_assignments_select on visit_assignments
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or visit_org_visible_to_caller(org_id) or assigned_to = auth.uid())
  );

-- Copies 091's form, as 099f did for `visit_org_sharing`.
create policy visit_assignments_module_released on visit_assignments
  as restrictive for all to authenticated
  using ((select ward_module_released('visits')))
  with check ((select ward_module_released('visits')));

-- ---------------------------------------------------------------------------
-- 103b. The to-do link
-- ---------------------------------------------------------------------------
alter table todos add column visit_assignment_id uuid references visit_assignments (id) on delete set null;

comment on column todos.visit_assignment_id is
  'The household visit assignment this "Visit the ___ family" to-do is about (ITER-055 bv5). '
  'Null on every other to-do.';

-- 095c's index, for visits. Different owners never collide, so a reassign (close the old holder's,
-- then create the new holder's) cannot meet it.
create unique index todos_one_open_visit_todo_per_owner
  on todos (visit_assignment_id, user_id)
  where visit_assignment_id is not null and completed_at is null;

create index todos_visit_assignment_idx on todos (visit_assignment_id) where visit_assignment_id is not null;

-- ---------------------------------------------------------------------------
-- 103c. todos.closed_reason
-- ---------------------------------------------------------------------------
-- MUST STAY IN STEP WITH `TODO_CLOSED_REASONS` in types/domain.ts. Starts from 089c's list, the
-- latest. `reassigned` / `unassigned`: the household went to somebody else, or to nobody.
-- `goal_ended`: the bishopric ended the goal the household was assigned under. A FINISHED visit
-- closes with no reason and a `source_completed` line — the to-do did its job.
alter table todos drop constraint todos_closed_reason_check;

alter table todos add constraint todos_closed_reason_check check (
  closed_reason is null
  or closed_reason in (
    'handed_over',
    'assistant_released',
    'speaker_changed',
    'told_not_needed',
    'talk_back_on',
    'unfinalized',
    'music_reopened',
    'meeting_cancelled',
    'reassigned',
    'unassigned',
    'goal_ended'
  )
);

-- ---------------------------------------------------------------------------
-- 103d. todo_log_entries kinds
-- ---------------------------------------------------------------------------
-- MUST STAY IN STEP WITH `TODO_LOG_KINDS` in types/domain.ts. Starts from 089d's list, the latest.
-- `visit_reassigned` carries the new holder's name in `body`, snapshotted. `visit_partly_reached`
-- carries the reason's label.
alter table todo_log_entries drop constraint todo_log_entries_kind_check;

alter table todo_log_entries add constraint todo_log_entries_kind_check check (
  kind in (
    'note',
    'step_done',
    'step_undone',
    'completed',
    'reopened',
    'scheduled',
    'unscheduled',
    'source_completed',
    'ask_accepted',
    'ask_declined',
    'handed_over',
    'assistant_released',
    'speaker_changed',
    'taken_over',
    'talk_off',
    'told_not_needed',
    'talk_back_on',
    'unfinalized',
    'music_submitted',
    'music_approved',
    'music_sent_back',
    'music_reopened',
    'topics_changed',
    'meeting_cancelled',
    'visit_assigned',
    'visit_reassigned',
    'visit_unassigned',
    'visit_goal_ended',
    'visit_partly_reached'
  )
);
