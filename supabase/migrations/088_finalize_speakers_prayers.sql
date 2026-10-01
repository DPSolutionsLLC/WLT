-- ITER-036, migration 088: FINALIZING SPEAKERS (AND PRAYERS) IS WHAT SENDS THE ASKS.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: two nullable columns, two CHECKs
-- widened to admit one more value each, and a backfill of the new columns. The running build
-- selects neither column and writes none of the new values, so no entry belongs in
-- HELD_BACK_UNTIL_DEPLOYED.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS STORES (plans/sacrament-finalize-hands-off-asks.md, D1–D6)
-- ---------------------------------------------------------------------------
-- Finalizing means "I've prayed about it and decided", separately per kind: topics (078),
-- references (079), and now speakers and prayers. Finalizing speakers is what puts one "Ask ___ to
-- speak" to-do per chosen speaker on the CONDUCTOR's list (D1, D6); it replaces the old "Send
-- asks" button. Prayers follow in the next slice (fb) and use `prayers_finalized_at`, landed here
-- so that slice needs no migration of its own.
--
-- A TIMESTAMP, NEVER A BOOLEAN, AND NO `_by` COLUMN — 078's rule for `topics_finalized_at`:
-- "when was this decided" is the question, null is how un-finalizing works without a delete, and
-- a user column on a ward-scoped table is the composite-key trap migration 069 narrowed. The audit
-- row records who.
--
-- `unfinalized` is a new `todos.closed_reason` and timeline kind: an ask the owner had touched is
-- CLOSED (never deleted) when the decision is reopened (D3). The code is in
-- lib/sacrament/finalizePeople.ts and lib/todos/askLinks.ts.
--
-- NO POLICY MOVES. `sundays` keeps migration 019's ward-wide UPDATE; the route's `talks.request`
-- check is the boundary, exactly as `topics.manage` is for 078.
--
-- Structure:
--   088a  sundays.speakers_finalized_at, sundays.prayers_finalized_at
--   088b  todos.closed_reason values
--   088c  todo_log_entries kinds
--   088d  backfill: a Sunday whose speakers were already asked reads finalized


-- ---------------------------------------------------------------------------
-- 088a. the stamps
-- ---------------------------------------------------------------------------
alter table sundays
  add column speakers_finalized_at timestamptz,
  add column prayers_finalized_at timestamptz;

comment on column sundays.speakers_finalized_at is
  'When a member of the bishopric finalized this Sunday''s speakers, which sends their asks to the '
  'conductor (ITER-036, D1). Cleared when a speaker changes. lib/sacrament/finalizePeople.ts.';

comment on column sundays.prayers_finalized_at is
  'When a member of the bishopric finalized this Sunday''s prayers, which sends their asks to the '
  'conductor (ITER-036, D1). Cleared when a prayer''s person changes. lib/sacrament/finalizePeople.ts.';


-- ---------------------------------------------------------------------------
-- 088b. todos.closed_reason
-- ---------------------------------------------------------------------------
-- MUST STAY IN STEP WITH `TODO_CLOSED_REASONS` in types/domain.ts.
alter table todos drop constraint todos_closed_reason_check;

alter table todos add constraint todos_closed_reason_check check (
  closed_reason is null
  or closed_reason in (
    'handed_over',
    'assistant_released',
    'speaker_changed',
    'told_not_needed',
    'talk_back_on',
    'unfinalized'
  )
);


-- ---------------------------------------------------------------------------
-- 088c. todo_log_entries kinds
-- ---------------------------------------------------------------------------
-- MUST STAY IN STEP WITH `TODO_LOG_KINDS` in types/domain.ts.
alter table todo_log_entries drop constraint todo_log_entries_kind_check;

alter table todo_log_entries add constraint todo_log_entries_kind_check check (
  kind in (
    'note',
    'step_done',
    'step_undone',
    'completed',
    'reopened',
    'scheduled',
    'unscheduled',
    'source_completed',
    'ask_accepted',
    'ask_declined',
    'handed_over',
    'assistant_released',
    'speaker_changed',
    'taken_over',
    'talk_off',
    'told_not_needed',
    'talk_back_on',
    'unfinalized'
  )
);


-- ---------------------------------------------------------------------------
-- 088d. backfill
-- ---------------------------------------------------------------------------
-- A Sunday whose speakers were already asked under "Send asks" — any ask to-do, open or answered,
-- on a live talk — reads finalized, so the deploy moves no live Sunday back to "not finalized"
-- over asks that were sent. Prayers had no asks before this, so nothing is backfilled for them.
update sundays
set speakers_finalized_at = now()
where speakers_finalized_at is null
  and exists (
    select 1
    from assignments
    join todos on todos.ask_assignment_id = assignments.id
    where assignments.sunday_id = sundays.id
      and assignments.ward_id = sundays.ward_id
      and assignments.cancelled_at is null
  );
