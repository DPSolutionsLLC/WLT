-- ITER-044, migration 092: RELEASE THE SACRAMENT TILE ON ITS OWN.
--
-- Migration 091's `sacrament` module owned five dashboard tiles: Sacrament, Topic history,
-- Program, Music and Calendar. It is split so `sacrament` releases the Sacrament tile alone, and
-- `topic_history`, `program`, `music` and `calendar` are separate entries on the list
-- (lib/access/releasedModules.ts). The never-built `speakers` placeholder (ITER-042, cancelled)
-- comes off the list.
--
-- ---------------------------------------------------------------------------
-- SAVED LISTS ARE NOT WIDENED
-- ---------------------------------------------------------------------------
-- A ward whose list holds `sacrament` now has the Sacrament tile alone, which is the state
-- Buffalo is meant to be in. Only `speakers` is removed. A ward with no row (everything released)
-- is unchanged. `updated_by` and `updated_at` are left alone: this is a catalog cleanup, not a
-- super admin's decision, and no audit row is written for a migration.
--
-- ---------------------------------------------------------------------------
-- THE MUSIC TABLES BECOME SHARED
-- ---------------------------------------------------------------------------
-- hymn_selections, musical_numbers and sunday_music are read and written by Sacrament (the hub,
-- cancelling a lost meeting's music, the conductor reconcile) and by Program (gathering the
-- programme, its "Music not approved yet" line) as well as by Music. 091's own rule is that a
-- table read by more than one module stays unrestricted: refused with Music, Sacrament's
-- cancellation of a lost meeting's hymns would be a silent zero-row UPDATE. Music is still refused
-- through can() and the bounce, because every music page and route gates on `music.*`.
--
-- ---------------------------------------------------------------------------
-- PROGRAM AND CALENDAR KEEP THEIR OWN TABLES
-- ---------------------------------------------------------------------------
-- `programs` is read only by lib/program/queries.ts. conducting_rotation and
-- sunday_org_conducting are read only by lib/calendar/queries.ts, from the calendar pages, the
-- rotation and org-conducting routes, and generation and the Sunday editor, which run only under
-- `calendar.manage`. Their policies are re-keyed in 091's exact shape.

update ward_release_settings
   set released_modules = array_remove(released_modules, 'speakers')
 where 'speakers' = any (released_modules);

drop policy hymn_selections_module_released on hymn_selections;
drop policy musical_numbers_module_released on musical_numbers;
drop policy sunday_music_module_released on sunday_music;

drop policy programs_module_released on programs;
create policy programs_module_released on programs as restrictive for all to authenticated
  using ((select ward_module_released('program')))
  with check ((select ward_module_released('program')));

drop policy conducting_rotation_module_released on conducting_rotation;
create policy conducting_rotation_module_released on conducting_rotation
  as restrictive for all to authenticated
  using ((select ward_module_released('calendar')))
  with check ((select ward_module_released('calendar')));

drop policy sunday_org_conducting_module_released on sunday_org_conducting;
create policy sunday_org_conducting_module_released on sunday_org_conducting
  as restrictive for all to authenticated
  using ((select ward_module_released('calendar')))
  with check ((select ward_module_released('calendar')));

-- ---------------------------------------------------------------------------
-- DELIBERATELY NOT RESTRICTED after this, in addition to 091's list:
-- ---------------------------------------------------------------------------
--   hymn_selections, musical_numbers,
--   sunday_music                             Sacrament, Program and Music all read and write them
--   (Topic history owns no table: it reads `assignments`, which stay Sacrament's.)
