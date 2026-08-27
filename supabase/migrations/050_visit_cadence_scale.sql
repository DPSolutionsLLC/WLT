-- ITER-018, migration 050: a visit goal stops having a PERIOD and starts having a CADENCE.
--
-- EXPAND ONLY. This migration drops nothing, so the currently-deployed build keeps reading the
-- columns it knows about while this is applied — the expand-and-contract pattern migrations
-- 046→049 established. The drops are migration 051, and 051 is applied AFTER the new code is
-- deployed.
--
-- What changes, and why:
--
--   A goal used to say "between these two dates, visit everybody". Progress was therefore
--   measured against a shared period boundary, and a household visited last December read
--   "✓ Visited" in its row while the banner above counted it as unvisited for the period that
--   began in January. Both notions of progress were correct and they disagreed.
--
--   A goal now says "visit every household once every X". Progress is measured from EACH
--   household's own last completed visit, so there is one notion and nothing to disagree with.
--   `deadline` survives as a nullable, presentation-only attribute — "we would like to have got
--   round everybody by Christmas" — and drives no arithmetic.

-- ---------------------------------------------------------------------------
-- 3a. visit_goals gains the cadence, the notice window and the deadline
-- ---------------------------------------------------------------------------
--
-- All nullable. `cadence_amount`/`cadence_unit` stay nullable so the existing "a goal row
-- carrying no usable interval" state remains representable — lib/visits/progress.ts reports it
-- as `goalHasNoCadence` and the page says something honest and specific about it rather than
-- inventing a denominator.
alter table visit_goals
  add column cadence_amount integer,
  add column cadence_unit   text check (cadence_unit in ('day', 'week', 'month', 'year')),
  add column notice_amount  integer,
  add column notice_unit    text check (notice_unit in ('day', 'week', 'month', 'year')),
  add column deadline       date;

-- A zero interval is overdue the moment it is saved, and a negative one cannot divide. The floor
-- is here as well as in lib/validation/visit.ts because RLS and CHECK constraints are the
-- boundary; a route that forgets is still safe (CLAUDE.md rule 2).
alter table visit_goals
  add constraint visit_goals_cadence_amount_positive
    check (cadence_amount is null or cadence_amount >= 1);

alter table visit_goals
  add constraint visit_goals_notice_amount_positive
    check (notice_amount is null or notice_amount >= 1);

-- AMOUNT AND UNIT ARE INSEPARABLE. Half a cadence — a number with no unit, or a unit with no
-- number — is unrepresentable, which is what lets lib/visits/queries.ts assemble a `Cadence`
-- object from the pair and return null for the whole thing on one test rather than two.
--
-- Written as an equality of two `is null` expressions so it can ACTUALLY FAIL. A CHECK that is
-- silently inert is the bug plans/retros/ai-d-corpus-scoping.md records — `array_length` returns
-- NULL on an empty array, so its constraint never rejected anything. `(a is null) = (b is null)`
-- is a plain boolean on both sides and is never NULL, so it rejects.
alter table visit_goals
  add constraint visit_goals_cadence_complete
    check ((cadence_amount is null) = (cadence_unit is null));

alter table visit_goals
  add constraint visit_goals_notice_complete
    check ((notice_amount is null) = (notice_unit is null));

-- ---------------------------------------------------------------------------
-- 3b. Backfill every existing goal
-- ---------------------------------------------------------------------------
--
-- `deadline` takes `goal_period_end`. `goal_period_start` is carried NOWHERE: it was the anchor
-- for a household nobody had ever visited, and ITER-018 Decision 3 replaces that with a
-- `never_visited` band that needs no anchor at all.
update visit_goals
set deadline = goal_period_end,
    cadence_amount = case cadence
                       when 'annual'   then 1
                       when 'biannual' then 6
                       when 'custom'   then cadence_months
                     end,
    cadence_unit   = case cadence
                       when 'annual'   then 'year'
                       else 'month'
                     end
where cadence is not null;

-- The notice window reproduces the outgoing DUE_SOON_FRACTION = 0.8, so no ward's numbers move
-- on the day this is applied: a household that read "Due soon" yesterday reads "Approaching"
-- today, at the same point in its interval.
--
-- 20% of the interval expressed in DAYS, which has no edge case at any cadence length. A
-- 12-month goal gets 72 days; a 1-month goal gets 6. Both are strictly shorter than their own
-- cadence, which is what lib/validation/visit.ts requires of anything saved from here on — a
-- notice window as long as its cadence would make every household permanently "approaching".
--
-- greatest(1, ...) because the column's own CHECK floors at 1, and a cadence of one month times
-- 30 times 0.2 is 6 — but a future one-day cadence would floor to 0 and violate it.
update visit_goals
set notice_amount = greatest(1, floor(
      (case cadence
         when 'annual'   then 12
         when 'biannual' then 6
         else cadence_months
       end) * 30 * 0.2
    )::integer),
    notice_unit = 'day'
where cadence is not null
  and (case cadence when 'annual' then 12 when 'biannual' then 6 else cadence_months end)
      is not null;

-- ---------------------------------------------------------------------------
-- 3c. households gains the do-not-contact flag
-- ---------------------------------------------------------------------------
--
-- HOUSEHOLD-level, and a separate axis from `members.status = 'do_not_contact'`. The member
-- status answers "may we call THIS PERSON"; this answers "may we call on this family at all".
--
-- A do-not-contact household is SHOWN, MARKED, and counted in NOTHING (ITER-018 Decision 4). It
-- is deliberately not folded into the moved-out rule: `isVisitableHousehold()` answers "does
-- anybody live here", and conflating the two would make the household VANISH, which is what
-- Decision 4 explicitly refused. The record of what happened before the decision is exactly what
-- the next presidency needs.
--
-- NO POLICY CHANGE IS NEEDED. `households` is one of the ward-wide tables in migration 019's
-- generated loop, and its four policies are `ward_id = current_ward_id()` with no column list —
-- so a new column inherits them. Said here so a reader does not have to go and check.
alter table households
  add column do_not_contact boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3d. The per-organization, per-household cadence override
-- ---------------------------------------------------------------------------
--
-- This organization's cadence for this household. ABSENT means "use the organization's goal" —
-- there is no sentinel row meaning "default", so clearing an override is a DELETE and the
-- resolution in lib/visits/progress.ts is a map lookup with a fallback.
--
-- A JOIN TABLE, NOT A households COLUMN, and that reversal is ITER-018 Decision 2. The same
-- family can be on a 3-month cadence for the Elders Quorum and a 12-month one for the Relief
-- Society, at the same time, with both dashboards correct. A column on `households` could not
-- have expressed that at all.
--
-- org_id is NOT NULL, unlike visit_goals.org_id. A cadence is always some organization's
-- relationship to a household, and a null org_id would land in the hole `org_id =
-- current_org_id()` creates: null is never equal to null in SQL, so the row would be invisible
-- to its own author (plans/retros/talks-d-reliability-goals.md).
create table household_visit_cadences (
  id             uuid primary key default gen_random_uuid(),
  ward_id        uuid not null references wards (id) on delete cascade,
  household_id   uuid not null,
  org_id         uuid not null,
  cadence_amount integer not null check (cadence_amount >= 1),
  cadence_unit   text not null check (cadence_unit in ('day', 'week', 'month', 'year')),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- The whole model in one line: ONE cadence per organization per household. The route upserts
  -- against this pair rather than reading-then-writing, so two leaders saving at once cannot
  -- produce two overrides that disagree.
  unique (household_id, org_id),

  -- `on delete cascade` on BOTH parents, deliberately. An override is meaningless without its
  -- household or its organization, and there is nothing here worth preserving as an orphan.
  --
  -- Checked rather than copied: plans/retros/visits-d-attempts-appointments-and-participants.md
  -- records a composite `on delete set null` that made visits undeletable, because the composite
  -- key included the not-null ward_id. `cascade` has no such interaction — it removes the row
  -- rather than trying to null part of a key.
  foreign key (household_id, ward_id) references households (id, ward_id) on delete cascade,
  foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade,

  -- No delete clause, and `created_by` stays nullable: a leader being released should not take
  -- their organization's cadences with them.
  foreign key (created_by, ward_id) references users (id, ward_id)
);

alter table household_visit_cadences enable row level security;

-- ---------------------------------------------------------------------------
-- 3e. RLS, mirroring visit_goals exactly
-- ---------------------------------------------------------------------------
--
-- Four policies, the SAME predicate on all of them, because read and write scope are identical
-- here. An organization sees and sets its own overrides; the bishopric sees and sets every
-- organization's.
--
-- THE SELECT IS DELIBERATELY NOT WIDENED FOR CROSS-ORG VISIBILITY. `ward_allows_cross_org_
-- visibility()` appears on `visit_logs_select` and nowhere else (migration 019): the ward setting
-- widens reads of visit REPORTS, so a ward council can read what happened. A cadence is a
-- CONFIGURATION, not a report — the Relief Society reading the Elders Quorum's private judgement
-- about a family is not what that setting offered.
create policy household_visit_cadences_select on household_visit_cadences
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy household_visit_cadences_insert on household_visit_cadences
  for insert to authenticated
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy household_visit_cadences_update on household_visit_cadences
  for update to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()))
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy household_visit_cadences_delete on household_visit_cadences
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

-- ---------------------------------------------------------------------------
-- 3f. Index
-- ---------------------------------------------------------------------------
--
-- readVisitProgress() fetches every override for ONE organization on every dashboard load, which
-- is (ward_id, org_id) exactly. Naming follows 018_indexes.sql.
create index household_visit_cadences_org_idx
  on household_visit_cadences (ward_id, org_id);
