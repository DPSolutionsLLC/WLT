-- Phase 4A, migration 025: external speakers, the contact waiver, and approval uniqueness.
--
--   Part 1  external speaker columns and the exactly-one-speaker CHECK (ITER-004)
--   Part 2  the contact waiver
--   Part 3  one approval row per bishopric member per assignment
--   Part 4  indexes
--   Part 5  the assignment_reverted trigger key, for wards that already exist
--
-- Everything added here is nullable and every constraint is satisfied by the rows that exist,
-- so this migration cannot fail on data. The one to watch is Part 3: if any environment holds
-- two approval rows for one user on one assignment, the unique constraint will refuse it.


-- ============================================================================
-- Part 1 — external speakers
-- ============================================================================
--
-- ITER-004. A visiting stake leader or a missionary reporting home is not on the ward roster,
-- and inventing a member row for them would corrupt every count the roster feeds. The name is
-- retyped each time rather than saved to a list of stake leaders — that list is machinery
-- nobody has asked for, and a name is cheap.
--
-- The title is TYPED, never derived. `users` records no gender, which is why
-- bishopricDisplayName() in lib/calendar/queries.ts already refuses to guess an honorific.

alter table assignments
  add column external_speaker_name  text,
  add column external_speaker_title text;

comment on column assignments.external_speaker_name is
  'A speaker who is not on the ward roster. Mutually exclusive with member_id - see assignments_speaker_exactly_one.';

comment on column assignments.external_speaker_title is
  'An honorific the planner TYPED, such as "President". Never derived - the app records no gender and will not guess one.';

-- The third arm is an empty slot, and it is not an oversight: an assignment at stage 'plan'
-- legitimately has no speaker yet, a decline clears the speaker back to none, and a calendar
-- revert puts a filled assignment into exactly that state.
alter table assignments
  add constraint assignments_speaker_exactly_one check (
       (member_id is not null and external_speaker_name is null)
    or (member_id is null     and external_speaker_name is not null)
    or (member_id is null     and external_speaker_name is null)
  );


-- ============================================================================
-- Part 2 — the contact waiver
-- ============================================================================
--
-- ITER-004 forbids SILENTLY SKIPPING the contact stages for somebody the ward is not
-- contacting. A skip leaves REQUEST and CONFIRM looking like outstanding tasks nobody can ever
-- complete. A waiver is a recorded decision instead, with a person and a timestamp on it, and
-- it is what lets an external speaker cross REQUEST -> CONFIRM -> NOTIFY and
-- APPRECIATE -> COMPLETE.

alter table assignments
  add column contact_waived_at timestamptz,
  add column contact_waived_by uuid;

comment on column assignments.contact_waived_at is
  'When the contact stages were waived for an external speaker. NEVER set for a ward member - waiving those stages for somebody on the roster would hide a real outstanding task.';

-- Waiving the contact stages for a ward member would hide a task somebody still has to do.
alter table assignments
  add constraint assignments_waiver_external_only check (
    contact_waived_at is null or member_id is null
  );

-- Half a waiver is not a waiver. Both columns move together or neither does.
alter table assignments
  add constraint assignments_waiver_pair check (
    (contact_waived_at is null and contact_waived_by is null)
    or (contact_waived_at is not null and contact_waived_by is not null)
  );

-- The composite foreign key, rather than a plain reference to users (id), is how the ward scope
-- is enforced structurally: a waiver cannot name somebody in another ward however the row was
-- written. Every other actor column on this table is declared the same way.
alter table assignments
  add constraint assignments_contact_waived_by_fkey
    foreign key (contact_waived_by, ward_id) references users (id, ward_id);


-- ============================================================================
-- Part 3 — one approval row per person
-- ============================================================================
--
-- The APPROVE gate counts approval rows against the bishopric roll. Without this constraint one
-- counselor can insert three rows and satisfy a 3-of-3 gate alone. The gate counts rows; the
-- DATABASE is what makes each row a distinct person.
--
-- It also gives recordApproval() something to upsert on, so a bishopric member changing their
-- mind updates their own row rather than stacking a second one.

alter table assignment_approvals
  add constraint assignment_approvals_one_per_user unique (assignment_id, user_id);


-- ============================================================================
-- Part 4 — indexes
-- ============================================================================
--
-- ward_id leads every one of them, because every query in the app filters on it first
-- (CLAUDE.md rule 1).

create index assignments_ward_sunday_idx      on assignments (ward_id, sunday_id);
create index assignments_ward_member_idx      on assignments (ward_id, member_id, pipeline_stage);
create index assignment_history_member_idx    on assignment_history (ward_id, member_id);
create index assignment_comments_sunday_idx   on assignment_comments (ward_id, sunday_id);


-- ============================================================================
-- Part 5 — the assignment_reverted trigger key
-- ============================================================================
--
-- calendar-b handed this forward: the revert-to-'plan' path in lib/calendar/queries.ts notifies
-- nobody, because no key existed for it. 03-calendar.md asks for the planner to be told when a
-- calendar change voids their planning work.
--
-- Existing wards get the row here; a ward seeded from scratch gets it from
-- supabase/seed/notification_triggers.sql. notification_settings carries unique
-- (ward_id, trigger_key) from migration 013, which is what makes this ON CONFLICT real rather
-- than a no-op that inserts duplicates.

insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select id, 'assignment_reverted', array['bishop', 'counselor']::text[], true
from wards
on conflict (ward_id, trigger_key) do nothing;
