---
id: unit-hierarchy-and-ward-switch
type: feature
iter: null
commits: ["663f8f8"]
date: 2026-09-21
files:
  - supabase/migrations/065_unit_hierarchy.sql
  - supabase/migrations/066_ward_switch.sql
  - supabase/migrations/067_audit_log_cross_ward_author.sql
  - types/domain.ts
  - lib/auth/session.ts
  - lib/auth/permissions.ts
  - lib/auth/adminUsers.ts
  - lib/units/queries.ts
  - lib/units/wardSwitch.ts
  - lib/validation/wardSwitch.ts
  - lib/validation/adminUser.ts
  - app/api/session/active-ward/route.ts
  - tests/helpers/seed.ts
  - testing/infrastructure/seedUtils.ts
  - testing/infrastructure/cleanUp.ts
related:
  - foundation-b-schema
  - foundation-c-services
  - auth-a-session-shell
  - auth-b-invites-admin
  - role-access-overrides
  - youth-j-team-roster
  - ward-callings-model
---

## ⚠️ Superseded in part, 2026-09-21 — the model was wrong

**The fix is [ward-callings-model](ward-callings-model.md), migrations 068–071, same day.**

The mechanism here works and is applied. **What it implements is not what the product wants.**

It built a *visiting officer*: one person, one `users` row, one role, borrowing another ward with
a reduced read-only permission list. The user's model — confirmed the same day, and already
written in CLAUDE.md §7 before this was built — is that **a person holds a real calling in each
ward** and carries that ward's role while acting there. There is no visitor tier.

Separately: **stake officers get no app access at all.** The intended surface is a read-only view
of the one meeting's agenda they are attending, plus adding to that meeting's prayer roll.
`STAKE_OFFICER_PERMISSIONS` was emptied on 2026-09-21.

**Still correct:** migration 065 nearly in full, migration 067 entirely, and the central claim
that **the 131 policies do not move** — pointing the four helper functions at an active
*ward-role assignment* keeps every policy correct and unchanged. **To be replaced (in 068+, not
edited — 066 is applied):** `current_user_role()` staying put, `current_org_id()` returning null,
and `is_bishopric()` keying off `acting_in_home_ward()`.

Read the rest of this file as the record of what was built, not as guidance.

## What was done

P2 slices `proto-b` and `proto-c`: a generic `units` hierarchy (area / stake / ward) and
`unit_assignments` above wards, plus an **authorized ward switch** that lets a stake officer act
inside a ward that is not their own. The mechanism is deliberately not cross-ward policies — it
changes what `current_ward_id()` returns, so all 131 existing policies stay untouched and simply
become correct for the ward the officer switched into. Five new role values landed (three stake
roles, `super_admin`, `resource_center_specialist`), the session now carries home / active /
effective ward, and `GET|PATCH /api/session/active-ward` is the mechanism P3's chrome control
will call.

Both slices are invisible to anybody who belongs to one ward, which is the phase's stated
requirement: `listSwitchableWards()` returns `[]` without a unit assignment, and
`INVITABLE_ROLES` was narrowed in the same edit so the new roles never appear in a ward's invite
dropdown.

## Key decisions

- **`current_ward_id()` re-validates on every read** rather than being the phase file's plain
  `coalesce(active_ward_id, ward_id)`. A coalesce authorizes the switch once, at write time,
  forever — releasing a stake president would leave their session reading ward B until somebody
  nulled the column. The function is `stable`, so this costs one lookup per statement, not per
  row. `current_org_id()` and `is_bishopric()` key off one `acting_in_home_ward()` so all three
  fall back in step rather than through three conditions that can drift.

- **An additive `unit_assignments` table, not a move of every calling.** `users` stays the
  person's HOME row — `ward_id`, `role` and `org_id` do not move — which is what lets
  `current_*()` and the session keep reading it, and is the actual reason the 131 policies did
  not move. `SessionUser.wardId` keeps its name and changes meaning to "the ward being acted
  in", so ~200 existing call sites became correct without an edit.

- **Two gaps in the plan, both found by building it, both resolved without widening a policy.**
  `wards_select` is `id = current_ward_id()`, so the ward picker could never be assembled from
  the caller's own reads — solved with a `security definer` `switchable_wards()` returning three
  columns, rather than widening a policy that would have exposed another ward's `settings`. And
  `audit_log` carried a composite FK `(user_id, ward_id) → users (id, ward_id)`, which makes an
  audit row filed under the VISITED ward unwritable; since `writeAuditLog()` never throws, every
  mutation a visiting officer made would have gone **silently unaudited** (rule 6). Migration 067
  narrows that FK to the author alone — the audit row's ward is where the action happened, which
  after 066 is genuinely not the author's home ward.

- **Writes are refused across a switch by the existing policies, not by new checks.** A visitor
  has no organization (`current_org_id()` is null) and is not bishopric, so `visit_goals`,
  `household_stewardships` and `wards` all refuse them already. The same mechanism means a
  visitor reads **no visit reports** unless the visited ward has cross-org visibility on — kept
  deliberately, because a fourth arm naming stake officers would give a visitor more than the
  ward's own EQ president gets, and would be the first cross-ward predicate in the schema.

- **Private notes never widen**, asserted directly and on both sides of the cross-org setting.
  That is the assertion the whole phase is judged by (rule 5).
