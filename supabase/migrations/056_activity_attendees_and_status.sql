-- Phase 8 slice C, migration 056: WHO IS GOING TO A GAME, AND WHAT A STATUS IS STILL FOR.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS, exactly like 054 and 055. Every row count below
-- was read with the SERVICE CLIENT on 2026-08-28, before this file was written — which is what
-- makes "applies immediately" a checked claim rather than a hope:
--
--   activity_events      14 rows. Tallied by (status/event_type): upcoming/tbd 12,
--                        upcoming/away 1, cancelled/tbd 1. ZERO hold 'completed', and no code
--                        path writes it — `grep` finds the string only in a comment in
--                        lib/youth/queries.ts. So the CHECK narrowing below cannot fail on
--                        anything that exists.
--   activity_attendees   0 rows. The unique index and the three replaced write policies are
--                        therefore free.
--   activity_logs        0 rows. Untouched here; slice D owns it.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added. That allowlist exists for expand-and-contract slices, and an entry that is not needed
-- HIDES a real migration from the assertion that everything on disk has been applied.
--
-- Structure:
--   056a  status loses 'completed'
--   056b  one attendee row per person per event
--   056c  the write policies on activity_attendees
--   056d  index


-- ---------------------------------------------------------------------------
-- 056a. `status` loses 'completed'
-- ---------------------------------------------------------------------------
--
-- MIGRATION 054c HANDED THIS QUESTION HERE BY NAME: "Slice C should revisit whether `completed`
-- earns its place. An event in the past is completed by the clock too, on the same argument that
-- removed `covered`."
--
-- It does not earn its place. The argument that removed `covered` and `uncovered` removes this
-- one unchanged: a stored value THE CLOCK DECIDES goes stale the moment nobody refreshes it, and
-- nothing in this project refreshes anything — pg_cron is not enabled, supabase/functions/ does
-- not exist, and vercel.json declares no crons. A game last February is completed whether or not
-- a person remembered to say so, and a column that only sometimes says so is worse than one that
-- never does, because a reader cannot tell which kind of row they are looking at.
--
-- FOLLOW-UP STATE IS `activity_logs`' BUSINESS, in slice D. "Did somebody go, and what happened"
-- is a person's account of an event, and it belongs on the table built to hold accounts — not as
-- a fourth value on a column whose other two values are facts a person knows.
--
-- WHAT SURVIVES, AND WHY THE PAIR IS THE RIGHT PAIR:
--   upcoming   the default. Nothing has happened to this event.
--   cancelled  a fact only a person knows, that nothing else can express (054c). A called-off
--              game stays on the list, marked, because the record that it was ever scheduled is
--              exactly what "why did nobody go?" needs.
alter table activity_events drop constraint activity_events_status_check;

alter table activity_events
  add constraint activity_events_status_check
    check (status in ('upcoming', 'cancelled'));


-- ---------------------------------------------------------------------------
-- 056b. One attendee row per person per event
-- ---------------------------------------------------------------------------
--
-- WITHOUT THIS, TAPPING "I'LL GO" TWICE WRITES TWO ROWS — on a slow phone, which is the whole
-- context this module runs in. Coverage is computed from an attendee COUNT, so two rows would
-- read as two people going where one is, and the number a leader uses to decide whether to step
-- in would be quietly wrong.
--
-- NO `nulls not distinct` HERE, DELIBERATELY, AND THE CONTRAST WITH 055b IS THE POINT.
-- Migration 055b needed that clause because `source_recurrence_id` is nullable and SQL's
-- `null = null` is NULL rather than true, so two rows with a null recurrence id would not
-- conflict. Both columns here are `not null` (migration 009), so the plain unique index is exact
-- and the clause would add nothing. Stating the contrast is what stops the next reader "fixing"
-- one of the two indexes to match the other.
create unique index activity_attendees_event_user_idx
  on activity_attendees (event_id, user_id);


-- ---------------------------------------------------------------------------
-- 056c. The write policies on activity_attendees
-- ---------------------------------------------------------------------------
--
-- Migration 019 generated four ward-wide policies for this table in a loop. The three WRITE
-- policies are replaced here.
--
-- ---------------------------------------------------------------------------
-- `activity_attendees_ward_select` IS LEFT EXACTLY AS IT IS, AND THAT IS LOAD-BEARING
-- ---------------------------------------------------------------------------
-- Coverage is computed from an attendee COUNT. If one reader could see attendee rows another
-- could not, the same event would read COVERED to one leader and UNCOVERED to another, from the
-- same data, at the same instant. CLAUDE.md records that trap under the all-organizations
-- unclaimed rule: a rule that is not uniformly evaluable is not a rule.
--
-- This is the same read-wide/write-narrow contrast migration 054 drew for profiles, and here the
-- read half is load-bearing rather than merely convenient.
--
-- ---------------------------------------------------------------------------
-- THE PREDICATE IS `user_id`, NEVER `assigned_by`
-- ---------------------------------------------------------------------------
-- `assigned_by` is NULL on a self-add, and a policy comparing against it would be the talks-d
-- hole (plans/retros/talks-d-reliability-goals.md) in a third place: `assigned_by = auth.uid()`
-- is NULL rather than true for every row a person added for themselves, so they could not remove
-- their own. `assigned_by` is a RECORD OF HOW THE ROW CAME TO EXIST, written by the route, and no
-- policy reads it. `user_id` is `not null`, so it compares cleanly.
drop policy activity_attendees_ward_insert on activity_attendees;
drop policy activity_attendees_ward_update on activity_attendees;
drop policy activity_attendees_ward_delete on activity_attendees;

-- ANYBODY MAY PUT THEMSELVES DOWN; ONLY THE BISHOPRIC MAY PUT SOMEBODY ELSE DOWN
-- (08-youth-activities.md §Step 4). An org secretary who holds `youth_activities.view` and
-- `.log` but not `.manage` is exactly the sort of person who turns up to a basketball game, and
-- the row they can create is their own and no other.
create policy activity_attendees_insert on activity_attendees
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or user_id = auth.uid())
  );

-- NARROWED NOW EVEN THOUGH NOTHING IN THIS SLICE WRITES IT. Slice D sets
-- `confirmed_attendance`, and leaving migration 019's ward-wide UPDATE in place until then would
-- let anybody in the ward confirm somebody else's attendance. Narrowing it here costs one policy
-- and closes that before it opens.
create policy activity_attendees_update on activity_attendees
  for update to authenticated
  using      (ward_id = current_ward_id() and (is_bishopric() or user_id = auth.uid()))
  with check (ward_id = current_ward_id() and (is_bishopric() or user_id = auth.uid()));

-- "I can't after all" and a bishopric member withdrawing an assignment are the SAME DELETE, and
-- that is correct: a row saying somebody is going has one meaning, so removing it has one meaning
-- too. Which of the two happened is recorded in the audit log by the route, where the difference
-- actually matters.
create policy activity_attendees_delete on activity_attendees
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or user_id = auth.uid()));


-- ---------------------------------------------------------------------------
-- 056d. Index
-- ---------------------------------------------------------------------------
--
-- Naming follows 018_indexes.sql, 054e and 055d, and it leads with ward_id because every query
-- does. Every screen in this slice reads the attendees for a SET of events at once
-- (lib/youth/attendees.ts), which is this index.
create index activity_attendees_event_idx on activity_attendees (ward_id, event_id);
