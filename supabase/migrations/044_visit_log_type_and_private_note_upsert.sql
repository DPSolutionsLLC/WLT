-- Visits A, migration 044: the three schema gaps between migration 008 and the visit tracker
-- the application layer needs.
--
-- ADDS COLUMNS AND ONE CONSTRAINT. IT TOUCHES NO POLICY. Migration 019's visit policies are
-- correct as written, and dropping a permissive policy to "replace" it is how a widened read
-- survives a review (plans/retros/talks-d-reliability-goals.md) — PostgreSQL ORs permissive
-- policies together, so the old one keeps granting.

-- FEATURES.md §Module 9 and 07-visits.md §Step 2 both list a visit type; migration 008 has no
-- such column. A single-value CHECK looks odd on purpose: one value is what the feature spec
-- names, and the constraint is what makes a second one a decision rather than a typo.
alter table visit_logs
  add column visit_type text not null default 'in_home'
    check (visit_type in ('in_home'));

-- An edited private note with no updated_at cannot tell its author when they last touched it,
-- and the author is the only person who will ever see it.
alter table visit_private_notes
  add column updated_at timestamptz not null default now();

-- The private-note route is an UPSERT (07-visits.md §Step 2) and there was no constraint to
-- upsert onto. Without this a user accumulates duplicate private notes for one visit, and
-- "the caller's note" stops being a single row anyone can name.
alter table visit_private_notes
  add constraint visit_private_notes_one_per_author unique (visit_log_id, user_id);
