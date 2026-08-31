-- Phase 8 slice H, migration 060: CLOSING OUT A SEASON, AND A REMOVE THAT CANNOT DESTROY AN
-- ACCOUNT.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS, and like 059 it needs no row count to say so.
-- THIS MIGRATION IS PURELY ADDITIVE: one nullable column and one function. It sets nothing NOT
-- NULL, narrows no CHECK and tightens no policy, so there is no row that exists today which it
-- could fail on and no count is load-bearing. 054–058 each counted rows because each of them
-- tightened something; this one does not, and performing a count check it does not need would
-- teach the next reader that the ritual matters more than the reason.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added. That allowlist exists for the contract half of an expand-and-contract pair, and an
-- entry that is not needed HIDES a real migration from the assertion that everything on disk has
-- been applied.
--
-- ---------------------------------------------------------------------------
-- WHAT IS MISSING TODAY — TWO ITEMS THAT ARE THE SAME BUTTON
-- ---------------------------------------------------------------------------
-- ITER-028. /youth ranks young people on a support percentage computed from every past home game
-- on a profile plus the next one, and NOTHING EVER LEAVES THAT COMPUTATION. A basketball season
-- that finished in February keeps contributing to Ethan's number in October, and a ward two years
-- in is ranking its youth on games nobody remembers.
--
-- ITER-031. `Remove` on an activity deletes unconditionally. Migration 009 cascades
-- youth_activity_profiles → activity_events → {activity_attendees, activity_logs →
-- activity_private_notes}, so one press destroys a season, every sign-up, every pastoral
-- follow-up AND the private notes CLAUDE.md rule 5 calls private forever.
--
-- They resolve together: once a season can be CLOSED, "I want this off my list" has an answer
-- that destroys nothing, and the destructive path narrows to what it should always have been —
-- an activity created by mistake with nothing recorded against it.
--
-- Structure:
--   060a  closed_at: a timestamp, never a boolean
--   060b  the follow-up counter the refusal needs


-- ---------------------------------------------------------------------------
-- 060a. closed_at: a timestamp, never a boolean
-- ---------------------------------------------------------------------------
--
-- A TIMESTAMP, NEVER A BOOLEAN. "When did this season end" is the question the history page asks,
-- and a boolean cannot answer it — the final percentage is RECOMPUTED against this instant rather
-- than stored, which is what keeps "nothing in this project refreshes anything" intact.
--
-- NULLABLE, AND NULL MEANS RUNNING. Every existing profile therefore reads as running and NO
-- WARD'S /youth MOVES on the day this is applied — the same absent-means-default idiom as
-- `household_stewardships` (052), `household_visit_cadences` (050), 054a's `org_id` and 059b's
-- `occasion_id`.
--
-- REOPENABLE, AND NEVER A DELETE. A season closed by mistake is reopened by setting this back to
-- null. That is the whole reason it is a nullable timestamp rather than a one-way flag: the point
-- of this slice is that the primary control destroys nothing, and a control that could not be
-- undone would be a second destructive button beside the one being narrowed.
alter table youth_activity_profiles add column closed_at timestamptz;

-- NO NEW RLS POLICY, AND THE OMISSION IS DELIBERATE — do not "notice" it later and add one.
--
-- Closing a season is an ORDINARY UPDATE on youth_activity_profiles, and migration 054d's
-- `youth_activity_profiles_update` already describes exactly the right boundary: USING is
-- `is_bishopric() or entered_by = auth.uid() or org_id = current_org_id()`, and WITH CHECK carries
-- the explicit `org_id is null` branch that closes the talks-d hole for a ward council member with
-- no organization. A second policy naming this column would be a second copy of an answer that is
-- already correct, and PostgreSQL ORs permissive policies together, so it could only ever WIDEN
-- what 054d decided (plans/retros/talks-d-reliability-goals.md).


-- ---------------------------------------------------------------------------
-- 060b. The follow-up counter the refusal needs
-- ---------------------------------------------------------------------------
--
-- WHY A FUNCTION AT ALL. The DELETE route has to answer "does this activity have any pastoral
-- follow-ups written against it?" before it destroys one, and it must not ask that question
-- through the caller's own client. TWO REASONS, and the second is the one that matters.
--
--   THE TWO POLICIES ARE SCOPED DIFFERENTLY, AND THEY DIVERGE TODAY. 054d admits a delete on
--   `is_bishopric() or entered_by = auth.uid() or org_id = current_org_id()`. 057c admits a log
--   READ on `is_bishopric() or logged_by = auth.uid() or activity_event_is_in_caller_org(...) or
--   ward_allows_cross_org_visibility()` — and `entered_by` appears in NEITHER half of that. So a
--   leader who created an activity and has since been RELEASED AND RECALLED to a different
--   organization may still delete it (they entered it) while being unable to read a single
--   follow-up somebody else wrote on it. That is not a hypothetical shape: the profile keeps the
--   `org_id` it was created with and the user's `org_id` moves, which is what a reorganisation
--   does. Counting through their client would return zero and the delete would go through.
--
--   AND THE REFUSAL MUST BE UNIFORMLY EVALUABLE. This is migration 056c's load-bearing rule and
--   059c's third reason, arriving again: whether an activity may be destroyed is a fact about the
--   activity, not about who is looking at it. A count that ran under the reader's own policies
--   would make the same DELETE succeed for one leader and fail for another from the same data at
--   the same instant — and it would silently become wrong the day 057c is narrowed again.
--
-- WHY `security definer` IS CORRECT HERE AND DOES NOT BREAK RULE 2 — three points, and a later
-- reader will want to widen this function, so all three are written down:
--
--   1. IT RETURNS A COUNT AND NEVER A ROW. No note text, no author, no event title, no date
--      reaches the caller. There is no shape of query against this function that yields content.
--
--   2. IT IS USED ONLY TO REFUSE A WRITE. Nothing renders its result and the route does not
--      disclose the number — the 409 says "has follow-ups recorded against it" and stops, because
--      the deleter may not be entitled to know whose they are or how many (rule 5).
--
--   3. `current_ward_id()` KEEPS IT WARD-SCOPED, so it cannot be used to probe another ward's
--      profile id. Passing a foreign uuid returns 0, which is also what an empty profile returns —
--      the two are indistinguishable from outside, on purpose.
--
-- `stable`, and `set search_path = public, pg_temp` — following every helper in 019 and 057c. The
-- join carries `event.ward_id = log.ward_id` for the reason the composite foreign keys exist: a
-- ward filter on one side of a join is not a ward filter on the other.
create or replace function activity_profile_followup_count(target_profile_id uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $function$
  select count(*)::integer
  from activity_logs log
  join activity_events event
    on event.id = log.event_id
   and event.ward_id = log.ward_id
  where event.profile_id = target_profile_id
    and event.ward_id = current_ward_id();
$function$;
