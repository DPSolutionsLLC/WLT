-- P4 Sacrament slice f2c, migration 085: A SUNDAY'S WORK IS CANCELLED WHEN ITS TALKS ARE LOST.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. ADDITIVE, plus one index narrowed and one function
-- body replaced:
--   - new nullable columns only; nothing the running build selects or writes changes shape;
--   - `prayer_assignments_sunday_type_idx` becomes PARTIAL. It admits strictly more rows than
--     before, and until the code deploys no row has `cancelled_at` set, so it behaves identically;
--   - `apply_fast_sunday` stops reverting talks to `plan`. The running build's updateSunday()
--     already reverts BEFORE calling it (lib/calendar/queries.ts), so on the edit path the
--     function's own revert found nothing to do. On the GENERATION path the old build loses a
--     silent revert it never reported — see "Known limitation" in the plan.
-- No entry belongs in HELD_BACK_UNTIL_DEPLOYED.
--
-- ---------------------------------------------------------------------------
-- THE REVERSAL (plans/sacrament-cancelled-sunday-work.md, the user's decisions C1–C7, 2026-09-26)
-- ---------------------------------------------------------------------------
-- Migrations 023 and 027 say a lost talk is "reverted to 'plan', NEVER deleted", keeping its
-- speaker. That is replaced: when a Sunday stops holding sacrament meeting, or a talk loses its
-- slot, the work is RELEASED and recorded as CANCELLED. Nothing is deleted — the reason the old
-- rule gave ("the planning work behind that assignment is somebody's") is kept whole, because a
-- cancelled record keeps every column it had. Only its place on the Sunday is given up: every
-- reader skips a row with `cancelled_at` set, so the Sunday reads as empty and planning, if the
-- meeting ever comes back, simply starts over.
--
-- `cancelled_at` + `cancelled_reason`, not a pipeline stage or status value: a stage is where the
-- work IS, and cancellation is that it STOPPED, from whatever stage. The two are set together or
-- not at all.
--
-- `todos.ask_prayer_id` and `todos.musical_number_id` link a "Let ___ know it's cancelled" to-do
-- to what was cancelled, with 083b's partial unique so a retry never creates a second one. Slice g
-- (Prayers) will use `ask_prayer_id` for prayer asks too; migration 083's header already names it.
--
-- NO POLICY MOVES.
--
-- Structure:
--   085a  cancelled_at / cancelled_reason on four tables
--   085b  one live prayer per type, not one row
--   085c  todos links to a cancelled prayer or musical number
--   085d  apply_fast_sunday no longer touches assignments


-- ---------------------------------------------------------------------------
-- 085a. cancelled_at / cancelled_reason
-- ---------------------------------------------------------------------------
-- MUST STAY IN STEP WITH `CANCELLED_REASONS` in types/domain.ts.
--   no_meeting    the Sunday no longer holds sacrament meeting
--   fast_sunday   the Sunday became Fast Sunday, which has no speaking slots
--   slot_removed  the Sunday kept its meeting but lost this speaking slot
alter table assignments
  add column cancelled_at timestamptz,
  add column cancelled_reason text check (
    cancelled_reason is null or cancelled_reason in ('no_meeting', 'fast_sunday', 'slot_removed')
  ),
  add constraint assignments_cancelled_together
    check ((cancelled_at is null) = (cancelled_reason is null));

alter table prayer_assignments
  add column cancelled_at timestamptz,
  add column cancelled_reason text check (
    cancelled_reason is null or cancelled_reason in ('no_meeting', 'fast_sunday', 'slot_removed')
  ),
  add constraint prayer_assignments_cancelled_together
    check ((cancelled_at is null) = (cancelled_reason is null));

alter table hymn_selections
  add column cancelled_at timestamptz,
  add column cancelled_reason text check (
    cancelled_reason is null or cancelled_reason in ('no_meeting', 'fast_sunday', 'slot_removed')
  ),
  add constraint hymn_selections_cancelled_together
    check ((cancelled_at is null) = (cancelled_reason is null));

alter table musical_numbers
  add column cancelled_at timestamptz,
  add column cancelled_reason text check (
    cancelled_reason is null or cancelled_reason in ('no_meeting', 'fast_sunday', 'slot_removed')
  ),
  add constraint musical_numbers_cancelled_together
    check ((cancelled_at is null) = (cancelled_reason is null));

comment on column assignments.cancelled_at is
  'When this talk was cancelled because its Sunday lost the meeting or its slot (slice f2c). '
  'A cancelled talk is a RECORD: every reader skips it, so the slot reads as free.';
comment on column prayer_assignments.cancelled_at is
  'When this prayer was cancelled because its Sunday lost the meeting (slice f2c). Skipped by '
  'every reader and by the one-per-type index.';
comment on column hymn_selections.cancelled_at is
  'When this hymn choice was cancelled because its Sunday lost the meeting (slice f2c).';
comment on column musical_numbers.cancelled_at is
  'When this musical number was cancelled because its Sunday lost the meeting (slice f2c).';

-- Every per-Sunday read now filters on it.
create index assignments_live_sunday_idx
  on assignments (ward_id, sunday_id) where cancelled_at is null;


-- ---------------------------------------------------------------------------
-- 085b. ONE LIVE INVOCATION AND ONE LIVE BENEDICTION PER SUNDAY
-- ---------------------------------------------------------------------------
-- Migration 028's index counted every row, so a cancelled prayer kept on the Sunday would block the
-- next person asked to pray. It now counts only live rows. lib/prayers/queries.ts upserts by
-- reading the live row first (findPrayerSlot), never with ON CONFLICT, so a partial index serves it.
drop index prayer_assignments_sunday_type_idx;

create unique index prayer_assignments_sunday_type_idx
  on prayer_assignments (ward_id, sunday_id, prayer_type)
  where cancelled_at is null;


-- ---------------------------------------------------------------------------
-- 085c. todos → a cancelled prayer or musical number
-- ---------------------------------------------------------------------------
-- Single-column `on delete set null`, as 083a's `ask_assignment_id`: deleting the source leaves the
-- to-do standing. Written only by lib/todos/askLinks.ts with the service role.
alter table todos
  add column ask_prayer_id uuid references prayer_assignments (id) on delete set null,
  add column musical_number_id uuid references musical_numbers (id) on delete set null;

comment on column todos.ask_prayer_id is
  'The prayer this to-do is about (slice f2c: "Let ___ know it''s cancelled"; slice g: the ask). '
  'Null for every other to-do.';
comment on column todos.musical_number_id is
  'The musical number this to-do is about (slice f2c: "Let ___ know it''s cancelled"). Null for '
  'every other to-do.';

create unique index todos_one_open_prayer_item_per_owner
  on todos (ask_prayer_id, user_id)
  where ask_prayer_id is not null and completed_at is null;

create unique index todos_one_open_musical_item_per_owner
  on todos (musical_number_id, user_id)
  where musical_number_id is not null and completed_at is null;


-- ---------------------------------------------------------------------------
-- 085d. apply_fast_sunday no longer touches assignments
-- ---------------------------------------------------------------------------
-- The body is 023's with the revert removed, and the result no longer reports
-- `assignments_reverted` (nothing read it). Cancelling the talks on a Sunday that becomes Fast
-- Sunday is done by lib/calendar/queries.ts BEFORE this runs, where it can warn, record history and
-- tell whoever asked the speakers — none of which a SQL function can do.
create or replace function apply_fast_sunday(
  p_ward_id        uuid,
  p_month_start    date,
  p_fast_sunday_id uuid
) returns jsonb
  language plpgsql
  set search_path = public, pg_temp
as $$
declare
  cleared_ids   uuid[] := array[]::uuid[];
  default_slots integer;
begin
  -- Regex-guarded rather than a bare ::integer cast: a cast of "three" raises, and a malformed
  -- setting must degrade to the fallback instead of failing the edit. 15 is the same ceiling
  -- MAX_SPEAKING_SLOTS enforces in lib/validation/calendar.ts.
  select case
           when ward.settings ->> 'default_speaking_slots' ~ '^[0-9]+$'
             then (ward.settings ->> 'default_speaking_slots')::integer
           else 3
         end
    into default_slots
  from wards ward
  where ward.id = p_ward_id;

  -- null when the ward row is absent or hidden by RLS.
  default_slots := coalesce(default_slots, 3);
  if default_slots < 1 or default_slots > 15 then
    default_slots := 3;
  end if;

  -- A pinned Sunday is never cleared. The pin outranks the rule until a human removes it.
  with cleared as (
    update sundays
    set type = 'standard',
        speaking_slots = default_slots
    where sundays.ward_id = p_ward_id
      and sundays.date >= p_month_start
      and sundays.date < (p_month_start + interval '1 month')
      and sundays.type = 'fast_sunday'
      and sundays.fast_sunday_pinned = false
      and sundays.id is distinct from p_fast_sunday_id
    returning sundays.id
  )
  select coalesce(array_agg(cleared.id), array[]::uuid[]) into cleared_ids from cleared;

  -- null means "every Sunday this month is displaced" — the clear above still stands.
  if p_fast_sunday_id is not null then
    update sundays
    set type = 'fast_sunday',
        speaking_slots = 0
    where sundays.ward_id = p_ward_id
      and sundays.id = p_fast_sunday_id;
  end if;

  -- snake_case keys, matching apply_roster_import. lib/calendar/queries.ts maps them to
  -- camelCase in one place, exactly like every column in this codebase (CLAUDE.md §6).
  return jsonb_build_object(
    'cleared', to_jsonb(cleared_ids),
    'applied', p_fast_sunday_id
  );
end;
$$;

comment on function apply_fast_sunday(uuid, date, uuid) is
  'Moves Fast Sunday within one month in a single transaction. SECURITY INVOKER, so RLS still '
  'governs every write. Restores the ward default speaking slots on the Sunday it clears. Since '
  'migration 085 it never touches assignments: lib/calendar/queries.ts cancels the talks first.';
