-- Phase 2, migration 072: THE SESSION CARRIES ITS ORGANIZATION'S TYPE.
--
-- One column added to session_context(). Nothing else in this file.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- The permission matrix becomes ORGANIZATION-AWARE in this phase: an org_president in Young
-- Women may manage youth activities, one in Sunday School reaches them not at all, and one in
-- the Elders Quorum sees them without managing them. That is a rule about the ORGANIZATION'S
-- TYPE, and `session_context()` returns only its id.
--
-- THE APPLICATION MUST NOT RESOLVE THE TYPE SEPARATELY. That is 070e's rule and it applies here
-- unchanged: if TypeScript read the organization's type in a second query while RLS resolved the
-- organization in the first, the two could disagree — and the disagreement would surface as a
-- permission check answering a different question from the policy behind it. ONE ROUND TRIP, ONE
-- ANSWER, BOTH SIDES AGREE. getSessionUser is wrapped in cache(), so it still costs one query
-- per request.
--
-- ---------------------------------------------------------------------------
-- WHY A JOIN AND NOT A SECOND HELPER
-- ---------------------------------------------------------------------------
-- There is deliberately no current_org_type(). No POLICY needs it — every policy that scopes by
-- organization compares `org_id = current_org_id()`, which is an identity test and is already
-- correct. The type is needed by the APPLICATION's permission matrix and by nothing in the
-- database, so adding a helper would be adding a security-definer function with no caller.
--
-- ---------------------------------------------------------------------------
-- NULL MEANS NO ORGANIZATION, EXACTLY AS org_id DOES
-- ---------------------------------------------------------------------------
-- A bishop, a ward secretary and a ward_council_member all resolve to a null organization, and
-- the type is null with it. The LEFT JOIN below keeps that honest: a calling whose org_id is
-- null, and a calling whose organization row has been deleted, both read null rather than
-- dropping the session row entirely. An inner join here would reproduce exactly the bug 070e's
-- own comment warns about — no row, read by lib/auth/session.ts as a half-created account.
--
-- APPLIES IMMEDIATELY AND IS A NO-OP for every existing caller: the added column is the last in
-- the return type, and lib/auth/session.ts names its columns rather than reading by position.
--
-- The return type changes, so this is a drop-and-create rather than a `create or replace`, and
-- the grants are re-issued below because they do not survive the drop — 070e's precedent, for
-- 070e's reason.

drop function session_context();

create function session_context()
  returns table (
    ward_id            uuid,
    home_ward_id       uuid,
    active_ward_id     uuid,
    role               text,
    org_id             uuid,
    org_type           text,
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
         o.type,
         a.counselor_position,
         a.id,
         is_bishopric()
    from users u
    left join ward_role_assignments a
      on a.user_id = u.id
     and a.ward_id = current_ward_id()
     and a.is_active
    left join organizations o
      on o.id = current_org_id()
   where u.id = auth.uid();
$$;

-- The organization is joined on current_org_id() rather than on a.org_id, deliberately. They are
-- the same value today — current_org_id() reads the active calling's organization — but the
-- function is the one place that answer is allowed to come from, and reading the column directly
-- would be a second source for it. If current_org_id() ever gains a fallback, this follows it.

-- PUBLIC gets EXECUTE on a new function by default. Revoke first, then grant deliberately —
-- migration 022 Part 2's precedent. service_role is included because the test suite calls it.
revoke all on function session_context() from public;
grant execute on function session_context() to authenticated;
grant execute on function session_context() to service_role;
