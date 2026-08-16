-- Phase 1A, migration 020: ward-scoped reads on `users`.
--
-- Migration 019 made users SELECT self-only and handed the decision to phase 1
-- (plans/retros/foundation-b-schema.md, "Known gaps"). The decision is a ward-scoped policy.
--
-- Safe against recursion: every policy on every other table resolves the caller's ward through
-- current_ward_id(), which is SECURITY DEFINER and therefore bypasses RLS on its own read of
-- `users`. A ward-scoped policy here cannot re-enter it.
--
-- Trade-off, accepted deliberately: RLS grants rows, never columns, so any authenticated ward
-- member can read another ward member's email. Everyone with an account is ward leadership, and
-- the alternative (a definer-side view) means every future name lookup has to remember to use it.
-- If a genuinely private column is ever added to `users`, it goes in its own table instead --
-- the same reasoning that moved member notes out of `members` in migration 003.

drop policy users_select_self on users;

create policy users_ward_select on users
  for select to authenticated
  using (ward_id = current_ward_id());
