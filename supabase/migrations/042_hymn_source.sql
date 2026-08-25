-- Program E, migration 042: where a hymn row came from.
--
-- ---------------------------------------------------------------------------
-- WHY THIS COLUMN EXISTS
-- ---------------------------------------------------------------------------
-- supabase/seed/hymns.sql holds 42 of the hymnbook's 341 hymns and its own header forbids
-- padding the gap with plausible-looking entries, because a wrong hymn number prints on a
-- program that a congregation then sings from. That instruction still stands.
--
-- Everything in program-e — search, AI candidate ranking, the coordinator's screen — needs 341
-- searchable rows to be built and tested against. The way through, decided 2026-08-25, is to
-- fill the 299 missing numbers with rows nobody could mistake for a real hymn
-- ("[Placeholder] Hymn 43") and to record in the data itself which is which. No plausible-looking
-- entry is ever written, so the seed file's rule is honoured rather than waived.
--
-- This is a BUILD-AND-TEST measure. A ward must not print a programme from a placeholder.
-- `npm run hymns:reset` deletes every placeholder and leaves the 42 verified rows untouched;
-- `npm run hymns:import -- <file>` loads an approved hymnbook over the top.
--
-- ---------------------------------------------------------------------------
-- WHY THE DEFAULT IS ADDED AND THEN DROPPED
-- ---------------------------------------------------------------------------
-- ADD COLUMN ... DEFAULT backfills the 42 existing rows as 'authoritative', which is correct:
-- they were hand-verified. Dropping the default afterwards forces every future insert to state
-- what it is. Left in place, a placeholder insert that forgot `source` would be silently
-- recorded as authoritative — and that is the one direction this column must never be wrong in.

alter table hymns add column source text not null default 'authoritative';
alter table hymns alter column source drop default;

alter table hymns add constraint hymns_source_check
  check (source in ('authoritative', 'placeholder'));

comment on column hymns.source is
  'Where this row came from. ''authoritative'' = number and title verified against a real
   hymnbook and safe to print. ''placeholder'' = a synthetic row filling a gap so the app has
   341 searchable numbers to build and test against; its title reads "[Placeholder] Hymn <n>"
   and it carries no topic tags. NOT NULL with no default on purpose, so an insert must say
   which it is. Clear every placeholder with `npm run hymns:reset`, which deletes
   where source = ''placeholder'' and nothing else.';
