-- ITER-038, migration 089: A SUNDAY'S MUSIC IS SUBMITTED, REVIEWED BY THE CONDUCTOR, AND REOPENS ON
-- ANY CHANGE.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: one new table, three nullable
-- columns on existing tables, one NOT NULL column with a default, two CHECKs widened to admit more
-- values, and three notification trigger rows. The running build selects none of the new columns
-- and writes none of the new values, so no entry belongs in HELD_BACK_UNTIL_DEPLOYED.
--
-- ONE MIGRATION FOR ALL THREE SLICES (ma, mb, mc), as 088 was for ITER-036: it is additive, and
-- splitting it would buy nothing but a second push. plans/sacrament-music-handoff-and-approval.md.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS STORES
-- ---------------------------------------------------------------------------
-- `sunday_music` is one row per Sunday that has any music state beyond the hymns themselves: the
-- chorister and organist (slice ma), and the submission's status (slice mb). The hymns stay in
-- `hymn_selections` and the musical number in `musical_numbers`, LIVE, exactly as before — the
-- programme and the hub read them unchanged (D3). This table records who leads the music and
-- whether the conductor has approved it; it is not a copy of the picks.
--
-- ABSENT MEANS THE EMPTY DRAFT, the house idiom (`household_stewardships`, `closed_at`): a Sunday
-- with no row has no chorister, no organist and a `draft` status. Nothing inserts a row on read.
--
-- ---------------------------------------------------------------------------
-- NO WRITE POLICY, AND THAT IS THE ENFORCEMENT
-- ---------------------------------------------------------------------------
-- The table has a SELECT policy and nothing else, so RLS denies every authenticated INSERT,
-- UPDATE and DELETE. Every write runs through lib/music/* with the service role behind a route's
-- guard — migration 073's `access_requests` shape, for 073's reason: the status machine, and the
-- rule that NOBODY APPROVES THEIR OWN SUBMISSION (A3), are enforced by the ABSENCE of a write path
-- rather than by a route check somebody could forget. A client that skipped the route could not
-- set `approved` on its own submission because it could not write the row at all.
-- tests/rls/sunday-music.test.ts asserts it at the table for every role.
--
-- Structure:
--   089a  sunday_music
--   089b  todos.music_sunday_id, todos.music_role
--   089c  todos.closed_reason values
--   089d  todo_log_entries kinds
--   089e  notification_user_prefs.email_enabled
--   089f  three notification triggers for every existing ward


-- ---------------------------------------------------------------------------
-- 089a. sunday_music
-- ---------------------------------------------------------------------------
-- A PERSON IS A MEMBER OR A TYPED NAME, NEVER BOTH. A visiting organist has no member record, and
-- a ward member is better as a link than as a copy of their name. Both null is "not chosen yet".
--
-- The member keys are composite `(member, ward_id) → members (id, ward_id)`, copied from
-- `prayer_assignments.member_id` (migration 005) with its action: none, so a member with music on
-- a Sunday cannot be deleted out from under it. A null member id is not checked (MATCH SIMPLE).
--
-- `submitted_by` is a PLAIN `references users (id)`. Never the composite `(user, ward_id)` key
-- migration 069 narrowed: a submitter may hold the calling here while their account lives in
-- another ward. `on delete set null` is single-column, so it cannot null `ward_id` with it.
--
-- `return_note` is the conductor's words to the coordinator when they send the music back, and
-- only then. Its durable home is the coordinator's to-do timeline; it lives here too so the card
-- can show it until the music is submitted again.
create table sunday_music (
  id                  uuid primary key default gen_random_uuid(),
  ward_id             uuid not null references wards (id) on delete cascade,
  sunday_id           uuid not null,
  chorister_member_id uuid,
  chorister_name      text,
  organist_member_id  uuid,
  organist_name       text,
  status              text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved')),
  submitted_at        timestamptz,
  submitted_by        uuid references users (id) on delete set null,
  approved_at         timestamptz,
  returned_at         timestamptz,
  returned_reason     text
    check (returned_reason in ('sent_back', 'music_changed', 'topics_changed')),
  return_note         text
    check (return_note is null or length(btrim(return_note)) between 1 and 1000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (ward_id, sunday_id),
  foreign key (sunday_id, ward_id) references sundays (id, ward_id) on delete cascade,
  foreign key (chorister_member_id, ward_id) references members (id, ward_id),
  foreign key (organist_member_id, ward_id) references members (id, ward_id),
  constraint sunday_music_chorister_one_kind
    check (not (chorister_member_id is not null and chorister_name is not null)),
  constraint sunday_music_organist_one_kind
    check (not (organist_member_id is not null and organist_name is not null)),
  constraint sunday_music_chorister_name_length
    check (chorister_name is null or length(btrim(chorister_name)) between 1 and 120),
  constraint sunday_music_organist_name_length
    check (organist_name is null or length(btrim(organist_name)) between 1 and 120),
  constraint sunday_music_submitted_stamped
    check (status <> 'submitted' or submitted_at is not null),
  constraint sunday_music_approved_stamped
    check (status <> 'approved' or approved_at is not null),
  constraint sunday_music_returned_pair
    check ((returned_at is null) = (returned_reason is null)),
  constraint sunday_music_note_only_when_sent_back
    check (return_note is null or returned_reason = 'sent_back')
);

comment on table sunday_music is
  'A Sunday''s chorister, organist and music submission status (ITER-038). SELECT-only under RLS: '
  'every write is lib/music/* with the service role. Absent means an empty draft.';

alter table sunday_music enable row level security;

create policy sunday_music_select on sunday_music
  for select to authenticated
  using (ward_id = current_ward_id());

create index sunday_music_sunday_idx on sunday_music (sunday_id);


-- ---------------------------------------------------------------------------
-- 089b. todos → a Sunday's music
-- ---------------------------------------------------------------------------
-- `choose` is the coordinator's "Choose the music for …"; `review` is the conductor's "Review the
-- music for …". Written only by lib/todos/musicLinks.ts with the service role.
--
-- Single-column `on delete set null`, as 083a's `ask_assignment_id`: deleting a Sunday leaves the
-- to-do standing as an ordinary one. NOT cascade — that would destroy a person's to-do.
--
-- NO PAIR CHECK between the two columns, deliberately: `on delete set null` nulls only the id, so
-- a check requiring both-or-neither would make deleting a Sunday fail. Every reader treats
-- `music_sunday_id is null` as "unlinked", whatever `music_role` holds.
alter table todos
  add column music_sunday_id uuid references sundays (id) on delete set null,
  add column music_role text check (music_role in ('choose', 'review'));

comment on column todos.music_sunday_id is
  'The Sunday whose music this to-do is about (ITER-038). Null for every other to-do, and a null '
  'here means unlinked whatever music_role holds.';

-- One open music to-do of each role per owner per Sunday: what makes a second Finalize or a second
-- Submit add nothing (23505 is "already there"). Partial on `completed_at is null`, so a finished
-- one never blocks the next round.
create unique index todos_one_open_music_todo_per_owner
  on todos (music_sunday_id, music_role, user_id)
  where music_sunday_id is not null and completed_at is null;

create index todos_music_sunday_idx
  on todos (music_sunday_id)
  where music_sunday_id is not null;


-- ---------------------------------------------------------------------------
-- 089c. todos.closed_reason
-- ---------------------------------------------------------------------------
-- MUST STAY IN STEP WITH `TODO_CLOSED_REASONS` in types/domain.ts. `music_reopened`: the music
-- changed after it was submitted, so the review is no longer needed. `meeting_cancelled`: the
-- Sunday stopped holding sacrament meeting.
alter table todos drop constraint todos_closed_reason_check;

alter table todos add constraint todos_closed_reason_check check (
  closed_reason is null
  or closed_reason in (
    'handed_over',
    'assistant_released',
    'speaker_changed',
    'told_not_needed',
    'talk_back_on',
    'unfinalized',
    'music_reopened',
    'meeting_cancelled'
  )
);


-- ---------------------------------------------------------------------------
-- 089d. todo_log_entries kinds
-- ---------------------------------------------------------------------------
-- MUST STAY IN STEP WITH `TODO_LOG_KINDS` in types/domain.ts. `music_sent_back` carries the
-- conductor's note in `body` and is meaningless without it, so it is required, as `note` is.
alter table todo_log_entries drop constraint todo_log_entries_kind_check;

alter table todo_log_entries add constraint todo_log_entries_kind_check check (
  kind in (
    'note',
    'step_done',
    'step_undone',
    'completed',
    'reopened',
    'scheduled',
    'unscheduled',
    'source_completed',
    'ask_accepted',
    'ask_declined',
    'handed_over',
    'assistant_released',
    'speaker_changed',
    'taken_over',
    'talk_off',
    'told_not_needed',
    'talk_back_on',
    'unfinalized',
    'music_submitted',
    'music_approved',
    'music_sent_back',
    'music_reopened',
    'topics_changed',
    'meeting_cancelled'
  )
);

alter table todo_log_entries add constraint todo_log_entries_music_sent_back_has_body check (
  kind <> 'music_sent_back' or (body is not null and length(btrim(body)) > 0)
);


-- ---------------------------------------------------------------------------
-- 089e. notification_user_prefs.email_enabled
-- ---------------------------------------------------------------------------
-- Per person, per trigger: false means in-app only. The person writes it themselves through
-- migration 019's `_own_*` policies, which already admit exactly `user_id = auth.uid()`.
alter table notification_user_prefs
  add column email_enabled boolean not null default false;

comment on column notification_user_prefs.email_enabled is
  'Whether this person also wants this trigger by email (ITER-038). False means in-app only. '
  'Self-written under migration 019''s own-row policies.';


-- ---------------------------------------------------------------------------
-- 089f. three triggers for every existing ward
-- ---------------------------------------------------------------------------
-- supabase/seed/notification_triggers.sql carries the same three for new wards. A new trigger key
-- is always BOTH, or it silently never fires for one set of wards (migration 036's header).
insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, trigger.key, trigger.default_roles, true
from wards ward
cross join (values
  ('music_topics_ready', array['music_coordinator']::text[]),
  ('music_submitted',    array['bishop', 'counselor']),
  ('music_sent_back',    array['music_coordinator'])
) as trigger(key, default_roles)
on conflict (ward_id, trigger_key) do nothing;
