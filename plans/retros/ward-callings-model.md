---
id: ward-callings-model
type: feature
iter: null
commits: ["663f8f8"]
date: 2026-09-21
files:
  - supabase/migrations/068_ward_role_assignments.sql
  - supabase/migrations/069_narrow_user_author_fks.sql
  - supabase/migrations/070_callings_resolve_the_session.sql
  - supabase/migrations/071_drop_user_calling_columns.sql
  - lib/callings/queries.ts
  - lib/callings/writeCalling.ts
  - lib/auth/errors.ts
  - lib/auth/routeErrors.ts
  - lib/visits/participants.ts
  - lib/auth/session.ts
  - lib/auth/adminUsers.ts
  - lib/auth/invites.ts
  - lib/auth/youthAccounts.ts
  - lib/supabase/scoped.ts
  - lib/units/queries.ts
  - lib/calendar/queries.ts
  - lib/callings/callingLabel.ts
  - app/(app)/layout.tsx
  - app/(app)/dashboard/page.tsx
  - lib/notifications/emitNotification.ts
  - lib/notifications/notifyOtherBishopric.ts
  - lib/notifications/notifyOrgLeadership.ts
  - lib/notifications/notifyWardCouncilFlag.ts
  - app/api/auth/login/route.ts
  - app/api/session/active-ward/route.ts
  - types/domain.ts
  - tests/helpers/seed.ts
  - testing/infrastructure/seedUtils.ts
  - testing/infrastructure/cleanUp.ts
related:
  - unit-hierarchy-and-ward-switch
  - notification-trigger-drift
  - role-access-overrides
  - auth-b-invites-admin
  - youth-j-team-roster
fixes: unit-hierarchy-and-ward-switch
---

## What was done

Replaced the **visiting officer** model `proto-c` shipped — one person, one `users` row, one role,
borrowing another ward under a reduced permission list — with the model CLAUDE.md §7 always
described: **a person is given a real calling in each ward they need**, and carries that ward's
role and that ward's access while acting there. `ward_role_assignments` (migration 068) is now the
source of truth for what role somebody holds, in which ward, in which organization; migration 070
points `current_ward_id()`, `current_user_role()`, `current_org_id()` and `is_bishopric()` at the
active calling, and **the 131 policies did not move**.

Between those two, migration 069 narrowed **48 composite foreign keys** that would otherwise have
made a second-ward WRITE impossible. Migration 071 drops `users.role`, `org_id` and
`counselor_position`.

## Key decisions

- **A calling's `is_active` and an account's `is_active` are separate facts.** The plan's backfill
  copied `users.is_active` onto the calling; that is wrong, and the plan contradicted itself about
  it one section later. Deactivating an account must not release its callings, because
  reactivating would then have to revive them and could not tell one switched off with the account
  from one genuinely released. `can_act_in_ward()` joins both instead, so nothing is lost.
- **`users_ward_select` was the one policy that had to move.** A person holding a calling in your
  ward is one of *your* ward's leaders and must be readable as such — otherwise they are silently
  absent from the admin list, with no error anywhere. A `security definer` helper answers it so
  the fact is uniformly evaluable.
- **`can_act_in_ward()` lost both `unit_assignments` arms.** A stake officer reaches nothing
  (CLAUDE.md §7), and a super admin's reach is `proto-d`'s to decide with the screen that grants
  it — not inherited quietly from a migration about something else. The hierarchy is no longer
  consulted by a switch at all.
- **Four notification helpers, not the three the plan named.** `notifyWardCouncilFlag` resolves
  recipients by `(ward_id, role)` exactly as the other three do, and `emitNotification` returns
  without an error when nobody matches — so missing it would have delivered nothing to a
  cross-ward executive secretary, silently. That is `notification-trigger-drift`'s actual damage.
  `listBishopricUsers` and `listOrgLeadershipUsers` in `lib/calendar/queries.ts` needed the same
  change for the same reason.

## The finding the plan missed: an AUTHOR is not a SUBJECT

Migration 069's header argues that narrowing the 48 keys is safe because "the author is still a
real user, and RLS still scopes every insert to `current_ward_id()`". **That argument is sound for
an author and wrong for a subject, and the plan drew no distinction between them.**

An author column (`recorded_by`, `logged_by`, `approved_by`) is written from `auth.uid()`, so RLS
and the session already agree about it. A **subject** column — `visit_participants.user_id` ("who
went"), `sundays.conducting_user_id` ("who conducts"), `conducting_rotation.user_id` — is written
from an id the **caller supplied**, and the composite key was the only thing that ever checked it
belonged to the ward. Narrowing it turned a constraint violation into a **silently accepted row
naming somebody from another ward**.

`tests/routes/visitParticipants.test.ts` caught the first one, and only because the old behaviour
happened to be a 500 that satisfied `toBeGreaterThanOrEqual(400)` — the route had never validated
anything. The fix is one helper, `filterUsersInWard()` / `findUsersOutsideWard()` in
`lib/callings/queries.ts`, applied at every path that writes a user id it did not resolve itself,
plus an `InvalidInputError` that carries a sentence into a 400 instead of a server fault.

**It asks about the CALLING, not `users.ward_id`** — a counselor whose account lives in another
ward holds a real bishopric calling here and must stay selectable, which is the whole point of the
model. `readConductorName()` had the mirror of the same bug and was filtering `users` by
`ward_id`, which would have rendered a cross-ward conductor nameless on the calendar and on the
printed programme.

## What the walk found (scenario 066, 2026-09-21)

Driven in a real browser; every write read back with the service client. The model itself held:
the same account read as **Relief Society President** in ward 1 and **Ward Secretary** in ward 2,
the nav changed with it, and the ward 2 edit produced `audit_log(ward_id = ward 2, user_id = <a
ward 1 user>)` — the row the composite foreign keys forbade. Private notes stayed invisible from
both sides and no ward 1 row was reachable from ward 2.

**066-D1 — the chrome named the role but not the organization, and the user confirmed it had to.**
The header and the dashboard both said "Organization President". Under this model that is half an
answer: somebody holding callings in two wards needs to know WHICH calling is active, and the
organization is the part that decides what they can see. Fixed with `ORG_SCOPED_ROLE_SUFFIXES` and
`describeCalling()` beside `ROLE_LABELS` — **a full `Record<Role, string | null>`, not a Partial**,
so a new org-scoped role fails to compile until somebody decides (the rule `ROLE_LABELS` states
for itself and `role-access-overrides` states for permissions). A calling with no organization is
left alone rather than becoming "Harness Second Ward Ward Secretary", and a failed organization
read degrades to the generic label rather than throwing — the only place in the calling code that
degrades, because this one is a LABEL and the rest is access.

**066-D2 — at phone width the header clips the calling away** (100px of space for 205px of text).
Not caused by this change, but this change is what makes the clipped half load-bearing. **Deferred
by the user** to P3, which rebuilds that chrome with the switcher control.

**A checklist item had to be corrected mid-walk.** "Log a visit in ward 2" described a state the
seeded person cannot reach — `ward_secretary` holds no `visits.*` at all — so it could never have
passed, and ticking it would have reported coverage that did not exist.

## What went wrong during execution

**Migration 071 was applied when it was supposed to be held back.** `supabase db push` has no
per-file exclusion — it applies every unapplied `.sql` on disk — so writing the contract migration
to disk before the push was the same as applying it. `users.role`, `org_id` and
`counselor_position` were dropped while the deployed build still selected them, which makes every
authenticated page on the live deployment answer 400 until the new build ships.

The `HELD_BACK_UNTIL_DEPLOYED` list in `tests/db/migrations.test.ts` is **documentation, not a
mechanism**: it stops the suite complaining about an unapplied file, and it cannot stop a push.
**The only thing that actually holds a migration back is not creating the file until the deploy is
live.** That note now lives in the test file itself.

**Fixture cleanup broke as a direct consequence of migration 069**, and the failure left orphaned
wards, units and auth users in the shared hosted project rather than erroring loudly. Deleting
wards one at a time cascades the first ward's `users` rows while the second ward's
`activity_logs` / `visit_logs` / `programs` rows still reference them through a now-single-column
key with no `on delete` action. Under the old composite `(author, ward_id)` key such a row could
not exist, so ward-by-ward was safe. Both `tests/helpers/seed.ts` and
`testing/infrastructure/cleanUp.ts` now delete every ward in **one statement**, so referential
integrity is checked once, at the end of it.

## Pattern

**A relaxation is never only a relaxation, and the things depending on a constraint are rarely the
things it was written for.** Narrowing 48 foreign keys was reasoned about as a change to
*authorship*. What actually broke was a **validation nobody knew the database was performing** on
caller-supplied ids, and a fixture **teardown** that had quietly relied on the old constraint to
guarantee an ordering it never stated. Neither appears anywhere in the plan.

When a constraint is removed, the question is not "what was it for" but **"what was relying on it
being impossible"** — and the answer is found by grepping for every write of the constrained
column, not by reading the migration that created it.
