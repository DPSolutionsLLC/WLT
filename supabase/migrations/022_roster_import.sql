-- Phase 2A, migration 022: roster lookup indexes, the import apply function, and the
-- column-level `users` UPDATE grant.
--
-- Three unrelated-looking things share one migration because phase 2 opens exactly one, and
-- the third has been waiting three phases for it (auth-a → auth-b → auth-c all recorded it as
-- a known gap and none of them carried a migration to close it).
--
--   Part 1  lookup indexes for the roster-c CSV match strategy
--   Part 2  apply_roster_import(), the single-transaction apply roster-c calls
--   Part 3  narrow the authenticated UPDATE grant on `users` to theme_preference


-- ============================================================================
-- Part 1 — lookup indexes for the import match strategy
-- ============================================================================
--
-- These are deliberately NOT unique. A unique constraint is the obvious way to make an import
-- idempotent and it is the wrong answer here: two unrelated Smith families with no address on
-- file are legitimate, and a constraint would reject the second one forever. Matching is
-- decided in the import preview, where a human confirms it, and these indexes only make that
-- lookup cheap. Do not "fix" them into unique indexes.

create index households_ward_family_name_idx
  on households (ward_id, lower(family_name));

create index members_ward_household_name_idx
  on members (ward_id, household_id, lower(first_name), lower(last_name));


-- ============================================================================
-- Part 2 — apply_roster_import
-- ============================================================================
--
-- @supabase/supabase-js has no transaction API, and 02-roster.md §Step C requires the apply
-- step to be one transaction: a half-applied roster is worse than a refused one. A plpgsql
-- function is called as a single statement, so it gets an implicit transaction for free.
--
-- SECURITY INVOKER — the default, and required. RLS must still apply to every write inside
-- this function (CLAUDE.md rule 2). Do NOT add SECURITY DEFINER: it would turn the import
-- into a hole straight through the ward boundary.
--
-- p_households: [{ family_name, address }]
-- p_members:    [{ family_name, address, first_name, last_name, category, gender, phone }]
--
-- It never references member_notes. The LCR export does not contain notes, they are
-- irreplaceable, and the safest way to guarantee an import cannot touch them is for the
-- function not to know the table exists.
--
-- Members present in the database but absent from the payload are left alone. An import is
-- additive; departures are marked moved_out by a human (02-roster.md §Pitfalls — there is no
-- delete in this module).
--
-- `status` is not in the payload and is never written on update, so re-importing the ward
-- roster cannot resurrect a member somebody marked moved_out.
create function apply_roster_import(
  p_ward_id    uuid,
  p_households jsonb,
  p_members    jsonb
) returns jsonb
  language plpgsql
  set search_path = public, pg_temp
as $$
declare
  household_row      jsonb;
  member_row         jsonb;
  incoming_family    text;
  incoming_address   text;
  incoming_first     text;
  incoming_last      text;
  matched_household  uuid;
  matched_member     uuid;
  current_category   text;
  current_gender     text;
  current_phone      text;
  next_category      text;
  next_gender        text;
  next_phone         text;
  households_created integer := 0;
  households_updated integer := 0;
  members_created    integer := 0;
  members_updated    integer := 0;
  new_household_ids  uuid[] := array[]::uuid[];
begin
  for household_row in
    select value from jsonb_array_elements(coalesce(p_households, '[]'::jsonb))
  loop
    incoming_family := nullif(btrim(household_row ->> 'family_name'), '');
    incoming_address := nullif(btrim(household_row ->> 'address'), '');

    -- A household with no family name has nothing to match on and nothing to display.
    continue when incoming_family is null;

    -- The match key includes the address, so two Smith households at different addresses stay
    -- two households. A household on file WITH an address therefore does not match an incoming
    -- row without one, which is intended: the preview is where a human resolves that.
    select household.id into matched_household
    from households household
    where household.ward_id = p_ward_id
      and lower(household.family_name) = lower(incoming_family)
      and coalesce(lower(household.address), '') = coalesce(lower(incoming_address), '')
    limit 1;

    if matched_household is null then
      insert into households (ward_id, family_name, address)
      values (p_ward_id, incoming_family, incoming_address)
      returning id into matched_household;

      households_created := households_created + 1;
      new_household_ids := new_household_ids || matched_household;
    elsif incoming_address is not null then
      -- Because the address is part of the match key, this only ever normalises casing or
      -- whitespace on an address that already matches case-insensitively. Filling in a
      -- missing address is a merge decision, and merges belong to the preview, not here.
      update households
      set address = incoming_address
      where households.id = matched_household
        and households.ward_id = p_ward_id
        and households.address is distinct from incoming_address;

      if found then
        households_updated := households_updated + 1;
      end if;
    end if;
  end loop;

  for member_row in
    select value from jsonb_array_elements(coalesce(p_members, '[]'::jsonb))
  loop
    incoming_first := nullif(btrim(member_row ->> 'first_name'), '');
    incoming_last := nullif(btrim(member_row ->> 'last_name'), '');

    continue when incoming_first is null or incoming_last is null;

    incoming_family := nullif(btrim(member_row ->> 'family_name'), '');
    incoming_address := nullif(btrim(member_row ->> 'address'), '');

    -- Resolved by the same key the household loop used, so a member lands in the household the
    -- same import just created rather than in a second copy of it.
    matched_household := null;

    if incoming_family is not null then
      select household.id into matched_household
      from households household
      where household.ward_id = p_ward_id
        and lower(household.family_name) = lower(incoming_family)
        and coalesce(lower(household.address), '') = coalesce(lower(incoming_address), '')
      limit 1;
    end if;

    select member.id, member.category, member.gender, member.phone
      into matched_member, current_category, current_gender, current_phone
    from members member
    where member.ward_id = p_ward_id
      and member.household_id is not distinct from matched_household
      and lower(member.first_name) = lower(incoming_first)
      and lower(member.last_name) = lower(incoming_last)
    limit 1;

    if matched_member is null then
      insert into members (
        ward_id, household_id, first_name, last_name, category, gender, phone
      )
      values (
        p_ward_id,
        matched_household,
        incoming_first,
        incoming_last,
        nullif(btrim(member_row ->> 'category'), ''),
        nullif(btrim(member_row ->> 'gender'), ''),
        nullif(btrim(member_row ->> 'phone'), '')
      );

      members_created := members_created + 1;
    else
      -- Only incoming non-null fields overwrite. A blank cell in the export means "the export
      -- does not carry this", not "clear what the ward typed in by hand".
      next_category := coalesce(nullif(btrim(member_row ->> 'category'), ''), current_category);
      next_gender := coalesce(nullif(btrim(member_row ->> 'gender'), ''), current_gender);
      next_phone := coalesce(nullif(btrim(member_row ->> 'phone'), ''), current_phone);

      if (next_category, next_gender, next_phone)
         is distinct from (current_category, current_gender, current_phone) then
        update members
        set category = next_category,
            gender = next_gender,
            phone = next_phone
        where members.id = matched_member
          and members.ward_id = p_ward_id;

        members_updated := members_updated + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'households_created', households_created,
    'households_updated', households_updated,
    'members_created', members_created,
    'members_updated', members_updated,
    'new_household_ids', to_jsonb(new_household_ids)
  );
end;
$$;

comment on function apply_roster_import(uuid, jsonb, jsonb) is
  'Applies a confirmed CSV import in one transaction. SECURITY INVOKER, so RLS still governs every write. Never touches member_notes.';

-- PUBLIC gets EXECUTE on a new function by default. Revoke first, then grant deliberately.
-- service_role is included because the test suite and the seed harness call this with the
-- service client; revoking PUBLIC would otherwise take that away too.
revoke all on function apply_roster_import(uuid, jsonb, jsonb) from public;
grant execute on function apply_roster_import(uuid, jsonb, jsonb) to authenticated;
grant execute on function apply_roster_import(uuid, jsonb, jsonb) to service_role;


-- ============================================================================
-- Part 3 — narrow the authenticated UPDATE grant on `users`
-- ============================================================================
--
-- Handed forward by auth-a → auth-b → auth-c. `users_update_self` (migration 019) lets a user
-- update their own row, and nothing restricted WHICH COLUMNS — so a user could rewrite their
-- own `role` to bishop, or their own `is_active` back to true after being deactivated, with a
-- direct API call. The admin UI disables self-edits, but a disabled control is a UI guard, not
-- a security boundary.
--
-- RLS grants or denies a ROW, never a column, so a policy cannot close this. Column-level
-- GRANTs can, and they are checked before the policy runs: the refusal is a hard error rather
-- than the zero-row success an RLS denial produces.
--
-- theme_preference is the complete set of what an authenticated session updates today —
-- components/layout/ThemeToggle.tsx is the only such write in the repo. Everything else
-- (adminUsers, youthAccounts, registration) goes through the service-role client, which has
-- its own grant and is unaffected.
--
-- BREAKING, deliberately: a future profile-edit page must widen this grant to include
-- first_name / last_name. Add them when that page ships, not before. Without the grant its
-- update fails with "permission denied for column", which is a confusing error a long way
-- from its cause — tests/rls/users-column-grant.test.ts is where that reasoning is pinned.
--
-- The `alter default privileges` block in migration 019 applies only to tables created later,
-- so it cannot re-widen `users`.
revoke update on users from authenticated;
grant update (theme_preference) on users to authenticated;
