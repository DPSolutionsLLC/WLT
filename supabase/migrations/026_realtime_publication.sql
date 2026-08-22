-- Route tests & realtime, migration 026: the supabase_realtime publication.
--
-- Realtime has never been enabled for any table in this project: before this migration a grep of
-- supabase/ finds no publication statement at all. talks-b shipped comment threads that therefore
-- never updated live, and Phase 11's notification UI would have found the same gap.
--
-- ONE TABLE, ONE PROOF. This adds assignment_comments and nothing else. Adding `notifications`
-- alongside it was considered and rejected: a publication entry is a PRIVACY DECISION, and
-- CLAUDE.md rule 2 says the boundary is proven rather than assumed. tests/rls/realtime-isolation.
-- test.ts is what earns this table its entry — it proves a ward B subscriber receives nothing
-- when ward A inserts a comment. Proving the same for `notifications` means a second isolation
-- test for a table whose UI does not exist yet, and notification rows are per-RECIPIENT rather
-- than per-ward, so an unproven entry there would be worse than one here. Phase 11 adds that
-- table together with its own leak test.
--
-- REPLICA IDENTITY is deliberately left at the default. Both subscribers listen for INSERT only,
-- and the default identity carries everything an INSERT payload needs. `replica identity full`
-- would be required to put OLD values in UPDATE and DELETE payloads — it also makes every such
-- payload carry the entire previous row, which for a table of free text about members is a
-- privacy cost nothing has asked to pay. Do not add it speculatively.
--
-- RLS still applies. Supabase evaluates the subscriber's policies against each change before
-- delivering it, so migration 019's bishopric-only SELECT policy governs who receives what. That
-- is the claim the test checks rather than takes on trust.


-- ============================================================================
-- Part 1 — the publication must exist
-- ============================================================================
--
-- Supabase creates `supabase_realtime` on every project, so its absence means this is running
-- somewhere unexpected. Raising is the only honest answer: a migration that quietly skipped its
-- entire purpose and reported success is precisely the silent failure CLAUDE.md rule 7 forbids —
-- realtime would be dead, `db:push` would say nothing, and the first sign of trouble would be a
-- comment thread that never updates.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception
      'The supabase_realtime publication does not exist, so realtime cannot be enabled. '
      'Supabase creates it on every project - check that this is running against the linked '
      'project (npm run db:link) before creating it by hand.';
  end if;
end
$$;


-- ============================================================================
-- Part 2 — assignment_comments
-- ============================================================================
--
-- Guarded per table rather than wrapped in a single `if not exists` over the whole migration:
-- db:push is not the only thing that runs these, and a re-run has to be a no-op rather than an
-- "already member of publication" error that stops a deploy.

do $$
begin
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
