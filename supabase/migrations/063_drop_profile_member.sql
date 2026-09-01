-- Phase 8 slice J, migration 063: THE CONTRACT HALF. DO NOT APPLY THIS UNTIL THE NEW BUILD IS LIVE.
--
-- ---------------------------------------------------------------------------
-- WHY IT WAITS
-- ---------------------------------------------------------------------------
-- The RUNNING build still selects both of these columns. `ACTIVITY_PROFILE_COLUMNS` in
-- lib/youth/queries.ts names `member_id` and its `members!…` embed; `ACTIVITY_EVENT_COLUMNS`
-- names `youth_attended`. PostgREST answers a select list naming a column that does not exist
-- with a 400, so dropping either underneath the deployed build makes EVERY YOUTH SCREEN 400 —
-- /youth, /youth/profiles, /youth/calendar, /youth/events/[id], /youth/history/[member_id] and
-- the import wizard, all at once.
--
-- So this file has an entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts, which is
-- what distinguishes "held back on purpose" from "written and forgotten" — the only thing that
-- assertion can actually tell apart. The order is:
--
--   1. `npm run db:push` applies 062 (done: it is additive and widening, so the running build is
--      unaffected).
--   2. Deploy the application.
--   3. Apply this migration, AND DELETE ITS ENTRY FROM THAT LIST IN THE SAME CHANGE. An entry
--      left behind after step 3 makes the test blind to 063 for ever, which is itself the bug the
--      second half of migrations.test.ts exists to catch.
--
-- ---------------------------------------------------------------------------
-- THIS MIGRATION DESTROYS NO FACT
-- ---------------------------------------------------------------------------
-- It removes THE SECOND COPY OF TWO. Migration 062b copied every `youth_activity_profiles.
-- member_id` into an `activity_roster` row, and 062e copied every answered
-- `activity_events.youth_attended` into an `activity_event_participation` row. Both copies are
-- already the ones the new build reads; these two columns have had no reader since it deployed.
--
-- ---------------------------------------------------------------------------
-- WHAT HAPPENS TO THE CASCADE, WHICH IS THE ONE BEHAVIOURAL CHANGE
-- ---------------------------------------------------------------------------
-- `youth_activity_profiles.member_id` carried `on delete cascade` to `members` (migration 009),
-- so deleting a member deleted their whole profile — the season, its events, its sign-ups and its
-- follow-ups. That cascade now lives on `activity_roster.member_id` (062a), so deleting a member
-- REMOVES THEM FROM THE ROSTERS THEY ARE ON and the team's schedule survives. That is what a ward
-- that loses one player actually wants, and tests/rls/activity-roster.test.ts proves it rather
-- than asserting it in a comment.
--
-- Dropping the column drops its foreign key with it; there is no separate `drop constraint` to
-- write for that one.


-- The column, and the constraint that hung off it. `youth_activity_profiles` keeps its name —
-- migration 062's header says why a rename would be churn — but with this column gone the row is
-- unambiguously a TEAM rather than one young person's copy of one.
alter table youth_activity_profiles drop column member_id;


-- THE CHECK GOES FIRST, EXPLICITLY, rather than being left to fall with the column.
--
-- Postgres would drop a CHECK that depends on a dropped column anyway, so naming it here is for
-- the reader rather than for the planner: `activity_events_youth_attended_needs_profile` is a
-- constraint migration 061 argued for at length, and a reader of `git log` should see it removed
-- deliberately rather than discover it gone. Its successor is the `not null` on
-- `activity_event_participation.member_id` — 062d states that the constraint is now the column.
alter table activity_events drop constraint activity_events_youth_attended_needs_profile;

alter table activity_events drop column youth_attended;
