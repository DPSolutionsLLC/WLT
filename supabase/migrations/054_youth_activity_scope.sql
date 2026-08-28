-- Phase 8 slice A, migration 054: WHO OWNS A YOUTH'S ACTIVITY, AND WHO MAY SEE IT.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. It is additive-with-tightening on tables that
-- have never held a row — every one of the five activity tables counts zero, checked with the
-- service client before this file was written. So it is NOT an expand-and-contract slice: there
-- is no entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts, and none should be
-- added. If any of these tables ever holds a row, the NOT NULLs below fail loudly rather than
-- silently, which is the correct answer.
--
-- ---------------------------------------------------------------------------
-- READS ARE WARD-WIDE. WRITES ARE ORG-SCOPED. THE CONTRAST IS THE DECISION.
-- ---------------------------------------------------------------------------
-- Migration 019 left a note addressed to this phase: "SPEC.md gives none of the activity tables
-- an org_id column, so there is nothing to scope on... Phase 8 should decide whether youth
-- activity coordination is genuinely org-private; if so it needs an org_id migration first."
--
-- It is NOT genuinely org-private. FEATURES.md §Module 10 and plans/08-youth-activities.md both
-- give the ward council the FULL calendar — a ward council member exists to see across the
-- organizations, and a Young Women president who cannot see that a young man's basketball season
-- clashes with a temple trip is the coordination failure this module was built to remove.
--
-- What IS org-private is the WRITING. An Elders Quorum president entering an activity "for the
-- Young Women" is not coordination, it is a leader believing they did something they did not.
--
-- So: youth_activity_profiles_ward_select from migration 019 SURVIVES UNTOUCHED, and only the
-- three write policies are replaced. Two different rules, enforced in two different places, which
-- is what 08-youth-activities.md §Pitfalls asks for by name.
--
-- Structure:
--   054a  org_id on youth_activity_profiles
--   054b  tighten youth_activity_profiles
--   054c  tighten activity_events and narrow its status
--   054d  replace the write policies on youth_activity_profiles
--   054e  indexes


-- ---------------------------------------------------------------------------
-- 054a. org_id on youth_activity_profiles, and nowhere else
-- ---------------------------------------------------------------------------
--
-- A NULL org_id IS A WARD-WIDE PROFILE. There is no sentinel row and no sentinel organization
-- meaning "everybody" — absent is the default, the same idiom household_stewardships (052) and
-- household_visit_cadences (050) use, and for the same reason: "we chose everybody" and "we have
-- not chosen" must not be the same value.
--
-- The column goes on the PROFILE ALONE. Events, attendees and logs inherit their organization
-- through the profile they hang off, so a second copy of the answer could disagree with the
-- first — and a game that belonged to one organization while its season belonged to another is
-- not a state anybody could act on.
alter table youth_activity_profiles add column org_id uuid;

-- THE COLUMN LIST ON `set null` IS NOT OPTIONAL.
--
-- A bare `on delete set null` on a COMPOSITE foreign key nulls EVERY referencing column, ward_id
-- included — and ward_id is `not null`, so the cascade raises and the parent organization becomes
-- undeletable. Migration 046 shipped exactly that bug and 047 fixed it with PostgreSQL 15's
-- column list (plans/retros/visits-d-*).
--
-- `set null` rather than `cascade`, deliberately: releasing a leader or dissolving an
-- organization must not take a youth's basketball season with it. The profile survives and
-- becomes ward-wide, which is a legitimate state rather than a hole.
alter table youth_activity_profiles
  add constraint youth_activity_profiles_org_id_ward_id_fkey
    foreign key (org_id, ward_id) references organizations (id, ward_id)
    on delete set null (org_id);


-- ---------------------------------------------------------------------------
-- 054b. Tighten youth_activity_profiles
-- ---------------------------------------------------------------------------
--
-- Both columns were nullable in migration 009 only because Foundation B created every table
-- before anything wrote to one. Nothing intended either state:
--
--   member_id      a profile that names no youth is not a profile, it is a row.
--   activity_type  `ActivityType` in types/domain.ts is not a union with null, so a null here
--                  would map to a value the TypeScript side says cannot exist.
alter table youth_activity_profiles alter column member_id     set not null;
alter table youth_activity_profiles alter column activity_type set not null;


-- ---------------------------------------------------------------------------
-- 054c. Tighten activity_events, and narrow its status
-- ---------------------------------------------------------------------------
alter table activity_events alter column title      set not null;
alter table activity_events alter column event_date set not null;
alter table activity_events alter column event_type set not null;
alter table activity_events alter column event_type set default 'tbd';

-- `event_date` stays timestamptz, and that is correct rather than a violation of CLAUDE.md §6.
-- A Sunday is a date; a game kicks off at four o'clock. The rule says dates for Sundays and
-- visits, timestamps for events, and this is an event.

-- TWO SEPARATE THINGS HAPPEN TO `status`, AND THEY ARE NOT THE SAME DECISION.
--
-- (1) `covered` and `uncovered` ARE REMOVED, because the clock decides them and not a person.
--     Slice C computes coverage from (event_date, event_type, attendee count, now) as a pure
--     function of the clock, exactly as appointmentViewState() computes "missed" and
--     householdVisitPriority() computes "overdue". A STORED coverage value goes stale the moment
--     nobody refreshes it, and nothing in this project refreshes anything: pg_cron is not
--     enabled, supabase/functions/ does not exist, and vercel.json declares no crons. The
--     scheduled notification that would have kept it fresh (`youth_event_uncovered`) joins
--     `visit_overdue` as Phase 11's decision, which already owns this problem for two other
--     things.
--
-- (2) `cancelled` IS ADDED, which is a deliberate deviation from SPEC.md's four values.
--     A cancelled game is a fact a person knows and nothing else can express. Without it the
--     only way to take a cancelled game off the list is to DELETE the row, which loses the record
--     that it was ever scheduled — and "why did nobody go?" is exactly the question the record
--     answers.
--
-- SLICE C SHOULD REVISIT WHETHER `completed` EARNS ITS PLACE. An event in the past is completed
-- by the clock too, on the same argument that removed `covered`. It survives here only because
-- follow-up state may turn out to need it, and removing a value is cheaper to decide once
-- slice D knows.
alter table activity_events drop constraint activity_events_status_check;

alter table activity_events
  add constraint activity_events_status_check
    check (status in ('upcoming', 'cancelled', 'completed'));


-- ---------------------------------------------------------------------------
-- 054d. The write policies on youth_activity_profiles
-- ---------------------------------------------------------------------------
--
-- Migration 019 generated four ward-wide policies for this table in a loop. The three WRITE
-- policies are replaced here. `youth_activity_profiles_ward_select` IS LEFT EXACTLY AS IT IS —
-- reads are ward-wide by product decision (see the header), and that contrast is the whole point
-- of this migration.
drop policy youth_activity_profiles_ward_insert on youth_activity_profiles;
drop policy youth_activity_profiles_ward_update on youth_activity_profiles;
drop policy youth_activity_profiles_ward_delete on youth_activity_profiles;

-- THE `org_id is null` BRANCH IS THE talks-d HOLE, CLOSED.
--
-- `org_id = current_org_id()` evaluates to NULL, not true, when both sides are null: SQL's
-- `null = null` is not JavaScript's. Without the explicit branch below, a user whose account has
-- no organization would write a ward-wide profile that the INSERT accepted and the SELECT then
-- hid FROM ITS OWN AUTHOR — the row exists, the write returned success, and the page is empty.
-- plans/retros/talks-d-reliability-goals.md records that exact failure on visit_goals.
--
-- `ward_council_member` is the role most likely to have no org_id set, and it is also the role
-- 08-youth-activities.md singles out as the widest in the app. So this is not an edge case here;
-- it is the ordinary path for one of the two roles this module was built for.
create policy youth_activity_profiles_insert on youth_activity_profiles
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id is null or org_id = current_org_id())
  );

-- USING says WHICH ROWS YOU MAY TOUCH; WITH CHECK says WHAT YOU MAY LEAVE BEHIND, and they are
-- deliberately different.
--
-- USING carries `entered_by = auth.uid()`, which is 08-youth-activities.md's rule in full:
-- "Creator, bishopric, or the youth's org leaders." A ward council member with no organization
-- edits the ward-wide profile they entered, because they entered it.
--
-- WITH CHECK deliberately OMITS `entered_by`: you may edit your own ward-wide profile, but you
-- may not move it into somebody else's organization. Handing the Young Women an activity they
-- never agreed to own is not an edit.
create policy youth_activity_profiles_update on youth_activity_profiles
  for update to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or entered_by = auth.uid() or org_id = current_org_id())
  )
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id is null or org_id = current_org_id())
  );

create policy youth_activity_profiles_delete on youth_activity_profiles
  for delete to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or entered_by = auth.uid() or org_id = current_org_id())
  );

-- activity_events KEEPS migration 019's ward-wide policies and gets NO org column. An event
-- inherits its organization through its profile, and the composite foreign key already refuses an
-- event pointing at another ward's profile. A second scoping rule here would be a second place
-- for the answer to live (plans/retros/visits-b-*, visits-f-*: one predicate, one place).


-- ---------------------------------------------------------------------------
-- 054e. Indexes
-- ---------------------------------------------------------------------------
--
-- Naming follows 018_indexes.sql. Every one leads with ward_id, because every query does.
--
--   member    the profile list groups by youth, so a member's profiles are read together.
--   date      the event list opens on "upcoming, soonest first" and orders on this column.
--   profile   an event list narrowed to one activity, and slice B's re-import matching.
create index youth_activity_profiles_member_idx on youth_activity_profiles (ward_id, member_id);
create index activity_events_date_idx           on activity_events (ward_id, event_date);
create index activity_events_profile_idx        on activity_events (ward_id, profile_id);
