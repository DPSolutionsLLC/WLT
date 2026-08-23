-- talks-d follow-up, migration 030: scope goals to the organization that owns them.
--
-- Decided while walking scenario 019. Before this, `goals` sat in migration 019's WARD-SCOPED
-- policy loop: every authenticated member of the ward could read and write every goal, including
-- another organization's. The permission matrix was narrower than the policy, so the route was
-- the only real boundary — the same asymmetry roster-a and roster-b recorded for `members`,
-- `households` and `member_organizations`, and one that talks-d had handed to Phase 11.
--
-- It is closed here instead, because the answer turned out to be a pattern this schema already
-- has. `visit_goals` has been org-scoped since migration 019 with exactly the shape below, and
-- copying a policy that already exists is a much smaller thing to get wrong than inventing one.
--
-- THE RULE:
--   org_id is null  ->  a WARD-LEVEL goal. Bishopric only, read and write.
--   org_id is set   ->  that organization's leadership, plus the bishopric.
--
-- Bishopric authority is shared and total (CLAUDE.md §7): `is_bishopric()` short-circuits the org
-- check on all four verbs, so a bishop and both counselors see and manage every organization's
-- goals. That is the "bishopric owning all as admin" half of the decision.
--
-- Existing rows keep `org_id = null` and so become bishopric-only. That is deliberate: every goal
-- written before this migration was created by a bishopric planner through the only board that
-- existed, so null is the truthful owner rather than a default that loses information.

alter table goals add column org_id uuid;

-- The composite foreign key, matching every other org reference in the schema. It is what makes
-- an org from another ward unrepresentable rather than merely unlikely.
alter table goals
  add constraint goals_org_fk
  foreign key (org_id, ward_id) references organizations (id, ward_id);

-- The policy loop in migration 019 named these four. They are replaced, not amended — a leftover
-- ward-scoped SELECT would sit alongside the org-scoped one and PostgreSQL ORs permissive
-- policies together, so the old one would silently win and this migration would do nothing.
drop policy goals_ward_select on goals;
drop policy goals_ward_insert on goals;
drop policy goals_ward_update on goals;
drop policy goals_ward_delete on goals;

create policy goals_org_select on goals
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy goals_org_insert on goals
  for insert to authenticated
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy goals_org_update on goals
  for update to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()))
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy goals_org_delete on goals
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

-- `current_org_id()` returns NULL for a user with no organization, and in SQL `org_id = null` is
-- never true — so a null-org user who is not bishopric reads nothing here rather than reading
-- every ward-level goal. That is the intended answer and it falls out of the comparison, but it
-- is worth stating because it is the one place this policy's behaviour is not obvious.

comment on column goals.org_id is
  'The organization that owns this goal. NULL means a ward-level goal, visible to the bishopric '
  'only. Set means that org''s leadership plus the bishopric (migration 030).';

-- The board reads a ward's goals filtered by owner, which is the pair this index serves.
create index if not exists goals_ward_org_idx on goals (ward_id, org_id);
