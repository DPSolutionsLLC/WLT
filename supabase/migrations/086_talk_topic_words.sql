-- P4 Sacrament, Topics screen rebuild slice t1, migration 086: A TALK'S TOPIC IS ITS WORDS.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. ADDITIVE: one new nullable column and a backfill.
-- The running build neither selects nor writes `topic_title`, so nothing it does changes shape.
-- The backfill must run BEFORE the new code reads the column, and applying this ahead of the
-- deploy is what guarantees that. No entry belongs in HELD_BACK_UNTIL_DEPLOYED.
--
-- ---------------------------------------------------------------------------
-- THE DECISION (plans/sacrament-topics-screen-rebuild.md, user decision 1, 2026-09-29)
-- ---------------------------------------------------------------------------
-- There is no topic library. A talk's topic is the words typed for it, and what the ward keeps is
-- a HISTORY of the words it has used, read straight off `assignments`. The talk carries its own
-- copy of the words the speaker was asked to speak about, so nothing done elsewhere later — a
-- rename, an archive — can rewrite what somebody was asked.
--
-- `topic_id`, `topics` and `topic_candidates` are NOT touched. From this slice on nothing writes
-- or reads them, and their data is kept: never destroy what somebody wrote. Dropping them is a
-- later, deliberate migration, held back until after a deploy because the build before this one
-- still selects them.
--
-- The CHECK mirrors MAX_TOPIC_TITLE in types/domain.ts. A blank title is stored as null by the
-- data layer, so an all-whitespace value can never be the stored form of "no topic".

alter table assignments
  add column topic_title text
  check (topic_title is null or char_length(btrim(topic_title)) between 1 and 200);

comment on column assignments.topic_title is
  'The words this talk''s speaker was asked to speak about (migration 086). Replaces topic_id, '
  'which is kept for its data and no longer written.';

update assignments a
   set topic_title = t.title
  from topics t
 where t.id = a.topic_id
   and t.ward_id = a.ward_id
   and a.topic_title is null;
