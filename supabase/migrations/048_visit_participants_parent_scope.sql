-- Visits D, migration 048: a participant's WRITE scope is its parent visit's, not its own column.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
-- Migration 046 gave `visit_participants` the same policy shape as `visit_logs`, over its own
-- denormalized `org_id`. For `visit_logs` that is complete — a visit log has no parent, so its
-- own org is the whole story. `visit_participants` DOES have a parent, and its own column is
-- therefore only half the question.
--
-- The hole: an Elders Quorum leader inserting
--
--   { org_id: <their own EQ>, visit_log_id: <a Relief Society visit> }
--
-- satisfies `org_id = current_org_id()` and satisfies the composite foreign key to
-- visit_logs (id, ward_id), which only checks the WARD. So the write succeeded, and with
-- cross-org visibility on the Relief Society would read a participant on their own visit that
-- nobody in their organization put there.
--
-- It is a write-integrity hole rather than a confidentiality one — the attacker reads nothing
-- they could not already read — and the application never produces that shape, because
-- lib/visits/participants.ts stamps `org_id` from the PARENT visit and never from a request. But
-- CLAUDE.md rule 2 is that RLS is the security boundary and the route is not: a policy that
-- holds only because the one caller happens to be careful is not the boundary.
--
-- ---------------------------------------------------------------------------
-- THE FIX, AND WHY SELECT IS LEFT ALONE
-- ---------------------------------------------------------------------------
-- The three WRITE policies now also require that the caller could write the PARENT visit. The
-- SELECT policy is deliberately unchanged: reads are the per-row hot path — the visits page
-- fetches every participant for every recent visit in one query — and the denormalized `org_id`
-- is exactly what lets that policy avoid a subquery per row. Denormalization is safe for reads
-- because `visit_logs.org_id` is not patchable: app/api/visits/[id]/route.ts accepts no org
-- change, by design, so the copy cannot drift from the original.
--
-- A SECURITY DEFINER helper rather than an inline EXISTS, following
-- `ward_allows_cross_org_visibility()` in 019: inside a policy an inline subquery would itself be
-- subject to visit_logs' RLS, which makes the predicate depend on the ward's cross-org READ
-- setting — and this is a WRITE check, which must not move when that setting does.
--
-- ---------------------------------------------------------------------------
-- THE THREE POLICIES ARE DROPPED, NOT SHADOWED
-- ---------------------------------------------------------------------------
-- PostgreSQL ORs permissive policies together, so adding a stricter policy beside the old one
-- would change nothing at all — the old one keeps granting
-- (plans/retros/talks-d-reliability-goals.md). Dropping is correct HERE, and only here, because
-- these are policies migration 046 created two migrations ago and this file replaces them.

create function visit_log_is_writable_by_caller(target_visit_log_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from visit_logs parent
    where parent.id = target_visit_log_id
      and parent.ward_id = current_ward_id()
      and (is_bishopric() or parent.org_id = current_org_id())
  );
$$;

drop policy visit_participants_insert on visit_participants;
drop policy visit_participants_update on visit_participants;
drop policy visit_participants_delete on visit_participants;

create policy visit_participants_insert on visit_participants
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id = current_org_id())
    and visit_log_is_writable_by_caller(visit_log_id)
  );

create policy visit_participants_update on visit_participants
  for update to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id = current_org_id())
    and visit_log_is_writable_by_caller(visit_log_id)
  )
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id = current_org_id())
    and visit_log_is_writable_by_caller(visit_log_id)
  );

create policy visit_participants_delete on visit_participants
  for delete to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id = current_org_id())
    and visit_log_is_writable_by_caller(visit_log_id)
  );
