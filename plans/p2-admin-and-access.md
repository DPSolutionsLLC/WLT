# Plan: P2 Admin & Access — super admin, Stakes & Wards, and the request flow

**Created:** 2026-09-21
**Type:** feature
**Source:** [plans/P2-unit-hierarchy.md](P2-unit-hierarchy.md), slice `proto-d`
**Structure:** Sequential — **this is plan 2 of 2**. Plan 1 is
[plans/ward-callings-model.md](ward-callings-model.md) and **must be executed, deployed and
walked first**. Every screen here writes the table plan 1 creates, and two of its tasks are
explicitly deferred decisions that plan 1 hands forward.

Executing this closes **P2**.

---

## Overview

The admin surface for the unit hierarchy: who may create a stake, who may grant a permission a
ward does not have by default, and how a ward asks for one. It maps the prototype's access model
onto WLT's existing one rather than beside it.

### Key requirements

1. **Do not build a parallel permission model beside
   [lib/auth/permissions.ts](../lib/auth/permissions.ts).** The prototype's matrix is an INPUT
   that must be translated, not a second engine to run alongside the first.
2. **An app-wide grant never turns on silently.** Changing a default writes an explicit *off*
   override for every existing ward, plus a notification carrying a one-tap "turn on for my ward".
3. **The requester can see the outcome.** The prototype shipped the request flow without this
   first and caught the gap; do not repeat it.
4. **Self-initiated changes go through the same path as approved requests** — one mechanism, not
   two.
5. A ward with no stake above it, and a leader with one calling, see none of this.

### Success criteria

- A super admin can create a stake, nest wards under it, and assign somebody a **second calling**
  — the state plan 1's scenario 066 can currently only reach by seeding.
- `tests/rls/access-requests.test.ts` green, including that a ward admin cannot approve their own
  request.
- Every pre-existing suite still green. Lint, typecheck, harness typecheck, full suite and build
  all clean, **each checked by its own exit code**.

---

## The mapping — the prototype's matrix onto WLT's

| Prototype | Here |
|---|---|
| `F` (full) | `*.manage` |
| `R` (read) | `*.view` |
| `Q` (quorum) | the existing `org_id` scoping — **not a new level** |
| ward narrows a default off | `wards.settings.role_access` **remove**-delta |
| request unlocks something new | `role_access` **add**-delta + the request flow below |

`role_access` already resolves as add/remove deltas against the code defaults
(`mergeRoleAccess`), and `admin.*` / `sacrament.*` are already non-overridable in both
directions. **That machinery is the target; this plan feeds it, it does not replace it.**

---

## Two inputs that must be settled before the matrix is treated as authoritative

Both are recorded in [plans/prototype/module-map.md](prototype/module-map.md) §4 and
[decisions.md](prototype/decisions.md), and **both need the user, not a guess.**

1. **⚠️ The prototype's role list has no Young Men.** Five org presidencies where
   `organizations.type` has six. Almost certainly an omission rather than a decision — but if the
   matrix is ported verbatim, Young Men leaders silently lose every grant. **Confirm first.**
2. **⚠️ Two corrupted matrix entries** — `stake-president.access.zoom` and
   `music-coordinator.access.music` each hold a pasted build note where a level belongs. Neither
   can be read; both need a human to say what the level should be.

A third, already answered and carried forward: **`ward_council_member` has no prototype
equivalent and must not be dropped.** CLAUDE.md calls it "the widest role in the app" and several
youth decisions turn on it.

---

## Relevant Files

### Create

- `supabase/migrations/072_access_requests.sql` — the request table, RLS, and the super-admin
  write path.
- `lib/access/requests.ts` — create / approve / deny, service-role, audited.
- `lib/access/appWideGrant.ts` — the off-override fan-out. **The dangerous one**; see Task 3.2.
- `lib/units/writeUnit.ts` — create and rename units, set `unit_number`.
- `lib/roster/wardRoster.ts` — the roster boundary (Task 4.1).
- `app/api/access-requests/route.ts`, `app/api/access-requests/[id]/route.ts`
- `app/api/units/route.ts`, `app/api/units/[id]/route.ts`
- `app/api/callings/route.ts` — assign a person a calling in a ward (**plan 1 left this to us**).
- `app/(app)/admin/stakes/page.tsx` — Stakes & Wards.
- `app/(app)/admin/access-requests/page.tsx` — the queue, and the requester's own view.
- `tests/rls/access-requests.test.ts`, `tests/rls/units-write.test.ts`
- `tests/routes/accessRequests.test.ts`, `tests/routes/callings.test.ts`
- `tests/lib/appWideGrant.test.ts`
- `testing/scenarios/admin/scenario-067-asking-for-a-permission/{scenario.md,seed.ts}`
- `testing/scenarios/admin/scenario-068-a-stake-and-its-wards/{scenario.md,seed.ts}`

### Modify

- `lib/auth/permissions.ts` — whatever the matrix port changes; **`NON_OVERRIDABLE_PERMISSIONS`
  and `NON_OVERRIDABLE_ROLES` do not widen.**
- `lib/auth/navigation.ts` — the two new admin pages, gated on `admin.view` **and built**.
- `supabase/seed/notification_triggers.sql` — new trigger keys, and `SPEC.md` and
  `testing/infrastructure/seedUtils.ts` in the **same commit** (see Pitfalls).
- `types/domain.ts` — request statuses and their labels.
- `CLAUDE.md` §7, `plans/P2-unit-hierarchy.md` — mark P2 closed.

---

## Known Pitfalls (from retro context)

- **`notification-trigger-drift` (ITER-023) — one list, three copies.** This plan adds notification
  triggers for request-submitted, request-decided and app-wide-grant. The seed SQL, `SPEC.md` and
  the harness constant must change **in the same commit**, or `emitNotification()` looks the key
  up, finds no row, and **returns without an error or a log** — a notification that never arrives
  and nothing observes. `tests/db/notification-triggers-seed.test.ts` is what catches it.

- **`role-access-overrides` (ITER-005)** — `role_access` is a **delta**, never a replacement list.
  The app-wide fan-out in Task 3.2 writes *remove*-deltas; it must merge into each ward's existing
  settings object, never overwrite it. `writeCrossOrgVisibility()`'s header carries this warning
  verbatim for the same jsonb column — a wholesale write would silently delete every ward's
  permission overrides, which is the worst possible side effect of flipping a default.

- **`youth-h` / `060-D2` — a policy mirror must copy BOTH halves**, and a failed `WITH CHECK`
  raises (42501) where a failed `USING` returns zero rows. Map it with `isPolicyRefusal()`.

- **`talks-d` hole — never scope a policy on a nullable author column.** `access_requests`
  carries `requested_by` and `decided_by`; `decided_by` is null until a decision exists, so it
  must not appear in any policy predicate.

- **`visits-f` — refuse, and name the alternative, without disclosing counts or content.**

- **`youth-b` / `youth-c` — `npm run build` catches what lint, typecheck and the suite miss.**
  Both new pages are client components; their wording belongs in `types/domain.ts`, never in a
  route file.

---

## Tasks

### Slice 1 — Stakes & Wards. One commit.

#### Task 1.1 — `lib/units/writeUnit.ts` and the routes

Create and rename units; set `unit_number`, which **starts empty and is editable** — it is the
real church-assigned number, never app-invented (migration 065a). Service-role client, because
`units` has SELECT-only policies by design (065f) and that is not changing here.

`assertCan()` is the boundary. **Creating a unit requires `super_admin`**, checked against the
caller's `unit_assignments`, not against a ward permission — a ward has no standing to create the
stake above itself.

#### Task 1.2 — the Stakes & Wards screen

List stakes, wards nested under theirs, create and rename both. **Build no area or district
screens** — the data shape anticipates them and nothing else does (CLAUDE.md §7).

**`wards.unit_id` becomes `not null` only when ward creation goes through this screen.** Migration
065c left it nullable deliberately because `tests/helpers/seed.ts` inserts wards directly. If this
slice tightens it, the seed helper must set it first — otherwise every RLS suite goes red on the
day it applies.

#### Task 1.3 — assigning a calling

`POST /api/callings` — give a person a role in a ward. **This is what makes plan 1's scenario 066
reachable by hand**, and it is the first screen that can create a second calling.

Guards: `admin.manage_users` for a calling in the caller's own ward; `super_admin` for one in any
other. **Re-use `countActiveBishops()`'s last-bishop guard** — ending somebody's bishop calling is
the same lockout risk as demoting them, and plan 1 re-pointed that guard at callings.

---

### Slice 2 — the request → approve flow. One commit.

#### Task 2.1 — `access_requests`

**File:** `supabase/migrations/072_access_requests.sql` (create)

Columns: `id`, `ward_id` (NOT NULL — rule 1), `requested_by`, `role`, `permission`, `level`,
`reason` (NOT NULL — a request without a written reason is not a request), `status`
(`pending | approved_ward | approved_app_wide | denied`), `decided_by` (nullable),
`decision_note`, `decided_at`, `created_at`.

RLS: a ward reads **its own** requests; a super admin reads all. Writes go through the
service-role client, as everywhere else administrative in this repo.

**`decided_by` is nullable and must never appear in a policy predicate** (`talks-d`).

#### Task 2.2 — the requester sees the outcome

The prototype shipped this flow **without** outcome visibility and caught the gap. A denied
request must show its `decision_note` to the person who asked, or the flow teaches leaders that
asking does nothing.

#### Task 2.3 — a ward admin cannot approve their own request

Only a super admin decides. Asserted in `tests/rls/access-requests.test.ts` — the single most
important case in the suite, because the whole point of a request is that somebody else answers.

---

### Slice 3 — granting. One commit. **The dangerous one.**

#### Task 3.1 — ward-scoped approval

Writes an **add-delta** into that one ward's `wards.settings.role_access`. Merge, never replace.

#### Task 3.2 — app-wide approval, and the fan-out

**File:** `lib/access/appWideGrant.ts` (create)

**AN APP-WIDE GRANT NEVER TURNS ON SILENTLY.** Changing a code default would otherwise widen
every ward in the app at once, with nobody asked. So approving app-wide:

1. changes the default (a code change, shipped normally);
2. writes an explicit **remove**-delta into **every existing ward's** `role_access`, so no ward's
   effective access moves on the day it lands;
3. notifies each ward's bishopric with a one-tap **"turn on for my ward"**, which deletes that
   ward's remove-delta.

**Every write in step 2 merges into the existing settings object.** A wholesale write deletes the
ward's other overrides — `writeCrossOrgVisibility()` carries this exact warning for this exact
column.

**Step 2 is not atomic across wards** and cannot be. Make it idempotent and re-runnable, log per
ward, and **do not swallow a per-ward failure** (rule 7) — a ward that silently missed its
off-override is a ward that silently gained a permission.

#### Task 3.3 — one mechanism, not two

A super admin changing something directly goes through **the same code path** as an approved
request, writing a request row with `status = approved_*` and `requested_by = decided_by`. Two
paths would drift, and the audit log would tell two different stories about the same act.

---

### Slice 4 — the roster boundary. One commit.

#### Task 4.1 — `lib/roster/wardRoster.ts`

[decisions.md §5](prototype/decisions.md) asks that *"get the current roster for this ward"* be a
**single interface the rest of the app consumes**, so a future real LCR integration replaces what
is behind one boundary rather than something scattered through every module.

**This phase is when that is cheap to draw** — P2 is already touching the access model, and no
roster code is otherwise in flight.

Scope it honestly: **one read function**, adopted by the callers that already ask for a ward's
roster. It is a seam, not a rewrite. **Roster import stays ward-level and ward-owned** — not
something a super admin manages centrally.

---

## Testing Strategy

- `tests/rls/access-requests.test.ts` — a ward reads only its own; a super admin reads all; **a
  ward admin cannot approve their own**; no authenticated write path exists.
- `tests/rls/units-write.test.ts` — an authenticated insert into `units` is still refused;
  creation goes through the service-role path only.
- `tests/lib/appWideGrant.test.ts` — **pure, no database.** The fan-out produces a remove-delta
  per ward; an existing unrelated override **survives**; re-running is idempotent. This is the
  test that catches a wholesale settings overwrite.
- `tests/routes/callings.test.ts` — assigning a second calling; the last-bishop guard fires; a
  ward admin cannot assign into another ward.
- `tests/db/notification-triggers-seed.test.ts` — already exists; it will go red until all three
  copies of the new trigger keys agree. **That is the mechanism working.**

---

## Test Scenarios (Harness)

### Scenario 067: Asking for a permission

**Tags:** `admin`, `auth`, `full`
**Purpose:** The request flow end to end, including the outcome the requester sees. Seeding gives
a pending request and a super admin to decide it — a state with no UI path until this slice.

**Verification checklist (machine-checkable):**
- [ ] A ward admin submits a request with a reason and sees it as **pending**
- [ ] The same admin **cannot** approve it — no control, and the API refuses
- [ ] After a super admin denies with a note, **the requester can read the note**
- [ ] After a ward-scoped approval, that ward's `role_access` gains an add-delta and **no other
      ward's settings changed**
- [ ] An audit row exists for the submission and for the decision

**Needs a human eye:**
- [ ] Does a denial read as a decision somebody made, or as the app refusing?

### Scenario 068: A stake and its wards

**Tags:** `admin`, `full`
**Purpose:** Creating a stake, nesting wards, and assigning a person a second calling — the
first time scenario 066's state is reachable without seeding.

**Verification checklist (machine-checkable):**
- [ ] A super admin creates a stake and nests two wards under it
- [ ] `unit_number` starts **empty** and saves when typed
- [ ] Assigning a second calling makes `GET /api/session/active-ward` return two wards **for that
      person only**
- [ ] A ward admin sees no Stakes & Wards entry anywhere
- [ ] Deleting a stake with wards under it **fails loudly** (`on delete restrict`, migration 065a)

---

## Validation Commands

**Capture each command's own exit code** — a pipeline's status is not the tool's.

```bash
npm run db:push && npm run db:types   # NEVER db:reset (CLAUDE.md §9)

npm run lint;              echo "LINT=$?"
npm run typecheck;         echo "TSC=$?"
npm run harness:typecheck; echo "HARNESS=$?"
npx vitest run --reporter=dot; echo "VITEST=$?"
npm run build;             echo "BUILD=$?"
```

Leave a gap between full suite runs — the hosted project's auth rate limit produces timeouts that
pass on re-run.

---

## Integration Notes

### Breaking changes

- **`wards.unit_id` may become `not null`** (Task 1.2). If it does, `tests/helpers/seed.ts` must
  set it in the same commit or every RLS suite goes red.
- **New notification trigger keys** must land in all three places at once.

### Documentation to update in the same commits

- **CLAUDE.md §7** — P2 closed; what a super admin actually reaches, written down rather than
  deferred.
- **`plans/P2-unit-hierarchy.md`** — status to closed, all four slices marked.
- **`plans/INDEX.md`** — P2's row.

### Deliberately out of scope

- **Area and district screens.** The data shape only.
- **The stake officer's agenda view** — read-only, one meeting, plus that meeting's prayer roll.
  Narrow and purpose-built, **never `agendas.view`**. It belongs to whichever phase builds
  agendas' surfaces, not here.
- **Real LCR integration.** Task 4.1 draws the boundary; nothing goes behind it yet.
- **The switcher control** — P3 chrome.
