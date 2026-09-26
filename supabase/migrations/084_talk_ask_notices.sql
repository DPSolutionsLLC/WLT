-- P4 Sacrament slice f2b, migration 084: WHEN A TALK IS OFF, WHOEVER ASKED THE SPEAKER IS TOLD.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: one nullable column and two
-- CHECKs widened to admit more values than before. The running build selects nothing new and
-- writes none of the new values, so no entry belongs in HELD_BACK_UNTIL_DEPLOYED.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS STORES (plans/sacrament-talk-asks-conductor-and-assistant.md, f2b)
-- ---------------------------------------------------------------------------
-- A talk is OFF when its Sunday holds no sacrament meeting (a stake conference, say) or its slot
-- no longer exists (a Fast Sunday, or fewer speaking slots). Whether a talk is off is COMPUTED
-- from the Sunday, never stored (lib/sacrament/talkAsks.ts, talkIsOff()).
--
-- What IS stored is an event: WHEN an ask's owner was told its talk is off. `todos.talk_off_at`
-- is set on the ask (or on a new "Let ___ know there's no talk" to-do for a speaker who had
-- already accepted) together with a `talk_off` timeline line. The owner closes it with "Told
-- them" (`closed_reason = 'told_not_needed'`). If the talk comes back on first, it is closed with
-- `closed_reason = 'talk_back_on'` and the speaker is asked again from scratch (the user's
-- decision, 2026-09-26).
--
-- `taken_over` is the new owner's line after a handover (f2): "Taken over from ___".
--
-- NO POLICY MOVES. `todos` stays owner-only on every verb (081); these writes go through the
-- service role in lib/todos/askLinks.ts, behind the calendar route's own permission check.
--
-- Structure:
--   084a  todos.talk_off_at
--   084b  todos.closed_reason values
--   084c  todo_log_entries kinds


-- ---------------------------------------------------------------------------
-- 084a. todos.talk_off_at
-- ---------------------------------------------------------------------------
alter table todos add column talk_off_at timestamptz;

comment on column todos.talk_off_at is
  'When this ask''s owner was told its talk is off (Sacrament slice f2b). Null on every other '
  'to-do. Written only by lib/todos/askLinks.ts with the service role.';


-- ---------------------------------------------------------------------------
-- 084b. todos.closed_reason
-- ---------------------------------------------------------------------------
-- Migration 083's inline CHECK takes Postgres's default name. MUST STAY IN STEP WITH
-- `TODO_CLOSED_REASONS` in types/domain.ts.
alter table todos drop constraint todos_closed_reason_check;

alter table todos add constraint todos_closed_reason_check check (
  closed_reason is null
  or closed_reason in (
    'handed_over',
    'assistant_released',
    'speaker_changed',
    'told_not_needed',
    'talk_back_on'
  )
);


-- ---------------------------------------------------------------------------
-- 084c. todo_log_entries kinds
-- ---------------------------------------------------------------------------
-- `body` carries the previous owner's NAME, snapshotted, for `taken_over`, and the Sunday's
-- date in words, snapshotted, for `talk_off`. MUST STAY IN STEP WITH `TODO_LOG_KINDS` in
-- types/domain.ts.
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
    'talk_back_on'
  )
);
