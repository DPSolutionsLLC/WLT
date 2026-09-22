# P2 — Unit Hierarchy

**Depends on:** nothing (runs in parallel with P1). **Size:** Large — the biggest single piece
of work since Foundation.
**Status: ✅ CLOSED 2026-09-21.** All four slices shipped.
`proto-b` applied (migration 065). `proto-c` applied (066, 067) but **its model was wrong**;
**CORRECTED by [plans/ward-callings-model.md](ward-callings-model.md), migrations 068–071**.
`proto-d` — [plans/p2-admin-and-access.md](p2-admin-and-access.md) — shipped with migrations
072–074: an **organization-aware permission matrix** re-derived from the prototype, the
**Stakes & Wards** screen, `POST /api/callings` (which makes scenario 066's state reachable by
hand for the first time), `access_requests` with its request → decide flow, the app-wide grant
fan-out, and `lib/roster/wardRoster.ts`. See CLAUDE.md §7 for what a super admin actually reaches
and what survived the re-derivation unchanged.

Stakes above wards, a super admin above both, and a session that can act in a ward other than
the user's own — without rewriting 131 RLS policies.

> ✅ **MODEL CORRECTION, 2026-09-21 — MADE. Read before planning anything here.**
>
> The correction is implemented in migrations **068** (`ward_role_assignments` + the 1:1
> backfill), **069** (the 48 composite foreign keys), **070** (the session resolves from a
> calling) and **071** (the contract half, **held back until the slice-3 deploy is live**).
> CLAUDE.md §7 *Multi-ward access* is the authoritative description of what was built; what
> follows is the record of what was wrong and why.
>
> `proto-c` shipped a **visiting officer**: one person, one `users` row, one role, borrowing
> another ward under a reduced read-only permission list. **That is not the model.** A person who
> needs more than one ward is **given a real calling in each ward** — on that ward's roster, with
> that ward's role and that ward's access — and simply *is* a leader there while acting there.
> There is no visitor tier and no cross-ward read. CLAUDE.md §7 said so ("the role assignment
> carries the ward, not the role") before the code was written.
>
> **Stake officers get no app access at all.** Eventually: a read-only view of the ONE meeting's
> agenda they are attending, plus adding to that meeting's prayer roll. Not `agendas.view`, which
> is every agenda the ward ever published. `STAKE_OFFICER_PERMISSIONS` is now empty.
>
> **What survives:** 065 nearly in full, 067 entirely, and the central claim that the 131 policies
> do not move — point the four helpers at an active **ward-role assignment** and every policy is
> still correct. **What is replaced (068+, never by editing 066, which is applied):**
> `current_user_role()` must follow the ward; `current_org_id()` must return the person's real
> organization in the ward being acted in, not null; `is_bishopric()` asks the active assignment
> and `acting_in_home_ward()` stops existing.
>
> **Settled:** `users.role` / `org_id` / `counselor_position` are **DROPPED** (migration 071,
> held back until the deploy). Two places answering "what calling does this person hold" is
> `notification-trigger-drift` waiting to happen. `users.ward_id` **stays** as the home ward.
>
> **And one finding the replan did not anticipate, which set its size:** forty-eight composite
> foreign keys `(author, ward_id) → users (id, ward_id)` forbid a second-ward WRITE — migration
> 067's defect times forty-eight. Narrowed in 069, catalog-driven; `tests/db/user-author-fks.test.ts`
> fails if one comes back.

**Load with this:** [prototype/decisions.md](prototype/decisions.md) §5 (the held plan) and §2.3
(the access-model conflict).

---

## The reversal this phase is

`plans/INDEX.md` listed **"Multi-ward UI — the data model supports it, the interface does not"**
as explicitly out of scope for v1, and `12-polish-multiward.md` held the scaffolding for last.
Both were superseded 2026-09-20: the prototype carries a stake tier, a super admin and ward
switching, and the user chose to build the hierarchy now rather than defer it.

It runs **early** rather than last because P3's tile dashboard computes visibility from the
access model. Building that against the old model and again against the new one is waste.

---

## Two findings that make this tractable

**1. Twenty-six of the prototype's 33 roles already exist.** `users.counselor_position` has been
in migration 002 since Foundation, checked `in (1, 2)`. So:

| Prototype | Here | New? |
|---|---|---|
| `elders-quorum-president` | `org_president` + `org_id` | no |
| `bishopric-1st-counselor` | `counselor` + `counselor_position = 1` | no |
| 20 org roles | 3 role values × `org_id` × position | no |
| 4 stake roles, `super_admin`, 2 specialists | — | ~~7 new~~ **5, and 5 landed** |

**Do not add 33 role values.**

> **CORRECTED BY `proto-b`, 2026-09-21.** Five role values landed, not seven, and the arithmetic
> is the same argument this table already makes one row higher: `users.counselor_position`
> collapses `stake-1st-counselor` and `stake-2nd-counselor` into one `stake_counselor`, exactly
> as it does for the bishopric. So **3** stake values + `super_admin` +
> `resource_center_specialist`. The seventh, `sacrament-ordinance-coordinator`, is marked
> **verify** in `plans/prototype/module-map.md` §4 against the existing `sacrament_manager` and
> is **deferred to P11**, which owns that module.

**2. The 173 `current_ward_id()` references sit behind one function.** Every policy asks
`ward_id = current_ward_id()`, and that is a single `stable security definer` function returning
`users.ward_id` (migration 019, line 30). Change what it returns and **the 131 policies do not
move**:

```sql
current_ward_id()  →  coalesce(users.active_ward_id, users.ward_id)
```

> **⚠️ THAT LINE IS WRONG AND WAS NOT BUILT. CORRECTED BY `proto-c`, 2026-09-21.** A plain
> `coalesce` authorizes the switch **once, at write time, forever** — release a stake president
> in September and their session is still reading ward B in March, until somebody remembers to
> null the column. The shipped function **re-validates on every read**:
>
> ```sql
> case when u.active_ward_id is not null and can_act_in_ward(u.id, u.active_ward_id)
>      then u.active_ward_id else u.ward_id end
> ```
>
> It is `stable`, so Postgres evaluates it once per statement rather than once per row, and
> revocation therefore costs one extra lookup per statement. See migration 066b.

A stake president does not need cross-ward policies. They need an **authorized ward switch**,
after which every existing policy is already correct for the ward they are in. The risk
concentrates into one function plus one switching mechanism instead of spreading across every
table in the schema.

---

## Pre-work — two data fixes

Before the prototype's access matrix is used as input:

1. **Two corrupted entries.** `stake-president.access.zoom` and `music-coordinator.access.music`
   each hold a pasted build note where an access level belongs, both starting `"F "` followed by
   paragraphs. Both should be `"F"`.
2. **No Young Men presidency.** The prototype has `young-women-*` and no `young-men-*`, while
   `organizations.type` has six orgs. Almost certainly an omission, not a decision. **Confirm
   with the user** before treating the matrix as authoritative.

Also note: **`R` (read-only) is never used** by any of the 33 roles — every grant is `F` or `Q`.
The prototype kept the tier deliberately but nothing exercises it, so it is unproven design.
WLT's existing `view`/`manage` split already covers it if it turns out to be wanted.

---

## Slice `proto-b` — the schema ✅ DONE 2026-09-21 (migration 065)

> Built from `plans/unit-hierarchy-and-ward-switch.md`. Retro:
> `plans/retros/unit-hierarchy-and-ward-switch.md`.

**Migration 065.** Schema only. **No behaviour change, no policy edits, nothing reads the new
columns yet.** This slice must be deployable with zero visible effect.

```
units
  id, unit_number (the REAL church-assigned number, nullable until known),
  type check (type in ('area','stake','ward')),
  parent_id → units (nullable),
  name, created_at

wards.unit_id        → units   (every existing ward gets a unit row; backfill is 1:1)
users.active_ward_id → wards   (nullable; null means "my own ward")
members.mrn          text      (nullable — membership record number)
```

**Model generically, build narrowly.** `type` covers area/stake/ward because real church
structure also has missions and districts as stake-equivalents, and how far up this goes is
genuinely uncertain — which is itself the reason not to hardcode two levels. **Build no area- or
district-level screens.** Only the shape anticipates them.

**Role values:** add `stake_president`, `stake_counselor`, `stake_secretary`, `super_admin` and
the two specialists to the `users.role` CHECK **and** to `ROLES` in `types/domain.ts` in the same
change — migration 002's own comment warns that if they drift the database accepts a value the
TypeScript union rejects. `stake_counselor` uses `counselor_position`, the same as the bishopric.

**The assignment carries the ward, not the role.** Roles stay reusable templates. Today `users`
holds one row per person with one `ward_id`; a person holding callings in two wards needs a
second row or a join table. **Decide which in this slice** and write the reason down — the
prototype's plan says the ward lives on the assignment, and `users.id` is `auth.users.id`, so a
second `users` row per person is not available. A `unit_assignments` join table is the likely
answer.

**Backfill is mandatory and lossless:** one `units` row of type `ward` per existing ward, no
parent. Stakes are created by a human afterwards.

## Slice `proto-c` — the switch, and the RLS that guards it ⚠️ SUPERSEDED (migrations 066, 067)

> **Applied, then corrected the same day by migrations 068–070.** 066's functions were replaced
> in place by `create or replace`; the file itself was never edited, because it is applied. 067
> survives entirely and was the first sighting of the composite-foreign-key defect that 069 then
> found forty-seven more of. Read what follows as the record of the first attempt, not as a
> description of the code.

> Built from `plans/unit-hierarchy-and-ward-switch.md`. Retro:
> `plans/retros/unit-hierarchy-and-ward-switch.md`. Migration **067** was not planned: `audit_log`
> carried a composite FK `(user_id, ward_id) → users (id, ward_id)`, which makes an audit row
> filed under the ward being VISITED unwritable — and `writeAuditLog()` never throws, so every
> mutation a visiting officer made would have gone silently unaudited (rule 6).

**The dangerous one.** Everything in this slice can silently widen access.

**Migration 066** rewrites three functions and nothing else:

```sql
current_ward_id()  →  coalesce(active_ward_id, ward_id)  from users where id = auth.uid()
current_org_id()   →  org_id, but NULL whenever active_ward_id is set and differs from ward_id
is_bishopric()     →  unchanged in shape; must not return true for a visiting stake officer
```

> **CORRECTED BY `proto-c`, 2026-09-21 — three things this got wrong.** All three are recorded
> here rather than only in the migration, because this file is what a later reader opens first.
>
> **1. `current_ward_id()` is not a `coalesce`.** See the correction above.
>
> **2. `current_org_id()` and `is_bishopric()` key off `acting_in_home_ward()`, not off
> "`active_ward_id` is set and differs".** One mechanism rather than two: when
> `current_ward_id()` falls back because authorization was revoked, the organization and the
> bishopric flag fall back **with it**, automatically and in step. Writing the same condition in
> three places is three chances for one to drift.
>
> **3. It rewrites three functions and ALSO replaces two `users` policies, and both were
> mandatory.** `users_ward_select` gains `or id = auth.uid()`, because after a switch a visiting
> officer's own `users.ward_id` is still their home ward — so `ward_id = current_ward_id()` stops
> matching their own row, `lib/auth/session.ts` reads nothing, and **the switch signs the
> switcher out**. And `users_update_self` gains a `WITH CHECK` arm, which needs a column
> `GRANT` in front of it: migration 022 revoked UPDATE on `users` and granted back only
> `theme_preference`, and **column privileges are checked before policies**, so no policy could
> have opened the switch on its own.
>
> Two functions this file does not mention also landed: `session_context()` (so the app reads the
> effective ward rather than recomputing it) and `switchable_wards()` (because `wards_select` is
> `id = current_ward_id()`, so the ward picker **cannot** be built from the caller's own reads —
> see migration 066f for why widening that policy would have been the wrong trade).

> **`current_org_id()` is the subtle one.** A stake president switched into a ward has no
> organization *in that ward*, and their own `org_id` points at a row in a different ward
> entirely. Returning it would make org-scoped policies match rows they have no business seeing
> — and `household_stewardships`, `visit_goals`, `activity_logs` and `youth_activity_profiles`
> all scope on it. **Null is the correct answer**, and the phase's RLS suite must assert it.

**Authorization for the switch itself** is the whole security boundary of this phase. A user may
set `active_ward_id` to ward B only if a unit assignment places them over B — a stake officer
over B's stake, or a super admin. **The policy on `users.active_ward_id` is what enforces it**,
not the route (rule 2).

**Tests — the highest-value in this phase.** Add `tests/rls/unit-switching.test.ts` asserting,
for every case, by re-reading with the service client:

- An ordinary ward member **cannot** set `active_ward_id` at all
- A stake officer **can** switch to a ward in their stake and **cannot** to one outside it
- After an authorized switch, a stake officer reads ward B's data — and **writes are still
  refused** wherever the existing policy requires an org or the bishopric
- `current_org_id()` returns null across the switch
- `is_bishopric()` is false for a visiting stake officer
- **Private notes never widen.** `visit_private_notes` and `activity_private_notes` stay
  `user_id = auth.uid()` (rule 5) — a ward switch does not reach them, and this is the assertion
  that proves the phase did not break the promise the whole app rests on

**Session and UI:** `requireSessionUser()` gains the active ward; the switcher is a control in
P3's chrome, but the *mechanism* lands here so it can be tested before it is visible. **Anyone
who belongs to exactly one ward never sees the control at all** — the same logic already applied
to roles.

**Also here, because they are cheap and they matter:**

- **The last active super admin can never be deactivated or removed.** The same shape as the
  existing last-bishop lockout guard in `auth-b`.
- **Assigning super admin needs more friction** than an ordinary role — it bypasses the access
  matrix entirely.

## Slice `proto-d` — super admin and the access matrix

The admin surface. Maps the prototype's model onto WLT's rather than beside it:

| Prototype | Here |
|---|---|
| `F` (full) | `*.manage` |
| `R` (read) | `*.view` |
| `Q` (quorum) | the existing `org_id` scoping |
| ward narrows a default off | `wards.settings.role_access` remove-delta |
| request unlocks something new | `role_access` add-delta + the new request flow |

**Do not build a parallel permission model beside `lib/auth/permissions.ts`.**

**The request → approve flow** is genuinely new: a ward admin requests role + module + level
with a written reason; a super admin approves ward-scoped, approves app-wide, or denies with a
note. **The requester can see the outcome** — the prototype shipped this without it first and
caught the gap.

**An app-wide grant never turns on silently.** Changing a default writes an explicit *off*
override for every existing ward, plus a notification carrying a one-tap "turn on for my ward".
Self-initiated changes go through the same path as approved requests — one mechanism, not two.

**Stakes & Wards screen:** list stakes, wards nested under theirs, create and rename both.
`unit_number` is editable and starts empty.

> **Do not let the roster boundary leak.** [prototype/decisions.md](prototype/decisions.md) §5
> asks that *"get the current roster for this ward"* be a single interface the rest of the app
> consumes, so a future real LCR integration replaces what is behind one boundary rather than
> something scattered through every module. This phase is when that is cheap to draw.

---

## Deliberately not in this phase

- **Area or district admin screens** — the data shape only.
- **Per-ward data isolation beyond `ward_id`** — it already exists and already works.
- **Real LCR integration.** See decisions.md §4.9: the hard part is not name matching, it is
  that every module references a person by an app-generated id, so reconciliation means
  re-pointing every one of those references. A review needs **three** outcomes per person, not
  two.
- **The LCR-import ↔ access-control cross-check** (decisions.md §4.4) — needs P4's roster
  re-skin first.

---

## Definition of done

- [ ] Migration 065 applies with **zero** behaviour change; the app is walked after it
- [ ] `ROLES` in `types/domain.ts` and the `users.role` CHECK match exactly
- [ ] Migration 066 changes three functions and **no policies**
- [ ] `tests/rls/unit-switching.test.ts` covers every case above, including the private-note one
- [ ] Every existing RLS suite still green — that is the proof the 131 policies did not move
- [ ] The last-super-admin guard has its own test
- [ ] Audit rows on every switch, every role change, every grant
- [ ] `explicitTimeZone.test.ts` green (CLAUDE.md rule 12)

## What to verify by hand

Sign in as an ordinary ward member and confirm **no ward control appears anywhere**. Sign in as
a stake officer, switch into a second ward, and confirm you can read its visits and youth pages
but cannot write anything org-scoped — then check that a private note written by someone in that
ward is invisible to you. That last one is the phase's real test.
