-- Phase 2, migration 073: A WARD ASKS FOR A PERMISSION IT DOES NOT HAVE.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: one new table, its policies and
-- two indexes. It sets nothing NOT NULL on an existing table, narrows no CHECK and tightens no
-- policy, so there is no row that exists today which it could fail on.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added — 059's header carries the argument: that allowlist is for the contract half of an
-- expand-and-contract pair, and an entry that is not needed HIDES a real migration from the
-- assertion that everything on disk has been applied. `ward-callings-model` then learned the
-- harder half of the same lesson: `supabase db push` has no per-file exclusion, so the only real
-- hold-back is not creating the file until the deploy is live.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS FOR
-- ---------------------------------------------------------------------------
-- `wards.settings.role_access` already lets a ward NARROW what a role holds, and already lets it
-- WIDEN one — `mergeRoleAccess` resolves add/remove deltas against the code defaults, and
-- ITER-005 built that machinery. What has never existed is a way for a ward to ASK, and for
-- somebody else to answer.
--
-- This table is that conversation, recorded. It is NOT a second permission engine: an approval
-- writes an ordinary add-delta into `wards.settings.role_access` and the resolution path is
-- completely unchanged. Key requirement 1 of plans/p2-admin-and-access.md forbids a parallel
-- model beside lib/auth/permissions.ts, and this file adds none.
--
-- ---------------------------------------------------------------------------
-- THE ONE RULE THIS TABLE EXISTS TO ENFORCE: SOMEBODY ELSE ANSWERS
-- ---------------------------------------------------------------------------
-- A ward admin may ASK and may READ THE OUTCOME. They may not DECIDE. That is the whole point of
-- a request — if the asker could approve it, the ward would simply be granting itself the
-- permission and the request would be paperwork around a self-grant.
--
-- It is enforced the only way that survives a forgotten route check: THERE IS NO AUTHENTICATED
-- WRITE PATH AT ALL. No INSERT, UPDATE or DELETE policy exists, so RLS denies every write by
-- default and both halves — submitting and deciding — run through the service-role client, where
-- lib/access/requests.ts applies the guard. That is the same shape `units`, `unit_assignments`
-- and `ward_role_assignments` already use, and 065f's reasoning applies unchanged: an untested
-- write policy is the most dangerous thing in this phase.
--
-- Structure:
--   073a  the table
--   073b  policies: a ward reads its own, a super admin reads all, nobody writes
--   073c  indexes


-- ---------------------------------------------------------------------------
-- 073a. The table
-- ---------------------------------------------------------------------------
--
-- `ward_id` IS NOT NULL — CLAUDE.md rule 1, and there is no case for an exception here. A request
-- is made BY a ward, FOR that ward, and the four documented ward-less tables are ward-less
-- because a ward is genuinely not the right scope for them. This one is asking for a permission
-- inside exactly one ward.
--
-- `reason` IS NOT NULL. A request with no written reason is not a request — it is a demand, and
-- the person deciding has nothing to decide on. The app refuses an empty one at the boundary too
-- (lib/validation/accessRequest.ts), but the column is what makes it true of every row however
-- it got there.
--
-- `decided_by` IS NULLABLE AND MUST NEVER APPEAR IN A POLICY PREDICATE. That is the `talks-d`
-- hole, now six sightings in this repo: a null author column makes a predicate NULL rather than
-- false, and the row becomes invisible to the very person who needs to see it. Here it would be
-- worse than usual — a pending request has a null `decided_by` BY DEFINITION, so a policy reading
-- it would hide exactly the rows waiting to be answered.
create table access_requests (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,

  -- WHO ASKED. Nullable only because `on delete set null` must be able to fire: the request is a
  -- record of a decision and must outlive the account that made it. It is NOT in any policy
  -- predicate either, for the reason above.
  requested_by  uuid references users (id) on delete set null,

  -- WHAT IS BEING ASKED FOR. The role and the permission, as the app names them — deliberately
  -- plain `text` and NOT a CHECK against a list, because ROLES and PERMISSIONS are TypeScript
  -- constants that grow every phase and a CHECK here would be a seventh copy of a list to keep in
  -- step (`notification-trigger-drift`, ITER-023). The Zod schema validates them at the boundary
  -- against the real constants, which cannot drift from themselves.
  role          text not null,
  permission    text not null,

  -- The prototype's level, kept so the request records what was actually asked for. `F` and `Q`
  -- are the only levels its matrix ever uses; `R` exists in its vocabulary and is never used, so
  -- it is accepted here and means nothing yet (decisions.md §2.3).
  level         text not null default 'F' check (level in ('F', 'R', 'Q')),

  reason        text not null,

  -- `approved_ward` and `approved_app_wide` are two different acts with two different blast
  -- radii, and collapsing them into one `approved` plus a boolean would make the audit trail
  -- ambiguous about which one happened.
  status        text not null default 'pending' check (
                  status in ('pending', 'approved_ward', 'approved_app_wide', 'denied')
                ),

  decided_by    uuid references users (id) on delete set null,

  -- THE REQUESTER MUST BE ABLE TO READ THIS. The prototype shipped the request flow WITHOUT
  -- outcome visibility and caught the gap itself; a denial nobody can read teaches leaders that
  -- asking does nothing.
  decision_note text,
  decided_at    timestamptz,

  created_at    timestamptz not null default now()
);

-- A decision has a decider and a time, or it is not a decision. This is a constraint and not a
-- comment for migration 061's reason: nobody can act on a state the schema should have refused.
-- A pending row has neither; a decided row has both.
alter table access_requests
  add constraint access_requests_decision_complete check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_at is not null)
  );

comment on table access_requests is
  'A ward asking for a permission its roles do not hold by default. An approval writes an add-delta into wards.settings.role_access; this table is the conversation, not a second permission engine.';


-- ---------------------------------------------------------------------------
-- 073b. Policies — a ward reads its own, a super admin reads all, nobody writes
-- ---------------------------------------------------------------------------
--
-- SELECT ONLY, DELIBERATELY. See the header: there is no authenticated write path, so a ward
-- admin CANNOT approve their own request even if a route forgot to check — which is CLAUDE.md
-- rule 2 working as intended, and is the single most important thing
-- tests/rls/access-requests.test.ts asserts.
--
-- THE READ IS THE WHOLE WARD'S, not just the requester's. `requested_by = auth.uid()` would be
-- the `talks-d` hole again AND would be wrong on its own terms: a bishopric shares admin
-- authority (CLAUDE.md §7), so a counselor must be able to see what the bishop asked for. The
-- ward is the unit that asked.
alter table access_requests enable row level security;

create policy access_requests_select on access_requests
  for select to authenticated
  using (is_super_admin() or ward_id = current_ward_id());


-- ---------------------------------------------------------------------------
-- 073c. Indexes
-- ---------------------------------------------------------------------------
--
-- The queue reads "every pending request, oldest first" across all wards for a super admin, and
-- "this ward's requests, newest first" for a ward. Two access patterns, two indexes.
create index access_requests_ward_created_idx
  on access_requests (ward_id, created_at desc);

create index access_requests_pending_idx
  on access_requests (created_at)
  where status = 'pending';
