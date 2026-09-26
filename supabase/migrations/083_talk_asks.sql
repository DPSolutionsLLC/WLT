-- P4 Sacrament slice f1, migration 083: A TALK'S ASK IS A TO-DO FOR WHOEVER CONDUCTS THAT SUNDAY.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: three nullable columns, two
-- indexes, and one CHECK widened to admit more values than before. The running build selects none
-- of the new columns and writes none of the new log kinds, so nothing it reads or writes can break
-- and no entry belongs in HELD_BACK_UNTIL_DEPLOYED.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS STORES (plans/sacrament-talk-asks-conductor-and-assistant.md, U1 and U6–U9)
-- ---------------------------------------------------------------------------
-- "Send asks" on a Sunday creates one "Ask ___ to speak" to-do per speaker not yet asked, on the
-- list of that Sunday's CONDUCTING leader (U1). The answer — accepted, or declined with a reason —
-- is recorded ON THE TO-DO and goes through the talk pipeline's existing outcome path (U7). An
-- answered ask is marked done and NEVER deleted; its timeline says what the answer was.
--
-- `todos.ask_assignment_id` is the link. It is ITS OWN COLUMN rather than a polymorphic
-- (source_type, source_id) pair for the reason migration 082 gave `action_item_id` one: a foreign
-- key is what keeps the link honest, and a polymorphic id can point at nothing with no error
-- anywhere. Slice g (Prayers) adds `ask_prayer_id` beside it on the same terms.
--
-- `todos.closed_reason` says why an OPEN ask left somebody's list WITHOUT being answered: the work
-- moved to a new conductor (f2), an assistant stopped assisting (f3), or the talk's speaker
-- changed (f1). A closed ask has `completed_at` set as well, so every existing reader already
-- treats it as done; this column is only the reason. Null on every ordinary to-do. All three
-- values are admitted NOW so f2 and f3 do not rewrite this CHECK — 081's precedent with
-- `source_completed`.
--
-- `assignment_history.decline_reason` is the answer's reason, for speaker history. Only a MEMBER
-- has a history row (migration 005: `member_id not null`), so a visiting speaker's decline is
-- recorded on the talk and nowhere else (U8).
--
-- ---------------------------------------------------------------------------
-- NO POLICY MOVES
-- ---------------------------------------------------------------------------
-- `todos` stays owner-only on every verb (081, D2) and its INSERT still refuses any `assigned_by`
-- (D3). The conductor's asks are therefore written by the service role in lib/todos/askLinks.ts,
-- behind the route's own `talks.request` check — lib/todos/sourceLinks.ts's pattern. A conductor
-- and an assistant each hold their OWN copy and neither can read the other's steps or notes.
-- `assignment_history` keeps migration 019's bishopric-only policies.
--
-- Structure:
--   083a  todos columns
--   083b  one open ask per (talk, owner)
--   083c  todo_log_entries kinds
--   083d  assignment_history.decline_reason


-- ---------------------------------------------------------------------------
-- 083a. todos
-- ---------------------------------------------------------------------------
-- A SINGLE-COLUMN `on delete set null`. `todos` has no `(id, ward_id)` pairing to `assignments`,
-- and a single-column set null cannot null `ward_id` with it (the visits-d / migration 047 trap
-- only bites a composite key). Deleting a talk therefore leaves its asks standing as ordinary
-- to-dos: never destroy what somebody wrote.
alter table todos
  add column ask_assignment_id uuid references assignments (id) on delete set null,
  add column closed_reason text check (
    closed_reason is null
    or closed_reason in ('handed_over', 'assistant_released', 'speaker_changed')
  );

comment on column todos.ask_assignment_id is
  'The talk this to-do asks somebody to give (Sacrament slice f). Null for every other to-do. '
  'Written only by lib/todos/askLinks.ts with the service role.';

comment on column todos.closed_reason is
  'Why an open ask left this list without being answered: handed_over, assistant_released or '
  'speaker_changed. completed_at is set too. Null for every ordinary to-do.';


-- ---------------------------------------------------------------------------
-- 083b. AT MOST ONE OPEN ASK PER (TALK, OWNER)
-- ---------------------------------------------------------------------------
-- What makes Send asks idempotent: a double press, or a retry after a half-finished run, meets
-- this index and is treated as already done (23505). PARTIAL on `completed_at is null`, so an
-- answered or closed ask never blocks a fresh one — a changed speaker is asked anew.
create unique index todos_one_open_ask_per_owner
  on todos (ask_assignment_id, user_id)
  where ask_assignment_id is not null and completed_at is null;

-- Every lookup by talk, open or closed — resolving an answer, closing on a speaker change.
create index todos_ask_assignment_idx
  on todos (ask_assignment_id)
  where ask_assignment_id is not null;


-- ---------------------------------------------------------------------------
-- 083c. todo_log_entries kinds
-- ---------------------------------------------------------------------------
-- The inline column CHECK in migration 081 takes Postgres's default name. Every kind f2 and f3
-- write is admitted here, for the same reason as 083a's `closed_reason` values.
--
-- `body` carries the REASON LABEL for `ask_declined` ("Not available") and the new owner's NAME,
-- snapshotted, for `handed_over` — never the decline's free-text note, which stays on the talk.
--
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
    'speaker_changed'
  )
);


-- ---------------------------------------------------------------------------
-- 083d. assignment_history.decline_reason
-- ---------------------------------------------------------------------------
-- Null on every existing row, which renders as a plain "Declined". MUST STAY IN STEP WITH
-- `DECLINE_REASONS` in types/domain.ts.
alter table assignment_history
  add column decline_reason text check (
    decline_reason is null or decline_reason in ('not_available', 'other')
  );

comment on column assignment_history.decline_reason is
  'Why a declined talk was declined: not_available or other. Null for every other outcome and '
  'for declines recorded before migration 083.';
