-- P5 slice b, migration 082: AN AGENDA ACTION ITEM CAN BE ASSIGNED TO A PERSON, AND THAT PERSON'S
-- TO-DO IS LINKED TO IT — "TWO KEYS, ONE ITEM".
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: four nullable columns and one
-- partial unique index. It touches no existing column, CHECK or policy, and the running build
-- selects neither table's new columns, so nothing it reads can break and no entry belongs in
-- HELD_BACK_UNTIL_DEPLOYED.
--
-- ---------------------------------------------------------------------------
-- WHAT THE TWO KEYS ARE (plans/todo-and-my-appointments.md, Tasks 10–15)
-- ---------------------------------------------------------------------------
-- Assigning an action item to a user creates that user's to-do, linked here by
-- `todos.action_item_id`. Completion then runs both ways, and NEITHER direction completes the
-- other side:
--   * the meeting completes the item  → the to-do gets `source_completed_at` (a flag, never a
--     delete; the owner's steps and notes are theirs);
--   * the owner completes the to-do   → the item gets `completion_review_requested_at` (a flag the
--     bishopric sees on the agenda; the meeting decides whether it is done).
-- "Confirm, don't silently act" (decisions.md §1), applied in both directions.
--
-- ---------------------------------------------------------------------------
-- `assigned_to` (FREE TEXT) IS NOT TOUCHED OR BACKFILLED
-- ---------------------------------------------------------------------------
-- A typed "Brother Diaz" cannot be resolved to an account honestly — there may be two, or none
-- with an account at all. The free-text field keeps working exactly as before. P4's Agendas slice
-- replaces the free-text control with a picker writing `assigned_user_id`; until then the column
-- is written only through the API and the harness seed (decision D1).
--
-- ---------------------------------------------------------------------------
-- NO POLICY MOVES
-- ---------------------------------------------------------------------------
-- `action_items` sits in migration 019's ward-wide loop, so a to-do's owner may already write
-- `completion_review_requested_at` with their own client — which is the reverse key. `todos` stays
-- owner-only (081), which is exactly why the FORWARD key (creating, flagging, unlinking another
-- person's to-do) runs through the service role in lib/todos/sourceLinks.ts, behind the agenda
-- route's own `agendas.manage` check.
--
-- ---------------------------------------------------------------------------
-- PLAIN SINGLE-COLUMN FOREIGN KEYS, both of them
-- ---------------------------------------------------------------------------
-- `assigned_user_id` is a USER reference, and user references are never composite with `ward_id`
-- (migration 069; tests/db/user-author-fks.test.ts). It is a SUBJECT written from a request body,
-- so the routes call findUsersOutsideWard() before writing it — the check the composite key used
-- to make.
--
-- `todos.action_item_id` is single-column because `action_items` has no `unique (id, ward_id)` to
-- reference, and `on delete set null` on a single column cannot null `ward_id` with it (the
-- visits-d / migration 047 trap only bites a composite key). Deleting an action item therefore
-- UNLINKS its to-do and never deletes it; the route removes an untouched one itself, first.
--
-- Structure:
--   082a  action_items columns
--   082b  todos columns
--   082c  one to-do per (action item, owner)


-- ---------------------------------------------------------------------------
-- 082a. action_items
-- ---------------------------------------------------------------------------
alter table action_items
  add column assigned_user_id uuid references users (id) on delete set null,
  add column completion_review_requested_at timestamptz;

comment on column action_items.assigned_user_id is
  'The account this item is assigned to, if any. Creates and links that person''s to-do '
  '(lib/todos/sourceLinks.ts). Independent of the free-text assigned_to, which is untouched.';

comment on column action_items.completion_review_requested_at is
  'Set when the assignee marks their linked to-do complete: the meeting is asked to review the '
  'item, never auto-completed. Cleared when the item is completed or reopened.';


-- ---------------------------------------------------------------------------
-- 082b. todos
-- ---------------------------------------------------------------------------
alter table todos
  add column action_item_id uuid references action_items (id) on delete set null,
  add column source_completed_at timestamptz;

comment on column todos.action_item_id is
  'The agenda action item this to-do was created for. Null for a to-do the owner wrote. '
  'Moves to the newest copy when the item is carried forward to the next agenda.';

comment on column todos.source_completed_at is
  'Set when the linked action item is completed on the agenda: a flag for the owner, never a '
  'delete or a completion. Cleared if the item is reopened.';


-- ---------------------------------------------------------------------------
-- 082c. ONE TO-DO PER (ACTION ITEM, OWNER)
-- ---------------------------------------------------------------------------
-- What makes the auto-create idempotent: a double submit, or a retry after the "saved, but the
-- to-do was not" 500, meets this index and is treated as already done. Partial, so the owner's
-- own to-dos (null link) never collide with each other. Its leading column also serves every
-- lookup by `action_item_id`.
create unique index todos_one_per_action_item_owner
  on todos (action_item_id, user_id)
  where action_item_id is not null;
