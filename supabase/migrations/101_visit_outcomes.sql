-- ITER-055 slice bv3, migration 101: what a visit reached, and how a contact attempt went
-- (plans/bishopric-visits.md P7, P8).
--
-- ADDS COLUMNS AND CONSTRAINTS. IT TOUCHES NO POLICY. Migration 099's visit_logs SELECT policy and
-- 019's write policies cover the new columns — RLS grants rows, not columns.
--
-- Every existing row keeps its meaning: `needs_another_visit` defaults to false, and both detail
-- columns default to null, so a completed visit stays done and an attempt stays an attempt.

-- ---------------------------------------------------------------------------
-- "Visited, but still needs a visit" (D6, D7)
-- ---------------------------------------------------------------------------
-- A visit happened, but not the visit the household needs — the spouse was out, somebody asked us
-- to come back. It is a COMPLETED visit with a flag, never a third outcome: it still happened, it
-- still names who went, and every reader that asks "did anybody go?" keeps the right answer.
-- Only readers that ask "is this household done?" read the flag (lib/visits/progress.ts,
-- lib/visits/allOrgProgress.ts): a flagged visit does not reset the household's clock.
alter table visit_logs
  add column needs_another_visit boolean not null default false,
  add column needs_another_reason text
    check (needs_another_reason in ('not_home', 'spouse_absent', 'asked_to_return', 'other')),
  add constraint visit_logs_needs_another_reason_with_flag
    check ((needs_another_reason is null) = (not needs_another_visit)),
  add constraint visit_logs_needs_another_only_completed
    check (not needs_another_visit or outcome = 'completed');

-- ---------------------------------------------------------------------------
-- How a contact attempt went (prototype contact panel)
-- ---------------------------------------------------------------------------
-- Set only on an attempt. Optional there: every attempt recorded before this migration has none,
-- and the log form's "Attempted" does not ask.
alter table visit_logs
  add column attempt_detail text
    check (attempt_detail in ('no_answer', 'left_message', 'no_message_left')),
  add constraint visit_logs_attempt_detail_only_attempted
    check (attempt_detail is null or outcome = 'attempted');

-- ---------------------------------------------------------------------------
-- A phone call is a kind of contact
-- ---------------------------------------------------------------------------
-- Migration 044 made `visit_type` a single-value CHECK so that a second value would be a decision.
-- This is that decision: the contact panel records a call attempt as `phone`. A phone call is
-- ONLY EVER AN ATTEMPT (decided with the user 2026-11-04): a done visit is an in-person visit, so a
-- call cannot reset a household's clock. Held here as well as in lib/validation/visit.ts, so a
-- write from anywhere is refused for the same reason.
alter table visit_logs drop constraint visit_logs_visit_type_check;
alter table visit_logs
  add constraint visit_logs_visit_type_check check (visit_type in ('in_home', 'phone')),
  add constraint visit_logs_phone_only_attempted
    check (visit_type <> 'phone' or outcome = 'attempted');
