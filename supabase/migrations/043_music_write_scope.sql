-- Program E, migration 043: narrow who may WRITE a hymn selection or a musical number.
--
-- ---------------------------------------------------------------------------
-- WHY THIS DEVIATES FROM MIGRATION 019'S LOOP, ON PURPOSE
-- ---------------------------------------------------------------------------
-- `hymn_selections` and `musical_numbers` sit in 019's ward-scoped policy loop, which grants
-- every authenticated member of the ward all four verbs. That made the route's assertCan() the
-- only write boundary — exactly the shape CLAUDE.md rule 2 says not to rely on: a route that
-- forgets a check must still be safe because the policy blocked it.
--
-- This follows migration 037 for `programs` exactly, and calendar-c's precedent that the first
-- org-scoped write boundary belonged in RLS rather than only in the route.
--
-- SELECT STAYS WARD-WIDE. What the ward is singing on Sunday is read aloud from the pulpit and
-- printed on the programme; there is nothing private in it, and the program builder, the PDF
-- renderer and the public page all read these rows. WRITE is the boundary that was missing, and
-- it is the only one this migration changes.
--
-- ---------------------------------------------------------------------------
-- WHY THE ROLES ARE LITERALS HERE
-- ---------------------------------------------------------------------------
-- RLS cannot read a ward's `wards.settings.role_access` override, so these four roles are named
-- directly rather than resolved through it. The policy is therefore the CODE default, and a ward
-- that has removed music.manage from its secretary is honoured by assertCan() in the route rather
-- than here.
--
-- The two together are strictly narrower than either alone — a caller must satisfy BOTH the
-- policy and the ward's own configuration — which is the correct direction for a boundary to be
-- wrong in. A ward that ADDS music.manage to another role gets a route that permits it and a
-- policy that refuses it; that is a deliberate trade, and widening this policy to match would
-- mean trusting a jsonb blob from inside RLS.
--
-- ---------------------------------------------------------------------------
-- WHY ward_secretary IS ON THE LIST AND org_president IS NOT
-- ---------------------------------------------------------------------------
-- The secretary builds the programme and has to be able to type in a hymn the coordinator has not
-- got to yet — lib/auth/permissions.ts grants them music.view for exactly that reason, and
-- MeetingOrderForm's hymn fields are theirs. An organization president has no part in sacrament
-- meeting music at all.
--
-- bishop and counselor are both named, never bishop alone. Bishopric admin authority is shared
-- and a check that gives the bishop something a counselor lacks is a bug (CLAUDE.md §7).

drop policy hymn_selections_ward_insert on hymn_selections;
drop policy hymn_selections_ward_update on hymn_selections;
drop policy hymn_selections_ward_delete on hymn_selections;

create policy hymn_selections_music_insert on hymn_selections for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'music_coordinator', 'ward_secretary')
  );

create policy hymn_selections_music_update on hymn_selections for update to authenticated
  using (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'music_coordinator', 'ward_secretary')
  )
  with check (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'music_coordinator', 'ward_secretary')
  );

create policy hymn_selections_music_delete on hymn_selections for delete to authenticated
  using (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'music_coordinator', 'ward_secretary')
  );

drop policy musical_numbers_ward_insert on musical_numbers;
drop policy musical_numbers_ward_update on musical_numbers;
drop policy musical_numbers_ward_delete on musical_numbers;

create policy musical_numbers_music_insert on musical_numbers for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'music_coordinator', 'ward_secretary')
  );

create policy musical_numbers_music_update on musical_numbers for update to authenticated
  using (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'music_coordinator', 'ward_secretary')
  )
  with check (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'music_coordinator', 'ward_secretary')
  );

create policy musical_numbers_music_delete on musical_numbers for delete to authenticated
  using (
    ward_id = current_ward_id()
    and current_user_role() in ('bishop', 'counselor', 'music_coordinator', 'ward_secretary')
  );

comment on table hymn_selections is
  'Which hymn is sung in which slot on a Sunday. SELECT is ward-wide (migration 019);
   INSERT/UPDATE/DELETE are narrowed to bishop, counselor, music_coordinator and ward_secretary by
   migration 043, deviating from 019''s loop on purpose. hymn_title is DENORMALISED beside
   hymn_number so a program approved before the hymns table changed keeps printing the title it
   was approved with. ai_suggested records whether the choice began as an AI suggestion and is
   written only by POST /api/hymns/select.';

comment on table musical_numbers is
  'One musical number per Sunday. SELECT is ward-wide (migration 019); INSERT/UPDATE/DELETE are
   narrowed by migration 043 exactly as hymn_selections is. `performer` is FREE TEXT and never a
   member id — a visiting quartet and "the Primary children" are both normal answers.';
