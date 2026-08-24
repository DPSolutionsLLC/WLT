-- AI D, migration 035: fix the empty-array guards migration 034 shipped inert.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------------------------
-- Migration 034 wrote:
--
--   check (speaker_roles is null or array_length(speaker_roles, 1) > 0)
--
-- `array_length('{}', 1)` RETURNS NULL, NOT 0. Postgres has no first dimension to measure on an
-- empty array, so it answers NULL rather than zero — and `null > 0` is NULL, and a CHECK
-- constraint PASSES on NULL. The guard was therefore inert: an empty array stored happily.
--
-- That matters because `= any ('{}')` matches NOTHING. A filter saved with an empty array would
-- silently return zero documents while reading, in the panel and in the API, as "no restriction
-- on this axis" — the exact failure mode migration 033's standard-works exemption exists to
-- prevent, one table over.
--
-- Caught by tests/rls/retrieval-filter-access.test.ts, which inserts an empty array with the
-- service client and expects a refusal. It is worth noting that NOTHING in the application could
-- reach this state: lib/validation/knowledge.ts refuses an empty array with `.min(1)`, and
-- lib/knowledge/filterResolution.ts collapses one to null before it ever reaches a query. The
-- constraint is the third line of defence, and a third line that does not hold is worse than an
-- absent one because it is believed.
--
-- ---------------------------------------------------------------------------------------------
-- THE FIX
-- ---------------------------------------------------------------------------------------------
-- `cardinality()` counts every element regardless of dimension and returns 0 — a real number, not
-- NULL — for an empty array. It is the right tool for "is this array non-empty" and array_length
-- never was.
--
-- Re-added as NAMED constraints. Migration 034's were inline and got system-generated names,
-- which is why they are dropped by the names Postgres assigned (`<table>_<column>_check`) rather
-- than by names of our choosing. Naming them here means the next person to change them can.

set search_path = public;

alter table retrieval_filters
  drop constraint if exists retrieval_filters_speaker_roles_check,
  drop constraint if exists retrieval_filters_speakers_check;

alter table retrieval_filters
  add constraint retrieval_filters_speaker_roles_not_empty
    check (speaker_roles is null or cardinality(speaker_roles) > 0),
  add constraint retrieval_filters_speakers_not_empty
    check (speakers is null or cardinality(speakers) > 0);
