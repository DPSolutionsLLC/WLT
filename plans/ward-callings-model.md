# Plan: Ward Callings — one person, a real calling in each ward

**Created:** 2026-09-21
**Type:** feature
**Source:** [plans/P2-unit-hierarchy.md](P2-unit-hierarchy.md), correcting slice `proto-c`
**Structure:** Sequential — **this is plan 1 of 2**. Plan 2 is
[plans/p2-admin-and-access.md](p2-admin-and-access.md) (`proto-d`) and must run **after** this
one, because every admin screen it builds sits on the table this plan creates.

---

## Overview

Replace the model `proto-c` shipped. It built a **visiting officer** — one person, one `users`
row, one role, borrowing another ward under a reduced permission list. The product wants
something simpler and stronger: **a person is given a real calling in each ward they need**, is
on that ward's roster, and carries **that ward's role and that ward's access** while acting
there. There is no visitor tier, no guest, and no cross-ward read.

It may never be used. It is being built now because retrofitting one-person-to-many-callings
later is the overhaul with real breakage risk, and the shape is cheap to draw today.

### Key requirements

1. `ward_role_assignments` becomes the source of truth for "what role does this person hold, in
   which ward, in which organization".
2. **The 131 RLS policies still do not move.** They read `current_ward_id()`,
   `current_user_role()`, `current_org_id()` and `is_bishopric()`; repointing those four at the
   active assignment leaves every policy correct and unchanged.
3. **A person acting in ward B can WRITE there.** This is the requirement `proto-c` could not
   have met — see Finding 1.
4. Every migration in slices 1–3 is a **no-op on the day it applies**, because the backfill is
   1:1 and exact.
5. Stake officers keep reaching **nothing**. `STAKE_OFFICER_PERMISSIONS` is already `[]`; this
   plan does not widen it.
6. A person who belongs to exactly one ward sees no change anywhere.

### Success criteria

- `tests/rls/ward-callings.test.ts` green, including a **write** performed in a second ward.
- Every pre-existing RLS suite still green — that is the proof the 131 did not move.
- `npm run lint`, `npm run typecheck`, `npm run harness:typecheck`, `npm run test`,
  `npm run build` all clean, each checked by its **own** exit code (see Validation).

---

## Three findings that set this plan's size

Read these before writing SQL. The first is the one that makes this plan large.

### 1. Forty-eight composite foreign keys forbid a second-ward write

`grep "references users (id, ward_id)" supabase/migrations/*.sql` returns **48 constraints
across 27 migrations** — `visit_logs.recorded_by`, `activity_logs.logged_by`,
`programs.approved_by`, `agendas.published_by`, `notifications.recipient_user_id`, and 43 more.

Each asserts: **the person who authored this row belongs to this row's ward.** That was exactly
right while a person had one ward. Under this model it is false, and it fails closed in the
worst way:

> Sister X's `users.ward_id` is ward A. She holds Relief Society president in ward B. She logs a
> visit there → `visit_logs(ward_id = B, recorded_by = X)` → the FK demands a `users` row with
> `(X, B)` → **SQLSTATE 23503**, surfacing as a 500.

This is migration **067**'s defect — the one the route test caught on `audit_log` — times 48.
There is no constraint that can express "the author holds an assignment in this ward", and a
trigger is forbidden (CLAUDE.md §9: *"There are no triggers anywhere in this repo; do not add the
first one for this"*). **So the constraints must be narrowed.** Slice 2.

### 2. `users.ward_id` STAYS. Only `role`, `org_id` and `counselor_position` go.

`users.ward_id` is `NOT NULL`, is half of `unique (id, ward_id)`, and after slice 2 still anchors
nothing — but it remains the person's **home ward**: the ward their account was created in, the
one they land in when they have no other, and the fallback `current_ward_id()` uses when no
assignment is active. Dropping it would touch `resolveSessionWardId`, the invite flow, youth
account creation and registration for no gain this plan needs.

### 3. `resolveSessionWardId()` is a SECOND place that answers "which ward"

[lib/supabase/scoped.ts](../lib/supabase/scoped.ts) reads `users.ward_id` directly. That returns
the **home** ward, not the ward being acted in — so every `scopedQuery` would filter on the wrong
ward the moment somebody acts in their second calling. It must read the same answer the database
does. Task 3.6.

---

## Decisions taken before planning

| Question | Answer | Why |
|---|---|---|
| The 48 composite FKs | **Narrow all of them now** | Confirmed by the user 2026-09-21. Each swap is a RELAXATION — every row satisfying the composite satisfies the single-column key — so it cannot fail on existing data. Deferring leaves multi-ward able to read and not to write, failing as a 500. |
| `users.role` / `org_id` / `counselor_position` | **Dropped**, after the deploy | Two places answering "what calling does this person hold" is `notification-trigger-drift` waiting to happen — that retro is one list in three copies, all disagreeing. The contract half is held back; the repo already has the machinery. |
| `users.ward_id` | **Stays** — the home ward | Finding 2. |
| `unit_assignments` (065) | **Stays, untouched** | Stake roles and `super_admin` are a different axis: an assignment over a UNIT, not a calling in a ward. `proto-d` builds on it. |
| Migration 066 | **Superseded, never edited** | It is applied. Its functions are replaced by `create or replace` in slice 3. |

**Written down for the next reader:** this is the shape CLAUDE.md §7 always described — *"the role
assignment carries the ward, not the role… which is also what lets somebody hold different
callings in different wards"*. `proto-c` built past that sentence. This plan implements it.

---

## Relevant Files

### Create

- `supabase/migrations/068_ward_role_assignments.sql` — the table, the 1:1 backfill, RLS + policies.
- `supabase/migrations/069_narrow_user_author_fks.sql` — the 48 constraint swaps, catalog-driven.
- `supabase/migrations/070_callings_resolve_the_session.sql` — repoints `current_ward_id`,
  `current_user_role`, `current_org_id`, `is_bishopric`, `can_act_in_ward`, `session_context`,
  `switchable_wards`; drops `acting_in_home_ward`.
- `supabase/migrations/071_drop_user_calling_columns.sql` — **HELD BACK UNTIL DEPLOYED.**
- `lib/callings/queries.ts` — read a person's callings, read a ward's holders of a role.
- `lib/callings/writeCalling.ts` — create / update / end a calling, service-role, audited.
- `tests/rls/ward-callings.test.ts` — the phase's highest-value suite.
- `tests/rls/ward-callings-write.test.ts` — **a second-ward WRITE**, the thing 048 FKs blocked.
- `tests/db/user-author-fks.test.ts` — asserts no composite `(author, ward_id)` FK survives.
- `tests/routes/session-active-ward.test.ts` — **modify**, see below.
- `testing/scenarios/auth/scenario-066-one-person-two-callings/{scenario.md,seed.ts}`

### Modify

- `types/domain.ts` — `SessionUser` loses `isVisitingWard`, gains `callingId`; add `Calling`.
- `types/database.ts` — regenerated. **Never hand-edited.**
- `lib/auth/session.ts` — resolve role and org from `session_context()`, not from the `users` row.
- `lib/supabase/scoped.ts` — `resolveSessionWardId()` must return the ACTIVE ward (Finding 3).
- `lib/notifications/emitNotification.ts`, `notifyOtherBishopric.ts`, `notifyOrgLeadership.ts` —
  resolve recipients from callings, not from `users`. **Load-bearing**, see Pitfall 2.
- `lib/auth/invites.ts` — redemption writes a calling row.
- `lib/auth/adminUsers.ts` — the ward user list and role changes read/write callings.
- `lib/auth/youthAccounts.ts` — a youth account is a calling too.
- `app/api/auth/login/route.ts`, `app/api/auth/pin-login/route.ts` — whatever they read of role.
- `lib/units/queries.ts`, `lib/units/wardSwitch.ts` — `can_act_in_ward` now means "holds a
  calling there"; `listSwitchableWards()` lists the wards they hold callings in.
- `tests/helpers/seed.ts` — seed callings; a handle may hold a second one.
- `tests/rls/users-column-grant.test.ts`, `tests/lib/permissions.test.ts`,
  `tests/lib/session.test.ts` — whatever the change breaks.
- `testing/scenarios/auth/scenario-064-*/scenario.md` — **delete the superseded scenario**, or
  replace it with 066. Decide at execution; do not leave two scenarios describing rival models.

---

## Dependencies

- **No new libraries.**
- Reuse, do not reinvent: `writeAuditLog()`, `assertCan()` / `resolveRoleAccess()`,
  `respondToRouteError()` / `readJsonBody()`, `seedFixtures()` / `asRole()`,
  `isPolicyRefusal()` ([lib/youth/policyRefusal.ts](../lib/youth/policyRefusal.ts)).
- Two hosted-database steps: `npm run db:push`, then `npm run db:types`.
  **`npm run db:reset` wipes the shared hosted project — never run it** (CLAUDE.md §9).

---

## Known Pitfalls (from retro context)

- **`unit-hierarchy-and-ward-switch` — the retro for the work this plan corrects.** Read its
  superseding banner first. Its three still-correct findings carry forward unchanged:
  `current_ward_id()` must **re-validate on every read** (never a plain `coalesce`);
  `users_ward_select` needs its `or id = auth.uid()` arm or **the switch signs the switcher out**;
  and a column GRANT must open `active_ward_id` before any policy can guard it.

- **`notification-trigger-drift` (ITER-023) — one list, three copies, all disagreeing.** This
  plan's version is the role list in `users.role`'s CHECK, in `ROLES`, and now in
  `ward_role_assignments.role`'s CHECK. Three copies again. **Point the new CHECK at the same
  list and extend `tests/lib/permissions.test.ts`'s disk-reading assertion to cover it**, or this
  retro repeats verbatim.

- **⚠️ `notification-trigger-drift`, the OTHER half — a failure confined to where it should have
  been caught.** Its actual damage was that flagging a follow-up *"stamped `flag_sent_at`, logged
  `notified: true` and delivered NOTHING"*. The three notification helpers in this plan resolve
  recipients by `(ward_id, role)` on `users`. Miss one and a person holding a calling in ward B
  **never receives ward B's notifications**, while `emitNotification` returns without an error —
  silent by construction, exactly as before. Change all three together.

- **`role-access-overrides` (ITER-005) — the compiler is the enumerator.** `RoleAccess` is
  `Record<Role, …>`. Do not silence a new-role compile error with a default or an index signature.

- **`youth-j` / defect `060-D2` — a mirror must copy BOTH halves of a policy**, and a failed
  `WITH CHECK` **raises** (42501) where a failed `USING` returns zero rows. `ward_role_assignments`
  will carry an asymmetric policy; map 42501 with `isPolicyRefusal()`, narrowly.

- **`talks-d` hole, five sightings — never scope a policy on a nullable author column.**
  `ward_role_assignments.created_by` is nullable and must not appear in any policy predicate.

- **`seed-household-id-collision` — fixture ids must be unique per run.** New calling fixtures
  take the per-run id like everything else in `seedFixtures`.

- **`youth-b` / `youth-c` — `npm run build` catches what lint, typecheck and the suite miss.**

---

## Tasks

### Slice 1 — the table (migration 068). One commit.

**Requirement: deployable with zero visible effect.** Nothing reads the new table yet.

#### Task 1.1 — `ward_role_assignments`

**File:** `supabase/migrations/068_ward_role_assignments.sql` (create)

```sql
create table ward_role_assignments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users (id) on delete cascade,
  ward_id            uuid not null references wards (id) on delete cascade,
  role               text not null check (role in ( /* the 15 values — see Task 1.2 */ )),
  org_id             uuid,
  counselor_position integer check (counselor_position in (1, 2)),
  is_active          boolean not null default true,
  started_on         date,
  ended_on           date,
  created_by         uuid references users (id) on delete set null,
  created_at         timestamptz not null default now(),

  foreign key (org_id, ward_id) references organizations (id, ward_id)
);

create unique index ward_role_assignments_one_per_ward
  on ward_role_assignments (user_id, ward_id)
  where is_active;

create index ward_role_assignments_user_id_idx on ward_role_assignments (user_id);
create index ward_role_assignments_ward_role_idx on ward_role_assignments (ward_id, role)
  where is_active;
```

**Details:**
- **ONE ACTIVE CALLING PER WARD, enforced by a partial unique index.** A person may hold callings
  in several wards; two *simultaneous* callings in the SAME ward has no meaning the session could
  resolve — `current_user_role()` would have two answers. The partial `where is_active` is what
  lets the history stay (a released calling keeps its row) while the live answer stays single.
- `foreign key (org_id, ward_id) references organizations (id, ward_id)` — the composite FK is
  **kept here**, and that is not a contradiction of slice 2: this one asserts the organization is
  in the same ward as the calling, which is still true and still worth enforcing. Slice 2 removes
  only the FKs asserting an *author* belongs to a ward.
- `created_by` is nullable and **must never appear in a policy predicate** (`talks-d`).
- `started_on` / `ended_on` are record-keeping and drive no arithmetic in this plan. `is_active`
  is the column every query reads, matching `users.is_active`'s existing role.

#### Task 1.2 — the role CHECK, and the drift test that guards it

Use the **same 15 values** as `users_role_check` (migration 065g). Extend
`tests/lib/permissions.test.ts`'s existing disk-reading block — which already asserts
`users_role_check` and `invites_role_check` match `ROLES` — to assert this third copy too. One
list, three copies; the test is what stops them drifting.

#### Task 1.3 — the 1:1 backfill

```sql
insert into ward_role_assignments (user_id, ward_id, role, org_id, counselor_position, is_active)
select id, ward_id, role, org_id, counselor_position, is_active
from users;
```

**Lossless and exact.** Every existing `users` row becomes exactly one calling, so every helper
in slice 3 returns the identical answer it returns today. That is what makes 068–070 no-ops.

#### Task 1.4 — RLS and policies

```sql
alter table ward_role_assignments enable row level security;

create policy ward_role_assignments_select on ward_role_assignments
  for select to authenticated
  using (ward_id = current_ward_id() or user_id = auth.uid());
```

**SELECT only — no write policies.** Callings are written through the **service-role client**
(`lib/callings/writeCalling.ts`), the shape [lib/auth/adminUsers.ts](../lib/auth/adminUsers.ts)
already uses for role changes, with `assertCan()` as the boundary in the route. `proto-d` builds
the screen. Do not add write policies here — there is no screen to exercise them.

`or user_id = auth.uid()` is the same load-bearing arm `users_ward_select` needed: a person acting
in ward B must still be able to read their own ward A calling, or they cannot get back.

---

### Slice 2 — the 48 foreign keys (migration 069). One commit.

**Requirement: a pure relaxation. It cannot fail on an existing row.**

#### Task 2.1 — narrow every `(author, ward_id) → users (id, ward_id)` FK

**File:** `supabase/migrations/069_narrow_user_author_fks.sql` (create)

**CATALOG-DRIVEN, not a hand-written list of 48** — migration 019 Part 2's precedent, and for its
stated reason: *"the failure mode this guards against is precisely 'someone added a table and
forgot'."* A hand-written list is 48 chances to mistype a constraint name.

```sql
do $$
declare
  fk record;
  author_column text;
  delete_action text;
begin
  for fk in
    select con.oid, con.conname, con.conrelid::regclass::text as table_name,
           con.confdeltype, con.conkey, con.confkey
      from pg_constraint con
      join pg_class ref on ref.oid = con.confrelid
      join pg_namespace ns on ns.oid = ref.relnamespace
     where con.contype = 'f'
       and ref.relname = 'users'
       and ns.nspname  = 'public'
       and array_length(con.conkey, 1) = 2
  loop
    -- the local column that is NOT ward_id
    select attname into author_column
      from pg_attribute
     where attrelid = fk.oid::regclass  -- resolve against conrelid; see Details
       and attnum = any (fk.conkey)
       and attname <> 'ward_id';

    delete_action := case fk.confdeltype
      when 'c' then ' on delete cascade'
      when 'n' then ' on delete set null'
      when 'r' then ' on delete restrict'
      when 'd' then ' on delete set default'
      else ''
    end;

    execute format('alter table %s drop constraint %I', fk.table_name, fk.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references users (id)%s',
      fk.table_name, fk.conname, author_column, delete_action
    );
  end loop;
end $$;
```

**Details — all of these matter:**
- **PRESERVE `on delete`.** Several of these are `on delete cascade` (notifications,
  `visit_private_notes`, `activity_private_notes`) and several are `on delete set null`
  (`threads`, `sacrament_assignments`). Losing a `cascade` orphans rows; losing a `set null`
  makes a user undeletable. `confdeltype` is the only honest source — do not assume `no action`.
- **KEEP THE CONSTRAINT NAME.** Re-adding under the same name keeps every existing error message
  and every migration comment that refers to it accurate.
- **Resolve `author_column` against `conrelid`**, not against the constraint oid — the sketch
  above is deliberately marked; write it correctly and verify against
  `tests/db/user-author-fks.test.ts` before trusting it.
- **The loop must not touch `unique (id, ward_id)` on `users` itself**, which is a *unique*
  constraint, not a foreign key — `contype = 'f'` already excludes it. It stays: slice 1's
  `organizations (id, ward_id)` FK and others still rely on that idiom elsewhere.
- **What is given up, written down:** the database no longer proves an author belonged to the
  ward they wrote in. That is a fact which is now *legitimately false*. What still holds: the
  author is a real user, and **RLS still scopes every insert to `current_ward_id()`**, which is
  the boundary that actually matters (rule 2).

#### Task 2.2 — the test that keeps it true

**File:** `tests/db/user-author-fks.test.ts` (create)

Query the catalog through a `security definer` introspection helper (the shape migration 019
Part 5 already uses for `tables_without_rls`) and assert **zero** two-column foreign keys
referencing `users` remain. A future migration re-adding one would silently re-break
second-ward writes; this is what catches it.

---

### Slice 3 — the session resolves from callings (migration 070 + TypeScript). One commit.

**The dangerous one.** Everything here can silently widen or narrow access.

#### Task 3.1 — repoint the four helper functions

**File:** `supabase/migrations/070_callings_resolve_the_session.sql` (create)

```sql
create or replace function current_ward_id()
  returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select case
           when u.active_ward_id is not null and can_act_in_ward(u.id, u.active_ward_id)
             then u.active_ward_id
           else u.ward_id
         end
    from users u where u.id = auth.uid();
$$;

create or replace function can_act_in_ward(target_user uuid, target_ward uuid)
  returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from ward_role_assignments a
      join users u on u.id = a.user_id
     where a.user_id = target_user and a.ward_id = target_ward
       and a.is_active and u.is_active
  );
$$;

create or replace function current_user_role()
  returns text language sql stable security definer set search_path = public, pg_temp
as $$
  select a.role from ward_role_assignments a
   where a.user_id = auth.uid() and a.ward_id = current_ward_id() and a.is_active;
$$;

create or replace function current_org_id()
  returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select a.org_id from ward_role_assignments a
   where a.user_id = auth.uid() and a.ward_id = current_ward_id() and a.is_active;
$$;

create or replace function is_bishopric()
  returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(current_user_role() in ('bishop', 'counselor'), false);
$$;

drop function acting_in_home_ward();
```

**Details:**
- **`current_ward_id()` still re-validates on every read** — carried forward from 066 and still
  the difference between "released on Sunday" and "still reading ward B in March".
- **`can_act_in_ward()` becomes much simpler and much stronger**: not "is a stake officer above
  this ward" but **"do you hold an active calling there"**. The `unit_assignments` arm is
  **deliberately removed** — a stake officer reaches nothing (CLAUDE.md §7), and `super_admin`'s
  reach is `proto-d`'s to decide with its own screen and its own written rule.
- **`is_bishopric()` gets simpler and `acting_in_home_ward()` disappears entirely.** The whole
  visiting-officer apparatus was compensating for a role that did not follow the ward. It does
  now, so the compensation is deleted rather than left inert.
- Keep migration 019's comment on `is_bishopric()`: bishopric authority is shared, and there is
  deliberately no function granting the bishop something a counselor lacks.

#### Task 3.2 — `session_context()` and `switchable_wards()`

`session_context()` drops `acting_in_home_ward` and gains `role` and `calling_id`, so the app
takes the role from the same round trip as the ward and the two cannot disagree.
`switchable_wards()` becomes "wards I hold an active calling in", which is the honest list and
is what the P3 control will render.

#### Task 3.3 — `lib/auth/session.ts`

Take `role`, `orgId`, `counselorPosition` from `session_context()` rather than from the `users`
row. **Throw on an RPC error; never fall back to the `users` row** — a silent fall back is the
app and RLS disagreeing, which is the failure this whole design exists to prevent (rule 7).

#### Task 3.4 — `types/domain.ts`

`SessionUser` **loses `isVisitingWard`** (there is no visitor) and gains `callingId: string`.
`homeWardId` survives and now means "the ward my account belongs to", which is still true.

#### Task 3.5 — the three notification helpers

**Files:** `lib/notifications/emitNotification.ts`, `notifyOtherBishopric.ts`,
`notifyOrgLeadership.ts` (modify)

Each currently asks `users` for `(ward_id, role, is_active[, org_id])`. Each must ask
`ward_role_assignments` for `(ward_id, role, is_active[, org_id])` **joined to `users.is_active`**
— a calling can be active on a deactivated account, and that person must not be notified.

**Change all three in one commit** (Pitfall 2). A missed one delivers nothing and says nothing.

#### Task 3.6 — `resolveSessionWardId()` must return the ACTIVE ward

**File:** `lib/supabase/scoped.ts` (modify)

It reads `users.ward_id` — the HOME ward. Under this model that is the wrong ward the moment
somebody acts in a second calling, and `scopedQuery` would filter every read to the wrong place.
Read `current_ward_id()` through `session_context()` instead. Its header's "defence in depth, NOT
the security boundary" comment stays true and stays put.

#### Task 3.7 — the write paths

**Files:** `lib/auth/invites.ts`, `lib/auth/adminUsers.ts`, `lib/auth/youthAccounts.ts`,
`lib/callings/writeCalling.ts` (create)

Every path that today writes `users.role` / `org_id` / `counselor_position` writes a **calling**
instead. Redeeming an invite creates one; the admin role change updates one; creating a youth
account creates one.

**Keep the last-bishop guard and re-point it**: `countActiveBishops()` must count active callings
with `role = 'bishop'` in that ward, joined to active users. Its message and its check-then-act
trade-off do not change. `countActiveSuperAdmins()` is untouched — `super_admin` lives in
`unit_assignments`, a different axis.

#### Task 3.8 — `lib/units/*`

`listSwitchableWards()` returns the wards the caller holds an active calling in, and `[]` for
somebody with one calling — the "anyone who belongs to one ward never sees the unit layer"
requirement is unchanged. `switchActiveWard()` keeps its 42501 mapping.

---

### Slice 4 — the contract (migration 071). HELD BACK.

**File:** `supabase/migrations/071_drop_user_calling_columns.sql` (create, do not apply)

```sql
alter table users drop column role;
alter table users drop column org_id;
alter table users drop column counselor_position;
```

**Add `"071"` to `HELD_BACK_UNTIL_DEPLOYED` in
[tests/db/migrations.test.ts](../tests/db/migrations.test.ts), naming its pair and its reason.**
The deployed build selects these columns through `lib/auth/session.ts` and `adminUsers`, and
PostgREST answers a select naming a missing column with a **400** — applying it early answers
every authenticated page 400 at once, which is `062`/`063`'s lesson verbatim.

**Apply it only after the slice-3 deploy is live and walked, and delete the allowlist entry in
the same change** — an entry that outlives its deploy hides the migration from the assertion that
everything on disk has been applied.

---

## Deploy order, and the one window that is not covered

1. Apply **068** and **069**. Both are no-ops for the running build.
2. Apply **070**. Still a no-op: the backfill makes every helper return its current answer.
3. **Deploy** the slice-3 code.
4. Apply **071**, and remove its allowlist entry.

**The gap, stated rather than discovered:** between steps 2 and 3, the running build writes a role
change to `users.role` only, so the calling row would go stale and RLS would read the old role.
The window is minutes, on an app with one ward and one admin, and the recovery is to re-run
Task 1.3's backfill as an update. **A dual-write phase is deliberately not built** — it would be
permanent machinery for a transient risk of that size. If the deploy is expected to be slow, make
no role changes during it.

---

## Testing Strategy

Priority follows CLAUDE.md §8: RLS first, then permission helpers, then routes.

### `tests/rls/ward-callings.test.ts` (create)

Seed a person with callings in **two** wards. Every case re-reads with the service client.

- `current_user_role()` returns the **ward A role** at home and the **ward B role** after a switch
  — the assertion `proto-c` got backwards
- `current_org_id()` returns their **ward B organization**, not null and not ward A's
- `is_bishopric()` is **true** in a ward where their calling is bishop and **false** in a ward
  where it is not — the same person, both answers
- a person with ONE calling reads exactly what they read before (the no-op proof)
- switching to a ward where the calling was **deactivated** falls back to the home ward on the
  **next read** — revocation is immediate
- **private notes never widen.** `visit_private_notes` and `activity_private_notes` stay
  `user_id = auth.uid()` in both wards (rule 5)
- a second-ward calling **cannot** read a third ward

### `tests/rls/ward-callings-write.test.ts` (create) — the point of slice 2

**This suite would have been impossible before migration 069, and that is what it documents.**

- a person acting under their ward B calling **inserts a `visit_log`** there and the row survives
  a service-client re-read
- the same for `activity_logs` and one `programs` write — three different composite FKs, so a
  single missed constraint fails here
- an insert naming an author with **no** calling in that ward is still refused, by RLS

### `tests/db/user-author-fks.test.ts` (create)

Zero two-column foreign keys referencing `users` remain. Read from the catalog.

### Modify

- `tests/lib/permissions.test.ts` — extend the disk-reading block to the third role CHECK.
- `tests/lib/session.test.ts` — `isVisitingWard` is gone; `callingId` is present.
- `tests/routes/session-active-ward.test.ts` — the ward list is now callings-based.
- `tests/helpers/seed.ts` — `HandleSpec` gains an optional `secondCalling`.

---

## Test Scenarios (Harness)

### Scenario 066: One person, two callings

**Folder:** `testing/scenarios/auth/scenario-066-one-person-two-callings/`
**Tags:** `auth`, `admin`, `full`
**Purpose:** The model, walkable. One person who is Relief Society president in ward 1 and ward
secretary in ward 2 — different role, different organization, different access in each. Seeding
is the whole value: there is no UI for assigning a second calling until `proto-d`.

**Seed data summary:**
- `units` — 3 — one stake, two ward children
- `wards` — 2 · `users` — 5 · `ward_role_assignments` — 6 (one person holds two)
- ward 2: 4 households, 2 visit logs (one carrying a **private note** by ward 2's bishop)

**Tester action:** sign in as the two-calling person, work in ward 1, switch to ward 2, **write
something there**, then switch back.

**Verification checklist (machine-checkable):**
- [ ] In ward 1 the header names ward 1 and the role reads **Relief Society president**
- [ ] After switching, the header names ward 2 and the role reads **ward secretary**
- [ ] The nav changes between the two — different callings grant different modules
- [ ] A visit logged in ward 2 **persists**, and `visit_logs.recorded_by` is that person
- [ ] Ward 2's private note is **absent from the page source** in both wards
- [ ] One audit row per switch, filed under the ward being entered
- [ ] A single-calling leader still returns `wards: []` from `GET /api/session/active-ward`

**Needs a human eye:**
- [ ] Is it obvious *which calling you are acting under*, or only which ward?
- [ ] Does switching feel like changing hats, or like changing accounts?

### Scenario 065 stays as it is

It proves a NEGATIVE — a one-ward leader sees no unit layer — and that promise is unchanged.
**Re-walk it after slice 3**; it is the cheapest proof the no-op claim held.

---

## Validation Commands

**Capture each command's OWN exit code.** A previous run reported success from a pipeline's
exit code rather than vitest's and hid 7 failures — `npm run test | tail` returns `tail`'s status.

```bash
npm run db:push && npm run db:types   # NEVER db:reset (CLAUDE.md §9)

npm run lint;             echo "LINT=$?"
npm run typecheck;        echo "TSC=$?"
npm run harness:typecheck; echo "HARNESS=$?"
npx vitest run --reporter=dot; echo "VITEST=$?"
npm run build;            echo "BUILD=$?"
```

The full suite runs against the shared hosted project and takes ~40 minutes. **Leave a gap
between full runs** — `tests/helpers/asRole.ts` warns that repeated runs hit the auth rate limit,
which showed up as 7 timeouts on 2026-09-21 that all passed on re-run.

Targeted while iterating:

```bash
npx vitest run tests/rls/ward-callings.test.ts tests/rls/ward-callings-write.test.ts
npx vitest run tests/db/user-author-fks.test.ts tests/db/migrations.test.ts tests/db/rls-enabled.test.ts
npx vitest run tests/rls/ward-isolation.test.ts tests/lib/permissions.test.ts
```

---

## Integration Notes

### Breaking changes

- **`SessionUser.isVisitingWard` is removed.** Nothing reads it today; grep before assuming.
- **`users.role` / `org_id` / `counselor_position` stop existing** after slice 4. Every read must
  have moved to a calling by then — the compiler finds them once `types/database.ts` is
  regenerated.
- **`acting_in_home_ward()` is dropped.** Nothing outside migration 066 calls it.

### Documentation to update in the same commits

- **CLAUDE.md §7** — replace the "Multi-ward access — THE MODEL, corrected" warning block with
  what was actually built. The ⚠️ pointing at `lib/units/` and migration 066 comes off.
- **CLAUDE.md §4 rule 1** — unchanged; `ward_role_assignments` HAS a `ward_id`.
- **`plans/P2-unit-hierarchy.md`** — mark `proto-c` corrected and point at this plan.
- **`plans/retros/unit-hierarchy-and-ward-switch.md`** — its banner stays; add the fix's slug.

### Deliberately out of scope

- **`proto-d` entirely** — plan 2.
- **The stake officer's agenda view.** A read-only view of the one meeting they attend plus that
  meeting's prayer roll. Narrow, purpose-built, and **not `agendas.view`**, which would grant
  every agenda the ward ever published. It belongs to whichever phase builds agendas' surfaces.
- **The switcher CONTROL** — P3 chrome.
- **Any UI for assigning a second calling** — `proto-d`.
- **`super_admin`'s reach across wards.** `can_act_in_ward()` deliberately loses its
  `unit_assignments` arm here; `proto-d` decides what a super admin reaches and writes the rule
  down when it builds the screen that grants it.
