-- Phase 8 slice J, migration 062: A TEAM HAS ONE SCHEDULE AND A ROSTER.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS, and the argument is EXACT rather than
-- statistical. Both `create table` statements are additive and both backfills only insert. The
-- one statement that is shaped like a narrowing is `alter column member_id drop not null`, which
-- is a WIDENING: every row that satisfies `not null` satisfies the absence of it, so there is no
-- existing row it could fail on and counting them would prove nothing.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts for 062, and
-- none should be added. Its PAIR — migration 063, which drops the two columns backfilled here —
-- is the one that waits, and it carries the entry. That allowlist exists for the contract half of
-- an expand-and-contract pair, and an entry that is not needed HIDES a real migration from the
-- assertion that everything on disk has been applied.
--
-- ---------------------------------------------------------------------------
-- WHAT IS MISSING TODAY
-- ---------------------------------------------------------------------------
-- THERE IS NO TEAM IN THIS APP. There is only one young person's copy of a team.
--
-- `activity_events.profile_id` is a single foreign key, `activity_calendars.profile_id` is NOT
-- NULL (055c), and POST /api/youth/calendars/import takes a `profileId` — so eight players on a
-- twelve-game season is EIGHT PROFILES, EIGHT IMPORTS OF THE SAME FILE, AND 96 ROWS FOR 12 REAL
-- GAMES, with `activity_occasions` re-linking the duplicates one game at a time by hand.
--
-- ITER-033's model, in the user's own words: import once, assign each youth once, and let the app
-- derive youth × event. Everything after that is an exception. This file is the storage behind it.
--
-- ---------------------------------------------------------------------------
-- `youth_activity_profiles` IS NOT RENAMED, AND THAT IS DELIBERATE
-- ---------------------------------------------------------------------------
-- The row's MEANING changes here — it was one young person's activity and it is now a TEAM, with
-- a roster hanging off it — but 191 references across 34 source files make a rename pure churn,
-- and it would bury the real change in a diff nobody can read. Every header comment on the table
-- and its type says what it now is; the name is the one thing left pointing at what it was.
--
-- Structure:
--   062a  activity_roster
--   062b  backfill the roster from youth_activity_profiles.member_id
--   062c  member_id loses its NOT NULL
--   062d  activity_event_participation
--   062e  backfill participation from activity_events.youth_attended
--   062f  policies: ward-wide, all four verbs, on both tables
--   062g  indexes


-- ---------------------------------------------------------------------------
-- 062a. The roster: who is on this team, and for how long
-- ---------------------------------------------------------------------------
create table activity_roster (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  profile_id uuid not null,
  member_id  uuid not null,

  -- BOTH `date`, NEVER `timestamptz`, which is CLAUDE.md §6's rule and not a shortcut. "She left
  -- the team on the 15th" is a DAY, not an instant, and a leader recording it in April must be
  -- able to name a day in February. An instant would demand an hour nobody knows.
  --
  -- The comparison against `activity_events.event_date` — which IS a timestamptz — therefore
  -- resolves in the WARD'S ZONE, in lib/youth/roster.ts, which is the one place a wall-clock day
  -- and an instant are allowed to meet. That is lib/youth/ics/resolveInstant.ts's rule in a
  -- second place: never compare `event_date.slice(0, 10)` to one of these strings, because that
  -- is UTC and it puts a 7:30pm Friday game on Saturday.
  --
  -- BOTH NULLABLE, AND ABSENT MEANS THE WHOLE SCHEDULE. The same absent-means-default idiom as
  -- `household_stewardships` (052), `household_visit_cadences` (050), 054a's `org_id`, 059b's
  -- `occasion_id` and 060a's `closed_at`. THERE IS NO SENTINEL DATE MEANING "FROM THE START" and
  -- none should be invented — it is also what keeps assigning a young person to one tap, which is
  -- ITER-033's whole stated goal.
  --
  -- SYMMETRIC ON PURPOSE. A youth joining in January is the mirror of one leaving in February,
  -- and the support percentage's denominator needs both ends of the window.
  started_on date,
  ended_on   date,

  -- MIRRORS youth_activity_profiles.entered_by (migration 009) and activity_occasions.created_by
  -- (059a) EXACTLY — nullable, and no `on delete` clause. A leader being released must not take
  -- the roster with them.
  added_by   uuid,
  created_at timestamptz not null default now(),

  unique (id, ward_id),

  -- A COMPOSITE FOREIGN KEY ON EVERY ONE, so a roster row pointing at another ward's profile or
  -- another ward's member is impossible in the SCHEMA rather than merely refused by a policy.
  --
  -- `on delete cascade` ON member_id IS AN IMPROVEMENT OVER WHAT IT REPLACES, and it is worth
  -- saying out loud. TODAY, deleting a member cascades away their whole profile — the season, its
  -- events, its sign-ups and its follow-ups — because `youth_activity_profiles.member_id` carries
  -- that cascade. AFTER THIS, deleting a member removes them from the rosters they are on and the
  -- TEAM'S SCHEDULE SURVIVES, which is what a ward that loses one player actually wants.
  foreign key (profile_id, ward_id) references youth_activity_profiles (id, ward_id) on delete cascade,
  foreign key (member_id,  ward_id) references members (id, ward_id) on delete cascade,
  foreign key (added_by,   ward_id) references users (id, ward_id)
);

alter table activity_roster enable row level security;

-- ONE ROW PER (TEAM, YOUNG PERSON). A second row for the same pair would double that person in
-- every denominator on /youth, and a double tap on a slow phone — the ordinary case in this
-- module — is exactly how one would be written (056b's reason for its unique index, restated).
--
-- IT NEEDS NO `nulls not distinct`, AND THE CONTRAST WITH 055b IS THE POINT — do not "unify" the
-- two. 055b's index carries that clause because `source_recurrence_id` is NULLABLE, and SQL's
-- `null = null` is NULL rather than true, so without it two rows with a null recurrence id would
-- not conflict (the talks-d hole). BOTH COLUMNS HERE ARE `not null`, so the plain index is
-- already exact and the clause would be noise implying a nullability that does not exist.
create unique index activity_roster_profile_member_idx on activity_roster (profile_id, member_id);

comment on table activity_roster is
  'Which young people are on a team (youth_activity_profiles), and the window they were on it for. Absent dates mean the whole schedule — see migration 062.';


-- ---------------------------------------------------------------------------
-- 062b. Backfill: every existing profile becomes a team with a roster of exactly one
-- ---------------------------------------------------------------------------
--
-- LOSSLESS, AND NO WARD'S SCREEN MOVES ON THE DAY THIS APPLIES. A team of one computes exactly
-- what a per-youth profile computed: the same events, the same denominator, the same percentage.
-- That is what makes 062 purely structural and what lets it apply before the code deploys.
--
-- DUPLICATES STAY DUPLICATED, DELIBERATELY. A ward that has already entered eight profiles for
-- one basketball team still has eight teams of one after this, and collapsing them is a HUMAN
-- decision this migration refuses to take: merging would move rows nobody named and destroy one
-- profile's events, sign-ups and follow-ups. That is exactly what youth-h narrowed `Remove` to
-- prevent and what visits-f refused for the empty bulk replace — refuse the automatic destructive
-- thing, and name the alternative. The alternative here is that the roster makes the RIGHT shape
-- cheap from now on; no merge path ships in this slice.
--
-- `entered_by` becomes `added_by` and `created_at` is carried across, so a backfilled row is not
-- distinguishable from one a leader wrote — because it records the same fact.
insert into activity_roster (ward_id, profile_id, member_id, added_by, created_at)
select ward_id, id, member_id, entered_by, created_at
from youth_activity_profiles
where member_id is not null;


-- ---------------------------------------------------------------------------
-- 062c. member_id loses its NOT NULL
-- ---------------------------------------------------------------------------
--
-- A WIDENING, SO IT CANNOT FAIL. Every row satisfying `not null` satisfies its absence.
--
-- It is what lets a TEAM be created before anybody is on it — the state ITER-033's own flow
-- passes through between "import once" and "assign each youth". That state is NORMAL rather than
-- exceptional, which is why it is made loud on the roster panel and on the calendar rather than
-- refused (see lib/youth/roster.ts's `eventYouthAttendance`).
--
-- THE COLUMN IS DROPPED BY 063, AFTER THE DEPLOY, AND NOT HERE. The running build's
-- ACTIVITY_PROFILE_COLUMNS still selects `member_id`; dropping it underneath that build makes
-- every youth screen answer 400.
alter table youth_activity_profiles alter column member_id drop not null;


-- ---------------------------------------------------------------------------
-- 062d. Participation: one (young person, event) answer
-- ---------------------------------------------------------------------------
--
-- THREE STATES, AND THE THIRD IS THE ABSENCE OF THE ROW. This is migration 061's rule kept
-- EXACTLY, on storage that makes the sparse-exception shape structural:
--
--     no row              nobody has said. The ordinary state of nearly every (youth, event) pair.
--     row, true           somebody confirmed they are taking part.
--     row, false          somebody said they are not taking part.
--
-- `taking_part` IS `not null`, AND THAT IS THE CONTRAST WITH 061 RATHER THAN A DEPARTURE FROM IT.
-- 061 needed a NULLABLE column because the fact lived on a row (`activity_events`) that always
-- exists, so there had to be a value meaning "unanswered". Here the row is created only when
-- somebody answers, so a nullable column would be a SECOND way to spell the same third state —
-- and two spellings of one state is how the two come to disagree.
--
-- CLEARING BACK TO "NOBODY HAS SAID" DELETES THE ROW, AND THAT IS NOT 060a's "NEVER A DELETE".
-- That rule protects A RECORD SOMEBODY WROTE — a season's history, a pastoral account. This row
-- carries no text, no account and no author's words: it is a MARKER, and removing it is precisely
-- "nobody has said". `activity_logs` and `activity_private_notes` are untouched by any of this
-- and rule 5 is nowhere near it.
--
-- `true` IS STILL NOT A NO-OP even though it behaves like no-row in today's arithmetic. It keeps
-- "confirmed taking part" distinguishable from "assumed taking part", and it is what gives the
-- control a way back that is not the opposite claim.
--
-- NEVER INFERRED. Not from an empty attendee list, not from a cancelled sibling, not from a
-- missing follow-up, and — NEW HERE — NOT FROM AN EMPTY ROSTER. A team with nobody assigned yet
-- is not a team nobody is expected at; it is a team nobody has been assigned to. That is
-- lib/youth/classifyLocation.ts's refusal of near-miss matching in a FOURTH place.
create table activity_event_participation (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  event_id    uuid not null,
  member_id   uuid not null,
  taking_part boolean not null,

  -- Nullable and no `on delete` clause, exactly as `added_by` above: the fact outlives the person
  -- who recorded it.
  recorded_by uuid,
  created_at  timestamptz not null default now(),

  unique (id, ward_id),

  foreign key (event_id,    ward_id) references activity_events (id, ward_id) on delete cascade,
  foreign key (member_id,   ward_id) references members (id, ward_id) on delete cascade,
  foreign key (recorded_by, ward_id) references users (id, ward_id)
);

alter table activity_event_participation enable row level security;

-- ONE ANSWER PER (EVENT, YOUNG PERSON), for 062a's reason and with 062a's contrast: both columns
-- are `not null`, so this needs no `nulls not distinct` either. It is also what makes
-- setParticipation() an UPSERT rather than a read-then-write.
create unique index activity_event_participation_event_member_idx
  on activity_event_participation (event_id, member_id);

comment on table activity_event_participation is
  'Whether one young person is taking part in one event. No row means nobody has said — see migration 062.';

-- MIGRATION 061'S CHECK HAS NO SUCCESSOR AND NEEDS NONE.
--
-- `activity_events_youth_attended_needs_profile` existed because `activity_events.profile_id` is
-- NULLABLE: on a ward-wide event, "did THEY go?" had no referent, so the constraint made a
-- meaningless row a database error. Here the referent is `member_id`, which is `not null` — THE
-- CONSTRAINT IS THE COLUMN. What the route must still refuse is a member who is not on the
-- event's team roster at all, and that is a sentence a person can act on rather than a constraint
-- violation nobody can (061's own stated reason for refusing in the route first).


-- ---------------------------------------------------------------------------
-- 062e. Backfill: only the rows somebody actually answered
-- ---------------------------------------------------------------------------
--
-- `youth_attended is null` IS "NOBODY HAS SAID" AND BECOMES NO ROW, which is the same fact in the
-- new storage rather than a loss. Only the answered ones move.
--
-- THE JOIN CARRIES `profile.ward_id = event.ward_id`, and it is load-bearing rather than tidy: a
-- ward filter on ONE side of a join is not a ward filter on the other. Migration 060b states this
-- for `activity_profile_followup_count`, and it is the reason every composite foreign key in this
-- schema carries `ward_id` at all.
--
-- `profile.member_id is not null` is belt and braces against a row 062c has just made possible in
-- principle — there can be none yet, because no code writes one until this slice deploys, but the
-- predicate costs nothing and states the assumption instead of relying on the ordering.
insert into activity_event_participation (ward_id, event_id, member_id, taking_part, created_at)
select event.ward_id, event.id, profile.member_id, event.youth_attended, event.created_at
from activity_events event
join youth_activity_profiles profile
  on profile.id = event.profile_id
 and profile.ward_id = event.ward_id
where event.youth_attended is not null
  and profile.member_id is not null;


-- ---------------------------------------------------------------------------
-- 062f. Policies: ward-wide, all four verbs, on both tables
-- ---------------------------------------------------------------------------
--
-- A READER WILL ASSUME THESE SHOULD BE ORG-SCOPED. They should not, for three reasons, and all
-- three are written down because the assumption is reasonable and wrong.
--
-- 1. THEY MATCH THE TABLES THEY HANG OFF. `activity_events`, `activity_calendars` and
--    `activity_occasions` all keep migration 019's ward-wide policies and none of them has an
--    `org_id`, because the organization is answered ONCE, ON THE PROFILE (054d) and a second copy
--    could disagree with the first. A roster row and a participation row are the same kind of
--    thing: they hang off a profile that already carries the answer.
--
-- 2. NO POLICY MOVES, AND THAT IS WHAT MAKES 062 PURELY STRUCTURAL. Migration 061 says in as many
--    words that writing `youth_attended` is "an ORDINARY UPDATE on activity_events, which keeps
--    migration 019's ward-wide write policies… the same boundary `Cancel` already runs under".
--    Moving that fact onto a table with ward-wide policies moves NO boundary. Anybody who could
--    record it yesterday can record it today, and nobody else can.
--
-- 3. THE READ MUST BE UNIFORMLY EVALUABLE — migration 056c's load-bearing rule, third sighting
--    (059c is the second). The roster decides the DENOMINATOR of the support percentage and the
--    expected list on a calendar card. If one reader could see roster rows another could not, THE
--    SAME GAME WOULD READ COVERED TO ONE LEADER AND UNCOVERED TO ANOTHER from the same data at
--    the same instant, and neither of them would be wrong.
--
-- WRITTEN OUT RATHER THAN LOOPED, following 059c: eight policies a reader can grep for by name.

create policy activity_roster_ward_select on activity_roster
  for select to authenticated
  using (ward_id = current_ward_id());

create policy activity_roster_ward_insert on activity_roster
  for insert to authenticated
  with check (ward_id = current_ward_id());

create policy activity_roster_ward_update on activity_roster
  for update to authenticated
  using (ward_id = current_ward_id())
  with check (ward_id = current_ward_id());

create policy activity_roster_ward_delete on activity_roster
  for delete to authenticated
  using (ward_id = current_ward_id());

create policy activity_event_participation_ward_select on activity_event_participation
  for select to authenticated
  using (ward_id = current_ward_id());

create policy activity_event_participation_ward_insert on activity_event_participation
  for insert to authenticated
  with check (ward_id = current_ward_id());

create policy activity_event_participation_ward_update on activity_event_participation
  for update to authenticated
  using (ward_id = current_ward_id())
  with check (ward_id = current_ward_id());

create policy activity_event_participation_ward_delete on activity_event_participation
  for delete to authenticated
  using (ward_id = current_ward_id());


-- ---------------------------------------------------------------------------
-- 062g. Indexes
-- ---------------------------------------------------------------------------
--
-- EACH LEADS WITH ward_id, following 018_indexes.sql, 054e, 055d, 056d, 057e and 059d, because
-- every query does — the ward filter is the first predicate in this entire codebase.

-- "WHO IS ON THIS TEAM" — the roster panel on /youth/profiles, and the expected list on every
-- calendar card.
create index activity_roster_profile_idx on activity_roster (ward_id, profile_id);

-- "WHICH TEAMS IS THIS YOUNG PERSON ON" — /youth's grouping, which is now built from memberships
-- rather than from profiles, and /youth/history/[member_id].
create index activity_roster_member_idx on activity_roster (ward_id, member_id);

-- THE BY-EVENT READ FOR A WHOLE SCHEDULE IN ONE QUERY, the way lib/youth/attendees.ts already
-- reads its rows: a page renders a month or a season, so one round trip keyed back by event
-- rather than one per card.
create index activity_event_participation_event_idx
  on activity_event_participation (ward_id, event_id);
