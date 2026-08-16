-- Foundation B, migration 019: helper functions, row level security, policies, and the
-- restricted public views.
--
-- This is the security boundary for the whole application (CLAUDE.md rule 2). A route
-- handler that forgets a check must still be safe because the policy blocked it.
--
-- Structure:
--   Part 1  helper functions
--   Part 2  enable RLS on every table
--   Part 3  policies
--   Part 4  public views and role grants
--   Part 5  introspection helpers used by the structural tests


-- ============================================================================
-- Part 1 — helper functions
-- ============================================================================
--
-- SECURITY DEFINER is required, not stylistic. Without it these functions read `users`
-- under the caller's own RLS, and the `users` policy would re-enter them: infinite
-- recursion. As definer functions they bypass RLS on that read.
--
-- SET search_path is also required. A SECURITY DEFINER function without a pinned
-- search_path is a privilege-escalation vector — a caller can prepend a schema and
-- substitute their own `users` table.
--
-- STABLE lets Postgres evaluate them once per statement rather than once per row, which
-- matters because every policy below calls at least one.

create function current_ward_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select ward_id from users where id = auth.uid();
$$;

create function current_user_role()
  returns text
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select role from users where id = auth.uid();
$$;

create function current_org_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select org_id from users where id = auth.uid();
$$;

-- Bishopric admin authority is shared (CLAUDE.md §7): bishop and both counselors have
-- identical rights. There is deliberately no function that grants the bishop something a
-- counselor lacks — do not add one.
create function is_bishopric()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(current_user_role() in ('bishop', 'counselor'), false);
$$;

create function is_active_sacrament_manager()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from sacrament_assignment_managers manager
    where manager.user_id = auth.uid()
      and manager.is_active
  );
$$;

-- Compared against the literal string rather than cast to boolean: a malformed settings
-- value should read as "off", not raise inside a policy and break every query.
create function ward_allows_cross_org_visibility()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select (ward.settings ->> 'cross_org_visibility') = 'true'
      from wards ward
      where ward.id = current_ward_id()
    ),
    false
  );
$$;


-- ============================================================================
-- Part 2 — enable RLS on every table
-- ============================================================================
--
-- Driven off the catalog rather than a hand-written list, because the failure mode this
-- guards against is precisely "someone added a table and forgot". Postgres defaults RLS
-- off, and a table without it is readable by every authenticated user in every ward.

do $$
declare
  target text;
begin
  for target in
    select class.relname
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relkind in ('r', 'p')
    order by class.relname
  loop
    execute format('alter table %I enable row level security', target);
  end loop;
end $$;


-- ============================================================================
-- Part 3 — policies
-- ============================================================================
--
-- Every policy is written per operation rather than as FOR ALL. A FOR ALL policy with a
-- USING clause and no WITH CHECK lets a user UPDATE a row *into* another ward: the USING
-- clause tests the row as it was, and nothing tests the row as it will be. Every INSERT
-- and UPDATE policy below therefore carries an explicit WITH CHECK.
--
-- Every policy is scoped TO authenticated. anon reaches this database only through the two
-- views in Part 4.

-- ---------------------------------------------------------------------------
-- wards
-- ---------------------------------------------------------------------------
create policy wards_select on wards
  for select to authenticated
  using (id = current_ward_id());

create policy wards_update on wards
  for update to authenticated
  using (id = current_ward_id() and is_bishopric())
  with check (id = current_ward_id() and is_bishopric());

-- No INSERT or DELETE policy: creating or removing a ward is a service-role operation.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
--
-- Deliberately self-only, and deliberately NOT calling current_ward_id(). This is
-- pitfall #1 in 00-foundation.md and the plan requires it.
--
-- KNOWN GAP, for phase 1 (plans/01-auth-rbac.md): the app cannot yet read another user's
-- name — "conducting: Bro. Smith" has nothing to select. Phase 1 must decide how ward-wide
-- user reads happen: either a ward-scoped SELECT policy (safe in practice, because the
-- helper functions above are SECURITY DEFINER and so cannot recurse), or a definer-side
-- view exposing just id/first_name/last_name/role. Do not add one here without making that
-- decision explicitly.
create policy users_select_self on users
  for select to authenticated
  using (id = auth.uid());

create policy users_update_self on users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Standard ward-scoped tables — any authenticated member of the ward, all operations
-- ---------------------------------------------------------------------------
--
-- Generated in a loop so the pattern is applied identically. Twenty-four near-identical
-- policy blocks written by hand is twenty-four chances for one to drift.
--
-- NOTE — activity_* are ward-scoped, not org-scoped. plans/foundation-b-schema.md Task 5
-- lists them under org scoping, but SPEC.md gives none of the activity tables an org_id
-- column, so there is nothing to scope on. Rather than invent a column, they are ward-scoped
-- here. Phase 8 (plans/08-youth-activities.md) should decide whether youth activity
-- coordination is genuinely org-private; if so it needs an org_id migration first.

do $$
declare
  target text;
begin
  foreach target in array array[
    'organizations',
    'households',
    'members',
    'member_organizations',
    'sundays',
    'conducting_rotation',
    'prayer_assignments',
    'hymn_selections',
    'musical_numbers',
    'programs',
    'public_pages',
    'agendas',
    'action_items',
    'goals',
    'youth_activity_profiles',
    'activity_calendars',
    'activity_events',
    'activity_attendees',
    'activity_logs',
    'knowledge_documents',
    'document_chunks',
    'notification_settings',
    'conversation_threads',
    'conversation_messages'
  ]
  loop
    execute format(
      'create policy %I on %I for select to authenticated using (ward_id = current_ward_id())',
      target || '_ward_select', target);

    execute format(
      'create policy %I on %I for insert to authenticated with check (ward_id = current_ward_id())',
      target || '_ward_insert', target);

    execute format(
      'create policy %I on %I for update to authenticated using (ward_id = current_ward_id()) with check (ward_id = current_ward_id())',
      target || '_ward_update', target);

    execute format(
      'create policy %I on %I for delete to authenticated using (ward_id = current_ward_id())',
      target || '_ward_delete', target);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Bishopric-only tables
-- ---------------------------------------------------------------------------
--
-- member_notes is here because FEATURES.md §Module 1 makes member notes bishopric-visible
-- only, and RLS cannot restrict a single column — which is why the notes live in their own
-- table rather than on `members`.

do $$
declare
  target text;
begin
  foreach target in array array[
    'invites',
    'member_notes',
    'topics',
    'assignments',
    'assignment_approvals',
    'assignment_comments',
    'assignment_history',
    'tithing_sessions',
    'tithing_entries',
    'ai_settings',
    'sacrament_rotation_pools'
  ]
  loop
    execute format(
      'create policy %I on %I for select to authenticated using (ward_id = current_ward_id() and is_bishopric())',
      target || '_bishopric_select', target);

    execute format(
      'create policy %I on %I for insert to authenticated with check (ward_id = current_ward_id() and is_bishopric())',
      target || '_bishopric_insert', target);

    execute format(
      'create policy %I on %I for update to authenticated using (ward_id = current_ward_id() and is_bishopric()) with check (ward_id = current_ward_id() and is_bishopric())',
      target || '_bishopric_update', target);

    execute format(
      'create policy %I on %I for delete to authenticated using (ward_id = current_ward_id() and is_bishopric())',
      target || '_bishopric_delete', target);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Private notes — CLAUDE.md rule 5
-- ---------------------------------------------------------------------------
--
-- Readable and writable ONLY by their author. There is no bishopric branch on any of these
-- four operations, and adding one is a bug, not a feature request. Not for the bishop, not
-- for an admin, not for a support query. Plan C asserts this explicitly.

do $$
declare
  target text;
begin
  foreach target in array array['visit_private_notes', 'activity_private_notes']
  loop
    execute format(
      'create policy %I on %I for select to authenticated using (user_id = auth.uid() and ward_id = current_ward_id())',
      target || '_author_select', target);

    execute format(
      'create policy %I on %I for insert to authenticated with check (user_id = auth.uid() and ward_id = current_ward_id())',
      target || '_author_insert', target);

    execute format(
      'create policy %I on %I for update to authenticated using (user_id = auth.uid() and ward_id = current_ward_id()) with check (user_id = auth.uid() and ward_id = current_ward_id())',
      target || '_author_update', target);

    execute format(
      'create policy %I on %I for delete to authenticated using (user_id = auth.uid() and ward_id = current_ward_id())',
      target || '_author_delete', target);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Per-user preference and read-state tables
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['notification_user_prefs', 'report_read_status']
  loop
    execute format(
      'create policy %I on %I for select to authenticated using (user_id = auth.uid() and ward_id = current_ward_id())',
      target || '_own_select', target);

    execute format(
      'create policy %I on %I for insert to authenticated with check (user_id = auth.uid() and ward_id = current_ward_id())',
      target || '_own_insert', target);

    execute format(
      'create policy %I on %I for update to authenticated using (user_id = auth.uid() and ward_id = current_ward_id()) with check (user_id = auth.uid() and ward_id = current_ward_id())',
      target || '_own_update', target);

    execute format(
      'create policy %I on %I for delete to authenticated using (user_id = auth.uid() and ward_id = current_ward_id())',
      target || '_own_delete', target);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- hymns — the one table without a ward_id
-- ---------------------------------------------------------------------------
--
-- The hymnbook is the same for every ward. Readable by any authenticated user; written only
-- by the seed, which runs as service_role.
create policy hymns_select on hymns
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- visit_goals and visit_logs — org-scoped
-- ---------------------------------------------------------------------------
create policy visit_goals_select on visit_goals
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy visit_goals_insert on visit_goals
  for insert to authenticated
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy visit_goals_update on visit_goals
  for update to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()))
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy visit_goals_delete on visit_goals
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

-- Cross-org visibility widens READS only. A leader of one organization never gains write
-- access to another organization's logs, whatever the ward setting says.
create policy visit_logs_select on visit_logs
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (
      is_bishopric()
      or org_id = current_org_id()
      or ward_allows_cross_org_visibility()
    )
  );

create policy visit_logs_insert on visit_logs
  for insert to authenticated
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy visit_logs_update on visit_logs
  for update to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()))
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy visit_logs_delete on visit_logs
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
--
-- Reads and writes are recipient-only, but INSERT is ward-wide on purpose: emitNotification()
-- exists to notify *other* people, so a route acting as one user must be able to create a row
-- addressed to another user in the same ward.
create policy notifications_select on notifications
  for select to authenticated
  using (ward_id = current_ward_id() and recipient_user_id = auth.uid());

create policy notifications_insert on notifications
  for insert to authenticated
  with check (ward_id = current_ward_id());

create policy notifications_update on notifications
  for update to authenticated
  using (ward_id = current_ward_id() and recipient_user_id = auth.uid())
  with check (ward_id = current_ward_id() and recipient_user_id = auth.uid());

create policy notifications_delete on notifications
  for delete to authenticated
  using (ward_id = current_ward_id() and recipient_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_log — append-only
-- ---------------------------------------------------------------------------
--
-- Rule 6 requires every mutation to write here, so INSERT cannot be bishopric-only: an org
-- secretary logging a visit still has to record it. Reads are bishopric-only, and there is
-- no UPDATE or DELETE policy for anyone — an audit trail that can be edited is not one.
create policy audit_log_select on audit_log
  for select to authenticated
  using (ward_id = current_ward_id() and is_bishopric());

create policy audit_log_insert on audit_log
  for insert to authenticated
  with check (ward_id = current_ward_id() and (user_id = auth.uid() or user_id is null));

-- ---------------------------------------------------------------------------
-- Sacrament administration
-- ---------------------------------------------------------------------------
--
-- The assignment manager is a youth account with access to exactly one module. They may read
-- and update assignments, and record that they sent the message. They may not touch the
-- rotation pools, and they may not create or delete assignments.
create policy sacrament_assignments_select on sacrament_assignments
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or is_active_sacrament_manager()));

create policy sacrament_assignments_insert on sacrament_assignments
  for insert to authenticated
  with check (ward_id = current_ward_id() and is_bishopric());

create policy sacrament_assignments_update on sacrament_assignments
  for update to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or is_active_sacrament_manager()))
  with check (ward_id = current_ward_id() and (is_bishopric() or is_active_sacrament_manager()));

create policy sacrament_assignments_delete on sacrament_assignments
  for delete to authenticated
  using (ward_id = current_ward_id() and is_bishopric());

create policy sacrament_managers_select on sacrament_assignment_managers
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or user_id = auth.uid()));

create policy sacrament_managers_insert on sacrament_assignment_managers
  for insert to authenticated
  with check (ward_id = current_ward_id() and is_bishopric());

create policy sacrament_managers_update on sacrament_assignment_managers
  for update to authenticated
  using (ward_id = current_ward_id() and is_bishopric())
  with check (ward_id = current_ward_id() and is_bishopric());

create policy sacrament_managers_delete on sacrament_assignment_managers
  for delete to authenticated
  using (ward_id = current_ward_id() and is_bishopric());

create policy sacrament_send_log_select on sacrament_send_log
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or is_active_sacrament_manager()));

create policy sacrament_send_log_insert on sacrament_send_log
  for insert to authenticated
  with check (ward_id = current_ward_id() and (is_bishopric() or is_active_sacrament_manager()));

create policy sacrament_send_log_delete on sacrament_send_log
  for delete to authenticated
  using (ward_id = current_ward_id() and is_bishopric());


-- ============================================================================
-- Part 4 — public views and role grants
-- ============================================================================
--
-- The unauthenticated read path, and the riskiest surface in the application.
--
-- anon is never granted access to a base table. It reads two views that name their columns
-- explicitly, so a column added to `members` or `programs` in a later phase cannot leak
-- through them. Never write SELECT * here.
--
-- security_invoker = false (the default, stated explicitly because it is load-bearing) means
-- the view runs with its owner's rights and is not re-filtered by the caller's RLS. That is
-- the entire point: the projection *is* the boundary.

create view public_sacrament_assignments
  with (security_invoker = false)
as
  select
    page.slug,
    sunday.date                     as sunday_date,
    assignment.assignment_type,
    member.first_name,
    left(member.last_name, 1)       as last_initial,
    assigned.ordinality             as member_position
  from public_pages page
  join sacrament_assignments assignment
    on assignment.ward_id = page.ward_id
  join sundays sunday
    on sunday.id = assignment.sunday_id
   and sunday.ward_id = assignment.ward_id
  cross join lateral unnest(assignment.member_ids) with ordinality as assigned(member_id, ordinality)
  join members member
    on member.id = assigned.member_id
   and member.ward_id = assignment.ward_id
  where page.page_type = 'sacrament_assignments'
    and page.is_active;

comment on view public_sacrament_assignments is
  'Unauthenticated read surface. First name and last initial only — never phone, address, or full surname.';

-- draft_data is deliberately NOT exposed. It is an unstructured snapshot of the whole
-- program and may carry full names or notes, which makes it unsafe to hand to anon wholesale.
-- Phase 6 (plans/06-program-music.md) must define an explicit, named projection of the
-- program body before the public program page can render anything beyond the PDF link.
create view public_program
  with (security_invoker = false)
as
  select
    page.slug,
    sunday.date            as sunday_date,
    program.pdf_url,
    program.distributed_at
  from public_pages page
  join programs program
    on program.ward_id = page.ward_id
  join sundays sunday
    on sunday.id = program.sunday_id
   and sunday.ward_id = program.ward_id
  where page.page_type = 'program'
    and page.is_active
    and program.status = 'distributed';

comment on view public_program is
  'Unauthenticated read surface. PDF link and date only; draft_data is withheld pending an explicit safe projection in phase 6.';

-- Supabase no longer auto-exposes new objects to the Data API roles, so the grants are
-- explicit. RLS decides which rows; these grants decide which tables are reachable at all.
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- anon gets nothing except the two views. The revoke runs first because the grant above
-- covers views as well as tables.
revoke all on all tables in schema public from anon;
grant select on public_sacrament_assignments to anon;
grant select on public_program to anon;

-- Future phases create tables in this schema too. Without a default, a new table is
-- unreachable through the API until someone remembers to grant it — a confusing failure that
-- looks like an RLS bug. Row access is still governed by RLS, and the rls-enabled test below
-- fails loudly if a new table ever ships without a policy.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;


-- ============================================================================
-- Part 5 — introspection helpers for the structural tests
-- ============================================================================
--
-- tests/db/*.test.ts reach the database through PostgREST, which cannot see system catalogs.
-- These two functions expose exactly the two facts those tests assert, and nothing else.
-- EXECUTE is granted to service_role only.

create function tables_without_rls()
  returns table (table_name text)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select class.relname::text
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relkind in ('r', 'p')
    and not class.relrowsecurity
  order by class.relname;
$$;

create function applied_migration_versions()
  returns table (version text)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select migration.version::text
  from supabase_migrations.schema_migrations migration
  order by migration.version;
$$;

revoke all on function tables_without_rls() from public;
revoke all on function applied_migration_versions() from public;
grant execute on function tables_without_rls() to service_role;
grant execute on function applied_migration_versions() to service_role;
