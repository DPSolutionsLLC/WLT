-- Phase 8 slice D, migration 057: THE FOLLOW-UP LOG, AND THE ONE READ THIS MODULE NARROWS.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS, on 054/055/056's shared reasoning: this is
-- additive-with-tightening on tables that hold zero rows. Every count below was read with the
-- SERVICE CLIENT on 2026-08-28, before this file was written — which is what makes "applies
-- immediately" a checked claim rather than a hope:
--
--   activity_logs           0 rows. The two NOT NULLs and the unique constraint below are free.
--   activity_private_notes  0 rows. Same for its unique constraint.
--   activity_events         12 rows, 0 of them with a null profile_id. Untouched here.
--   activity_attendees      0 rows, 0 with confirmed_attendance set. Untouched here (056c).
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added. That allowlist exists for expand-and-contract pairs, and an entry that is not needed
-- HIDES a real migration from the assertion that everything on disk has been applied.
--
-- ---------------------------------------------------------------------------
-- THIS REVERSES PHASE 8's READ-WIDE DEFAULT, FOR ONE TABLE, DELIBERATELY
-- ---------------------------------------------------------------------------
-- Migration 054 made youth activity COORDINATION data ward-wide, and CLAUDE.md records the rule
-- that came out of it: "do not re-propose making the read org-scoped for consistency — the
-- asymmetry IS the feature."
--
-- A PASTORAL FOLLOW-UP NOTE IS NOT COORDINATION DATA. 08-youth-activities.md §Step 5 asks for
-- "the same shared/private split as Phase 7, with the same rules", and Phase 7's rule for
-- visit_logs is `is_bishopric() or org_id = current_org_id() or
-- ward_allows_cross_org_visibility()`. This file gives activity_logs that shape, resolved through
-- the event's profile because a log has no org_id of its own.
--
-- WHAT DOES NOT MOVE: youth_activity_profiles, activity_events and activity_attendees keep their
-- ward-wide SELECT, untouched in either direction. The calendar promise in FEATURES.md §Module 10
-- is about the CALENDAR, and it is kept in full. activity_attendees' ward-wide read is
-- load-bearing besides — coverage is computed from an attendee count, so a narrower read would
-- make the same event read covered to one leader and uncovered to another from the same data
-- (056c).
--
-- THE COST IS NAMED RATHER THAN DISCOVERED. `ward_council_member` is the role most likely to have
-- NO organization at all (054d says so in as many words), and it is one of the two roles this
-- module was built for. Under the policy below such a reader sees follow-ups on WARD-WIDE
-- activities, their own, and — if the ward has cross-org visibility on — everything. That is a
-- real narrowing and it is the price of the decision, not a bug to patch later with an
-- `if (role = 'ward_council_member')` branch, which would be CLAUDE.md rule 2 broken in the most
-- literal way available. /youth/feed states which mode the ward is in, in words, for that reason.
--
-- Structure:
--   057a  tighten activity_logs, and one follow-up per author per event
--   057b  activity_private_notes gains updated_at and its upsert target
--   057c  the org scope helper, and four replaced policies (its UPDATE is corrected by 058)
--   057d  the ward-council flag trigger key, for wards that already exist
--   057e  indexes


-- ---------------------------------------------------------------------------
-- 057a. Tighten activity_logs, and one follow-up per author per event
-- ---------------------------------------------------------------------------
--
-- Both columns were nullable in migration 009 only because Foundation B created every table
-- before anything wrote to one — the same sentence 054b wrote about `member_id` and
-- `activity_type`. A log with no event is not a follow-up, and a log with no author cannot be
-- edited by anybody: every write policy below names `logged_by`.
alter table activity_logs alter column event_id  set not null;
alter table activity_logs alter column logged_by set not null;

-- For the reason migration 044 gave visit_private_notes one: an edited record with no updated_at
-- cannot tell its reader when it last changed, and a follow-up is edited more often than most
-- rows in this schema — a leader writes what happened, then adds what they forgot.
alter table activity_logs add column updated_at timestamptz not null default now();

-- ONE FOLLOW-UP PER AUTHOR PER EVENT. Without it a leader accumulates rows every time they save,
-- and "my follow-up on this game" stops being a single row anybody can name — which is exactly
-- what the panel on /youth asks for, a screenful of events at once.
--
-- A PLAIN UNIQUE CONSTRAINT IS EXACT HERE, AND THE CONTRAST WITH 055b IS THE POINT. Migration
-- 055b needed `nulls not distinct` because `source_recurrence_id` is nullable and SQL's
-- `null = null` is NULL rather than true, so two rows with a null recurrence id would not
-- conflict. Both columns here are `not null` as of the two statements above, so the clause would
-- add nothing. Stating the contrast is what stops the next reader "fixing" one of the three
-- indexes to match the others.
alter table activity_logs
  add constraint activity_logs_one_per_author unique (event_id, logged_by);


-- ---------------------------------------------------------------------------
-- 057b. activity_private_notes gains updated_at and its upsert target
-- ---------------------------------------------------------------------------
--
-- A MIRROR OF MIGRATION 044, which added exactly these two things to visit_private_notes and for
-- exactly these two reasons. The route is an upsert and there was nothing to upsert onto: without
-- the constraint there is no conflict target, a second save writes a second row, and after that
-- "the caller's note" is no longer a single row anybody can name.
--
-- ITS FOUR AUTHOR-ONLY POLICIES FROM MIGRATION 019 ARE NOT TOUCHED, IN EITHER DIRECTION. No
-- bishopric branch, no ward-setting branch, and no widening for the org scope 057c introduces
-- next door. Wider reads on shared work do not widen a private note by one row (CLAUDE.md rule 5,
-- migration 053's own statement of the same boundary).
alter table activity_private_notes add column updated_at timestamptz not null default now();

alter table activity_private_notes
  add constraint activity_private_notes_one_per_author unique (activity_log_id, user_id);


-- ---------------------------------------------------------------------------
-- 057c. The org scope, and four replaced policies
-- ---------------------------------------------------------------------------
--
-- A `security definer` helper, following visit_log_is_writable_by_caller() (048) and
-- ward_allows_cross_org_visibility() (019). Inline, the subquery would itself be subject to
-- activity_events' and youth_activity_profiles' own RLS — which would couple a log's visibility
-- to two other tables' policies and make a WRITE check move whenever a READ setting moved.
--
-- A LEFT JOIN, NOT AN INNER ONE. `activity_events.profile_id` is nullable, and an event with no
-- profile must behave like a profile with no organization: ABSENT MEANS WARD-WIDE, the same idiom
-- household_stewardships (052), household_visit_cadences (050) and 054a all use. An inner join
-- would hide such a log from everybody but the bishopric, which is the opposite of
-- absent-means-default.
--
-- `profile.org_id is null` IS NOT OPTIONAL. `org_id = current_org_id()` evaluates to NULL rather
-- than true when both sides are null, so without the explicit arm a ward-wide activity would be
-- invisible to a reader with no organization — the talks-d hole in its fourth place, after
-- visit_goals, 054d and 056c.
create function activity_event_is_in_caller_org(target_event_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from activity_events event
    left join youth_activity_profiles profile
      on profile.id = event.profile_id
     and profile.ward_id = event.ward_id
    where event.id = target_event_id
      and event.ward_id = current_ward_id()
      and (profile.org_id is null or profile.org_id = current_org_id())
  );
$function$;

-- DROPPED AND RECREATED, NEVER SHADOWED. PostgreSQL ORs permissive policies together, so adding a
-- stricter policy beside migration 019's ward-wide one would change nothing at all
-- (plans/retros/talks-d-reliability-goals.md, restated by 048 for the same reason).
drop policy activity_logs_ward_select on activity_logs;
drop policy activity_logs_ward_insert on activity_logs;
drop policy activity_logs_ward_update on activity_logs;
drop policy activity_logs_ward_delete on activity_logs;

-- `logged_by = auth.uid()` IS ON THE SELECT DELIBERATELY. A leader must be able to read back what
-- they themselves wrote, even about a ward-wide activity belonging to an organization they are
-- not in. It costs nothing and removes a whole class of "where did my note go".
create policy activity_logs_select on activity_logs
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (
      is_bishopric()
      or logged_by = auth.uid()
      or activity_event_is_in_caller_org(event_id)
      or ward_allows_cross_org_visibility()
    )
  );

-- `logged_by = auth.uid()` WITH NO BISHOPRIC EXEMPTION ON INSERT. A follow-up is a personal
-- account of an event. A bishopric member filing one under somebody else's name is not oversight,
-- it is a record of something that did not happen — the same reasoning that keeps `recordedBy`
-- off every request body in this app.
--
-- The bishopric branch appears only on the PARENT-SCOPE half, so a counselor may write THEIR OWN
-- follow-up on any organization's event. That is the visits-d parent-scope rule in its second
-- module: a child row's scope is its parent's, enforced on writes as well as on reads, or an org
-- leader could file a follow-up against another organization's event.
create policy activity_logs_insert on activity_logs
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and logged_by = auth.uid()
    and (is_bishopric() or activity_event_is_in_caller_org(event_id))
  );

-- ---------------------------------------------------------------------------
-- THIS POLICY IS WRONG AND MIGRATION 058 REPLACES IT. IT IS LEFT HERE UNCHANGED.
-- ---------------------------------------------------------------------------
-- The intent was: the bishopric may clear a flag on somebody else's follow-up (they own the ward
-- council agenda), while WITH CHECK's `logged_by = auth.uid()` stops anybody leaving behind a row
-- attributed to a different author.
--
-- THE SECOND CLAUSE DEFEATS THE FIRST. WITH CHECK is evaluated against the RESULTING row, and a
-- bishopric member clearing somebody else's flag leaves `logged_by` as it was — somebody else's —
-- so the check fails and the update is refused outright. tests/rls/activity-logs.test.ts caught it
-- on its first run.
--
-- A migration that has been applied is not edited in place: the file on disk would then differ
-- from what the database holds, silently, which is the exact failure tests/db/migrations.test.ts
-- exists to catch. So this stays as it shipped and 058 says what it should have been, and why a
-- policy cannot express column immutability at all.
create policy activity_logs_update on activity_logs
  for update to authenticated
  using      (ward_id = current_ward_id() and (is_bishopric() or logged_by = auth.uid()))
  with check (ward_id = current_ward_id() and logged_by = auth.uid());

create policy activity_logs_delete on activity_logs
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or logged_by = auth.uid()));


-- ---------------------------------------------------------------------------
-- 057d. The ward-council flag trigger key, for wards that already exist
-- ---------------------------------------------------------------------------
--
-- A NEW TRIGGER KEY IS ALWAYS BOTH THE SEED AND A MIGRATION (migration 036's header), or it
-- silently never fires for one set of wards — no error, no log, just nothing arriving.
-- supabase/seed/notification_triggers.sql gains the same key in the same change.
--
-- The executive secretary and nobody else, matching visit_flagged_for_ward_council and migration
-- 045's correction. Recipients are resolved EXPLICITLY by
-- lib/notifications/notifyWardCouncilFlag.ts, so this list is the opt-out surface rather than the
-- address list.
insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, 'youth_activity_flagged_for_ward_council', array['executive_secretary'], true
from wards ward
on conflict (ward_id, trigger_key) do nothing;


-- ---------------------------------------------------------------------------
-- 057e. Indexes
-- ---------------------------------------------------------------------------
--
-- Naming follows 018_indexes.sql, 054e, 055d and 056d, and both lead with ward_id because every
-- query does.
--
-- The first is the FEED's keyset order. That feed orders on `created_at` rather than on the
-- event's date, because a log's event date lives on another table and PostgREST cannot order
-- parent rows by an embedded column — lib/youth/reportFeed.ts argues the choice in full.
--
-- The second is "does this event have a follow-up from me yet", which the panel on /youth asks
-- for a screenful of events at once.
create index activity_logs_created_idx on activity_logs (ward_id, created_at desc);
create index activity_logs_event_idx   on activity_logs (ward_id, event_id);
