-- Phase 2, migration 069: FORTY-EIGHT COMPOSITE FOREIGN KEYS FORBID A SECOND-WARD WRITE.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, TIMES FORTY-EIGHT
-- ---------------------------------------------------------------------------
-- Migration 002 established an idiom: a child row's ward must equal its parent's, enforced by a
-- COMPOSITE foreign key against `users (id, ward_id)`. Forty-eight constraints across
-- twenty-seven migrations carry it — visit_logs.recorded_by, activity_logs.logged_by,
-- programs.approved_by, agendas.published_by, notifications.recipient_user_id, and forty-three
-- more.
--
-- Each asserts: THE PERSON WHO AUTHORED THIS ROW BELONGS TO THIS ROW'S WARD. That was exactly
-- right while a person had one ward. Under the calling model (migration 068) it is false:
--
--   Sister X's users.ward_id is ward A. She holds Relief Society president in ward B. She logs a
--   visit there -> visit_logs(ward_id = B, recorded_by = X) -> the constraint demands a `users`
--   row with (X, B) -> SQLSTATE 23503, surfacing as a 500.
--
-- That is migration 067's defect, which tests/routes/session-active-ward.test.ts caught on
-- `audit_log` on its first run, in forty-eight more places. Multi-ward would be able to READ and
-- not to WRITE, and the failure would arrive as a server fault rather than as a refusal.
--
-- There is no constraint that can express "the author holds a CALLING in this ward", and a
-- trigger is forbidden (CLAUDE.md §9: there are no triggers anywhere in this repo; do not add the
-- first one for this). So the constraints are narrowed to the author alone.
--
-- ---------------------------------------------------------------------------
-- A PURE RELAXATION. IT CANNOT FAIL ON AN EXISTING ROW.
-- ---------------------------------------------------------------------------
-- Every row satisfying `(author, ward_id) -> users (id, ward_id)` satisfies `author -> users
-- (id)`, because the first is the second plus an extra conjunct. So this applies to a live
-- database with no validation risk and no held-back pair. No entry in HELD_BACK_UNTIL_DEPLOYED.
--
-- WHAT IS KEPT: the author is still a real `users` row, so authorship cannot be invented.
-- WHAT IS GIVEN UP, written down rather than discovered: the database no longer proves an author
-- belonged to the ward they wrote in — which is now legitimately false. RLS still scopes every
-- insert to current_ward_id(), and that is the boundary that actually matters (CLAUDE.md rule 2).


-- ============================================================================
-- 069a — narrow every (author, ward_id) -> users (id, ward_id) constraint
-- ============================================================================
--
-- CATALOG-DRIVEN, NOT A HAND-WRITTEN LIST OF FORTY-EIGHT. Migration 019 Part 2 set the precedent
-- and gave the reason: "the failure mode this guards against is precisely 'someone added a table
-- and forgot'." A hand-written list is forty-eight chances to mistype a constraint name, and it
-- would silently skip any constraint added between writing this file and applying it.
--
-- Three details, all of which matter:
--
--   * `on delete` AND `on update` ARE PRESERVED from the catalog. Several of these are
--     `on delete cascade` (notifications, visit_private_notes, activity_private_notes) and
--     several are `on delete set null` (threads, sacrament_assignments). Losing a cascade orphans
--     rows; losing a set-null makes a user undeletable. confdeltype/confupdtype are the only
--     honest source — assuming `no action` would be wrong for a dozen of them.
--
--   * THE CONSTRAINT NAME IS KEPT. Re-adding under the same name keeps every existing error
--     message and every migration comment that refers to it accurate.
--
--   * IT RAISES ON A SHAPE IT DOES NOT UNDERSTAND. A two-column foreign key to `users` with no
--     `ward_id` column is not this idiom, and silently rewriting it against an arbitrary column
--     would be far worse than refusing to apply.
--
-- `users`' own `unique (id, ward_id)` is NOT touched: contype = 'f' excludes a unique constraint.
-- It survives, unreferenced, and migration 071 is where it would be reconsidered if ever.
--
-- `ward_role_assignments`' own `(org_id, ward_id) -> organizations (id, ward_id)` is untouched
-- too, and so is the identical one on `users`: both reference `organizations`, not `users`, and
-- the loop filters on the REFERENCED table. Asserting an organization sits in the same ward as
-- the calling is still true and still worth enforcing.
do $$
declare
  fk             record;
  local_columns  text[];
  author_column  text;
  delete_action  text;
  update_action  text;
  narrowed_count integer := 0;
begin
  for fk in
    select con.conname                  as constraint_name,
           con.conrelid                 as local_relation,
           con.conrelid::regclass::text as table_name,
           con.conkey                   as local_attnums,
           con.confdeltype              as delete_type,
           con.confupdtype              as update_type
      from pg_constraint con
      join pg_class     ref on ref.oid = con.confrelid
      join pg_namespace ns  on ns.oid  = ref.relnamespace
     where con.contype = 'f'
       and ref.relname = 'users'
       and ns.nspname  = 'public'
       and array_length(con.conkey, 1) = 2
     order by con.conrelid::regclass::text, con.conname
  loop
    -- Resolved against conrelid — the table the constraint is ON — never against the
    -- constraint's own oid. pg_attribute is keyed by relation, so resolving a constraint oid as
    -- though it were a table either errors or silently names the wrong relation.
    select array_agg(att.attname order by att.attnum)
      into local_columns
      from pg_attribute att
     where att.attrelid = fk.local_relation
       and att.attnum   = any (fk.local_attnums);

    if not ('ward_id' = any (local_columns)) then
      raise exception
        'Constraint %.% is a two-column foreign key to users over (%), with no ward_id column. Migration 069 only knows how to narrow the (author, ward_id) idiom.',
        fk.table_name, fk.constraint_name, array_to_string(local_columns, ', ');
    end if;

    select each_column
      into author_column
      from unnest(local_columns) as each_column
     where each_column <> 'ward_id';

    delete_action := case fk.delete_type
      when 'c' then ' on delete cascade'
      when 'n' then ' on delete set null'
      when 'r' then ' on delete restrict'
      when 'd' then ' on delete set default'
      else ''
    end;

    update_action := case fk.update_type
      when 'c' then ' on update cascade'
      when 'n' then ' on update set null'
      when 'r' then ' on update restrict'
      when 'd' then ' on update set default'
      else ''
    end;

    execute format('alter table %s drop constraint %I', fk.table_name, fk.constraint_name);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references users (id)%s%s',
      fk.table_name, fk.constraint_name, author_column, update_action, delete_action
    );

    narrowed_count := narrowed_count + 1;
  end loop;

  raise notice 'Migration 069 narrowed % composite foreign keys to users.', narrowed_count;
end $$;


-- ============================================================================
-- 069b — the introspection helper that keeps it true
-- ============================================================================
--
-- tests/db/user-author-fks.test.ts reaches the database through PostgREST, which cannot see
-- system catalogs. This exposes exactly the one fact that test asserts and nothing else — the
-- shape migration 019 Part 5 already uses for tables_without_rls().
--
-- A FUTURE MIGRATION RE-ADDING ONE OF THESE WOULD SILENTLY RE-BREAK SECOND-WARD WRITES, in a way
-- no route test would catch unless it happened to write to that one table. This is what catches
-- it, once, for every table at the same time.
create function composite_user_author_fks()
  returns table (table_name text, constraint_name text)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select con.conrelid::regclass::text, con.conname::text
    from pg_constraint con
    join pg_class     ref on ref.oid = con.confrelid
    join pg_namespace ns  on ns.oid  = ref.relnamespace
   where con.contype = 'f'
     and ref.relname = 'users'
     and ns.nspname  = 'public'
     and array_length(con.conkey, 1) > 1
   order by 1, 2;
$$;

-- PUBLIC gets EXECUTE on a new function by default. Revoke first, then grant deliberately —
-- migration 022 Part 2's precedent. Only the structural test calls it, so only service_role.
revoke all on function composite_user_author_fks() from public;
grant execute on function composite_user_author_fks() to service_role;
