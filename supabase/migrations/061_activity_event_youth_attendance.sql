-- Phase 8 slice I, migration 061: RECORDING THAT THE YOUNG PERSON WAS NOT THERE.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS, and — like 060 — it needs no row count to say so.
-- The argument here is exact rather than statistical: the CHECK below constrains a column that
-- DOES NOT EXIST UNTIL THE STATEMENT ABOVE IT CREATES IT, and it is created null on every row.
-- `null` satisfies the constraint unconditionally, so there is no existing row it could fail on
-- and counting them would prove nothing.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added. That allowlist exists for the contract half of an expand-and-contract pair, and an
-- entry that is not needed HIDES a real migration from the assertion that everything on disk has
-- been applied.
--
-- ---------------------------------------------------------------------------
-- WHAT IS MISSING TODAY
-- ---------------------------------------------------------------------------
-- ITER-030. The support percentage on /youth is the share of a young person's past HOME games
-- where at least one leader confirmed they went. It assumes the young person was AT the game, and
-- NOTHING IN THIS SCHEMA CAN SAY THEY WERE NOT. A youth who breaks an ankle in December and
-- misses six games is measured, all winter, on six games nobody could have attended them at, and
-- every one counts against them. The number reports neglect that did not happen.
--
-- lib/youth/profileNeed.ts's carriesCoverageExpectation() already excludes three categories, all
-- for ONE reason — this game could not have been a chance to support them: `away` (no coverage
-- expectation by design), `cancelled` (it did not happen), `tbd` (not known to be a home game).
-- "The young person was not taking part" is THE SAME SENTENCE and is missing from the list. This
-- column is the storage behind a fourth line in that function, not a new idea.
--
-- ---------------------------------------------------------------------------
-- A SEPARATE COLUMN, NOT A FOURTH `status` VALUE
-- ---------------------------------------------------------------------------
-- `status` answers DID THIS EVENT HAPPEN. A game the young person missed STILL HAPPENED — other
-- youth may have been at it, and under migration 059 it may share an occasion with rows entirely
-- unaffected by this fact. Collapsing "the game was called off" and "Ethan was ill" into one
-- column destroys the record of which is which, which is precisely what a presidency needs.
--
-- ---------------------------------------------------------------------------
-- THREE STATES, AND `null` MEANS NOBODY HAS SAID
-- ---------------------------------------------------------------------------
-- The same absent-means-default idiom as `activity_attendees.confirmed_attendance` (056),
-- `youth_activity_profiles.closed_at` (060a), `activity_events.occasion_id` (059b) and 054a's
-- `org_id`, with no sentinel value meaning "present". A `not null default false` column would
-- assert on every row that the young person took part — a fact NOBODY STATED — which is
-- lib/youth/classifyLocation.ts's `.default("tbd")` argument arriving again.
--
-- NEVER INFERRED. Not from an empty attendee list, not from a cancelled sibling, not from a
-- missing follow-up. A person knows this and nothing else does; that is classifyLocation.ts's
-- refusal of near-miss matching, in a third place.
--
-- `true` IS NOT A NO-OP even though it behaves like `null` in today's arithmetic. It keeps
-- "assumed present" distinguishable from "confirmed present", and it is what gives the control a
-- way back that is not a delete — migration 060a's rule for `closed_at`, on a column with the
-- same power to move a number.
alter table activity_events add column youth_attended boolean;

comment on column activity_events.youth_attended is
  'Whether the young person this event belongs to is taking part. Null means nobody has said. Never inferred — see migration 061.';

-- ---------------------------------------------------------------------------
-- THE CHECK IS WHY THIS IS A CONSTRAINT AND NOT A COMMENT
-- ---------------------------------------------------------------------------
-- `profile_id` is NULLABLE: a ward-wide event belongs to no young person, so "did THEY go?" has no
-- referent on such a row. The constraint makes a meaningless row a database error rather than a
-- review miss. app/api/youth/events/[id]/route.ts refuses it with a SENTENCE first, because a
-- constraint violation is not something anybody can act on; this is the guarantee behind it.
alter table activity_events
  add constraint activity_events_youth_attended_needs_profile
    check (youth_attended is null or profile_id is not null);

-- NO NEW RLS POLICY, AND THE OMISSION IS DELIBERATE — do not "notice" it later and add one.
--
-- Writing this column is an ORDINARY UPDATE on activity_events, which keeps migration 019's
-- ward-wide write policies. That is the same boundary `Cancel` already runs under, and it is the
-- right one: a leader from another organization marking a young person as not taking part is the
-- same trust level as calling off their game, which the app already permits.
-- lib/youth/activityOwnership.ts states that narrowing activity_events needs a MIGRATION FIRST and
-- a helper after; this slice narrows nothing, so it adds no helper and there is deliberately still
-- no canManageActivityEvent().
--
-- NO INDEX. Every read of this column arrives through ACTIVITY_EVENT_COLUMNS on a query already
-- narrowed by (ward_id, profile_id) or (ward_id, event_date); nothing filters on it.
