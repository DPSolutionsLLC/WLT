-- P5 slice a, migration 081: TO DO — A LEADER'S OWN LIST, READABLE BY NOBODY ELSE.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: three new tables, their policies
-- and their indexes. It touches no existing table, column, CHECK or policy, so there is nothing
-- the running build reads that it could break and no entry belongs in HELD_BACK_UNTIL_DEPLOYED.
--
-- ---------------------------------------------------------------------------
-- TWO DECISIONS THIS FILE ENFORCES, both settled with the user 2026-09-24
-- (plans/todo-and-my-appointments.md, D2 and D3)
-- ---------------------------------------------------------------------------
-- D2 — OWNER ONLY. A to-do, its steps and its log are readable by the person whose list it is and
-- by nobody else: not the bishop, not an admin, not whoever assigned it. The assigner of an agenda
-- action item sees only the review flag on THEIR OWN agenda item (slice p5-b), never the to-do.
-- That is rule 5's shape — `visit_private_notes` — applied here by product decision rather than
-- by rule, so THERE IS NO BISHOPRIC ARM IN ANY POLICY BELOW, and adding one is a product change.
--
-- D3 — SELF ONLY. An authenticated client cannot put a to-do on somebody else's list, and cannot
-- claim one was assigned. Another person's to-do arrives only through a SOURCE that owns the
-- assignment (an agenda action item now; a speaker ask and a Zoom referral later), written with
-- the service role behind that source's own permission check. The INSERT policy on `todos` is
-- where this lives — `assigned_by is null` — not the route.
--
-- PERSON, NOT ROLE. Every row here belongs to `auth.uid()`. The only role-addressed entity in P5's
-- neighbourhood is P6's meeting invite, which is not in this migration.
--
-- A TO-DO LIVES IN THE WARD IT WAS CREATED IN (rule 1). A leader holding callings in two wards sees
-- ward B's to-dos only while acting in ward B — `current_ward_id()` in every predicate.
--
-- Structure:
--   081a  todos
--   081b  todo_steps
--   081c  todo_log_entries
--   081d  policies
--   081e  indexes


-- ---------------------------------------------------------------------------
-- 081a. todos
-- ---------------------------------------------------------------------------
--
-- EVERY USER REFERENCE IS A PLAIN `references users (id)`, never composite with `ward_id`.
-- Migration 069 narrowed 48 of those because a person may act in a ward their account does not
-- live in; tests/db/user-author-fks.test.ts fails if one comes back.
--
-- `assigned_by` NULL MEANS SELF — `visit_participants`' idiom. It never appears in a SELECT
-- predicate (the `talks-d` hole: a null column makes a predicate NULL, not false).
--
-- `do_date` AND `due_date` ARE SEPARATE, AND NEITHER CONSTRAINS THE OTHER. "When I intend to work
-- on it" and "when it must be done" are different facts; a leader may plan to start after a soft
-- deadline, and no rule here invents otherwise. Both are `date` — a day, not an instant.
--
-- `scheduled_for` IS A `timestamptz` because "Schedule this" (slice p5-c) names a time somebody
-- turns up at (CLAUDE.md §6). It lives here rather than in p5-c's own migration because it is a
-- column of the core entity, and p5-c then needs none.
--
-- `scheduled_with_member_id` IS COMPOSITE WITH `ward_id`, unlike the user columns, because a
-- member IS inside one ward — the composite key is what keeps a to-do from naming another ward's
-- member. `on delete set null (scheduled_with_member_id)` uses the column-list form: a plain
-- composite `set null` would null `ward_id` too and fail NOT NULL (visits-d, migration 047).
create table todos (
  id                       uuid primary key default gen_random_uuid(),
  ward_id                  uuid not null references wards (id) on delete cascade,
  user_id                  uuid not null references users (id) on delete cascade,
  assigned_by              uuid references users (id) on delete set null,
  title                    text not null check (length(btrim(title)) between 1 and 300),
  notes                    text check (notes is null or length(notes) <= 4000),
  tag                      text check (tag is null or length(btrim(tag)) between 1 and 40),
  do_date                  date,
  due_date                 date,
  scheduled_for            timestamptz,
  scheduled_with_member_id uuid,
  completed_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (scheduled_with_member_id, ward_id) references members (id, ward_id)
    on delete set null (scheduled_with_member_id)
);

comment on table todos is
  'A leader''s own task or project. Owner-only: no policy admits anybody but user_id (D2), and no authenticated client may create one for somebody else (D3).';


-- ---------------------------------------------------------------------------
-- 081b. todo_steps
-- ---------------------------------------------------------------------------
--
-- ADDING THE FIRST STEP IS WHAT MAKES A TO-DO A PROJECT. There is no mode column and no "type":
-- progress is COMPUTED from these rows (lib/todos/progress.ts), and zero rows is a plain item.
--
-- `done_at` rather than a boolean: when it was checked off is the fact the timeline shows.
create table todo_steps (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  todo_id    uuid not null,
  label      text not null check (length(btrim(label)) between 1 and 200),
  position   integer not null,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  foreign key (todo_id, ward_id) references todos (id, ward_id) on delete cascade
);


-- ---------------------------------------------------------------------------
-- 081c. todo_log_entries
-- ---------------------------------------------------------------------------
--
-- ONE TIMELINE, NEVER TWO RECORDS. A written note and an automatic line ("Checked off …") are
-- rows of the same table, ordered by `created_at`, so they interleave by time by construction.
--
-- `body` IS THE NOTE TEXT FOR A `note`, AND A SNAPSHOT OF THE STEP'S LABEL FOR A STEP KIND. A
-- snapshot rather than a foreign key to the step, so a renamed or deleted step keeps its history.
--
-- `source_completed` IS IN THE CHECK ALREADY, although only slice p5-b writes it, so migration 082
-- does not have to rewrite this constraint.
create table todo_log_entries (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  todo_id    uuid not null,
  kind       text not null check (
    kind in (
      'note',
      'step_done',
      'step_undone',
      'completed',
      'reopened',
      'scheduled',
      'unscheduled',
      'source_completed'
    )
  ),
  body       text check (body is null or length(body) <= 2000),
  created_at timestamptz not null default now(),
  check (kind <> 'note' or (body is not null and length(btrim(body)) > 0)),
  foreign key (todo_id, ward_id) references todos (id, ward_id) on delete cascade
);


-- ---------------------------------------------------------------------------
-- 081d. Policies
-- ---------------------------------------------------------------------------
--
-- USING AND WITH CHECK ARE IDENTICAL ON EVERY UPDATE. A failed WITH CHECK raises, a failed USING
-- returns zero rows (youth-h, defect 060-D2); keeping the two halves identical means a refusal is
-- always the quiet one, and the route turns zero rows into a 404.
--
-- LOG ENTRIES ARE APPEND-ONLY IN PRACTICE — no route updates or deletes one — but the owner DELETE
-- policy exists so deleting the parent to-do cascades cleanly under the owner's own client.
alter table todos enable row level security;
alter table todo_steps enable row level security;
alter table todo_log_entries enable row level security;

create policy todos_select on todos
  for select to authenticated
  using (ward_id = current_ward_id() and user_id = auth.uid());

-- D3. `assigned_by is null` is what stops an authenticated client claiming a to-do was assigned;
-- `user_id = auth.uid()` is what stops it writing onto somebody else's list.
create policy todos_insert on todos
  for insert to authenticated
  with check (ward_id = current_ward_id() and user_id = auth.uid() and assigned_by is null);

create policy todos_update on todos
  for update to authenticated
  using (ward_id = current_ward_id() and user_id = auth.uid())
  with check (ward_id = current_ward_id() and user_id = auth.uid());

create policy todos_delete on todos
  for delete to authenticated
  using (ward_id = current_ward_id() and user_id = auth.uid());

-- A step or a log line belongs to whoever owns its to-do. The ward is compared on both sides so a
-- child row can never be admitted through a parent in another ward.
create policy todo_steps_select on todo_steps
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and exists (
      select 1 from todos t
      where t.id = todo_steps.todo_id and t.ward_id = todo_steps.ward_id and t.user_id = auth.uid()
    )
  );

create policy todo_steps_insert on todo_steps
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and exists (
      select 1 from todos t
      where t.id = todo_steps.todo_id and t.ward_id = todo_steps.ward_id and t.user_id = auth.uid()
    )
  );

create policy todo_steps_update on todo_steps
  for update to authenticated
  using (
    ward_id = current_ward_id()
    and exists (
      select 1 from todos t
      where t.id = todo_steps.todo_id and t.ward_id = todo_steps.ward_id and t.user_id = auth.uid()
    )
  )
  with check (
    ward_id = current_ward_id()
    and exists (
      select 1 from todos t
      where t.id = todo_steps.todo_id and t.ward_id = todo_steps.ward_id and t.user_id = auth.uid()
    )
  );

create policy todo_steps_delete on todo_steps
  for delete to authenticated
  using (
    ward_id = current_ward_id()
    and exists (
      select 1 from todos t
      where t.id = todo_steps.todo_id and t.ward_id = todo_steps.ward_id and t.user_id = auth.uid()
    )
  );

create policy todo_log_entries_select on todo_log_entries
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and exists (
      select 1 from todos t
      where t.id = todo_log_entries.todo_id
        and t.ward_id = todo_log_entries.ward_id
        and t.user_id = auth.uid()
    )
  );

create policy todo_log_entries_insert on todo_log_entries
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and exists (
      select 1 from todos t
      where t.id = todo_log_entries.todo_id
        and t.ward_id = todo_log_entries.ward_id
        and t.user_id = auth.uid()
    )
  );

create policy todo_log_entries_update on todo_log_entries
  for update to authenticated
  using (
    ward_id = current_ward_id()
    and exists (
      select 1 from todos t
      where t.id = todo_log_entries.todo_id
        and t.ward_id = todo_log_entries.ward_id
        and t.user_id = auth.uid()
    )
  )
  with check (
    ward_id = current_ward_id()
    and exists (
      select 1 from todos t
      where t.id = todo_log_entries.todo_id
        and t.ward_id = todo_log_entries.ward_id
        and t.user_id = auth.uid()
    )
  );

create policy todo_log_entries_delete on todo_log_entries
  for delete to authenticated
  using (
    ward_id = current_ward_id()
    and exists (
      select 1 from todos t
      where t.id = todo_log_entries.todo_id
        and t.ward_id = todo_log_entries.ward_id
        and t.user_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------------------
-- 081e. Indexes
-- ---------------------------------------------------------------------------
create index todos_ward_user_completed_idx on todos (ward_id, user_id, completed_at);

-- My Appointments (slice p5-c) reads a person's scheduled to-dos and nothing else.
create index todos_user_scheduled_idx on todos (user_id, scheduled_for)
  where scheduled_for is not null;

create index todo_steps_todo_position_idx on todo_steps (todo_id, position);

create index todo_log_entries_todo_created_idx on todo_log_entries (todo_id, created_at);
