-- ITER-053, migration 095: THE ZOOM JOIN-LINK POOL AND WHO HOLDS A LINK.
--
-- The church's Zoom account has no API access, so the bishopric registers placeholder registrants
-- by hand in Zoom ("Guest 01", sacrament+guest01@gmail.com, …) and pastes each one's personal join
-- link here. A bishopric member on a visit then gives the next free link to a person — a roster
-- member or not — and texts it, shares it or shows it as a QR code
-- (plans/zoom-link-pool-and-invitees.md).
--
-- ---------------------------------------------------------------------------
-- A SELECT POLICY AND NO WRITE POLICY, ON BOTH TABLES
-- ---------------------------------------------------------------------------
-- Every write is the service role behind /api/zoom/join-links and /api/zoom/invitees, gated on
-- `zoom.manage_invitees` AND a bishopric calling (canManageInvitees(), lib/zoom/access.ts). That
-- gate is the write boundary, as it is for `zoom_remote_links` (094) and `sunday_music` (089). Do
-- not add a write policy "for convenience" (CLAUDE.md §9, 060-D2).
--
-- Reading: the bishopric, the ward clerk and the executive secretary — the holders of `zoom.view`.
-- The clerk and executive secretary see who holds a link and which placeholder; they edit nothing.
--
-- ---------------------------------------------------------------------------
-- THE JOIN URL IS HIDDEN AT THE COLUMN LEVEL (P2) — NEW TO THIS CODEBASE
-- ---------------------------------------------------------------------------
-- A join link is a capability: whoever holds it joins as that guest. So `authenticated` may SELECT
-- every column of zoom_join_links EXCEPT `join_url`, the bishop included. The bishopric reads one
-- URL only through GET /api/zoom/invitees/[id]/link, which uses the service role.
--
-- CONSEQUENCE: any query on zoom_join_links through a user's client must NAME its columns.
-- `select("*")`, or an embed asking for `join_url`, is a permission error (SQLSTATE 42501).
--
-- ---------------------------------------------------------------------------
-- ONE LINK, ONE PERSON, FOR GOOD (D2)
-- ---------------------------------------------------------------------------
-- `zoom_invitees.join_link_id` is UNIQUE, so two people can never hold one link. There is no
-- take-back in this slice: reusing a link needs a Zoom test (the old holder may still get in). An
-- UNASSIGNED link may be removed (a typo in a paste, P4); a given one may not.
--
-- "Next free link" is ONE function, assign_next_zoom_link(), using `for update skip locked` (P3):
-- supabase-js has no transactions, and two leaders on two visits at the same moment must never
-- receive the same link. remove_unassigned_zoom_link() is one statement for the same reason.
--
-- ---------------------------------------------------------------------------
-- WAITING FOR A LINK (D1)
-- ---------------------------------------------------------------------------
-- An empty pool does not refuse the hand-out: the person is saved with no link (`join_link_id`
-- null) and a to-do lands on the leader who did the hand-out (095c). The same waiting state serves
-- ITER-052's public page later.
--
-- `display_name` is a SNAPSHOT kept even when `member_id` is set, so a member record changing or
-- being deleted never loses the person. Attendance (ITER-054) attaches to the invitee, never the
-- link (P5).
--
-- Every user FK is single-column `on delete set null`, never composite (ward-callings-model, 069).
-- The member FK IS composite with `ward_id`, as `todos.scheduled_with_member_id` is (081).


-- 095a. zoom_join_links — the pool ----------------------------------------------------------------

create table zoom_join_links (
  id                uuid        primary key default gen_random_uuid(),
  ward_id           uuid        not null references wards (id) on delete cascade,
  placeholder_name  text        not null check (length(btrim(placeholder_name)) between 1 and 120),
  placeholder_email text        not null check (
                      placeholder_email = lower(placeholder_email)
                      and placeholder_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                      and char_length(placeholder_email) <= 254),
  join_url          text        not null check (join_url ~ '^https://' and char_length(join_url) <= 2000),
  created_by        uuid        references users (id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (id, ward_id),
  constraint zoom_join_links_one_url   unique (ward_id, join_url),
  constraint zoom_join_links_one_email unique (ward_id, placeholder_email)
);

comment on table zoom_join_links is
  'Pre-registered Zoom placeholder join links (ITER-053). authenticated may not SELECT join_url: '
  'name your columns, never select("*").';


-- 095b. zoom_invitees — a person holding (or waiting for) a link -----------------------------------

create table zoom_invitees (
  id             uuid        primary key default gen_random_uuid(),
  ward_id        uuid        not null references wards (id) on delete cascade,
  display_name   text        not null check (length(btrim(display_name)) between 1 and 120),
  member_id      uuid,
  phone          text        check (phone is null or char_length(phone) between 7 and 40),
  email          text        check (email is null or (
                   email = lower(email)
                   and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                   and char_length(email) <= 254)),
  notes          text        check (notes is null or length(notes) <= 1000),
  -- ITER-052 widens this to 'self_registration'; ZOOM_INVITEE_SOURCES in types/domain.ts moves
  -- with it.
  source         text        not null default 'visit' check (source in ('visit')),
  assigned_by    uuid        references users (id) on delete set null,
  join_link_id   uuid        unique,
  link_given_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint zoom_invitees_link_pair check ((join_link_id is null) = (link_given_at is null)),
  foreign key (member_id, ward_id) references members (id, ward_id)
    on delete set null (member_id),
  foreign key (join_link_id, ward_id) references zoom_join_links (id, ward_id)
);

comment on table zoom_invitees is
  'A person given (or waiting for) a Zoom join link (ITER-053). Attendance attaches here (ITER-054).';

create index zoom_invitees_ward_created_idx on zoom_invitees (ward_id, created_at desc);
create index zoom_invitees_member_idx on zoom_invitees (member_id) where member_id is not null;


-- Grants and policies (P2) ------------------------------------------------------------------------

alter table zoom_join_links enable row level security;
alter table zoom_invitees   enable row level security;

-- Column-level SELECT: everything but join_url. The insert/update/delete grants Supabase gives a
-- new table are left alone — with no write policy, RLS refuses every write anyway, exactly as it
-- does on zoom_remote_links.
revoke select on zoom_join_links from authenticated;
revoke select on zoom_join_links from anon;
grant select (id, ward_id, placeholder_name, placeholder_email, created_by, created_at)
  on zoom_join_links to authenticated;

create policy zoom_join_links_select on zoom_join_links
  for select to authenticated
  using (ward_id = current_ward_id()
         and (is_bishopric()
              or current_user_role() in ('ward_secretary', 'executive_secretary')));

create policy zoom_invitees_select on zoom_invitees
  for select to authenticated
  using (ward_id = current_ward_id()
         and (is_bishopric()
              or current_user_role() in ('ward_secretary', 'executive_secretary')));

create policy zoom_join_links_module_released on zoom_join_links
  as restrictive for all to authenticated
  using ((select ward_module_released('zoom')))
  with check ((select ward_module_released('zoom')));

create policy zoom_invitees_module_released on zoom_invitees
  as restrictive for all to authenticated
  using ((select ward_module_released('zoom')))
  with check ((select ward_module_released('zoom')));


-- assign_next_zoom_link (P3) ----------------------------------------------------------------------
-- Gives the invitee the oldest free link in the ward. A NULL return means EITHER no link is free
-- OR the invitee already has one / is not in this ward — the caller re-reads the invitee to tell
-- which. `skip locked` lets two concurrent hand-outs each take a different link rather than wait
-- for, and then collide on, the same one; the UNIQUE on join_link_id backs it.

create function assign_next_zoom_link(p_ward_id uuid, p_invitee_id uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_link_id uuid;
begin
  select l.id into v_link_id
    from zoom_join_links l
   where l.ward_id = p_ward_id
     and not exists (select 1 from zoom_invitees i where i.join_link_id = l.id)
   order by l.created_at, l.placeholder_name
   limit 1
   for update of l skip locked;

  if v_link_id is null then
    return null;
  end if;

  update zoom_invitees
     set join_link_id = v_link_id, link_given_at = now(), updated_at = now()
   where id = p_invitee_id
     and ward_id = p_ward_id
     and join_link_id is null;

  if not found then
    return null;
  end if;

  return v_link_id;
end;
$$;

revoke all on function assign_next_zoom_link(uuid, uuid) from public;
revoke all on function assign_next_zoom_link(uuid, uuid) from anon;
revoke all on function assign_next_zoom_link(uuid, uuid) from authenticated;
grant execute on function assign_next_zoom_link(uuid, uuid) to service_role;


-- remove_unassigned_zoom_link (P4) ----------------------------------------------------------------
-- One statement, so a hand-out cannot slip in between a check and the delete. Should one commit
-- first anyway, the foreign key from zoom_invitees refuses the delete; that is answered `false`
-- too, because the outcome is the same: the link is held, so it stays.

create function remove_unassigned_zoom_link(p_ward_id uuid, p_link_id uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  delete from zoom_join_links l
   where l.id = p_link_id
     and l.ward_id = p_ward_id
     and not exists (select 1 from zoom_invitees i where i.join_link_id = l.id);
  return found;
exception
  when foreign_key_violation then
    return false;
end;
$$;

revoke all on function remove_unassigned_zoom_link(uuid, uuid) from public;
revoke all on function remove_unassigned_zoom_link(uuid, uuid) from anon;
revoke all on function remove_unassigned_zoom_link(uuid, uuid) from authenticated;
grant execute on function remove_unassigned_zoom_link(uuid, uuid) to service_role;


-- 095c. The "Give ___ a Zoom link" to-do (D1, slice z2c) --------------------------------------------
-- Applied now so z2c needs no migration. The to-do closes with `completed_at` set, `closed_reason`
-- null and a `source_completed` timeline line — all existing values, so neither check constraint
-- changes. Written only by lib/todos/zoomLinks.ts with the service role.

alter table todos add column zoom_invitee_id uuid references zoom_invitees (id) on delete set null;

comment on column todos.zoom_invitee_id is
  'The invitee waiting for a Zoom link this to-do is about (ITER-053). Null on every other to-do.';

create unique index todos_one_open_zoom_link_todo_per_owner
  on todos (zoom_invitee_id, user_id)
  where zoom_invitee_id is not null and completed_at is null;

create index todos_zoom_invitee_idx on todos (zoom_invitee_id) where zoom_invitee_id is not null;
