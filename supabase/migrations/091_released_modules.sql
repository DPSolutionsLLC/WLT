-- ITER-041 slice b, migration 091: RELEASED MODULES PER WARD.
--
-- A ward can be given a list of the modules it has RELEASED, and everything else in that ward is
-- hidden and refused — for everybody except the super admin. The real Buffalo Ward shows its
-- bishopric Speakers & Prayers and Tithing; a test ward keeps everything.
--
-- ---------------------------------------------------------------------------
-- ABSENT MEANS EVERYTHING
-- ---------------------------------------------------------------------------
-- No row for a ward means every module is released, so every existing ward, every test fixture
-- and every harness ward behaves exactly as before the day this applies. An EMPTY array is a
-- different statement — nothing released — and is kept distinct on purpose.
--
-- ---------------------------------------------------------------------------
-- ONLY THE SUPER ADMIN WRITES IT, SO IT HAS A SELECT POLICY AND NO WRITE POLICY
-- ---------------------------------------------------------------------------
-- The shape of `access_requests` (073) and `sunday_music` (089): every write goes through the
-- service-role client behind the route's is_super_admin check. `wards.settings` is NOT a safe
-- home for this — `wards_update` (019) lets the bishopric write their own ward's row, and a list
-- that narrows the bishopric must not be editable by the bishopric.
--
-- ---------------------------------------------------------------------------
-- THE APP AND RLS READ ONE ANSWER (070e's rule)
-- ---------------------------------------------------------------------------
-- The list reaches the app through session_context(), in the same round trip as the role and the
-- ward, and RLS reads the same table through ward_module_released(). There is no second query
-- that could disagree with the policy.

create table ward_release_settings (
  ward_id          uuid primary key references wards (id) on delete cascade,
  released_modules text[] not null,
  -- A plain single-column key with `on delete set null`, never composite: the composite-FK delete
  -- trap (sacrament-music-people) is a person's deletion blocked by a row that only recorded them.
  updated_by       uuid references users (id) on delete set null,
  updated_at       timestamptz not null default now()
);

alter table ward_release_settings enable row level security;

-- The super admin reads every ward's list (Stakes & Wards shows them all); everybody else reads
-- only the ward they are acting in. NO insert, update or delete policy.
create policy ward_release_settings_select on ward_release_settings
  for select to authenticated
  using (ward_id = current_ward_id() or is_super_admin());

-- ---------------------------------------------------------------------------
-- IS THIS MODULE RELEASED IN THE WARD BEING ACTED IN?
-- ---------------------------------------------------------------------------
-- Security definer so a policy can read the settings row whatever the caller's own reach, and
-- current_ward_id() keeps it to the ward the session is acting in. The super admin is always
-- answered true: they see everything in every ward.
create function ward_module_released(p_module text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select is_super_admin()
      or not exists (
           select 1 from ward_release_settings where ward_id = current_ward_id()
         )
      or exists (
           select 1
             from ward_release_settings
            where ward_id = current_ward_id()
              and p_module = any (released_modules)
         );
$$;

revoke all on function ward_module_released(text) from public;
grant execute on function ward_module_released(text) to authenticated;
grant execute on function ward_module_released(text) to service_role;

-- ---------------------------------------------------------------------------
-- THE DATABASE REFUSES A MODULE'S OWN TABLES WHEN IT IS UNRELEASED
-- ---------------------------------------------------------------------------
-- One RESTRICTIVE policy per module-owned table. Restrictive policies are AND-ed with the
-- permissive ones, so every existing policy keeps its meaning and this can only narrow it. A
-- refused SELECT reads as no rows; a refused INSERT raises 42501; a refused UPDATE or DELETE is a
-- zero-row success.
--
-- `to authenticated` only: anonymous public pages and the service role are untouched.
--
-- The call is wrapped in `(select …)` so Postgres evaluates it ONCE per statement as an initPlan
-- rather than once per row — the answer cannot differ between rows of one query.
--
-- THIS MAPPING MUST MATCH `tables` IN lib/access/releasedModules.ts. tests/db/
-- module-release-policies.test.ts reads the policies back and compares them both ways, so a table
-- added to one side and not the other fails there rather than escaping the release list.
do $$
declare
  mapping record;
begin
  for mapping in
    select * from (values
      -- Sacrament meeting: talks and prayers, topics, programmes and music, conducting
      ('assignments',                  'sacrament'),
      ('assignment_approvals',         'sacrament'),
      ('assignment_comments',          'sacrament'),
      ('assignment_history',           'sacrament'),
      ('talk_references',              'sacrament'),
      ('prayer_assignments',           'sacrament'),
      ('topics',                       'sacrament'),
      ('topic_candidates',             'sacrament'),
      ('programs',                     'sacrament'),
      ('hymn_selections',              'sacrament'),
      ('musical_numbers',              'sacrament'),
      ('sunday_music',                 'sacrament'),
      ('conducting_rotation',          'sacrament'),
      ('sunday_org_conducting',        'sacrament'),
      -- Agendas
      ('agendas',                      'agendas'),
      ('action_items',                 'agendas'),
      -- Visits
      ('visit_logs',                   'visits'),
      ('visit_private_notes',          'visits'),
      ('visit_participants',           'visits'),
      ('visit_appointments',           'visits'),
      ('visit_goals',                  'visits'),
      ('household_visit_cadences',     'visits'),
      ('household_stewardships',       'visits'),
      ('goals',                        'visits'),
      -- Youth activities
      ('youth_activity_profiles',      'youth'),
      ('activity_events',              'youth'),
      ('activity_attendees',           'youth'),
      ('activity_logs',                'youth'),
      ('activity_private_notes',       'youth'),
      ('activity_calendars',           'youth'),
      ('activity_occasions',           'youth'),
      ('activity_roster',              'youth'),
      ('activity_event_participation', 'youth'),
      -- Tithing
      ('tithing_entries',              'tithing'),
      ('tithing_sessions',             'tithing'),
      -- Sacrament ordinances (the youth PIN screen and its administration)
      ('sacrament_assignments',        'sacrament_ordinances'),
      ('sacrament_rotation_pools',     'sacrament_ordinances'),
      ('sacrament_send_log',           'sacrament_ordinances'),
      ('sacrament_assignment_managers','sacrament_ordinances'),
      -- Roster: only the notes. `members` and `households` stay readable (see below).
      ('member_notes',                 'roster')
    ) as m (table_name, module_key)
  loop
    execute format(
      'create policy %I on %I as restrictive for all to authenticated '
        || 'using ((select ward_module_released(%L))) '
        || 'with check ((select ward_module_released(%L)))',
      mapping.table_name || '_module_released',
      mapping.table_name,
      mapping.module_key,
      mapping.module_key
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- DELIBERATELY NOT RESTRICTED, and why. Each is read by more than one module, so refusing it with
-- one module would break another that is released.
-- ---------------------------------------------------------------------------
--   sundays                                  Sacrament, Agendas and the Speakers & Prayers tracker
--   members, households, member_organizations,
--   organizations                            Speakers & Prayers reads the people (Roster's pages
--                                            and actions are refused through can() instead)
--   todos, todo_steps, todo_log_entries      Sacrament and Agendas write and read linked to-dos
--   knowledge_documents, document_chunks,
--   retrieval_filters, retrieval_suggestions,
--   ai_settings                              AI drafting across modules reads them
--   report_read_status                       shared by the visits and youth feeds
--   invites, access_requests, audit_log, issue_reports, notifications, notification_settings,
--   notification_user_prefs, users, wards, units, unit_assignments, ward_role_assignments,
--   public_pages, hymns, conversation_threads, conversation_messages, youth_login_attempts
--                                            core, account-level, or shared by everything

-- ---------------------------------------------------------------------------
-- session_context() CARRIES THE LIST AND WHETHER THE SESSION IS A SUPER ADMIN
-- ---------------------------------------------------------------------------
-- 072's body exactly, plus two columns at the end. `released_modules` is NULL when the ward has
-- no row (everything released); `is_super_admin` is the same is_super_admin() the policies call,
-- so can()'s bypass and the database's agree. lib/auth/session.ts names columns rather than
-- reading by position, so the running build ignores the extra two and this is safe before the
-- deploy. The return type changes, so this is drop-and-create and the grants are re-issued.

drop function session_context();

create function session_context()
  returns table (
    ward_id            uuid,
    home_ward_id       uuid,
    active_ward_id     uuid,
    role               text,
    org_id             uuid,
    org_type           text,
    counselor_position integer,
    calling_id         uuid,
    is_bishopric       boolean,
    released_modules   text[],
    is_super_admin     boolean
  )
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select current_ward_id(),
         u.ward_id,
         u.active_ward_id,
         current_user_role(),
         current_org_id(),
         o.type,
         a.counselor_position,
         a.id,
         is_bishopric(),
         (select r.released_modules
            from ward_release_settings r
           where r.ward_id = current_ward_id()),
         is_super_admin()
    from users u
    left join ward_role_assignments a
      on a.user_id = u.id
     and a.ward_id = current_ward_id()
     and a.is_active
    left join organizations o
      on o.id = current_org_id()
   where u.id = auth.uid();
$$;

revoke all on function session_context() from public;
grant execute on function session_context() to authenticated;
grant execute on function session_context() to service_role;

-- ---------------------------------------------------------------------------
-- FOR THE DRIFT TEST ONLY
-- ---------------------------------------------------------------------------
-- The release policies and their predicates, so tests/db/module-release-policies.test.ts can prove
-- the database's mapping equals the catalog's. composite_user_author_fks()'s shape (069).
create function module_release_policies()
  returns table (table_name text, policy_qual text)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select p.tablename::text, p.qual::text
    from pg_policies p
   where p.schemaname = 'public'
     and p.policyname like '%\_module\_released'
   order by 1;
$$;

revoke all on function module_release_policies() from public;
grant execute on function module_release_policies() to service_role;
