-- ============================================================================
-- DEVELOPMENT DATA ONLY. Never run this against a production ward.
--
-- Fixed UUIDs are used throughout so the seed is idempotent and so tests can reference
-- known ids. They are deliberately obvious placeholders.
--
-- NOTE — no user rows are seeded here. `users.id` references `auth.users(id)`, and creating
-- an auth user correctly means going through Supabase Auth (hashed password, identity row,
-- confirmation state), not a raw INSERT that breaks on the next Auth release. Plan C's
-- tests/helpers/seed.ts creates users through the admin API, which is the supported path.
-- Until then this ward has data but no members who can sign in.
-- ============================================================================

insert into wards (id, name, settings) values
  (
    '00000000-0000-4000-8000-000000000001',
    'Development Ward',
    jsonb_build_object('cross_org_visibility', false, 'timezone', 'America/Denver')
  )
on conflict (id) do nothing;

insert into organizations (id, ward_id, name, type) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Bishopric',      'bishopric'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'Elders Quorum',  'elders_quorum'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'Relief Society', 'relief_society'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 'Young Men',      'young_men'),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000001', 'Young Women',    'young_women'),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000001', 'Primary',        'primary')
on conflict (id) do nothing;

insert into households (id, ward_id, family_name, address) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 'Andersen', '145 Maple Street'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', 'Brooks',   '2201 Canyon Road'),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', 'Cortez',   '58 Willow Lane')
on conflict (id) do nothing;

insert into members (id, ward_id, household_id, first_name, last_name, category, gender, status) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', 'Mark',    'Andersen', 'adult', 'male',   'active'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', 'Rachel',  'Andersen', 'adult', 'female', 'active'),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', 'Ethan',   'Andersen', 'youth', 'male',   'active'),
  ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000202', 'Daniel',  'Brooks',   'adult', 'male',   'active'),
  ('00000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000202', 'Sarah',   'Brooks',   'adult', 'female', 'active'),
  ('00000000-0000-4000-8000-000000000306', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000203', 'Miguel',  'Cortez',   'adult', 'male',   'active'),
  ('00000000-0000-4000-8000-000000000307', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000203', 'Elena',   'Cortez',   'adult', 'female', 'active'),
  ('00000000-0000-4000-8000-000000000308', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000203', 'Sofia',   'Cortez',   'youth', 'female', 'active')
on conflict (id) do nothing;
