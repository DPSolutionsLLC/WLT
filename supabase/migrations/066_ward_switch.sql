-- Phase 2 slice proto-c, migration 066: THE AUTHORIZED WARD SWITCH.
--
-- THE DANGEROUS ONE. Everything in this file can silently widen access.
--
-- ---------------------------------------------------------------------------
-- THE PROOF THAT 131 POLICIES DID NOT MOVE
-- ---------------------------------------------------------------------------
-- This migration changes FOUR helper function bodies, adds THREE functions, and replaces TWO
-- policies on `users`. IT CHANGES NO OTHER POLICY. That is the whole design: a stake officer
-- does not reach another ward through a cross-ward predicate, they reach it through an
-- AUTHORIZED SWITCH, after which every policy that already says `ward_id = current_ward_id()` is
-- already correct for the ward they are now in. The risk concentrates into this file and one
-- guarded column instead of spreading across every table in the schema.
--
-- APPLIES IMMEDIATELY. The replaced current_ward_id() returns the old answer for every user,
-- because no user has an active_ward_id yet (migration 065 only added the column). So there is
-- NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts, and none should be added.
--
-- Structure:
--   066a  unit_ancestor_ids() and can_act_in_ward()
--   066b  current_ward_id(), acting_in_home_ward(), current_org_id(), is_bishopric()
--   066c  users_ward_select — let the switcher read their own row
--   066d  the column GRANT, and the WITH CHECK that guards it
--   066e  session_context()
--   066f  switchable_wards()


-- ============================================================================
-- 066a — the ancestor walk and the authorization test
-- ============================================================================

-- THE `depth < 10` GUARD IS NOT DECORATION. units.parent_id is a self-reference with no
-- constraint preventing a cycle, and an unguarded recursive CTE inside a policy helper is an
-- infinite loop inside EVERY QUERY ON THE SYSTEM. Ten is far above any real church structure.
-- tests/lib/unitAncestors.test.ts builds a deliberate cycle and proves this terminates.
--
-- Returns the unit AND its ancestors, so a stake officer assigned over the stake matches a ward
-- whose unit's parent is that stake, and an area officer would match through the stake — the
-- generic shape working without an area screen existing.
--
-- NOT security definer: it reads `units` only, is called from within definer functions that have
-- already bypassed RLS, and a definer function is a privilege boundary that should not be opened
-- where nothing needs it.
create function unit_ancestor_ids(target_unit uuid)
  returns setof uuid
  language sql
  stable
as $$
  with recursive chain (id, parent_id, depth) as (
    select id, parent_id, 0 from units where id = target_unit
    union all
    select u.id, u.parent_id, c.depth + 1
      from units u
      join chain c on u.id = c.parent_id
     where c.depth < 10
  )
  select id from chain;
$$;

-- MAY THIS PERSON ACT IN THIS WARD? The single authorization question of the whole phase.
--
-- EVERY ARM REQUIRES users.is_active. A deactivated officer loses the switch on their next
-- request, which is the same place lib/auth/session.ts already enforces deactivation.
--
-- The FIRST arm — "this is already your own ward" — is what makes setting active_ward_id to your
-- own ward a harmless no-op rather than a refusal.
--
-- A WARD WITH `unit_id is null` MATCHES NOTHING. Fail-closed, by construction: the ancestor walk
-- starts from null and returns no rows, so every ward created before proto-d's Stakes & Wards
-- screen is unreachable by a switch until somebody deliberately places it under a unit.
create function can_act_in_ward(target_user uuid, target_ward uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from users u
    where u.id = target_user
      and u.is_active
      and u.ward_id = target_ward
  ) or exists (
    select 1
    from unit_assignments ua
    join users u on u.id = ua.user_id
    where ua.user_id = target_user
      and u.is_active
      and (
        ua.role = 'super_admin'
        or ua.unit_id in (
          select unit_ancestor_ids((select unit_id from wards where id = target_ward))
        )
      )
  );
$$;


-- ============================================================================
-- 066b — rewrite three functions, add one
-- ============================================================================

-- RE-VALIDATES ON EVERY READ, AND THAT IS THE POINT. plans/P2-unit-hierarchy.md writes this as a
-- plain `coalesce(active_ward_id, ward_id)`, which authorizes the switch ONCE, AT WRITE TIME,
-- FOREVER: release a stake president and their session keeps reading ward B until somebody
-- remembers to null the column. DO NOT SIMPLIFY THIS TO A COALESCE. That is the difference
-- between "released on Sunday" and "still reading ward B in March".
--
-- It is STABLE, so Postgres evaluates it once per statement rather than once per row. Revocation
-- being immediate therefore costs one extra lookup per statement, not per row.
create or replace function current_ward_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select case
           when u.active_ward_id is not null
                and can_act_in_ward(u.id, u.active_ward_id)
             then u.active_ward_id
           else u.ward_id
         end
    from users u
   where u.id = auth.uid();
$$;

-- ONE MECHANISM, NOT TWO. current_org_id() and is_bishopric() below both key off THIS, never off
-- `active_ward_id is not null` — so if current_ward_id() falls back because authorization was
-- revoked, the organization and the bishopric flag fall back WITH it, automatically and in step.
-- Writing `active_ward_id is not null` in three places is three chances for one to drift.
create function acting_in_home_ward()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(
    (select ward_id from users where id = auth.uid()) = current_ward_id(),
    false
  );
$$;

-- THE SUBTLE ONE. A stake president switched into a ward has no organization IN THAT WARD, and
-- their own users.org_id points at a row in a DIFFERENT WARD ENTIRELY. Returning it would make
-- household_stewardships, visit_goals, activity_logs and youth_activity_profiles match rows they
-- have no business seeing — a cross-ward org leak arriving through a column nobody changed.
-- NULL IS THE CORRECT ANSWER, and tests/rls/unit-switching.test.ts asserts it directly.
create or replace function current_org_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select case when acting_in_home_ward() then org_id else null end
    from users
   where id = auth.uid();
$$;

-- Keeps migration 019's shape and its comment: bishopric admin authority is SHARED (CLAUDE.md
-- §7) and there is deliberately no function granting the bishop something a counselor lacks — do
-- not add one. The only change is that a bishop ACTING AWAY FROM HOME is not a bishopric member
-- there. Their own ward is untouched the moment they switch back.
create or replace function is_bishopric()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(current_user_role() in ('bishop', 'counselor'), false)
         and acting_in_home_ward();
$$;

-- current_user_role() IS DELIBERATELY NOT CHANGED. A stake president's role is 'stake_president'
-- in every ward; THE ROLE TRAVELS WITH THE PERSON, ONLY THE WARD CHANGES.


-- ============================================================================
-- 066c — let the switcher read their own row
-- ============================================================================
--
-- THE SWITCH WOULD OTHERWISE SIGN THE SWITCHER OUT, and nothing about that failure looks like a
-- permissions problem. Migration 020's policy is `ward_id = current_ward_id()`. After a switch a
-- visiting officer's own users.ward_id is still their HOME ward, so that predicate no longer
-- matches THEIR OWN ROW — and lib/auth/session.ts reads exactly that row by id to resolve the
-- session, gets nothing, treats it as a half-created account, and redirects to /login.

drop policy users_ward_select on users;

-- `or id = auth.uid()` is LOAD-BEARING, not defensive. See above. It also discloses nothing new:
-- a user could already read their own row under the old predicate whenever they were at home.
create policy users_ward_select on users
  for select to authenticated
  using (ward_id = current_ward_id() or id = auth.uid());


-- ============================================================================
-- 066d — open the column, then guard it
-- ============================================================================
--
-- A POLICY ALONE CANNOT OPEN THE SWITCH. Migration 022 Part 3 did `revoke update on users from
-- authenticated` and granted back exactly `theme_preference`, and COLUMN PRIVILEGES ARE CHECKED
-- BEFORE POLICIES — so without an explicit grant, `active_ward_id` fails with "permission denied
-- for column", which is a confusing error a long way from its cause.
--
-- Migration 022's header named theme_preference as "the complete set of what an authenticated
-- session updates today" and said a future page must widen the grant DELIBERATELY. THIS IS THAT
-- DELIBERATE WIDENING, and it is by exactly one column: `first_name` and `last_name` are STILL
-- NOT GRANTED, and a future profile-edit page still has to widen this again on purpose.
-- tests/rls/users-column-grant.test.ts pins both halves of that.
--
-- The moment this grant exists, every authenticated session may ATTEMPT the write and the WITH
-- CHECK arm below is the entire security boundary. That is still CLAUDE.md rule 2 — the route is
-- not the boundary — but it means the predicate must be airtight.

grant update (active_ward_id) on users to authenticated;

drop policy users_update_self on users;

-- THE `using` AND `with check` ARMS DIFFER, AND ANY TYPESCRIPT MIRROR OF THIS POLICY MUST COPY
-- BOTH (defect 060-D2). `using` admits your own row; `with check` decides what the row may
-- BECOME. A row that passes `using` and fails `with check` RAISES — SQLSTATE 42501 — where
-- almost every other refusal in this codebase returns a zero-row success, so a caller built for
-- the quiet shape reports a 500 reading "Please try again", which is untrue.
-- lib/units/wardSwitch.ts maps 42501 onto a typed refusal for exactly this reason.
--
-- `active_ward_id is null` IS ALWAYS ALLOWED: CLEARING THE SWITCH CAN NEVER NEED AUTHORIZATION.
-- An officer who has just been released must still be able to get back to their own ward.
create policy users_update_self on users
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (active_ward_id is null or can_act_in_ward(auth.uid(), active_ward_id))
  );


-- ============================================================================
-- 066e — session_context()
-- ============================================================================
--
-- THE APPLICATION MUST NOT RECOMPUTE THE EFFECTIVE WARD. If TypeScript does
-- `activeWardId ?? wardId` while the database RE-VALIDATES and falls back, the app and RLS
-- disagree about which ward the user is in: the app renders ward B's page frame around ward A's
-- rows, and every audit row is filed under the wrong ward. ONE ROUND TRIP, ONE ANSWER, BOTH
-- SIDES AGREE — and getSessionUser is already wrapped in cache(), so it costs one query per
-- request.
--
-- lib/auth/session.ts treats an error from this RPC the way it treats a failed `users` read:
-- THROW WITH CONTEXT, never fall back to data.ward_id. A silent fall back is the app and RLS
-- disagreeing, which is the one failure this whole design exists to prevent (CLAUDE.md rule 7).
create function session_context()
  returns table (
    ward_id             uuid,
    home_ward_id        uuid,
    active_ward_id      uuid,
    org_id              uuid,
    is_bishopric        boolean,
    acting_in_home_ward boolean
  )
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select current_ward_id(),
         u.ward_id,
         u.active_ward_id,
         current_org_id(),
         is_bishopric(),
         acting_in_home_ward()
    from users u
   where u.id = auth.uid();
$$;

-- PUBLIC gets EXECUTE on a new function by default. Revoke first, then grant deliberately —
-- migration 022 Part 2's precedent. service_role is included because the test suite calls it.
revoke all on function session_context() from public;
grant execute on function session_context() to authenticated;
grant execute on function session_context() to service_role;


-- ============================================================================
-- 066f — switchable_wards()
-- ============================================================================
--
-- THE PICKER CANNOT BE BUILT FROM THE CALLER'S OWN READS, AND THAT IS NOT AN OVERSIGHT IN THE
-- POLICIES — IT IS THE DESIGN WORKING.
--
-- `wards_select` (migration 019) is `id = current_ward_id()`, so a stake president sitting in
-- their home ward can read exactly ONE ward row: their own. `units_select` (065f) admits their
-- own ward's unit and the units they are ASSIGNED over — the stake — but not the stake's other
-- CHILDREN. So a list of "wards I may switch into", assembled from ordinary reads, contains only
-- the ward they are already in. The control would never offer ward B and the switch would be
-- undiscoverable.
--
-- THE FIX IS NOT TO WIDEN `wards_select`. That policy is one of the 131 this phase exists to
-- leave alone, and widening a ward's own readability to every stake officer is a far larger
-- promise than "you may switch into this ward" — it would put ward B's `settings`, including its
-- role_access overrides, in front of a reader who has not switched.
--
-- So the list is computed by a definer function that answers exactly one question and returns
-- exactly three columns. It is safe for the same three reasons migration 060b's
-- `activity_profile_followup_count` is, and all three must stay true:
--   * it returns a NAME AND AN ID, never a `settings` blob, a member or any ward content;
--   * it is used only to POPULATE A PICKER and to refuse — it grants nothing;
--   * every row it returns is one `can_act_in_ward()` already authorizes, so it discloses no
--     ward the caller could not reach by switching anyway.
--
-- It must also be UNIFORMLY EVALUABLE (056c's rule): "which wards may I act in" is a fact about
-- the CALLER, and computing it through reads that are themselves ward-scoped would make the
-- answer depend on where the caller happens to be standing — so switching into ward B would drop
-- ward A off the list and strand them there.
--
-- IT INCLUDES THE CALLER'S HOME WARD, via can_act_in_ward()'s first arm. That is what the "switch
-- back" control uses, and it is load-bearing: after a switch, `wards_select` matches ward B only,
-- so the home ward is no longer readable through any ordinary query.
create function switchable_wards()
  returns table (ward_id uuid, name text, unit_id uuid)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select w.id, w.name, w.unit_id
    from wards w
   where can_act_in_ward(auth.uid(), w.id)
   order by w.name;
$$;

-- PUBLIC gets EXECUTE on a new function by default. Revoke first, then grant deliberately.
revoke all on function switchable_wards() from public;
grant execute on function switchable_wards() to authenticated;
grant execute on function switchable_wards() to service_role;
