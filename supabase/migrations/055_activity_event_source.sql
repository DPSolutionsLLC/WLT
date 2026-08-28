-- Phase 8 slice B, migration 055: WHERE AN ACTIVITY EVENT CAME FROM, AND WHETHER IT HAS AN HOUR.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS, exactly like 054. It is additive-with-tightening
-- and nothing here can fail on the rows that exist:
--
--   activity_calendars   0 rows, checked with the service client on 2026-08-27. Both `set not
--                        null` statements below are therefore free. If a row ever appears before
--                        this runs, the statement fails loudly, which is the correct answer.
--   activity_events      4 rows, all seeded by testing/scenarios/youth for slice A. Every column
--                        added here is either nullable or carries a default, and the unique index
--                        is PARTIAL on exactly the shape those rows do not have (calendar_id is
--                        null on all four), so none of them is touched.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added. That allowlist exists for expand-and-contract slices; an entry that is not needed
-- hides a real migration from the assertion that everything on disk has been applied.
--
-- Structure:
--   055a  all_day on activity_events
--   055b  source_uid / source_recurrence_id, and the index that makes re-import idempotent
--   055c  tighten activity_calendars
--   055d  indexes


-- ---------------------------------------------------------------------------
-- 055a. all_day
-- ---------------------------------------------------------------------------
--
-- WITHOUT THIS COLUMN EVERY TOURNAMENT WEEKEND RENDERS "12:00am", AND ON THIS SCREEN THAT IS
-- INDISTINGUISHABLE FROM THE BUG THE WHOLE SLICE EXISTS TO PREVENT.
--
-- An ICS all-day entry (`DTSTART;VALUE=DATE:20270123`) carries a date and no time at all. It is
-- stored at ward midnight, because `event_date` is a timestamptz and there is nowhere else to put
-- it — but a midnight instant read back without this flag looks exactly like a 7:30pm game that
-- got converted through the wrong zone. The marker is what keeps a real off-by-N-hours bug
-- legible, which is the entire justification: 08-youth-activities.md is blunt that "a game
-- showing at the wrong hour makes the whole feature useless", and a bug you cannot see is worse
-- than one you can.
--
-- Slice C needs it for a second reason. Coverage asks "is anybody going to this, and is it within
-- 7 days" — answerable for an all-day event. "Who covers 12:00am" is not a question.
alter table activity_events add column all_day boolean not null default false;


-- ---------------------------------------------------------------------------
-- 055b. Where the row came from, and the index that makes a re-import idempotent
-- ---------------------------------------------------------------------------
--
-- Both nullable, and a null pair means A PERSON TYPED THIS EVENT IN. lib/youth/queries.ts's
-- createActivityEvent already writes `calendar_id: null` for exactly this reason, and slice B's
-- import must never match one of those rows.
--
-- `source_recurrence_id` is the occurrence's own DTSTART for an expanded series, and null for a
-- one-off. A weekly practice is ONE uid and twelve rows; without this column the twelve would
-- collapse onto one another.
alter table activity_events add column source_uid           text;
alter table activity_events add column source_recurrence_id text;

-- IDEMPOTENCE LIVES IN THE DATABASE, NOT IN TYPESCRIPT. lib/youth/ics/buildImportPreview.ts
-- computes the same diff to SHOW it, but two concurrent confirms of the same file would both read
-- "nothing there" and both insert. This index is what makes the second one fail instead.
--
-- TWO THINGS HERE NEED THEIR REASON WRITTEN DOWN.
--
-- `nulls not distinct` (PostgreSQL 15+, already relied on by migration 047's column list) is
-- REQUIRED, not a refinement. `source_recurrence_id` is null on every non-recurring event, and
-- under the default NULLS DISTINCT two rows with the same (ward, calendar, uid) and a null
-- recurrence id would NOT conflict — SQL's `null = null` is NULL, not true. That is the
-- talks-d hole (plans/retros/talks-d-reliability-goals.md) in a new place, and without this
-- clause re-importing an unchanged file would duplicate every one-off game in it.
--
-- The PARTIAL `where` is what keeps hand-entered events out. They carry null calendar_id AND null
-- source_uid, and under `nulls not distinct` every one of them would collide with every other —
-- a ward could enter exactly one manual event, ever.
create unique index activity_events_source_idx
  on activity_events (ward_id, calendar_id, source_uid, source_recurrence_id)
  nulls not distinct
  where calendar_id is not null and source_uid is not null;


-- ---------------------------------------------------------------------------
-- 055c. Tighten activity_calendars
-- ---------------------------------------------------------------------------
--
-- Both were nullable in migration 009 only because Foundation B created every table before
-- anything wrote to one, the same reason 054b gave for youth_activity_profiles. Nothing intended
-- either state:
--
--   profile_id   a calendar belonging to no activity is orphaned. Every read of this table goes
--                through a profile, and a row nothing can reach is a row nothing can delete.
--   source_type  `ActivitySourceType` in types/domain.ts is not a union with null, so a null here
--                maps to a value the TypeScript side says cannot exist.
alter table activity_calendars alter column profile_id  set not null;
alter table activity_calendars alter column source_type set not null;

-- NO NEW POLICY ON activity_calendars, DELIBERATELY. It keeps migration 019's four ward-wide
-- policies, on the same reasoning 054d gave for activity_events: a calendar hangs off a profile
-- exactly as an event does, so its organization is already answered once, on the profile. A
-- second copy of that answer could disagree with the first.
--
-- Narrowing it alone would achieve nothing anyway — the same leader could still create the same
-- events one at a time through POST /api/youth/events, which is ward-wide.
--
-- CONSEQUENCE, AND IT IS A UI DECISION AS WELL AS A SQL ONE: the import is offered against EVERY
-- profile in the ward, not only ones the user could edit. Hiding a control the API allows is the
-- mirror of defect youth-a-D1 and just as wrong. If this should ever be narrowed, the migration
-- comes first and the UI follows it.


-- ---------------------------------------------------------------------------
-- 055d. Indexes
-- ---------------------------------------------------------------------------
--
-- Leads with ward_id, following 018_indexes.sql and 054e. Every import resolves "does this
-- profile already have an ICS calendar" before it does anything else, and that is this index.
create index activity_calendars_profile_idx on activity_calendars (ward_id, profile_id);
