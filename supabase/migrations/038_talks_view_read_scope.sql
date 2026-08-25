-- Program A, migration 038: let the roles that hold `talks.view` actually read the talk pipeline.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT THIS FIXES
-- ---------------------------------------------------------------------------
-- Migration 019 put `assignments` and `topics` in the BISHOPRIC-ONLY policy loop, so SELECT on
-- both is `ward_id = current_ward_id() and is_bishopric()`.
--
-- lib/auth/permissions.ts, meanwhile, grants `talks.view` to ward_secretary, executive_secretary
-- and music_coordinator — and grants `program.build` and `program.view` to ward_secretary, who is
-- the person whose job the program builder exists to do.
--
-- Those two facts have contradicted each other since foundation-b, with no symptom, because
-- nothing read `assignments` on behalf of a non-bishopric user until Phase 6. Found by
-- tests/db/program-snapshot.test.ts running as a ward_secretary against the hosted project: the
-- draft assembled with every speaking slot `empty` and no topics, and the route answered 200. A
-- silently empty program is worse than a refusal — the secretary would print it.
--
-- This is the same shape as ITER-007 (`calendar.manage_org_conducting` held by roles that cannot
-- reach the screen exposing it): a permission that is dead at the database level.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES AND DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- SELECT only, on `assignments` and `topics` only. It implements a decision the permission matrix
-- already made; it does not make a new one.
--
-- INSERT, UPDATE and DELETE stay bishopric-only on both tables. Planning a speaker and running the
-- pipeline remain the bishopric's, exactly as before — a secretary reads the plan to build a
-- program from it, and changes nothing.
--
-- assignment_approvals, assignment_comments and assignment_history are UNTOUCHED. Approvals and
-- comments are the bishopric deliberating about a person, which is a different thing from the
-- resulting assignment, and no part of a program is built from them.
--
-- Roles are named as literals because RLS cannot read `wards.settings.role_access`. A ward that
-- REMOVES talks.view from its secretary is honoured by assertCan() in the route rather than here,
-- so the two together stay strictly narrower than either alone — the correct direction. This is
-- the same trade migration 037 documents for `programs`.

drop policy assignments_bishopric_select on assignments;
drop policy topics_bishopric_select on topics;

-- Kept as one list in one place. Two policies with two hand-copied role arrays is two things to
-- keep in step, and 019's loop exists because twenty-four hand-written blocks was twenty-four
-- chances for one to drift.
create function can_view_talks()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(
    current_user_role() in (
      'bishop',
      'counselor',
      'ward_secretary',
      'executive_secretary',
      'music_coordinator'
    ),
    false
  );
$$;

comment on function can_view_talks is
  'The roles holding `talks.view` in lib/auth/permissions.ts. Keep the two in step: this function
   is the read half of that permission, and the matrix is the write half. It grants READING the
   talk pipeline only — planning and every stage transition stay behind is_bishopric().';

create policy assignments_talks_view_select on assignments for select to authenticated
  using (ward_id = current_ward_id() and can_view_talks());

create policy topics_talks_view_select on topics for select to authenticated
  using (ward_id = current_ward_id() and can_view_talks());
