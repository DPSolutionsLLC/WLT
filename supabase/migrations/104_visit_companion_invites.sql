-- ITER-055 slice bv6, migration 104: a visit booked with companions, and the invite a companion
-- with an account accepts or declines (plans/bishopric-visits.md P11, P12, P13).
--
-- ---------------------------------------------------------------------------
-- INVITED OR RECORDED — NEVER SILENTLY ADDED (prototype §2.9 #1)
-- ---------------------------------------------------------------------------
-- A companion who has an account (`user_id`) is INVITED: their row starts `pending` and they accept
-- or decline it. A roster member (`member_id`) or a typed name (`label`) is only RECORDED and has no
-- status, because a roster member has no account to answer with (that link is ITER-058). The person
-- who booked the visit is never a row here — they are the appointment's `made_by`.
--
-- Any leader holding a calling in this ward may be invited, not only the bishopric (decided at bv6
-- start). `user_id` is a SUBJECT column written from a request body, so the route calls
-- findUsersOutsideWard() before writing it (CLAUDE.md §7, the 069 warning).
--
-- Answering is pending → accepted or pending → declined, once (decided at bv6 start). Cancelling
-- or rescheduling the appointment notifies nobody: an accepted companion's My Appointments follows
-- the appointment row by itself.
--
-- ---------------------------------------------------------------------------
-- A SELECT POLICY AND NO WRITE POLICY ON `visit_appointment_companions` (P12)
-- ---------------------------------------------------------------------------
-- The only writer is lib/visits/companions.ts, on the service role: inviting runs after the
-- caller's OWN client inserted the appointment (so visit_appointments_insert proved they may book
-- it), and answering runs after the route read the invite as its own invitee. The 073 / 089 / 094 /
-- 099 / 103 shape. Do not add a write policy "for convenience".
--
-- ---------------------------------------------------------------------------
-- THE ONE READ WIDENING: `is_visit_companion()` ON `visit_appointments_select`
-- ---------------------------------------------------------------------------
-- An invited leader outside the owning organization — and outside every sharing grant — still has
-- to see the visit they were asked to. So the appointment's SELECT gains one arm: the reader holds a
-- pending or accepted invite on THAT appointment. It exposes the appointment row and nothing else:
-- no visit log, no participant, no private note, no other appointment. A declined invite drops the
-- arm, so declining takes the appointment off their screens.
--
-- `visit_assignments` (103) is NOT widened: an invited companion reads the appointment, never who
-- the bishopric gave the household to.

-- ---------------------------------------------------------------------------
-- 104a. An appointment booked from a visit assignment (P11)
-- ---------------------------------------------------------------------------
-- Scheduling from a "Visit the ___ family" to-do books a visit appointment rather than putting a
-- time on the to-do, so the visit appears ONCE on My Appointments. Single-column: visit_assignments
-- has no (id, ward_id) key, and the route reads the assignment in this ward before linking it.
-- `on delete set null`: an appointment outlives any assignment it was made under.
alter table visit_appointments
  add column assignment_id uuid references visit_assignments (id) on delete set null;

comment on column visit_appointments.assignment_id is
  'The household visit assignment this appointment was booked from (ITER-055 bv6). Null otherwise.';

create index visit_appointments_assignment_idx
  on visit_appointments (assignment_id) where assignment_id is not null;

-- ---------------------------------------------------------------------------
-- 104b. The companions
-- ---------------------------------------------------------------------------
create table visit_appointment_companions (
  id             uuid        primary key default gen_random_uuid(),
  ward_id        uuid        not null references wards (id) on delete cascade,
  appointment_id uuid        not null,
  -- Single-column to users, never `(user, ward_id)`: migration 069 narrowed all forty-eight of
  -- those, because a leader acting under a calling in a second ward fails them as a 500.
  user_id        uuid        references users (id) on delete cascade,
  member_id      uuid,
  label          text,
  status         text        check (status in ('pending', 'accepted', 'declined')),
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  -- The companions go with the appointment. Appointments are cancelled, never deleted, except the
  -- one the route deletes itself when writing its companions failed (visits-d's pitfall).
  constraint visit_appointment_companions_appointment_fkey
    foreign key (appointment_id, ward_id) references visit_appointments (id, ward_id) on delete cascade,
  constraint visit_appointment_companions_member_fkey
    foreign key (member_id, ward_id) references members (id, ward_id) on delete cascade,
  -- Exactly one identity — migration 046's `visit_participants_one_identity`, verbatim in shape.
  constraint visit_appointment_companions_one_identity check (
    (user_id is not null)::int + (member_id is not null)::int
      + (nullif(btrim(coalesce(label, '')), '') is not null)::int = 1
  ),
  -- Only an invited person has a status, and every invited person has one. Written so it can
  -- actually fail (050's note on CHECKs that are NULL).
  constraint visit_appointment_companions_status_for_users
    check ((user_id is not null) = (status is not null)),
  constraint visit_appointment_companions_responded
    check ((responded_at is null) = (status is null or status = 'pending'))
);

-- The same person is not on one appointment twice. Two partial indexes, because a NULL never equals
-- a NULL (046's reason). No index on `label`: two people can genuinely be "a neighbour".
create unique index visit_appointment_companions_one_user
  on visit_appointment_companions (appointment_id, user_id) where user_id is not null;
create unique index visit_appointment_companions_one_member
  on visit_appointment_companions (appointment_id, member_id) where member_id is not null;

create index visit_appointment_companions_appointment_idx
  on visit_appointment_companions (appointment_id);
create index visit_appointment_companions_invitee_idx
  on visit_appointment_companions (user_id, status) where user_id is not null;

comment on table visit_appointment_companions is
  'Who is going along on a visit appointment (ITER-055 bv6): an invited leader (pending, accepted, '
  'declined), or a recorded roster member or typed name. Written only by lib/visits/companions.ts '
  'with the service role.';

alter table visit_appointment_companions enable row level security;

-- ---------------------------------------------------------------------------
-- 104c. is_visit_companion()
-- ---------------------------------------------------------------------------
-- `security definer` so that visit_appointments_select can ask it without running this table's own
-- policy, which in turn reads visit_appointments — the definer reads past RLS and the two policies
-- never recurse. It returns a boolean about the CALLER and nothing else.
create function is_visit_companion(p_appointment_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from visit_appointment_companions c
     where c.appointment_id = p_appointment_id
       and c.ward_id = current_ward_id()
       and c.user_id = auth.uid()
       and c.status in ('pending', 'accepted')
  );
$$;

revoke all on function is_visit_companion(uuid) from public;
grant execute on function is_visit_companion(uuid) to authenticated;
grant execute on function is_visit_companion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 104d. The policies
-- ---------------------------------------------------------------------------
-- 099c's policy plus the one arm. Nothing else on visit_appointments moves: the write policies
-- stay the bishopric or the owning organization, so a companion can read the appointment and
-- never change it.
drop policy if exists visit_appointments_select on visit_appointments;
create policy visit_appointments_select on visit_appointments
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or visit_org_visible_to_caller(org_id) or is_visit_companion(id))
  );

-- A companion row is readable by whoever can read its appointment (the EXISTS runs under
-- visit_appointments' own policy), and an invitee always reads their own invite — a declined one
-- included, after the appointment itself has left their view.
create policy visit_appointment_companions_select on visit_appointment_companions
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (
      user_id = auth.uid()
      or exists (select 1 from visit_appointments a where a.id = appointment_id)
    )
  );

-- Copies 091's form, as 099f and 103a did.
create policy visit_appointment_companions_module_released on visit_appointment_companions
  as restrictive for all to authenticated
  using ((select ward_module_released('visits')))
  with check ((select ward_module_released('visits')));

-- ---------------------------------------------------------------------------
-- 104e. todo_log_entries kinds
-- ---------------------------------------------------------------------------
-- MUST STAY IN STEP WITH `TODO_LOG_KINDS` in types/domain.ts. Starts from 103d's list, the latest.
-- `visit_companion_declined`: an invited companion can't come; the line goes on the booker's open
-- "Visit the ___ family" to-do when the appointment was booked from one, and carries the
-- companion's name in `body`, snapshotted.
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
    'meeting_cancelled',
    'visit_assigned',
    'visit_reassigned',
    'visit_unassigned',
    'visit_goal_ended',
    'visit_partly_reached',
    'visit_companion_declined'
  )
);

-- ---------------------------------------------------------------------------
-- 104f. The invite's notification, for every existing ward (P13)
-- ---------------------------------------------------------------------------
-- supabase/seed/notification_triggers.sql carries the same key for new wards, and so do SPEC.md,
-- lib/notifications/triggerDefaults.ts and testing/infrastructure/seedUtils.ts — a key missing from
-- one of them never fires for that set of wards (notification-trigger-drift). Recipients are
-- addressed explicitly (each invited leader), so the role list is the opt-out surface only.
insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, 'visit_companion_invited', array['bishop', 'counselor']::text[], true
from wards ward
on conflict (ward_id, trigger_key) do nothing;
