-- ITER-040, migration 090: THE ROSTER IMPORT IS A PASTE OF THE LCR WARD LIST REPORT, REVIEWED AS A
-- CHECKLIST. plans/roster-paste-import.md.
--
-- APPLIES IMMEDIATELY. Additive except for one drop: twelve nullable columns on `members`, one
-- non-unique index, and one new function. It DROPS `apply_roster_import()` (migration 022), which
-- the CSV upload called; the upload is deleted in the same change. Between this push and the
-- deploy, the old build's CSV import would answer 500, and nothing else reads the function.
--
-- ---------------------------------------------------------------------------
-- THE NEW MEMBER COLUMNS
-- ---------------------------------------------------------------------------
-- `full_name` and `birth_date` are the import's match key. `preferred_name` is LCR's "Last, First",
-- which is where `first_name` and `last_name` are split from (the user's decision; it reverses the
-- old CSV import's "never split a name" rule for this one known format).
--
-- THE CALLINGS AND MINISTERING COLUMNS ARE LEADER-ONLY ROSTER DATA AND ARE NEVER PUBLISHED. They
-- are readable by any ward member under `members_ward_select`, the same as phone and address, and
-- none of them may be added to lib/program/publicProjection.ts. They are written SILENTLY by every
-- paste, with no checklist entry; reviewing them against a previous report is deferred to the
-- Callings and Ministering modules, which will need a stored snapshot to do it. A callings cell
-- holds one calling per line, separated by `\n`.
--
-- `mrn` stays unread and unwritten (migration 065's instruction).
alter table members
  add column full_name            text check (char_length(full_name) <= 200),
  add column preferred_name       text check (char_length(preferred_name) <= 200),
  add column birth_date           date,
  add column email                text check (char_length(email) <= 320),
  add column class_assignment     text check (char_length(class_assignment) <= 1000),
  add column callings             text check (char_length(callings) <= 4000),
  add column callings_sustained   text check (char_length(callings_sustained) <= 4000),
  add column callings_set_apart   text check (char_length(callings_set_apart) <= 4000),
  add column ministering_brothers text check (char_length(ministering_brothers) <= 1000),
  add column ministering_sisters  text check (char_length(ministering_sisters) <= 1000),
  add column has_ministering_brothers boolean,
  add column has_ministering_sisters  boolean;

-- DELIBERATELY NOT UNIQUE, for migration 022's reason: identity is decided in TypeScript by
-- lib/roster/paste/buildRosterDiff.ts, where a human reviews it, and the function below trusts the
-- ids it is handed. This index only makes the lookup cheap.
create index members_ward_full_name_birth_idx
  on members (ward_id, lower(full_name), birth_date);


-- ---------------------------------------------------------------------------
-- apply_roster_paste
-- ---------------------------------------------------------------------------
-- One statement, so one implicit transaction: a half-applied roster is worse than a refused one.
--
-- SECURITY INVOKER, so RLS governs every write (CLAUDE.md rule 2). The explicit ward check is new:
-- 022 had none, and a caller acting in ward A has no business handing this ward B's id.
--
-- p_plan:
--   households:          [{ key, family_name, address }]        households to create
--   household_addresses: [{ household_id, address }]
--   creates:             [{ household_key | household_id, first_name, last_name, preferred_name,
--                           full_name, birth_date, gender, phone, email, category, <silent> }]
--   updates:             [{ member_id, household_key?, household_id?, set: { column: value } }]
--   move_outs:           [member_id]
--
-- In `set`, a key that is PRESENT is written (a JSON null clears the column); a key that is ABSENT
-- leaves the column alone. That is how a column missing from the paste never clears a stored value.
--
-- NOTHING IS EVER DELETED. "No longer listed" is `moved_out`. Households emptied by a move stay,
-- because visit history hangs off them. It never references member_notes.
create function apply_roster_paste(p_ward_id uuid, p_plan jsonb)
  returns jsonb
  language plpgsql
  security invoker
  set search_path = public, pg_temp
as $$
declare
  household_entry    jsonb;
  create_entry       jsonb;
  update_entry       jsonb;
  address_entry      jsonb;
  changes            jsonb;
  household_ids      jsonb := '{}'::jsonb;
  new_household_id   uuid;
  target_household   uuid;
  rows_changed       integer;
  households_created integer := 0;
  households_updated integer := 0;
  members_created    integer := 0;
  members_updated    integer := 0;
  members_moved_out  integer := 0;
  new_household_ids  uuid[] := array[]::uuid[];
begin
  if p_ward_id is distinct from current_ward_id() then
    raise exception 'roster import is for the ward you are acting in' using errcode = '42501';
  end if;

  for household_entry in
    select value from jsonb_array_elements(coalesce(p_plan -> 'households', '[]'::jsonb))
  loop
    insert into households (ward_id, family_name, address)
    values (
      p_ward_id,
      household_entry ->> 'family_name',
      nullif(btrim(household_entry ->> 'address'), '')
    )
    returning id into new_household_id;

    household_ids := household_ids
      || jsonb_build_object(household_entry ->> 'key', new_household_id);
    households_created := households_created + 1;
    new_household_ids := new_household_ids || new_household_id;
  end loop;

  for address_entry in
    select value from jsonb_array_elements(coalesce(p_plan -> 'household_addresses', '[]'::jsonb))
  loop
    update households
    set address = nullif(btrim(address_entry ->> 'address'), '')
    where households.ward_id = p_ward_id
      and households.id = (address_entry ->> 'household_id')::uuid
      and households.address is distinct from nullif(btrim(address_entry ->> 'address'), '');

    get diagnostics rows_changed = row_count;
    households_updated := households_updated + rows_changed;
  end loop;

  for create_entry in
    select value from jsonb_array_elements(coalesce(p_plan -> 'creates', '[]'::jsonb))
  loop
    target_household := coalesce(
      (household_ids ->> (create_entry ->> 'household_key'))::uuid,
      (create_entry ->> 'household_id')::uuid
    );

    insert into members (
      ward_id, household_id, status,
      first_name, last_name, preferred_name, full_name, birth_date,
      gender, phone, email, category,
      class_assignment, callings, callings_sustained, callings_set_apart,
      ministering_brothers, ministering_sisters,
      has_ministering_brothers, has_ministering_sisters
    )
    values (
      p_ward_id, target_household, 'active',
      create_entry ->> 'first_name',
      create_entry ->> 'last_name',
      create_entry ->> 'preferred_name',
      create_entry ->> 'full_name',
      (create_entry ->> 'birth_date')::date,
      create_entry ->> 'gender',
      create_entry ->> 'phone',
      create_entry ->> 'email',
      create_entry ->> 'category',
      create_entry ->> 'class_assignment',
      create_entry ->> 'callings',
      create_entry ->> 'callings_sustained',
      create_entry ->> 'callings_set_apart',
      create_entry ->> 'ministering_brothers',
      create_entry ->> 'ministering_sisters',
      (create_entry ->> 'has_ministering_brothers')::boolean,
      (create_entry ->> 'has_ministering_sisters')::boolean
    );

    members_created := members_created + 1;
  end loop;

  for update_entry in
    select value from jsonb_array_elements(coalesce(p_plan -> 'updates', '[]'::jsonb))
  loop
    changes := coalesce(update_entry -> 'set', '{}'::jsonb);

    -- `status` may only be set back to active ("returning"). A move-out goes through move_outs,
    -- and nothing here can write do_not_contact.
    if changes ? 'status' and changes ->> 'status' is distinct from 'active' then
      raise exception 'apply_roster_paste can only set a member back to active'
        using errcode = '22023';
    end if;

    target_household := coalesce(
      (household_ids ->> (update_entry ->> 'household_key'))::uuid,
      (update_entry ->> 'household_id')::uuid
    );

    update members
    set household_id = coalesce(target_household, members.household_id),
        first_name = case when changes ? 'first_name' then changes ->> 'first_name' else members.first_name end,
        last_name = case when changes ? 'last_name' then changes ->> 'last_name' else members.last_name end,
        preferred_name = case when changes ? 'preferred_name' then changes ->> 'preferred_name' else members.preferred_name end,
        full_name = case when changes ? 'full_name' then changes ->> 'full_name' else members.full_name end,
        birth_date = case when changes ? 'birth_date' then (changes ->> 'birth_date')::date else members.birth_date end,
        gender = case when changes ? 'gender' then changes ->> 'gender' else members.gender end,
        phone = case when changes ? 'phone' then changes ->> 'phone' else members.phone end,
        email = case when changes ? 'email' then changes ->> 'email' else members.email end,
        category = case when changes ? 'category' then changes ->> 'category' else members.category end,
        status = case when changes ? 'status' then changes ->> 'status' else members.status end,
        class_assignment = case when changes ? 'class_assignment' then changes ->> 'class_assignment' else members.class_assignment end,
        callings = case when changes ? 'callings' then changes ->> 'callings' else members.callings end,
        callings_sustained = case when changes ? 'callings_sustained' then changes ->> 'callings_sustained' else members.callings_sustained end,
        callings_set_apart = case when changes ? 'callings_set_apart' then changes ->> 'callings_set_apart' else members.callings_set_apart end,
        ministering_brothers = case when changes ? 'ministering_brothers' then changes ->> 'ministering_brothers' else members.ministering_brothers end,
        ministering_sisters = case when changes ? 'ministering_sisters' then changes ->> 'ministering_sisters' else members.ministering_sisters end,
        has_ministering_brothers = case when changes ? 'has_ministering_brothers' then (changes ->> 'has_ministering_brothers')::boolean else members.has_ministering_brothers end,
        has_ministering_sisters = case when changes ? 'has_ministering_sisters' then (changes ->> 'has_ministering_sisters')::boolean else members.has_ministering_sisters end
    where members.ward_id = p_ward_id
      and members.id = (update_entry ->> 'member_id')::uuid;

    get diagnostics rows_changed = row_count;
    members_updated := members_updated + rows_changed;
  end loop;

  update members
  set status = 'moved_out'
  where members.ward_id = p_ward_id
    and members.id in (
      select (value #>> '{}')::uuid
      from jsonb_array_elements(coalesce(p_plan -> 'move_outs', '[]'::jsonb))
    )
    and members.status <> 'moved_out';

  get diagnostics members_moved_out = row_count;

  return jsonb_build_object(
    'households_created', households_created,
    'households_updated', households_updated,
    'members_created', members_created,
    'members_updated', members_updated,
    'members_moved_out', members_moved_out,
    'new_household_ids', to_jsonb(new_household_ids)
  );
end;
$$;

comment on function apply_roster_paste(uuid, jsonb) is
  'Applies the ticked items of a roster paste in one transaction. SECURITY INVOKER, so RLS governs every write. Never deletes; never touches member_notes.';

revoke all on function apply_roster_paste(uuid, jsonb) from public;
grant execute on function apply_roster_paste(uuid, jsonb) to authenticated;
grant execute on function apply_roster_paste(uuid, jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- The CSV upload's function, replaced by the one above.
-- ---------------------------------------------------------------------------
drop function if exists apply_roster_import(uuid, jsonb, jsonb);
