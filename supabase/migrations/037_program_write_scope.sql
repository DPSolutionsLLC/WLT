-- Program A, migration 037: narrow who may WRITE a program.
--
-- ---------------------------------------------------------------------------
-- WHY THIS DEVIATES FROM MIGRATION 019'S LOOP, ON PURPOSE
-- ---------------------------------------------------------------------------
-- `programs` sits in 019's ward-scoped policy loop, which grants every authenticated member of
-- the ward all four verbs. That made the route's assertCan() the only write boundary — exactly
-- the shape CLAUDE.md rule 2 says not to rely on: a route that forgets a check must still be safe
-- because the policy blocked it.
--
-- A program is a document a whole ward is about to be handed, and by program-d it is a PDF in
-- everyone's inbox. Anybody in the ward being able to rewrite it the night before is not a
-- theoretical hole.
--
-- SELECT STAYS WARD-WIDE. Nothing in a program is private to the bishopric — it is read aloud on
-- Sunday. WRITE is the boundary that was missing, and it is the only one this migration changes.
--
-- ---------------------------------------------------------------------------
-- WHY THE ROLES ARE LITERALS HERE
-- ---------------------------------------------------------------------------
-- RLS cannot read a ward's `wards.settings.role_access` override, so these three roles are named
-- directly rather than resolved through it. That means the policy is the CODE default, and a ward
-- that has removed program.build from its secretary is honoured by assertCan() in the route
-- rather than here.
--
-- The two together are strictly narrower than either alone — a caller must satisfy BOTH the
-- policy and the ward's own configuration — which is the correct direction for a boundary to be
-- wrong in. A ward that ADDS program.build to another role gets a route that permits it and a
-- policy that refuses it; that is a deliberate trade, and widening this policy to match would
-- mean trusting a jsonb blob from inside RLS.
--
-- ---------------------------------------------------------------------------
-- prayer_assignments IS DELIBERATELY NOT TOUCHED
-- ---------------------------------------------------------------------------
-- It has the same ward-wide write hole, and plans/retros/talks-c-prayers-topics.md asked for that
-- to be raised before Phase 6 read prayers onto a public page. It was raised while this migration
-- was written and left for its own change: narrowing prayer writes changes the boundary for the
-- Phase 4 prayer board, which this plan writes no tests for.

drop policy programs_ward_insert on programs;
drop policy programs_ward_update on programs;
drop policy programs_ward_delete on programs;

create policy programs_builder_insert on programs for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'ward_secretary')
  );

create policy programs_builder_update on programs for update to authenticated
  using (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'ward_secretary')
  )
  with check (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'ward_secretary')
  );

create policy programs_builder_delete on programs for delete to authenticated
  using (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'ward_secretary')
  );

comment on table programs is
  'Sacrament meeting programs. SELECT is ward-wide (migration 019); INSERT/UPDATE/DELETE are
   narrowed to bishop, counselor and ward_secretary by migration 037, deviating from 019''s loop
   on purpose. draft_data is a SNAPSHOT, not a view: once written it stops tracking the calendar,
   assignments and prayers it came from, and POST /api/programs/[id]/refresh is the only sanctioned
   way to move it forward.';
