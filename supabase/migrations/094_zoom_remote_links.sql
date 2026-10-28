-- ITER-051, migration 094: EACH LEADER'S STREAM REMOTE-CONTROL LINK.
--
-- The ward streams sacrament meeting on Zoom, and a separate app the user built lets a leader
-- control the stream from a phone. Each leader is given a unique link into it. This table holds
-- one link per POSITION in the ward (bishop, both counselors, ward clerk, executive secretary),
-- and the Zoom tile's Remote control button opens the reader's own (plans/zoom-remote-links.md).
--
-- ---------------------------------------------------------------------------
-- A SELECT POLICY AND NO WRITE POLICY
-- ---------------------------------------------------------------------------
-- Every write is the service role behind PUT / DELETE /api/zoom/remote-links/[position], gated on
-- `zoom.manage_remote_links` AND a bishopric calling (lib/zoom/access.ts). That gate is the write
-- boundary, as it is for `sunday_music` (089) and `access_requests` (073). Do not add an UPDATE
-- policy "for convenience" (CLAUDE.md §9, 060-D2).
--
-- ---------------------------------------------------------------------------
-- ONLY THE HOLDER CAN READ A LINK — THERE IS NO BISHOPRIC ARM (D3)
-- ---------------------------------------------------------------------------
-- A link is a capability: whoever holds the URL controls the stream. The bishopric pastes links
-- and never reads one back, and the Remote links tab shows status only. The app reads every row's
-- STATUS through the service role, selecting no `url`.
--
-- ---------------------------------------------------------------------------
-- COMPUTED ON READ, AND STAMPED ON WRITE — BOTH, FOR DIFFERENT REASONS
-- ---------------------------------------------------------------------------
-- A row is bound to the calling it was pasted for (`holder_calling_id`). It is live only while
-- that calling is active, belongs to the reader, is in the ward being acted in, sits on an active
-- account, and STILL MATCHES THE POSITION. The last check matters because a role or counselor
-- number change updates the same calling row in place, so a 1st ↔ 2nd swap would otherwise leave
-- each counselor holding the other's link. holds_remote_link() asks all of it on every read, which
-- is the security guarantee: nothing in this project refreshes anything, so a stored flag alone
-- could not be trusted.
--
-- The stamp is what makes a change permanent. Without it a swap that is later undone, or a
-- released calling that is reinstated, would silently revive the old link. So updateCalling() and
-- endCalling() (lib/callings/writeCalling.ts, the only writers of an existing calling) turn the
-- affected rows off. tests/lib/remoteLinkRetireSites.test.ts keeps them the only writers.
--
-- A TURNED-OFF ROW HOLDS NO URL. Reviving one needs a fresh paste.
--
-- Every user FK is single-column `on delete set null`, never composite (ward-callings-model, 069).

create table zoom_remote_links (
  id                 uuid        primary key default gen_random_uuid(),
  ward_id            uuid        not null references wards (id) on delete cascade,
  position           text        not null check (position in
                       ('bishop', 'counselor_1', 'counselor_2', 'ward_clerk', 'executive_secretary')),
  url                text        check (url is null or (url ~ '^https://' and char_length(url) <= 2000)),
  holder_calling_id  uuid        references ward_role_assignments (id) on delete set null,
  set_by             uuid        references users (id) on delete set null,
  set_at             timestamptz not null default now(),
  deactivated_at     timestamptz,
  deactivated_reason text        check (deactivated_reason in ('holder_changed', 'turned_off')),
  deactivated_by     uuid        references users (id) on delete set null,
  constraint zoom_remote_links_one_per_position unique (ward_id, position),
  constraint zoom_remote_links_off_has_no_url
    check ((deactivated_at is null) = (url is not null)),
  constraint zoom_remote_links_off_has_reason
    check ((deactivated_at is null) = (deactivated_reason is null))
);

comment on table zoom_remote_links is
  'One stream remote-control link per bishopric position. Readable only by its holder (ITER-051).';

-- The position table in plans/zoom-remote-links.md. lib/zoom/remoteLinkPositions.ts is its
-- TypeScript mirror, and a counselor with no position number holds no remote.
create function remote_link_position_matches(
  p_role text,
  p_counselor_position integer,
  p_position text
)
  returns boolean
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select case p_position
           when 'bishop'              then p_role = 'bishop'
           when 'counselor_1'         then p_role = 'counselor' and p_counselor_position = 1
           when 'counselor_2'         then p_role = 'counselor' and p_counselor_position = 2
           when 'ward_clerk'          then p_role = 'ward_secretary'
           when 'executive_secretary' then p_role = 'executive_secretary'
           else false
         end
     and p_role is not null;
$$;

-- Security definer so the policy can read the calling and the account whatever the reader's own
-- reach. It answers only about the READER (`auth.uid()`), so it discloses nothing about anyone else.
create function holds_remote_link(p_calling_id uuid, p_position text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from ward_role_assignments c
      join users u on u.id = c.user_id
     where c.id = p_calling_id
       and c.user_id = auth.uid()
       and c.ward_id = current_ward_id()
       and c.is_active
       and u.is_active
       and coalesce(remote_link_position_matches(c.role, c.counselor_position, p_position), false)
  );
$$;

revoke all on function remote_link_position_matches(text, integer, text) from public;
grant execute on function remote_link_position_matches(text, integer, text) to authenticated;
grant execute on function remote_link_position_matches(text, integer, text) to service_role;

revoke all on function holds_remote_link(uuid, text) from public;
grant execute on function holds_remote_link(uuid, text) to authenticated;
grant execute on function holds_remote_link(uuid, text) to service_role;

alter table zoom_remote_links enable row level security;

create policy zoom_remote_links_select on zoom_remote_links
  for select to authenticated
  using (ward_id = current_ward_id()
         and deactivated_at is null
         and holds_remote_link(holder_calling_id, position));

create policy zoom_remote_links_module_released on zoom_remote_links
  as restrictive for all to authenticated
  using ((select ward_module_released('zoom')))
  with check ((select ward_module_released('zoom')));
