-- The supabase_realtime publication, for a project seeded from scratch.
--
-- Deliberately identical in effect to supabase/migrations/026_realtime_publication.sql. The
-- migration is what an EXISTING project gets from `npm run db:push`; this file is what a NEW one
-- gets alongside hymns, topics and notification triggers. Neither is redundant — a project built
-- only from seed never runs the migration, and a project built only from migrations never runs
-- the seed.
--
-- Both are guarded and idempotent, so running both is a no-op the second time.
--
-- KEEP THESE TWO FILES IN STEP. A table added to one and not the other is realtime that works in
-- one environment and silently does not in the other, which is the hardest class of bug this
-- project can produce: nothing errors, the UI simply stops updating for some people.
--
-- Phase 11 adds `notifications` here and in a migration, together with its own cross-ward leak
-- test. See the migration for why one table ships at a time.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception
      'The supabase_realtime publication does not exist, so realtime cannot be enabled. '
      'Supabase creates it on every project - check that this is running against the linked '
      'project (npm run db:link) before creating it by hand.';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname    = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'assignment_comments'
  ) then
    alter publication supabase_realtime add table assignment_comments;
  end if;
end
$$;
