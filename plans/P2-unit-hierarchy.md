# P2 — Unit Hierarchy

**Depends on:** nothing (runs in parallel with P1). **Size:** Large — the biggest single piece
of work since Foundation. **Status:** Not started.

Stakes above wards, a super admin above both, and a session that can act in a ward other than
the user's own — without rewriting 131 RLS policies.

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
| 4 stake roles, `super_admin`, 2 specialists | — | **7 new** |

**Do not add 33 role values.**

**2. The 173 `current_ward_id()` references sit behind one function.** Every policy asks
`ward_id = current_ward_id()`, and that is a single `stable security definer` function returning
`users.ward_id` (migration 019, line 30). Change what it returns and **the 131 policies do not
move**:

```sql
current_ward_id()  →  coalesce(users.active_ward_id, users.ward_id)
```

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

## Slice `proto-b` — the schema

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

## Slice `proto-c` — the switch, and the RLS that guards it

**The dangerous one.** Everything in this slice can silently widen access.

**Migration 066** rewrites three functions and nothing else:

```sql
current_ward_id()  →  coalesce(active_ward_id, ward_id)  from users where id = auth.uid()
current_org_id()   →  org_id, but NULL whenever active_ward_id is set and differs from ward_id
is_bishopric()     →  unchanged in shape; must not return true for a visiting stake officer
```

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
