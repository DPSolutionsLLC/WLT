-- Phase 8 slice G, migration 059: TWO YOUNG PEOPLE, ONE GAME.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS, and unlike 054–058 it needs no row count to say
-- so. THIS MIGRATION IS PURELY ADDITIVE: a new table, a nullable column, one foreign key and one
-- index. It sets nothing NOT NULL, narrows no CHECK and tightens no policy, so there is no row
-- that exists today which it could fail on and no count is load-bearing. 054–058 each counted
-- rows because each of them tightened something; this one does not, and performing a count check
-- it does not need would teach the next reader that the ritual matters more than the reason.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added. That allowlist exists for the contract half of an expand-and-contract pair, and an
-- entry that is not needed HIDES a real migration from the assertion that everything on disk has
-- been applied.
--
-- ---------------------------------------------------------------------------
-- WHAT IS MISSING TODAY
-- ---------------------------------------------------------------------------
-- `activity_events.profile_id` is a single foreign key, so an event belongs to exactly ONE young
-- person. Ethan Brooks and Josh Kim on the same basketball team, at the same game on Friday, are
-- two rows, two calendar cards, and nothing anywhere records that they are the same evening in
-- the same gym.
--
-- ITER-024 chose to keep ONE ROW PER YOUTH — the module's atom is already correct, because a
-- commitment is to *a young person on an occasion* — and to add only the missing fact, that two
-- atoms can share an evening. That is this file: one nullable link, and nothing about slices A–F
-- is reworked.
--
-- Structure:
--   059a  the occasion: an identity, and nothing else
--   059b  the link
--   059c  policies: ward-wide, all four, matching activity_events
--   059d  index


-- ---------------------------------------------------------------------------
-- 059a. The occasion: an identity, and nothing else
-- ---------------------------------------------------------------------------
--
-- NO TITLE, NO DATE, NO LOCATION, AND THAT IS ITER-024'S FIRST OPEN QUESTION ANSWERED.
-- Every one of those facts already lives on the EVENT ROWS this occasion links, and a second copy
-- could disagree with the first — an occasion titled "Game against Roosevelt" holding a row
-- titled "Game vs Roosevelt" would leave a reader with two names for one evening and no way to
-- tell which is the real one. The same reasoning keeps `org_id` off `activity_events` (054d) and
-- keeps coverage out of `status` (054c, 056a).
--
-- An occasion is therefore PURE IDENTITY: it exists so that two rows can point at the same thing.
create table activity_occasions (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,

  -- MIRRORS youth_activity_profiles.entered_by (migration 009) EXACTLY — nullable, and no
  -- `on delete` clause. An occasion must survive the person who created it for the reason a
  -- profile does: a leader being released must not take a season's shared games with them.
  created_by uuid,
  created_at timestamptz not null default now(),

  -- THE COMPOSITE FOREIGN KEY'S TARGET, which is why this unique index exists on a column that is
  -- already the primary key. `organizations` and `youth_activity_profiles` both carry one for the
  -- same reason: a `(occasion_id, ward_id)` key needs a `(id, ward_id)` unique constraint to
  -- reference, and it is what makes an event pointing at another ward's occasion impossible in
  -- the database rather than merely unlikely in the route.
  unique (id, ward_id),

  foreign key (created_by, ward_id) references users (id, ward_id)
);

alter table activity_occasions enable row level security;


-- ---------------------------------------------------------------------------
-- 059b. The link
-- ---------------------------------------------------------------------------
--
-- NULLABLE, AND NULL MEANS "THIS GAME IS ONLY THIS YOUNG PERSON'S". That is the ordinary state of
-- nearly every event in a ward, and it is the same absent-means-default idiom as
-- `household_stewardships` (052), `household_visit_cadences` (050) and 054a's `org_id`. THERE IS
-- NO SENTINEL OCCASION MEANING "ALONE" — "we linked this to nobody" and "we have not linked it"
-- must not be the same row.
--
-- Every existing event therefore gets `occasion_id: null` and NO WARD'S SCREEN MOVES on the day
-- this is applied.
alter table activity_events add column occasion_id uuid;

-- THE COLUMN LIST ON `set null` IS NOT OPTIONAL, and this is the third migration to say so.
--
-- A bare `on delete set null` on a COMPOSITE foreign key nulls EVERY referencing column, ward_id
-- included — and ward_id is `not null`, so the cascade raises and the parent row becomes
-- undeletable. Migration 046 shipped exactly that bug, 047 fixed it with PostgreSQL 15's column
-- list, and 054a restated the rule (plans/retros/visits-d-*).
--
-- `set null` RATHER THAN `cascade`, DELIBERATELY. Deleting an occasion must not delete the games.
-- An event with no occasion is the ordinary state of every event in the ward, so the last row of a
-- dissolved occasion simply becomes an ordinary event again — a legitimate state rather than a
-- hole. `cascade` here would mean unlinking a mistake destroyed the fixtures.
alter table activity_events
  add constraint activity_events_occasion_id_ward_id_fkey
    foreign key (occasion_id, ward_id) references activity_occasions (id, ward_id)
    on delete set null (occasion_id);


-- ---------------------------------------------------------------------------
-- 059c. Policies: ward-wide, all four, matching activity_events
-- ---------------------------------------------------------------------------
--
-- A READER WILL ASSUME THIS SHOULD BE ORG-SCOPED, BECAUSE 054 NARROWED THE PROFILE'S WRITES AND
-- 057c NARROWED THE FOLLOW-UP'S READS. It should not be, for three separate reasons.
--
-- 1. IT MATCHES THE TABLE IT LINKS. `activity_events` keeps migration 019's ward-wide policies
--    and has NO `org_id` at all — 054d says why: an event inherits its organization through the
--    PROFILE it hangs off, and a second copy of that answer could disagree with the first. An
--    occasion is the same kind of thing one layer further up. Narrowing it would be a second
--    scoping rule for a question that is already answered on the profile.
--
-- 2. A CROSS-ORGANIZATION OCCASION IS THE POINT, NOT AN EDGE CASE. ITER-024 calls it "a pleasing
--    consequence": an occasion holds a Young Men row and a Young Women row, each leader writes
--    about their own organization's young person, and every existing gate keeps its single
--    answer. A write policy comparing `current_org_id()` would make exactly that unwritable — the
--    Young Men president could not link a Young Women youth's game into the game they are both
--    at, which is the case this whole table exists for.
--
-- 3. THE READ MUST BE UNIFORMLY EVALUABLE. This is migration 056c's load-bearing rule arriving
--    again. If one reader could see occasion rows another could not, "who else is at this game"
--    would have TWO DIFFERENT ANSWERS from the same data at the same instant — and coverage
--    across the occasion is computed from exactly that list, so the same evening would read as an
--    alert to one leader and as covered to another.
--
-- Four policies, following migration 019's generated shape: `ward_id = current_ward_id()` on all
-- four, `to authenticated`. Written out rather than looped because 019's loop is a Foundation-B
-- artefact and a four-line loop for one table would hide the shape it produces.
create policy activity_occasions_ward_select on activity_occasions
  for select to authenticated
  using (ward_id = current_ward_id());

create policy activity_occasions_ward_insert on activity_occasions
  for insert to authenticated
  with check (ward_id = current_ward_id());

create policy activity_occasions_ward_update on activity_occasions
  for update to authenticated
  using (ward_id = current_ward_id())
  with check (ward_id = current_ward_id());

create policy activity_occasions_ward_delete on activity_occasions
  for delete to authenticated
  using (ward_id = current_ward_id());


-- ---------------------------------------------------------------------------
-- 059d. Index
-- ---------------------------------------------------------------------------
--
-- LEADS WITH ward_id, following 018_indexes.sql, 054e, 055d, 056d and 057e, because every query
-- does. Every read of an occasion's rows — the detail page, the "+N others" marker, the join
-- route's re-read after a write — is this index.
create index activity_events_occasion_idx on activity_events (ward_id, occasion_id);
