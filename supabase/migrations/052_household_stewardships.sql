-- ITER-019, migration 052: WHICH HOUSEHOLDS ARE EVEN OURS.
--
-- ADDITIVE ONLY. This migration drops nothing and removes no column, so it is safe to apply
-- before the new code is deployed and this is NOT an expand-and-contract slice. There is no
-- entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts, and none should be added.
--
-- What changes, and why:
--
--   Every organization is measured today against EVERY visitable household in the ward. The
--   Primary will only ever visit families with a child in Primary, so its dashboard reads
--   "3 of 200" for ever. This table records which households an organization has claimed.
--
-- ---------------------------------------------------------------------------
-- ZERO ROWS FOR AN ORGANIZATION MEANS THE WHOLE WARD
-- ---------------------------------------------------------------------------
-- ABSENT IS THE DEFAULT, exactly as it is for household_visit_cadences: there is no sentinel row
-- meaning "everything", so an organization that has narrowed nothing has no rows here at all.
--
-- THERE IS DELIBERATELY NO BACKFILL, and the empty table is the correct post-migration state.
-- Every existing dashboard is byte-identical on the day this is applied — the Elders Quorum has
-- narrowed nothing, so nothing about its numbers moves. An opt-in default (a row per household
-- per organization) could not have delivered that, and would have made "we chose everybody" and
-- "we have not chosen yet" the same rows.
--
-- The one seam this creates is stated where a reader hits it: "narrowed to nothing" and "not
-- narrowed" are also the same zero rows, so lib/validation/visit.ts REFUSES an empty bulk
-- replace with a sentence naming the alternative rather than silently widening an organization
-- back to two hundred households.

-- ---------------------------------------------------------------------------
-- 052a. The table
-- ---------------------------------------------------------------------------
--
-- Mirrors household_visit_cadences (migration 050 §3d) structurally, and answers a different
-- question: the cadence says HOW OFTEN, the stewardship says WHETHER AT ALL.
--
-- org_id is NOT NULL, unlike visit_goals.org_id. A stewardship is always some organization's
-- claim on a household, and a null org_id would land in the hole `org_id = current_org_id()`
-- creates: null is never equal to null in SQL, so the row would be invisible to its own author
-- (plans/retros/talks-d-reliability-goals.md).
create table household_stewardships (
  id           uuid primary key default gen_random_uuid(),
  ward_id      uuid not null references wards (id) on delete cascade,
  household_id uuid not null,
  org_id       uuid not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),

  -- The whole model in one line: a household is in an organization's stewardship, or it is not.
  -- Membership is PRESENCE OR ABSENCE and the row carries no payload, which is why the bulk
  -- replace can insert with ON CONFLICT DO NOTHING and needs no read-then-write.
  unique (household_id, org_id),

  -- `on delete cascade` on BOTH parents, deliberately. A claim is meaningless without its
  -- household or its organization, and there is nothing here worth preserving as an orphan.
  foreign key (household_id, ward_id) references households (id, ward_id) on delete cascade,
  foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade,

  -- No delete clause, and `created_by` stays nullable: a leader being released should not take
  -- their organization's stewardship with them.
  foreign key (created_by, ward_id) references users (id, ward_id)
);

alter table household_stewardships enable row level security;

-- ---------------------------------------------------------------------------
-- 052b. RLS — THE SELECT IS WIDENED, THE WRITES ARE NOT, AND THE CONTRAST IS THE DECISION
-- ---------------------------------------------------------------------------
--
-- Read this next to migration 050 §3e, which says the opposite for household_visit_cadences and
-- says it on purpose. `ward_allows_cross_org_visibility()` (migration 019) appears today on
-- `visit_logs_select` AND NOWHERE ELSE. It now also appears here, and it is still pointedly
-- ABSENT from `visit_goals_select` and `household_visit_cadences_select`.
--
--   FACTS ARE SHARED. JUDGEMENTS ARE NOT.
--
-- Whose stewardship a family is in is a fact about COVERAGE, and coverage is exactly what the
-- all-organizations view exists to expose: a household in NO organization's stewardship is
-- invisible to everyone unless somebody can read every organization's claims at once. That
-- pastoral failure mode is created by this table, so this table is where it has to be visible.
--
-- What interval we hold a family to (a cadence), and whether we think we are behind (a goal),
-- remain a presidency's private judgement. The Relief Society reading the Elders Quorum's
-- opinion about a family is not what the ward's visibility setting offered, and ITER-019 does
-- not reverse ITER-018 on that — it draws the line one table further along.
--
-- The consequence falls out of the policies rather than out of application branching: with the
-- setting on, an org leader sees every household's claims and their OWN organization's band; the
-- bishopric additionally sees every organization's band, because they can already read every
-- goal and every cadence. No `if (isBishopric)` decides what is readable (CLAUDE.md rule 2).
create policy household_stewardships_select on household_stewardships
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (
      is_bishopric()
      or org_id = current_org_id()
      or ward_allows_cross_org_visibility()
    )
  );

-- The writes carry NO cross-org branch. Reading who has claimed a family is a fact anybody on
-- the ward council may need; claiming one on another organization's behalf is not.
create policy household_stewardships_insert on household_stewardships
  for insert to authenticated
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy household_stewardships_delete on household_stewardships
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

-- THERE IS NO UPDATE POLICY, AND ITS ABSENCE IS A DECISION RATHER THAN AN OVERSIGHT.
--
-- Membership is presence or absence. The row carries no payload to update — `household_id` and
-- `org_id` together ARE the row, and changing either would be a different claim, which is a
-- delete and an insert. Adding an UPDATE policy later would mean somebody had invented a
-- mutable field, and that field is what should be questioned rather than the policy.

-- ---------------------------------------------------------------------------
-- 052c. Index
-- ---------------------------------------------------------------------------
--
-- Serves BOTH reads. The organization dashboard filters (ward_id, org_id) exactly, and the
-- all-organizations view filters on the ward_id prefix. Naming follows 018_indexes.sql.
create index household_stewardships_org_idx
  on household_stewardships (ward_id, org_id);
