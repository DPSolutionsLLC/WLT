-- Phase 3A, migration 023: the Sunday calendar's pin column, rotation versioning, and the
-- atomic fast-Sunday apply.
--
--   Part 1  sundays.fast_sunday_pinned
--   Part 2  conducting_rotation versioning constraints
--   Part 3  apply_fast_sunday(), the single-transaction re-resolution calendar-a calls


-- ============================================================================
-- Part 1 — the pin column
-- ============================================================================
--
-- `type` alone cannot record a manual override. Generation itself writes
-- type = 'fast_sunday' on whichever Sunday the rule chose, so reading "this row is typed
-- fast_sunday" as "a human pinned it" would make EVERY month read as pinned and the
-- resolution rule would never move Fast Sunday again.
--
-- This column is the only thing that distinguishes "the rule chose this" from "the bishopric
-- chose this". A pinned Sunday survives re-resolution; an unpinned one does not.

alter table sundays
  add column fast_sunday_pinned boolean not null default false;

comment on column sundays.fast_sunday_pinned is
  'True when a human pinned Fast Sunday to this date. Survives re-resolution; type alone cannot encode this because generation writes type = fast_sunday itself.';


-- ============================================================================
-- Part 2 — rotation versioning
-- ============================================================================
--
-- conducting_rotation allowed effective_from to be null and had no uniqueness, so the same
-- position could exist twice for the same date with nothing to say which one wins.
--
-- A rotation change INSERTS a new set of three rows at a new effective_from; it never updates
-- the old set. That is what makes "a rotation change applies forward only" true by
-- construction rather than by everyone remembering to. The unique constraint is what stops a
-- second set landing on a date that already has one.
--
-- Safe to apply unconditionally: nothing is seeded into this table and no phase has written
-- to it, so it is empty.

alter table conducting_rotation
  alter column effective_from set not null,
  add constraint conducting_rotation_ward_position_effective_key
    unique (ward_id, position, effective_from);


-- ============================================================================
-- Part 3 — apply_fast_sunday
-- ============================================================================
--
-- Clearing the old Fast Sunday and setting the new one must not be observable half-done: a
-- month with two fast Sundays, or with none, is worse than a refused change.
-- @supabase/supabase-js has no transaction API, so the established answer in this repo
-- (apply_roster_import, migration 022) is a plpgsql function — one statement, one implicit
-- transaction.
--
-- SECURITY INVOKER — the default, and required. RLS must still apply to every write inside
-- this function (CLAUDE.md rule 2). Do NOT add SECURITY DEFINER: it would turn calendar
-- edits into a hole straight through the ward boundary.
--
-- The RULE that decides WHICH Sunday is fast stays in TypeScript
-- (lib/calendar/resolveFastSunday.ts). This function is handed an id and applies it. Putting
-- the rule in plpgsql too would put it in two languages, which is the exact drift
-- buildImportPreview.ts was written to avoid (plans/retros/roster-c-csv-import.md).
--
-- Step 1 restores the WARD'S default speaking slots on a Sunday that stops being fast, read from
-- wards.settings ->> 'default_speaking_slots' and falling back to 3. The default is a ward setting
-- the bishopric edits in the app, not a constant — a ward that runs 5 speakers must not have this
-- function drag every un-fasted Sunday back to 3.
--
-- The read is defensive on purpose, mirroring mergeRoleAccess() in lib/auth/permissions.ts: a
-- missing, non-numeric or out-of-range value falls back to 3 rather than failing the write. A
-- malformed setting must not be able to break a calendar edit.
--
-- This still DISCARDS a hand-set value on a Sunday that became fast and then unfast — a Sunday set
-- to 15 by hand comes back as the ward default. 03-calendar.md Step 2 states the restore
-- explicitly and records that loss as a known future update.
--
-- There is deliberately NO unique index enforcing one fast_sunday per month. Clearing and
-- setting are separate statements everywhere except inside this function, so such an index
-- would reject legitimate intermediate states.
create function apply_fast_sunday(
  p_ward_id        uuid,
  p_month_start    date,
  p_fast_sunday_id uuid
) returns jsonb
  language plpgsql
  set search_path = public, pg_temp
as $$
declare
  cleared_ids          uuid[] := array[]::uuid[];
  assignments_reverted integer := 0;
  default_slots        integer;
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

    -- Reverted to 'plan', NEVER deleted. A Sunday with zero speaking slots has no room for a
    -- speaker, but the planning work behind that assignment is somebody's and deleting it
    -- destroys it (03-calendar.md §Pitfall 5).
    with reverted as (
      update assignments
      set pipeline_stage = 'plan'
      where assignments.ward_id = p_ward_id
        and assignments.sunday_id = p_fast_sunday_id
        and assignments.pipeline_stage <> 'plan'
      returning assignments.id
    )
    select count(*)::integer into assignments_reverted from reverted;
  end if;

  -- snake_case keys, matching apply_roster_import. lib/calendar/queries.ts maps them to
  -- camelCase in one place, exactly like every column in this codebase (CLAUDE.md §6).
  return jsonb_build_object(
    'cleared', to_jsonb(cleared_ids),
    'applied', p_fast_sunday_id,
    'assignments_reverted', assignments_reverted
  );
end;
$$;

comment on function apply_fast_sunday(uuid, date, uuid) is
  'Moves Fast Sunday within one month in a single transaction. SECURITY INVOKER, so RLS still governs every write. Restores the ward default speaking slots on the Sunday it clears, and reverts assignments on the new Fast Sunday to stage plan; never deletes one.';

-- PUBLIC gets EXECUTE on a new function by default. Revoke first, then grant deliberately.
-- service_role is included because the test suite and the seed harness call this with the
-- service client; revoking PUBLIC would otherwise take that away too.
revoke all on function apply_fast_sunday(uuid, date, uuid) from public;
grant execute on function apply_fast_sunday(uuid, date, uuid) to authenticated;
grant execute on function apply_fast_sunday(uuid, date, uuid) to service_role;
