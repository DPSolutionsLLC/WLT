-- P4 Sacrament, Topics screen rebuild slice t3, migration 087: DELETE ON A TALK CANCELS IT AND
-- SHIFTS THE REST UP.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. ADDITIVE: one new function that nothing in the
-- running build calls. No entry belongs in HELD_BACK_UNTIL_DEPLOYED.
--
-- ---------------------------------------------------------------------------
-- THE DECISION (plans/sacrament-topics-screen-rebuild.md, user decision 2, 2026-09-29)
-- ---------------------------------------------------------------------------
-- Delete on a talk does NOT delete it. The talk is CANCELLED and kept as a record, exactly as
-- migration 085 cancels a Sunday's lost work (reason `slot_removed`), every later talk moves up one
-- slot, and the Sunday has one fewer speaker. Telling people is not done here: the save-time
-- reconcile (lib/sacrament/conductorHandover.ts) writes the speaker's `cancelled` history row and
-- the asker's "Let ___ know it's cancelled" to-do, the same as for any cancelled talk.
--
-- ONE TRANSACTION, because the three writes only make sense together: a talk cancelled with the
-- rest not shifted leaves a hole, and a count lowered with nothing cancelled drops the last talk
-- off the end.
--
-- SECURITY INVOKER. Every write runs under the caller's own policies, so RLS stays the boundary
-- (CLAUDE.md rule 2); the route additionally requires `talks.plan` and `calendar.manage`.
--
-- The day's shape changed, so the Sunday's "topics are decided" and "references are finalized"
-- stamps are cleared — what lib/topics/finalize.ts's clearTalkShapeStamps() clears. A references
-- SKIP survives, as it does there.
--
-- There is no unique index on (sunday_id, slot_number), so the shift needs no temporary offset.
--
-- The three refusals raise with a fixed MESSAGE KEY, which lib/assignments/removeTalk.ts maps to a
-- sentence. The keys are part of that contract; change them together.
--
-- It writes no user id, so CLAUDE.md §7's findUsersOutsideWard() check has nothing to check.

create or replace function remove_talk(p_assignment_id uuid)
  returns jsonb
  language plpgsql
  security invoker
  set search_path = public, pg_temp
as $$
declare
  talk          assignments%rowtype;
  slots         integer;
  shifted_count integer;
begin
  select *
    into talk
    from assignments
   where id = p_assignment_id
     and ward_id = current_ward_id()
     for update;

  if not found then
    raise exception 'remove_talk:not_found';
  end if;

  if talk.cancelled_at is not null then
    raise exception 'remove_talk:already_cancelled';
  end if;

  select speaking_slots
    into slots
    from sundays
   where id = talk.sunday_id
     and ward_id = talk.ward_id
     for update;

  if not found then
    raise exception 'remove_talk:not_found';
  end if;

  -- A talk OUTSIDE the Sunday's slots (no slot, or past the count) holds no slot to give up: it is
  -- already off. Removing it cancels it and changes nothing else.
  if talk.slot_number is null or talk.slot_number > slots then
    update assignments
       set cancelled_at = now(),
           cancelled_reason = 'slot_removed'
     where id = talk.id;

    return jsonb_build_object(
      'sunday_id', talk.sunday_id,
      'slot_number', talk.slot_number,
      'shifted_count', 0
    );
  end if;

  if slots <= 1 then
    raise exception 'remove_talk:last_talk';
  end if;

  update assignments
     set cancelled_at = now(),
         cancelled_reason = 'slot_removed'
   where id = talk.id;

  update assignments
     set slot_number = slot_number - 1
   where sunday_id = talk.sunday_id
     and ward_id = talk.ward_id
     and cancelled_at is null
     and slot_number > talk.slot_number;

  get diagnostics shifted_count = row_count;

  update sundays
     set speaking_slots = speaking_slots - 1,
         topics_finalized_at = null,
         references_finalized_at = null
   where id = talk.sunday_id
     and ward_id = talk.ward_id;

  return jsonb_build_object(
    'sunday_id', talk.sunday_id,
    'slot_number', talk.slot_number,
    'shifted_count', shifted_count
  );
end;
$$;

comment on function remove_talk(uuid) is
  'Cancels one talk (reason slot_removed), moves every later talk up one slot and lowers the '
  'Sunday''s speaking_slots by one, in one transaction (migration 087).';

revoke all on function remove_talk(uuid) from public;
grant execute on function remove_talk(uuid) to authenticated;
grant execute on function remove_talk(uuid) to service_role;
