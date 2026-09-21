-- Phase 2, migration 068: A CALLING IN A WARD.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CORRECTS
-- ---------------------------------------------------------------------------
-- Migration 066 built a VISITING OFFICER: one person, one `users` row, one role, borrowing
-- another ward under a reduced permission list. The product wants something simpler and
-- stronger, and CLAUDE.md §7 has described it all along — "the role assignment carries the ward,
-- not the role… which is also what lets somebody hold different callings in different wards".
--
-- A person who needs access to more than one ward is GIVEN A REAL CALLING IN EACH. They are on
-- that ward's roster, tied to a role there, and they carry exactly the access that role carries
-- in that ward. There is no visitor tier, no reduced-rights guest, and no cross-ward read.
--
-- This file creates the table and backfills it 1:1 from `users`. NOTHING READS IT YET.
-- Migration 070 repoints the four session helpers at it; until then every helper answers exactly
-- what it answers today, because the backfill is exact.
--
-- APPLIES IMMEDIATELY and is invisible: a new table nothing queries, plus rows that duplicate
-- facts already on `users`. No entry in HELD_BACK_UNTIL_DEPLOYED, and none should be added.
--
-- Structure:
--   068a  the table
--   068b  the 1:1 backfill
--   068c  RLS and the SELECT policy
--   068d  users.role stops being required


-- ============================================================================
-- 068a — ward_role_assignments
-- ============================================================================
--
-- ONE ACTIVE CALLING PER WARD, enforced by a PARTIAL unique index. A person may hold callings in
-- several wards; two SIMULTANEOUS callings in the SAME ward is a state the session could not
-- resolve — current_user_role() would have two answers and current_org_id() two more. The
-- `where is_active` is what lets the history stay (a released calling keeps its row, with its
-- ended_on) while the live answer stays single.
--
-- `foreign key (org_id, ward_id) references organizations (id, ward_id)` IS KEPT HERE, and that
-- is not a contradiction of migration 069. This one asserts the organization is in the same ward
-- as the calling, which is still true and still worth enforcing. 069 removes only the constraints
-- asserting that an AUTHOR belongs to a ward, which is a fact that is now legitimately false.
--
-- `created_by` is nullable and MUST NEVER APPEAR IN A POLICY PREDICATE. That is the `talks-d`
-- hole, five sightings: `x = auth.uid()` is NULL rather than false when x is null, so a policy
-- scoped on a nullable author column admits or refuses rows nobody intended.
--
-- `started_on` / `ended_on` are record-keeping and drive no arithmetic anywhere in this phase.
-- `is_active` is the column every query reads, matching the role `users.is_active` already has.
create table ward_role_assignments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users (id) on delete cascade,
  ward_id            uuid not null references wards (id) on delete cascade,
  role               text not null check (
                       role in ('bishop', 'counselor', 'ward_secretary', 'executive_secretary',
                                'org_president', 'org_counselor', 'org_secretary',
                                'music_coordinator', 'ward_council_member', 'sacrament_manager',
                                'stake_president', 'stake_counselor', 'stake_secretary',
                                'super_admin', 'resource_center_specialist')
                     ),
  org_id             uuid,
  counselor_position integer check (counselor_position in (1, 2)),
  is_active          boolean not null default true,
  started_on         date,
  ended_on           date,
  created_by         uuid references users (id) on delete set null,
  created_at         timestamptz not null default now(),

  foreign key (org_id, ward_id) references organizations (id, ward_id)
);

-- ONE LIST, NOW THREE COPIES — users_role_check (065g), invites_role_check (065g) and this one.
-- `notification-trigger-drift` (ITER-023) is exactly this shape: one list in three places, all
-- free to disagree, and the drift silent. tests/lib/permissions.test.ts reads all three from disk
-- and asserts they match ROLES in types/domain.ts. A later migration widening the list must widen
-- all three and point that test at the new file, in the same commit.

create unique index ward_role_assignments_one_per_ward
  on ward_role_assignments (user_id, ward_id)
  where is_active;

create index ward_role_assignments_user_id_idx on ward_role_assignments (user_id);
create index ward_role_assignments_ward_role_idx on ward_role_assignments (ward_id, role)
  where is_active;

comment on table ward_role_assignments is
  'A calling: this person holds this role, in this ward, in this organization. The source of '
  'truth for current_user_role(), current_org_id() and is_bishopric() from migration 070 on.';


-- ============================================================================
-- 068b — the 1:1 backfill
-- ============================================================================
--
-- LOSSLESS AND EXACT. Every existing `users` row becomes exactly one calling, so every helper
-- migration 070 rewrites returns the identical answer it returns today. That is what makes
-- 068, 069 and 070 no-ops on the day they apply, and it is the only reason this sequence can be
-- pushed to a live database ahead of the deploy.
--
-- ⚠️ `is_active` IS FORCED TRUE, NOT COPIED FROM `users.is_active`, AND THE DIFFERENCE MATTERS.
-- The plan for this slice wrote `select …, is_active from users`; that is wrong, for two reasons
-- that only appear once something reads the column.
--
--   * THEY ARE TWO DIFFERENT FACTS. `users.is_active` answers "may this account be used";
--     `ward_role_assignments.is_active` answers "is this calling current". A bishop on holiday
--     whose account was switched off is still the bishop. Migration 070a joins BOTH — a calling
--     on a deactivated account authorizes nothing — so nothing is lost by keeping them separate,
--     and lib/notifications/* resolves recipients the same way for the same reason.
--   * COPYING MAKES REACTIVATION IMPOSSIBLE TO GET RIGHT. If deactivating an account had to
--     deactivate its callings, reactivating would have to revive them — and it could not tell a
--     calling switched off with the account from one that was genuinely RELEASED. The account
--     would come back holding a calling somebody had ended.
--
-- Forcing true is also the exact 1:1 the rest of this file claims: today `users.role` carries a
-- value whatever `is_active` says, and the calling IS that role.
insert into ward_role_assignments (user_id, ward_id, role, org_id, counselor_position, is_active)
select id, ward_id, role, org_id, counselor_position, true
from users;


-- ============================================================================
-- 068c — RLS, and a SELECT policy only
-- ============================================================================
--
-- NO WRITE POLICIES, DELIBERATELY. Callings are written through the SERVICE-ROLE client
-- (lib/callings/writeCalling.ts), which is the shape lib/auth/adminUsers.ts already uses for a
-- role change and lib/auth/invites.ts for a redemption — `users` has no INSERT policy either.
-- assertCan() in the route is therefore the effective boundary for a write here, which is why
-- that check can never be skipped. `proto-d` builds the screen; adding write policies now would
-- be policy nobody can exercise and nobody can test.
alter table ward_role_assignments enable row level security;

-- `or user_id = auth.uid()` IS LOAD-BEARING, the same arm `users_ward_select` needed in 066c and
-- for the same reason: a person acting under their ward B calling must still be able to read
-- their ward A calling, or nothing can offer them the way back. It discloses nothing new — it is
-- their own row, and they could already read it while standing at home.
create policy ward_role_assignments_select on ward_role_assignments
  for select to authenticated
  using (ward_id = current_ward_id() or user_id = auth.uid());


-- ============================================================================
-- 068d — users.role stops being required
-- ============================================================================
--
-- THE EXPAND-AND-CONTRACT WINDOW NEEDS THIS, and without it the sequence cannot be deployed.
--
-- Migration 071 drops `users.role`, `users.org_id` and `users.counselor_position`, and it is HELD
-- BACK until the new build is live. So there is a window in which the new code is running against
-- a schema that still has all three columns. In that window every path that CREATES an account —
-- lib/auth/invites.ts, lib/auth/youthAccounts.ts, tests/helpers/seed.ts — must be able to write a
-- CALLING and not a `users.role`, because naming a column 071 has dropped is a 400 the moment it
-- applies. `users.role` being NOT NULL made that impossible: the insert would fail on the
-- constraint before the deploy and fail on the missing column after it, with no version of the
-- code correct on both sides.
--
-- Making it nullable is invisible to the build running right now, which writes the column on
-- every insert exactly as it always has. `org_id` and `counselor_position` have been nullable
-- since migration 002, so only this one needs it.
--
-- `users_role_check` is deliberately LEFT IN PLACE. A CHECK constraint passes on NULL, so it
-- keeps refusing an unrecognised role for as long as anything still writes one, and
-- tests/lib/permissions.test.ts keeps reading it from disk. Dropping it here would remove a live
-- guard in exchange for nothing.
alter table users alter column role drop not null;
