-- Phase 2, migration 070: THE SESSION RESOLVES FROM A CALLING.
--
-- THE DANGEROUS ONE. Everything in this file can silently widen or narrow access.
--
-- ---------------------------------------------------------------------------
-- THE PROOF THAT 131 POLICIES STILL DO NOT MOVE
-- ---------------------------------------------------------------------------
-- Every policy in this schema reads one of four helpers: current_ward_id(), current_user_role(),
-- current_org_id() and is_bishopric(). Pointing those four at the person's ACTIVE CALLING instead
-- of at their `users` row leaves every policy correct and unchanged. That is the whole design,
-- and it is why this file rewrites five function bodies, replaces one policy on `users`, and
-- touches nothing else.
--
-- APPLIES IMMEDIATELY AND IS A NO-OP. Migration 068's backfill is 1:1 and exact — every existing
-- `users` row is exactly one calling with the same role, the same organization and the same
-- counselor position — so each function below returns the identical answer it returns today for
-- every person in the app. No entry in HELD_BACK_UNTIL_DEPLOYED, and none should be added.
--
-- ---------------------------------------------------------------------------
-- WHAT MIGRATION 066 GOT BACKWARDS, AND IS CORRECTED HERE
-- ---------------------------------------------------------------------------
-- 066 built a VISITING OFFICER and reasoned that "the role travels with the person, only the ward
-- changes". That is exactly backwards: the role belongs to the CALLING IN THAT WARD. Three
-- consequences, all reversed below:
--
--   * current_user_role() was deliberately NOT changed. It is changed here.
--   * current_org_id() returned NULL across a switch. It now returns the person's real
--     organization IN THE WARD THEY ARE ACTING IN.
--   * is_bishopric() keyed off acting_in_home_ward(). It now simply asks the active calling's
--     role, and acting_in_home_ward() is DROPPED rather than left inert — the whole
--     visiting-officer apparatus was compensating for a role that did not follow the ward.
--
-- Structure:
--   070a  can_act_in_ward() — "do you hold a calling there"
--   070b  current_ward_id(), current_user_role(), current_org_id(), is_bishopric()
--   070c  drop acting_in_home_ward()
--   070d  users_ward_select — a ward can see the leaders who hold callings in it
--   070e  session_context()


-- ============================================================================
-- 070a — the authorization question, answered by a calling
-- ============================================================================
--
-- MUCH SIMPLER AND MUCH STRONGER than 066's version. Not "is a stake officer somewhere above this
-- ward in the hierarchy" but "DO YOU HOLD AN ACTIVE CALLING THERE".
--
-- THE unit_assignments ARM IS DELIBERATELY REMOVED, both of them:
--
--   * A STAKE OFFICER REACHES NOTHING (CLAUDE.md §7). STAKE_OFFICER_PERMISSIONS is empty and this
--     plan does not widen it. The surface a stake leader is eventually meant to get is narrow and
--     purpose-built — a read-only view of the ONE meeting they are attending, plus that meeting's
--     prayer roll — and it is not expressible as a ward switch.
--   * A SUPER ADMIN'S REACH IS proto-d's TO DECIDE, with its own screen and its own written rule.
--     Leaving the arm here would grant it by inheritance, quietly, in a migration about something
--     else.
--
-- users.is_active IS STILL CHECKED, on top of the calling's own is_active. They are two different
-- facts — "this calling is current" and "this account may be used" — and a calling on a
-- deactivated account must not authorize anything. lib/auth/session.ts enforces the same thing on
-- the next request; this is it enforced again where RLS can see it.
--
-- THE FIRST ARM OF 066'S VERSION — "this is already your own ward" — IS GONE, and it is not
-- missed: everybody holds a calling in their own ward (068's backfill), so their home ward
-- matches through the ordinary predicate. A `users` row with no calling at all reaches nothing,
-- which is the correct fail-closed answer for a row that should not exist.
create or replace function can_act_in_ward(target_user uuid, target_ward uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from ward_role_assignments a
    join users u on u.id = a.user_id
    where a.user_id = target_user
      and a.ward_id = target_ward
      and a.is_active
      and u.is_active
  );
$$;


-- ============================================================================
-- 070b — the four helpers every policy reads
-- ============================================================================

-- RE-VALIDATES ON EVERY READ, AND THAT IS THE POINT. Carried forward from 066b unchanged, because
-- it was right there and is right here. plans/P2-unit-hierarchy.md writes this as a plain
-- `coalesce(active_ward_id, ward_id)`, which authorizes the switch ONCE, AT WRITE TIME, FOREVER:
-- release somebody from their second calling and their session keeps reading ward B until
-- somebody remembers to null the column. DO NOT SIMPLIFY THIS TO A COALESCE. That is the
-- difference between "released on Sunday" and "still reading ward B in March".
--
-- It is STABLE, so Postgres evaluates it once per statement rather than once per row.
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

-- THE REVERSAL. 066's header said "the role travels with the person, only the ward changes"; the
-- role belongs to the calling. Somebody who is Relief Society president in ward A and ward
-- secretary in ward B is an org_president here and a ward_secretary there, and every policy
-- reading current_user_role() is already correct for both without moving.
--
-- ONE MECHANISM, NOT TWO: it keys off current_ward_id(), never off `active_ward_id is not null`.
-- So when current_ward_id() falls back because a calling was ended, the role falls back WITH it,
-- automatically and in step.
--
-- NULL IS POSSIBLE and is the fail-closed answer: a `users` row with no active calling in the
-- ward it resolves to has no role, and every `current_user_role() = '…'` predicate is then NULL
-- rather than true. lib/auth/session.ts refuses such a session outright rather than rendering it.
create or replace function current_user_role()
  returns text
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select a.role
    from ward_role_assignments a
   where a.user_id = auth.uid()
     and a.ward_id = current_ward_id()
     and a.is_active;
$$;

-- 066 returned NULL across a switch, and its header argued that hard: a visiting stake president
-- has no organization in the ward they are visiting, and returning their own would have matched
-- rows in a different ward entirely. THAT ARGUMENT DIES WITH THE VISITOR. Under the calling model
-- the organization is read FROM THE CALLING IN THIS WARD, so it is a real organization in the
-- right ward or it is null because that calling has none.
create or replace function current_org_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select a.org_id
    from ward_role_assignments a
   where a.user_id = auth.uid()
     and a.ward_id = current_ward_id()
     and a.is_active;
$$;

-- Back to migration 019's shape exactly, and its comment stands: bishopric admin authority is
-- SHARED (CLAUDE.md §7), and there is deliberately no function granting the bishop something a
-- counselor lacks — do not add one.
--
-- 066's `and acting_in_home_ward()` is removed rather than kept as a safety net. Somebody whose
-- calling in this ward IS bishop or counselor is a member of THIS ward's bishopric, wherever
-- their account happens to live; and somebody whose calling here is anything else is not,
-- whatever they hold elsewhere. current_user_role() already answers that question correctly, so a
-- second condition could only ever make it wrong.
create or replace function is_bishopric()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select coalesce(current_user_role() in ('bishop', 'counselor'), false);
$$;


-- ============================================================================
-- 070c — acting_in_home_ward() disappears entirely
-- ============================================================================
--
-- DROPPED RATHER THAN LEFT INERT. It existed to compensate for a role that did not follow the
-- ward; the role follows the ward now, so the compensation is not merely unused — it is a
-- question with no meaning left in it. "Am I at home?" no longer decides anything about access,
-- and a function that still answers it is an invitation to write the old rule again.
--
-- It is dropped AFTER is_bishopric() and current_org_id() stop calling it, which is why this
-- section comes third. Nothing outside migration 066 ever called it.
drop function acting_in_home_ward();


-- ============================================================================
-- 070d — a ward must be able to see the leaders who hold callings in it
-- ============================================================================
--
-- THE POLICY THAT HAD TO MOVE, AND THE ONLY ONE.
--
-- 066c's predicate is `ward_id = current_ward_id() or id = auth.uid()`, reading `users.ward_id` —
-- the HOME ward. Under the calling model that is the wrong question for exactly the people this
-- phase exists for: a Relief Society president whose account lives in ward A and who holds a
-- calling in ward B would be INVISIBLE to ward B's bishop, absent from ward B's admin list, and
-- unnameable as the author of anything she wrote there. The admin screen would show a ward's
-- leaders with one of them silently missing.
--
-- So the predicate gains a third arm: a person who holds a calling in the ward you are acting in
-- is one of YOUR ward's leaders, and is readable as such. That is not a cross-ward read — it
-- discloses somebody who is on this ward's roster by the ward's own act of calling them.
--
-- WHAT DOES NOT WIDEN: `users` still has no policy admitting somebody in a ward you are not
-- acting in, the column GRANT (066d) still opens exactly `active_ward_id` for update, and nothing
-- about ward A becomes readable from ward B.
--
-- `or id = auth.uid()` STAYS AND IS STILL LOAD-BEARING (066c, and the retro for it): a person
-- acting in ward B whose `users.ward_id` is ward A must be able to read their own row, or
-- lib/auth/session.ts reads nothing, treats it as a half-created account and redirects to /login.
-- The switch would sign the switcher out, and nothing about that failure looks like permissions.

-- A SECURITY DEFINER HELPER RATHER THAN AN INLINE SUBQUERY, for two reasons. A subquery over
-- `ward_role_assignments` inside a policy on `users` is itself filtered by
-- `ward_role_assignments_select`, so the answer would depend on what the reader can see rather
-- than on the fact being asked about — and "is this person one of my ward's leaders" must be
-- UNIFORMLY EVALUABLE (056c's rule), or the admin list differs between two people looking at it.
-- It is safe for the three reasons migration 060b's activity_profile_followup_count is, and all
-- three must stay true: it returns a BOOLEAN and never a row, it is used only to admit a row the
-- reader's own ward called this person to, and current_ward_id() keeps it ward-scoped.
--
-- IT DOES NOT FILTER `is_active`, on purpose and in both halves. A deactivated account's calling
-- is deactivated with it (068b), and if this filtered, a deactivated cross-ward leader would
-- vanish from the admin list and could never be reactivated. The home-ward arm above has never
-- filtered it either, so this matches rather than departs.
create function holds_calling_in_current_ward(target_user uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from ward_role_assignments a
    where a.user_id = target_user
      and a.ward_id = current_ward_id()
  );
$$;

drop policy users_ward_select on users;

create policy users_ward_select on users
  for select to authenticated
  using (
    ward_id = current_ward_id()
    or id = auth.uid()
    or holds_calling_in_current_ward(id)
  );


-- ============================================================================
-- 070e — session_context()
-- ============================================================================
--
-- THE APPLICATION MUST NOT RECOMPUTE ANY OF THIS. If TypeScript read the role off the `users` row
-- while RLS read it off the calling, the page frame would name one role around another's rows and
-- every permission check in the app would be answering a different question from every policy.
-- ONE ROUND TRIP, ONE ANSWER, BOTH SIDES AGREE — and getSessionUser is wrapped in cache(), so it
-- costs one query per request.
--
-- It GAINS `role`, `counselor_position` and `calling_id`, and LOSES `acting_in_home_ward`. The
-- role now comes from the same round trip as the ward, so the two cannot disagree; `calling_id`
-- is what lets a screen say WHICH CALLING you are acting under rather than only which ward.
--
-- The return type changes, so this is a drop-and-create rather than a `create or replace`. The
-- grants are re-issued below for the same reason: they do not survive the drop.
--
-- lib/auth/session.ts treats an error from this RPC the way it treats a failed `users` read:
-- THROW WITH CONTEXT, never fall back to the `users` row. A silent fall back is the app and RLS
-- disagreeing, which is the one failure this whole design exists to prevent (CLAUDE.md rule 7).
drop function session_context();

create function session_context()
  returns table (
    ward_id            uuid,
    home_ward_id       uuid,
    active_ward_id     uuid,
    role               text,
    org_id             uuid,
    counselor_position integer,
    calling_id         uuid,
    is_bishopric       boolean
  )
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select current_ward_id(),
         u.ward_id,
         u.active_ward_id,
         current_user_role(),
         current_org_id(),
         a.counselor_position,
         a.id,
         is_bishopric()
    from users u
    left join ward_role_assignments a
      on a.user_id = u.id
     and a.ward_id = current_ward_id()
     and a.is_active
   where u.id = auth.uid();
$$;

-- A LEFT JOIN, deliberately. An inner join would return NO ROW for a `users` row with no active
-- calling in the ward it resolves to — and lib/auth/session.ts reads "no row" as a half-created
-- account and redirects to /login with no explanation. A row with a null role is the honest
-- answer, and the app refuses it with a sentence naming the cause instead.

-- PUBLIC gets EXECUTE on a new function by default. Revoke first, then grant deliberately —
-- migration 022 Part 2's precedent. service_role is included because the test suite calls it.
revoke all on function session_context() from public;
grant execute on function session_context() to authenticated;
grant execute on function session_context() to service_role;

revoke all on function holds_calling_in_current_ward(uuid) from public;
grant execute on function holds_calling_in_current_ward(uuid) to authenticated;
grant execute on function holds_calling_in_current_ward(uuid) to service_role;

-- unit_ancestor_ids() IS DELIBERATELY KEPT, although can_act_in_ward() no longer walks it. It is
-- the hierarchy walk proto-d's Stakes & Wards screen needs, its cycle guard is the reason
-- tests/lib/unitAncestors.test.ts exists, and dropping a correct function in a migration about
-- something else is how the next phase comes to write a second one.
