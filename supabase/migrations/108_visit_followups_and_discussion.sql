-- ITER-055 slice bv7, migration 108: a follow-up to-do from a visit, and "discuss in bishopric
-- meeting" (plans/bishopric-visits.md P14, P15, P-B).
--
-- ---------------------------------------------------------------------------
-- A FOLLOW-UP IS AN ORDINARY TO-DO WITH A LINK BACK (P14)
-- ---------------------------------------------------------------------------
-- `todos.visit_log_id` says which visit a follow-up came from, so the card can read "From a visit
-- to the ___ family". Unlike "Visit the ___ family" (103b) nothing closes it automatically: once
-- given, it is its owner's own work, so it can be ticked and deleted like any to-do. Written only
-- by lib/todos/visitLinks.ts with the service role, because it may land on another bishopric
-- member's list (081's INSERT policy is owner-only). `on delete set null`: deleting a visit leaves
-- the follow-up somebody was given.
--
-- ---------------------------------------------------------------------------
-- DISCUSS IN BISHOPRIC MEETING (P15) — ITS OWN COLUMNS, NOT THE WARD-COUNCIL FLAG
-- ---------------------------------------------------------------------------
-- `flagged_for_ward_council` / `flag_sent_at` (visits-c) are the ward council's. Publishing ANY
-- agenda stamps `flag_sent_at` for the ids its `flag` lines carry, so a discussion line that reused
-- that tag would silence a ward-council flag on the same visit. A discussion line is therefore its
-- own agenda source (`visit_discussion`) and these are its own columns:
--   discuss_in_bishopric    — somebody in the bishopric asked for it.
--   bishopric_discussed_at  — a published BISHOPRIC agenda carried it. Set only while the request
--                             stands; withdrawing clears both, and asking again clears the stamp.
--
-- Only one line ever reaches an agenda — "Visit — ___ family — to discuss" — never the shared
-- report and never the private note (lib/agendas/flaggedItems.ts's one-liner boundary).
-- No agenda is ever created to hold it (P-B): it joins an upcoming draft bishopric agenda, or waits
-- for the next one somebody creates.

-- ---------------------------------------------------------------------------
-- 108a. The follow-up link
-- ---------------------------------------------------------------------------
alter table todos add column visit_log_id uuid references visit_logs (id) on delete set null;

comment on column todos.visit_log_id is
  'The visit this follow-up to-do was created from (ITER-055 bv7). Null on every other to-do.';

create index todos_visit_log_idx on todos (visit_log_id) where visit_log_id is not null;

-- ---------------------------------------------------------------------------
-- 108b. Discuss in bishopric meeting
-- ---------------------------------------------------------------------------
alter table visit_logs
  add column discuss_in_bishopric boolean not null default false,
  add column bishopric_discussed_at timestamptz;

-- A stamp with no request standing is a contradiction, so it is refused rather than tolerated.
alter table visit_logs add constraint visit_logs_discussed_needs_request
  check (bishopric_discussed_at is null or discuss_in_bishopric);

comment on column visit_logs.discuss_in_bishopric is
  'The bishopric asked to discuss this visit in a bishopric meeting (ITER-055 bv7).';
comment on column visit_logs.bishopric_discussed_at is
  'When a published bishopric agenda carried this visit''s discussion line (ITER-055 bv7).';
