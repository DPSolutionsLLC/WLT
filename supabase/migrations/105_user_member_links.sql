-- ITER-058 slice cr1, migration 105: the login ↔ roster link, and where a calling came from
-- (plans/roster-decides-callings.md P1, P2, P7).
--
-- ---------------------------------------------------------------------------
-- A SELECT POLICY AND NO WRITE POLICY ON `user_member_links` (P1)
-- ---------------------------------------------------------------------------
-- A link decides privileges: from cr2 on, a linked account's calling follows the roster calling of
-- the member it is linked to. A link a user could write themselves is a privilege escalation —
-- link yourself to the Bishop's roster record and the review offers you the bishop calling. So the
-- only writer is lib/callings/memberLinks.ts on the service role, behind the routes' checks, and
-- NOBODY links their own account except through the email match (P3). The 073 / 089 / 094 / 103
-- shape: the rule lives in one module and RLS cannot be talked past it. Do not add a write policy
-- "for convenience".
--
-- PER (USER, WARD), NOT PER USER (P2). Each ward's roster governs only that ward, and a person may
-- hold callings in several wards (migration 068). One pending-or-active link per (user, ward), and
-- one active link per member — two accounts claiming one roster person would give two people one
-- calling.
--
-- ENDED, NEVER DELETED. A link that is declined or ended keeps its row, so who was linked to whom
-- is history.
--
-- NO RELEASED-MODULE POLICY. Linking is account-level, like `todos`: "Is this you?" must work in a
-- ward whose Admin module is unreleased (Buffalo's is), or nobody there could ever be linked.

-- ---------------------------------------------------------------------------
-- 105a. The links
-- ---------------------------------------------------------------------------
create table user_member_links (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references users (id) on delete cascade,
  ward_id      uuid        not null references wards (id) on delete cascade,
  -- Null only while a request is pending and nobody has chosen the member yet.
  member_id    uuid,
  status       text        not null check (status in ('pending', 'active', 'declined', 'ended')),
  method       text        check (method in ('email_match', 'admin', 'invite')),
  requested_at timestamptz,
  -- Single-column keys to users, never `(user, ward_id)`: migration 069 narrowed all forty-eight of
  -- those, because a leader acting under a calling in a second ward fails them as a 500.
  -- None of these three may ever appear in a policy predicate — the `talks-d` hole.
  linked_by    uuid        references users (id) on delete set null,
  decided_by   uuid        references users (id) on delete set null,
  decided_at   timestamptz,
  ended_at     timestamptz,
  ended_by     uuid        references users (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint user_member_links_member_fkey
    foreign key (member_id, ward_id) references members (id, ward_id) on delete cascade,
  constraint user_member_links_active_has_member check (status <> 'active' or member_id is not null),
  constraint user_member_links_active_has_method check (status <> 'active' or method is not null)
);

create unique index user_member_links_one_open_per_user_ward
  on user_member_links (user_id, ward_id)
  where status in ('pending', 'active');

create unique index user_member_links_one_active_per_member
  on user_member_links (member_id)
  where status = 'active';

create index user_member_links_ward_idx on user_member_links (ward_id) where status in ('pending', 'active');

comment on table user_member_links is
  'Which roster member an app account is, per ward (ITER-058). Ended, never deleted. Written only '
  'by lib/callings/memberLinks.ts with the service role; nobody links their own account except '
  'through the email match.';

alter table user_member_links enable row level security;

-- You read your own link; the bishopric reads the ward's. A super admin's reads go through the
-- service role after isSuperAdmin().
create policy user_member_links_select on user_member_links
  for select to authenticated
  using (ward_id = current_ward_id() and (user_id = auth.uid() or is_bishopric()));

-- ---------------------------------------------------------------------------
-- 105b. Where a calling came from (P7)
-- ---------------------------------------------------------------------------
-- `manual`: typed in by hand — at invite, on Admin → Users, or by any path that existed before this
-- migration (D1: day one moves nobody, so every existing row is `manual` through the default).
-- `roster`: applied from a reviewed roster calling. `override`: set by the super admin, marked, and
-- put back on every review.
alter table ward_role_assignments
  add column source      text        not null default 'manual'
    check (source in ('manual', 'roster', 'override')),
  -- MUST NEVER APPEAR IN A POLICY PREDICATE — the `talks-d` hole.
  add column override_by uuid        references users (id) on delete set null,
  add column override_at timestamptz,
  add constraint ward_role_assignments_override_complete
    check ((source = 'override') = (override_at is not null));

comment on column ward_role_assignments.source is
  'Where this calling came from: manual (typed in), roster (a reviewed LCR calling) or override '
  '(the super admin, marked and re-reviewed). ITER-058.';
