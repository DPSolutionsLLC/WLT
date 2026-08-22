# Plan: Ward Role-Access Overrides

**Created:** 2026-08-22
**Type:** bugfix
**Scope refs:** ITER-005
**Structure:** Unified

## Overview

`wards.settings.role_access` lets a ward change what a role may do. 37 of the app's 62 permission
checks honour it; the other **25 read the hardcoded `ROLE_PERMISSIONS` defaults and silently ignore
the ward's configuration** — including every `admin.manage_users` check in the app. Nothing writes
`role_access` today, so this is latent. It goes live the moment Phase 11 ships the admin screen that
owns the matrix, and it must land **before** that screen: settings that 25 checks ignore are worse
than no settings, because the screen makes a promise the app does not keep.

The cause is chronological drift, not a decision. `resolveRoleAccess()` arrived with `calendar-c`
and `talks-a`; every route written before it was never retrofitted, and nothing fails when a new one
forgets — the third parameter defaults.

### Key requirements

1. **Drop the `= ROLE_PERMISSIONS` default** on `can()` and `assertCan()` so every missing argument
   becomes a type error. The compiler produces the worklist and no future call site can drift. Do
   the same for the two helpers that mirror the trap: `manageableOrgIds()` and
   `visibleNavigationItems()`.
2. **Retrofit all 25 call sites** across 18 files to resolve the ward's override first.
3. **Lock `admin.*` and `sacrament.*`** — a `NON_OVERRIDABLE_PERMISSIONS` deny-list that
   `mergeRoleAccess` enforces in both directions.
4. **Change the override's stored shape from replace-the-list to add/remove deltas**, so the
   ~30 permissions Phases 5–12 will add reach a ward that already has an override.
5. **Enforce bishop/counselor equivalence structurally** (CLAUDE.md §7) inside `mergeRoleAccess`.

### Success criteria

- A ward that removes `roster.manage` from `bishop` finds `PUT /api/members/[id]/organizations` and
  `POST /api/roster/bulk-assign` refuse it with a 403 — and finds `counselor` refused identically.
- A ward that grants `roster.manage` to `ward_secretary` finds those same routes allow it.
- A ward that grants `admin.manage_users` to `ward_council_member` finds it **ignored**, and
  `GET /api/admin/users` still returns 403.
- A ward that removes `admin.manage_users` from `bishop` finds it **ignored** — the bishopric cannot
  lock itself out of the admin screen.
- A new route that forgets to resolve role access **fails `npm run typecheck`**.

---

## Decisions taken before planning

Three open questions from the scope were resolved with the user on 2026-08-22.

### Decision 1 — `admin.*` and `sacrament.*` are not overridable

**Why this is sharper than the scope realized.** `admin.manage_users` is not merely one of the 25.
The code behind it deliberately uses the **service-role client**, because `users` has no INSERT
policy and no UPDATE policy for other people's rows (migration 019). Both call sites say so in
comments that predate this work:

- `lib/auth/adminUsers.ts:256` — *"this write MUST use the service-role client. That makes
  assertCan() in the route the effective boundary here rather than RLS."*
- `lib/auth/youthAccounts.ts:78` — *"assertCan() in the route is therefore the effective boundary
  here, so that check can never be skipped."*

So a ward that widens `admin.manage_users` to any role hands that role the ability to change
anyone's role, including granting itself `bishop`. That is self-escalation through a settings blob,
and RLS does not stand behind it.

`sacrament.*` is locked for a different reason: it is the entire reach of the youth PIN account.
FEATURES.md §Module 17 and the comment on `SACRAMENT_MANAGER_PERMISSIONS` both say **exactly one
module**. Widening that is a product decision, not a matrix checkbox.

Locking in **both directions** also delivers, structurally, a guard `plans/11-notifications-admin.md`
asks the admin UI to implement by hand: *"Never allow a change that removes the last bishopric
member's admin access."* If `admin.*` cannot be removed, that lockout is unreachable.

### Decision 2 — the override stores add/remove deltas, not a replacement list

Replace-semantics means an override must restate every permission a role keeps. Phases 5–12 add
roughly thirty more permissions; under replace, any ward with a stored override for a role **never
receives the new defaults** for it, and nothing surfaces the drift. Deltas resolve against whatever
the code currently grants, so a Phase 6 permission reaches every ward automatically.

Deltas also make the stored JSON say what the ward *changed* — which is what an audit row, a diff,
and a "reset to default" button all want.

The migration cost is zero: **nothing writes `role_access` today**, so there is no stored data in
any shape. A legacy array is treated as malformed for that role (warn, ignore, keep the defaults),
the same as any other unrecognised shape.

```jsonc
// wards.settings.role_access — the new shape
{
  "ward_secretary": { "add": ["talks.plan"], "remove": ["agendas.publish"] },
  "music_coordinator": { "remove": ["music.manage"] }
}
```

### Decision 3 — bishop/counselor equivalence is enforced in `mergeRoleAccess`

CLAUDE.md §7 forbids the bishop holding anything a counselor lacks, and nothing currently stops an
override breaking it. A delta naming either role is applied to **both**. This is the same move as
`BISHOPRIC_PERMISSIONS` being one constant rather than two identical literals: the invariant holds
by construction rather than by the Phase 11 UI promising to render one row.

---

## Relevant Files

### Core (the semantic change)

- `lib/auth/permissions.ts` — **modify** — add `NON_OVERRIDABLE_PERMISSIONS`; rewrite
  `mergeRoleAccess` for delta shape + deny-list + bishopric equivalence; drop the
  `= ROLE_PERMISSIONS` default from `can()` and `assertCan()`.
- `lib/calendar/orgRotationScope.ts` — **modify** — drop the default on `manageableOrgIds()` (line 37).
- `lib/auth/navigation.ts` — **modify** — make `roleAccess` required on `visibleNavigationItems()`.

### The 25 call sites (18 files)

| File | Checks to fix | Permission(s) |
|---|---|---|
| `app/(youth)/sacrament/page.tsx` | 1 | `sacrament.view_assignments` |
| `app/api/admin/users/route.ts` | 1 | `admin.manage_users` |
| `app/api/admin/users/youth/route.ts` | 1 | `admin.manage_users` |
| `app/api/admin/users/[id]/route.ts` | 1 | `admin.manage_users` |
| `app/api/admin/users/[id]/reset-pin/route.ts` | 1 | `admin.manage_users` |
| `app/api/auth/invite/route.ts` | 1 | `admin.manage_users` |
| `app/api/conducting-rotation/route.ts` | 2 | `calendar.view`, `admin.manage_ward` |
| `app/api/households/route.ts` | 2 | `roster.view`, `roster.manage` |
| `app/api/households/[id]/route.ts` | 1 | `roster.manage` |
| `app/api/members/route.ts` | 2 | `roster.view`, `roster.manage` |
| `app/api/members/[id]/route.ts` | 1 | `roster.manage` |
| `app/api/members/[id]/notes/route.ts` | 2 | `roster.manage` ×2 |
| `app/api/members/[id]/organizations/route.ts` | 1 | `roster.manage` |
| `app/api/roster/bulk-assign/route.ts` | 1 | `roster.manage` |
| `app/api/roster/import/route.ts` | 1 | `roster.import` |
| `app/api/roster/import/preview/route.ts` | 1 | `roster.import` |
| `app/api/sundays/route.ts` | 2 | `calendar.view`, `calendar.manage` |
| `app/api/sundays/[id]/route.ts` | 1 | `calendar.manage` |
| `app/api/ward-settings/calendar/route.ts` | 2 | `calendar.view`, `admin.manage_ward` |

**Total: 25.** This matches the scope's count exactly; if `npm run typecheck` reports a different
number after Task 3, stop and reconcile before editing.

### Tests

- `tests/lib/permissions.test.ts` — **modify** — rewrite the `mergeRoleAccess` block for the delta
  shape; add deny-list and bishopric-equivalence blocks; pass `ROLE_PERMISSIONS` explicitly in the
  existing `can`/`assertCan` loops.
- `tests/helpers/seed.ts` — **modify** — add `roleAccess` to `SeedOptions`; add `setRoleAccess()`;
  make `setCrossOrgVisibility()` merge rather than clobber.
- `tests/routes/role-access-overrides.test.ts` — **create** — the route-level proof.
- `testing/scenarios/auth/scenario-014-ward-role-access-override/` — **create** — scenario + seed.

---

## Dependencies

No new libraries. Everything needed already exists:

- `resolveRoleAccess()` / `mergeRoleAccess()` in `lib/auth/permissions.ts`
- `tests/helpers/routeClient.ts` — route handlers callable as plain functions (CLAUDE.md §8)
- `tests/helpers/seed.ts` — `seedFixtures()` / `fixtures.cleanup()`
- No migration. `wards.settings` is `jsonb`; only the shape written into it changes, and nothing
  writes it yet.

---

## Known Pitfalls (from retro context)

- **`route-tests-and-realtime`** — *React's `cache()` is inert outside a request scope.* Measured,
  not assumed. So `resolveRoleAccess()` cannot be deduped for route handlers by wrapping it in
  `cache()`. A route checking several permissions must resolve **once into a local** and pass it, as
  the assignment routes already do. Do not add a `cache()` wrapper and assume it works.
- **`route-tests-and-realtime`** — *Check the fixture's real permissions before asserting a 403.*
  The intuitive answer is wrong often enough that it cost a slice: `music_coordinator` holds
  `talks.view`; `org_president` does not. For this plan the relevant surprise is that
  **`roster.manage` is bishopric-only** — `ward_secretary` holds `roster.view` and not
  `roster.manage`. `lib/auth/permissions.ts` is the source of truth; read it, do not guess.
- **`route-tests-and-realtime`** — *A route that reads the row before checking the permission
  returns 404, not 403,* because RLS hides the row first. Every retrofit here keeps `assertCan`
  ahead of every row read, so the refusals stay 403.
- **`route-tests-and-realtime`** — *Order any query you then index into.* If a new test asserts on
  `audit_log` rows, `.order("created_at")` before `find()`/`[0]`. The shared hosted project means
  other suites move heap order underneath you.
- **`foundation-c-services`** — *An RLS-denied UPDATE or DELETE succeeds with zero rows; it does not
  raise.* Assert a refused write by **re-reading the row with the service client**. INSERT is the
  only one of the four that errors.
- **`foundation-c-services`** — *Vitest must not run these files in parallel* and *delete wards
  before auth users in teardown.* Both already handled by `vitest.config.ts` and
  `seedFixtures().cleanup`; do not work around either.
- **`auth-b-invites-admin`** — *`requireSessionUser()` must sit outside the try block.* It redirects
  by throwing an internal Next.js error; a catch-all around it turns the redirect into a 500. Every
  retrofit below inserts code **inside** the existing try, never above `requireSessionUser()`.
- **`auth-b-invites-admin`** — *Next.js's dev logger renders an object argument to `console.error`
  as `{}`.* Anything that must survive belongs in the message string. This applies to every new
  `console.warn` in `mergeRoleAccess`.
- **`roster-b-picker-and-orgs`** (via `orgRotationScope.ts`) — *`typecheck` and `lint` both pass a
  server-only import reaching a client component; only `npm run build` catches it.*
  `lib/auth/navigation.ts` and `lib/calendar/orgRotationScope.ts` are deliberately free of
  `createServerSupabaseClient`. **Do not import `resolveRoleAccess` into either** — they take
  `RoleAccess` as a parameter for exactly this reason. Run the production build.

---

## Tasks

### Task 1: Add the non-overridable deny-list

**File:** `lib/auth/permissions.ts` (modify)
**Action:** Add `NON_OVERRIDABLE_PERMISSIONS` beside `ADMIN_PERMISSIONS`.

**Details:**

- **Placement correction:** the scope suggested `types/domain.ts` "alongside `ADMIN_PERMISSIONS`",
  but `ADMIN_PERMISSIONS` actually lives in `lib/auth/permissions.ts` (line ~74). Put the new
  constant there, immediately after it. `types/domain.ts` holds no permission constants and should
  not start.
- Derive it, do not hand-list it — a permission added to `PERMISSIONS` under an `admin.` or
  `sacrament.` prefix must be locked automatically:

```ts
// Permissions a ward may not reconfigure, in EITHER direction.
//
// admin.*  — these run through the service-role client (lib/auth/adminUsers.ts,
//            lib/auth/youthAccounts.ts), where assertCan() is the only boundary and RLS is not
//            behind it. Widening one is self-escalation: a role granted admin.manage_users can
//            make itself bishop. Locking removal too means the bishopric cannot lock itself out
//            of the admin screen, which is the guard 11-notifications-admin.md asks for.
//
// sacrament.* — the whole reach of a youth PIN account. FEATURES.md §Module 17: exactly one
//            module. Widening that is a product decision, not a checkbox.
export const NON_OVERRIDABLE_PERMISSIONS: readonly KnownPermission[] = PERMISSIONS.filter(
  (permission) =>
    permission.startsWith("admin.") || permission.startsWith("sacrament."),
);
```

- Note `audit.view` is **not** locked. It is in `ADMIN_PERMISSIONS` for the bishopric-equivalence
  loop, but it grants reading, not writing, and a ward may legitimately want its secretary to see
  the audit log. If that judgement is revisited, it changes one filter predicate.

---

### Task 2: Rewrite `mergeRoleAccess` for deltas, the deny-list, and bishopric equivalence

**File:** `lib/auth/permissions.ts` (modify)
**Action:** Replace the body of `mergeRoleAccess`, its Zod schema, and its doc comment. The
signature (`(override: unknown) => RoleAccess`) and the `RoleAccess` type are **unchanged**, so no
downstream consumer changes shape.

**Details:**

**New stored shape:**

```ts
export type RoleAccessDelta = {
  add?: readonly KnownPermission[];
  remove?: readonly KnownPermission[];
};

const roleAccessDeltaSchema = z.object({
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
});
```

**Parse per role, not whole-object.** The current code uses one `z.record(...)` over the whole
object, so a single bad value discards every other role's valid configuration. Iterate
`Object.entries()` and run `roleAccessDeltaSchema.safeParse()` per value, so an unrecognised shape
warns and leaves *that* role on the defaults while the rest still apply. This is what makes a legacy
array value (`{ music_coordinator: ["music.view"] }`) degrade gracefully.

**Resolution order, per role — implement exactly this and comment it:**

1. Start from `ROLE_PERMISSIONS[role]`.
2. Subtract everything in `remove`.
3. Add everything in `add`. **`add` wins a conflict** — a permission in both lists ends up granted.
   State this in a comment; it is arbitrary but must be deterministic and documented.
4. Drop anything not in `KNOWN_PERMISSIONS`, with one `console.warn` per role naming the offenders.
5. **Restore the default membership of every `NON_OVERRIDABLE_PERMISSIONS` entry.** One rule that
   covers both directions: for each locked permission, its presence in the result is whatever
   `ROLE_PERMISSIONS[role]` says, regardless of what the delta asked for. Warn once per role if the
   delta named any locked permission.
6. De-duplicate.

**Bishopric equivalence — apply before step 1:**

- If the override names `bishop`, `counselor`, or both, combine them into **one** delta: union of
  the `add` lists, union of the `remove` lists. Apply that single delta to both roles, so the two
  resolved lists are identical by construction.
- If both were named and their deltas differ, `console.warn` naming both roles and the difference —
  a message string, not an object argument (`auth-b-invites-admin`).
- Reuse `BISHOPRIC_ROLES`; do not introduce a second list of who the bishopric is.

**Malformed handling — keep the existing behaviour where it is still right:**

- `null` / `undefined` → `ROLE_PERMISSIONS`, unchanged.
- Not an object at all (`"nonsense"`, an array) → `console.warn` + `ROLE_PERMISSIONS`, unchanged.
- Unknown role key → warn, skip, unchanged.
- Unparseable per-role value → warn, that role keeps its defaults, siblings still apply. **New.**

**Update the doc comment on `resolveRoleAccess()`.** It currently says an override "can only ever
*narrow* access". That was already untrue and is now clearly untrue — an `add` list widens. The
throw-on-read-failure behaviour is still correct and must stay, but for the corrected reason:
falling back to the defaults can be wrong in **either** direction, silently restoring a permission
the ward removed or silently withholding one it granted. Do not add a fallback.

---

### Task 3: Make the parameter required, and let the compiler produce the worklist

**Files:** `lib/auth/permissions.ts`, `lib/calendar/orgRotationScope.ts`, `lib/auth/navigation.ts`
(all modify)

**Action:** Drop every `= ROLE_PERMISSIONS` default and every `?` on a `roleAccess` parameter.

**Details:**

```ts
// lib/auth/permissions.ts — was: roleAccess: RoleAccess = ROLE_PERMISSIONS
export function can(user: SessionUser, permission: KnownPermission, roleAccess: RoleAccess): boolean
export function assertCan(user: SessionUser, permission: KnownPermission, roleAccess: RoleAccess): void

// lib/calendar/orgRotationScope.ts:37 — was: roleAccess: RoleAccess = ROLE_PERMISSIONS
export function manageableOrgIds(user, organizations, roleAccess: RoleAccess): string[]

// lib/auth/navigation.ts — was: roleAccess?: RoleAccess
export function visibleNavigationItems(user: SessionUser, roleAccess: RoleAccess): NavigationItem[]
```

- Add a comment above `can()` recording **why** there is no default, so a later reader does not
  restore it as a convenience: *"No default. A defaulted third parameter is how 25 call sites came
  to silently ignore the ward's configuration (ITER-005). A missing argument must be a type error."*
- `orgRotationScope.ts` imports `ROLE_PERMISSIONS` only for the removed default — **drop that
  import** if nothing else in the file uses it, or `lint` will flag it.
- Run `npm run typecheck` now. It should report **25 errors across 18 files** plus the test-file
  errors from Task 8. That list is the worklist for Tasks 4–7. Reconcile any discrepancy before
  editing anything.

---

### Task 4: Retrofit the 16 API routes that follow the standard shape

**Files:** all `app/api/**` files in the Relevant Files table **except**
`app/api/conducting-rotation/route.ts` (Task 5). (modify)

**Action:** In each handler, move client creation above the permission check, resolve the override,
and pass it.

**Details:**

Every one of these currently calls `assertCan()` *before* `createServerSupabaseClient()`. All of
them get the same edit — the uniform shape is:

```ts
export async function POST(request: Request) {
  const user = await requireSessionUser();   // OUTSIDE the try — unchanged, do not move

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "roster.manage", roleAccess);

    // ...everything below unchanged, including the existing client variable's later use
```

**Rules that must hold after every edit:**

- **`assertCan` still precedes every row read**, so a refusal stays a 403 and never becomes a 404
  (`route-tests-and-realtime` correction 6). Creating the client is not a row read.
- `resolveRoleAccess()` reads the caller's **own** ward through `wards_select` (migration 019:
  `using (id = current_ward_id())`), so the one read it performs before the permission decision
  leaks nothing.
- **Delete the now-duplicated `const supabase = await createServerSupabaseClient()`** further down
  each handler. Do not leave two clients.
- **Resolve once per handler.** `app/api/households/route.ts`, `app/api/members/route.ts`,
  `app/api/members/[id]/notes/route.ts`, `app/api/sundays/route.ts` and
  `app/api/ward-settings/calendar/route.ts` each have two exported handlers — each handler resolves
  its own, but no handler resolves twice. `cache()` will not help (see Known Pitfalls).
- **Do not reorder body parsing relative to `assertCan`.** Several routes carry comments explaining
  that `assertCan` runs before the body is parsed on purpose (`app/api/sundays/route.ts:39`,
  `app/api/assignments/route.ts:74`). Client creation slots in above `assertCan`; the body parse
  stays where it is.
- **`app/api/roster/import/route.ts` and `.../preview/route.ts`** parse a multipart body. Same edit;
  the client just moves above the parse.

**New failure mode to accept, not to paper over:** `resolveRoleAccess()` throws on a read failure.
These routes could not previously fail there, so each gains a 500 path through its existing
`respondToRouteError(...)` fallback. That is correct — see the corrected comment in Task 2. Do not
add a try/catch around `resolveRoleAccess` and do not fall back.

---

### Task 5: Fix the route that is inconsistent with itself

**File:** `app/api/conducting-rotation/route.ts` (modify)

**Action:** Two separate fixes; this route is the only one that is not a mechanical retrofit.

**Details:**

**GET (line ~41)** — standard retrofit per Task 4. `assertCan(user, "calendar.view", roleAccess)`
with the client created first.

**PATCH (line ~103 onward)** — this handler parses the body **before** the permission check by
design, because *which* permission applies is decided by `input.orgId`. Keep that; the existing
comment explains it and it leaks nothing.

The defect is that the `orgId !== null` branch resolves the override and the `orgId === null` branch
does not, with a comment calling it a carry-forward from `calendar-a` rather than a decision. Fix by
hoisting the resolve above the branch so both use it:

```ts
const input = conductingRotationSchema.parse(await readJsonBody(request));
const supabase = await createServerSupabaseClient();
const roleAccess = await resolveRoleAccess(supabase, user.wardId);

let organizationName: string | null = null;

if (input.orgId === null) {
  assertCan(user, "admin.manage_ward", roleAccess);
} else {
  assertCan(user, "calendar.manage_org_conducting", roleAccess);
  // ... manageableOrgIds(user, organizations, roleAccess) — unchanged, already correct
}
```

- **Delete** the comment *"The ward's role_access override is deliberately not resolved on this
  branch"* — it is no longer true.
- The `else` branch's own `const roleAccess = await resolveRoleAccess(...)` is now the hoisted one;
  remove the inner declaration rather than shadowing it.
- Note in a comment that `admin.manage_ward` is in `NON_OVERRIDABLE_PERMISSIONS`, so passing
  `roleAccess` here cannot change the answer — it is passed for uniformity, so that the rule "every
  check resolves" has no exceptions a reader must remember.

---

### Task 6: Retrofit the youth sacrament page

**File:** `app/(youth)/sacrament/page.tsx` (modify)

**Action:** Resolve the override before `assertCan(user, "sacrament.view_assignments", roleAccess)`.

**Details:**

- The file currently imports no Supabase client. Add `createServerSupabaseClient` and
  `resolveRoleAccess`.
- **Keep `assertCan`, do not convert to `can()` + `NotPermitted`.** Every page under `app/(app)/`
  uses `can()` because a `ForbiddenError` escaping a Server Component becomes a 500. This page is
  different: `app/(youth)/layout.tsx` already redirects any non-`sacrament_manager` to `/dashboard`,
  so the check is unreachable defence-in-depth, and changing the refusal shape is out of scope.
- Add a comment: `sacrament.view_assignments` is in `NON_OVERRIDABLE_PERMISSIONS`, so this resolve
  cannot change the answer. It is here so that the rule has no exceptions — the alternative
  (`ROLE_PERMISSIONS` passed literally) is a line someone copies into a route where it *would*
  matter, which is the trap this whole plan exists to close.
- A `sacrament_manager` can read its own `wards` row: `wards_select` grants SELECT to any
  authenticated user whose `current_ward_id()` matches, with no role predicate. The youth layout
  already relies on this for the ward name.
- Cost, stated rather than hidden: this page now reads `wards` twice per render — once here and once
  in the layout for the ward name. A single-row primary-key lookup. If it ever matters, the fix is
  role access in the JWT claims, which is Phase 11's problem and is already implied by its
  re-login warning.

---

### Task 7: Confirm the 37 already-correct call sites still compile untouched

**Files:** all `app/(app)/**` pages, `app/api/assignments/**`, `app/api/assignment-comments/route.ts`
(no edits expected)

**Action:** Verification step, not an edit.

**Details:** These already resolve and pass `roleAccess`. After Task 3 they should produce **zero**
new type errors. If any does, it is passing `undefined` somewhere and needs the same treatment —
investigate rather than adding a default back.

---

### Task 8: Rewrite the permission unit tests

**File:** `tests/lib/permissions.test.ts` (modify)

**Action:** Update for the required parameter, and cover the three new behaviours.

**Details:**

**Existing blocks that need mechanical updates:**

- The exhaustive `can`/`assertCan` loops (lines ~160–187) call both with two arguments. Pass
  `ROLE_PERMISSIONS` explicitly as the third. This is the honest form — the test is about the code
  defaults.
- The `mergeRoleAccess` block (lines ~189–223) uses the replace shape throughout. Rewrite every case
  to the delta shape.

**New cases — `mergeRoleAccess` deltas:**

- `{ music_coordinator: { remove: ["music.manage"] } }` → `music.view` still true,
  `music.manage` false, every other role untouched.
- `{ ward_secretary: { add: ["talks.plan"] } }` → `talks.plan` true **and** every default
  `ward_secretary` permission still present. This is the case replace-semantics got wrong; assert
  the full retained list, not just the added one.
- A permission in both `add` and `remove` → granted (`add` wins), pinning the documented order.
- `{ org_secretary: { add: ["not.a.permission"], remove: ["visits.view"] } }` → unknown dropped,
  known removal applied.
- **Legacy array value** `{ music_coordinator: ["music.view"] }` → that role falls back to defaults,
  **and a sibling valid delta in the same object still applies.** This is the per-role parse
  granularity from Task 2.

**New cases — the deny-list:**

- `{ ward_council_member: { add: ["admin.manage_users"] } }` → still false. The escalation case.
- `{ bishop: { remove: ["admin.manage_users"] } }` → still true. The lockout case.
- `{ ward_council_member: { add: ["sacrament.view_assignments"] } }` → still false.
- A delta mixing a locked and an unlocked permission → the unlocked one applies, the locked one does
  not. Proves step 5 restores rather than discarding the whole delta.
- Loop `NON_OVERRIDABLE_PERMISSIONS` × `ROLES` and assert the resolved membership always equals
  `ROLE_PERMISSIONS[role]` regardless of the delta. Table-driven, per CLAUDE.md §8 priority 2.

**New cases — bishopric equivalence:**

- `{ bishop: { remove: ["talks.plan"] } }` → **counselor loses it too**.
- `{ counselor: { add: ["x"] } }` → bishop gains it too.
- Divergent deltas for the two → resolved lists identical; assert with the exhaustive
  `PERMISSIONS` loop, not a spot check.
- Extend the existing bishopric-equivalence test to run under an override as well as under defaults.

**`resolveRoleAccess` block:** update `stubWardClient` payloads to the delta shape. The
throw-on-read-failure test is unchanged and must keep passing.

---

### Task 9: Teach the seed helper about role access

**File:** `tests/helpers/seed.ts` (modify)

**Action:** Let a suite seed and change ward A's override.

**Details:**

- Add to `SeedOptions`:
  `roleAccess?: Record<string, { add?: string[]; remove?: string[] }>`
- Apply it in the ward A insert (line ~143), alongside `cross_org_visibility` and `timezone`. Ward B
  keeps no override — a cross-ward test needs one side unconfigured.
- Add `setRoleAccess(fixtures, override)` for mid-suite changes, modelled on `setCrossOrgVisibility`
  but **merging into the existing settings object rather than replacing it**: read `settings`,
  spread, set `role_access`, write back.
- **Also fix `setCrossOrgVisibility` to merge** (currently line ~284: it writes a fresh
  `{ cross_org_visibility, timezone }` object). This is a deliberate small widening of scope and it
  is justified: once `role_access` lives in `settings`, a suite that seeds an override and then calls
  `setCrossOrgVisibility` silently loses the override, and the test passes for the wrong reason.
  Leaving it would arm a new trap while closing an old one. Flag it in the commit message.

---

### Task 10: Prove it at the route level

**File:** `tests/routes/role-access-overrides.test.ts` (create)

**Action:** The proof that the retrofit works end to end. Follow the pattern in
`tests/routes/assignments.test.ts` exactly.

**Details:**

Header, in this order (the `vi.mock` hoisting trap is documented at the top of
`tests/helpers/routeClient.ts` — read it first):

```ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, setRoleAccess, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});
```

**Fixture handles:** `bishop`, `counselor1`, `wardSecretary`, `wardCouncilMember`. Seed a household,
a member, and an organization in ward A. `fixtures.cleanup()` in `afterAll`.

**Read the permission matrix before writing an assertion.** `roster.manage` is **bishopric-only** —
`ward_secretary` holds `roster.view` and not `roster.manage`. That is what makes it a clean pair:
bishop for the narrowing case, ward secretary for the widening case.

**Case 1 — narrowing is honoured (the fail-open bug).**
`setRoleAccess(fixtures, { bishop: { remove: ["roster.manage"] } })`, act as `bishop`, call
`PUT /api/members/[id]/organizations` → **403**. Then **re-read `member_organizations` with the
service client** and assert unchanged (`foundation-c-services`: an RLS-denied write is a zero-row
success, and here it must not even be attempted). Repeat for `POST /api/roster/bulk-assign`.

These two routes are the sharpest cases in the app: migration 019's ward-scoped policy loop grants
INSERT/UPDATE/DELETE on `member_organizations` to **every authenticated member of the ward**, so RLS
is not a boundary there at all and `assertCan` is the only thing standing in the way. CLAUDE.md rule
2 says RLS is the security boundary; `lib/roster/organizations.ts:16` documents this as the
exception. Say so in a comment at the top of this describe block.

**Case 2 — bishopric equivalence under an override.** Same override, act as `counselor1`, same route
→ **403**. The override named only `bishop`; the counselor must be refused identically (CLAUDE.md §7).

**Case 3 — widening is honoured (the fail-closed bug).**
`setRoleAccess(fixtures, { ward_secretary: { add: ["roster.manage"] } })`, act as `wardSecretary`,
call `PUT /api/members/[id]/organizations` → **200**, and the row is present when re-read with the
service client. RLS permits this write, which is exactly why the route check is the whole boundary.

**Case 4 — the escalation attempt is ignored.**
`setRoleAccess(fixtures, { ward_council_member: { add: ["admin.manage_users"] } })`, act as
`wardCouncilMember`, call `GET /api/admin/users` → **403**. Comment why this one matters most:
`lib/auth/adminUsers.ts` writes with the service-role client, so a successful call here would let
that role change anyone's role, including its own.

**Case 5 — the lockout attempt is ignored.**
`setRoleAccess(fixtures, { bishop: { remove: ["admin.manage_users"] } })`, act as `bishop`,
`GET /api/admin/users` → **200**.

**Case 6 — a delta reaches a route that never resolved before.**
`setRoleAccess(fixtures, { ward_secretary: { remove: ["calendar.view"] } })`, act as
`wardSecretary`, `GET /api/sundays` → **403**. Picks a route from a different module than cases 1–5,
so the fix is shown to be general rather than roster-specific.

**Ordering note:** each case sets its own override before acting. Because `setRoleAccess` writes to
ward A, cases must not run concurrently — `vitest.config.ts` already sets `fileParallelism: false`,
and tests within a file run in order, so sequential `it()` blocks are safe. Do not use
`it.concurrent`.

---

### Task 11: Update the project documentation

**Files:** `CLAUDE.md`, `plans/11-notifications-admin.md` (modify)

**Action:** Record the contract so Phase 11 builds against it rather than rediscovering it.

**Details:**

- **`CLAUDE.md` §4** — add a rule: *"Every permission check resolves the ward's role access. `can()`
  and `assertCan()` take it as a required third argument; a missing one is a type error. Resolve
  once per request into a local and pass it — `cache()` does not dedupe it in a route handler."*
- **`plans/11-notifications-admin.md` §Role access matrix** — replace the two-guard note with the
  contract this plan establishes: the stored shape is add/remove deltas keyed by role; `admin.*` and
  `sacrament.*` are not overridable in either direction (which is what delivers the "never remove
  the last bishopric member's admin access" guard structurally, so the UI does not implement it by
  hand); bishop and counselor resolve to one list, so the matrix renders them as a single row. Keep
  the existing re-login warning — it is still true and unaddressed.

---

## Testing Strategy

Per CLAUDE.md §8 priority order. This change is priority 2 (permission helpers) and 5 (route
handlers, happy path plus auth-denied); it adds no tables, so there are no new RLS policies to test.

| File | Kind | Covers |
|---|---|---|
| `tests/lib/permissions.test.ts` (modify) | unit, table-driven | delta resolution order, deny-list in both directions, bishopric equivalence, per-role malformed granularity |
| `tests/routes/role-access-overrides.test.ts` (create) | route handler, real hosted DB | the six cases above — narrowing honoured, equivalence, widening honoured, escalation ignored, lockout ignored, generality beyond roster |
| `tests/lib/navigation.test.ts` (modify) | unit | mechanical: `visibleNavigationItems` now requires the argument |
| `tests/lib/orgRotationScope.test.ts` and `tests/lib/rotationEligibility.test.ts` (modify) | unit | mechanical: `manageableOrgIds` now requires the argument |

**The whole suite must be run, not just these files.** Task 3 changes four function signatures used
across the codebase; `npm run test` is the only way to see what else moved.

**Not tested, deliberately:** that all 25 retrofitted call sites resolve. That is what the compiler
proves after Task 3, and a test asserting it would be a worse version of the same guarantee.

---

## Test Scenarios (Harness)

### Scenario 014: Ward role-access override changes what a role may do

**Tags:** `auth`, `permissions`, `full`
**Directory:** `testing/scenarios/auth/scenario-014-ward-role-access-override/`

**Purpose:** Nothing in the app writes `role_access` — the Phase 11 screen that will own it does not
exist. So this state is unreachable by hand without editing `jsonb` in the Supabase dashboard, which
is exactly the kind of setup seeding is for. Walking it once proves the delta shape is writable and
readable end to end **before** a screen depends on it, and proves the page guards and the route
guards now agree. Today they can disagree: the page hides the button and the route allows the write.

**Seed data summary:**
- `wards` — 1 — ward A with `settings.role_access` = `{ "ward_secretary": { "add": ["roster.manage"] },
  "bishop": { "remove": ["calendar.manage"] } }`
- `users` — 3 — a bishop, a counselor, a ward secretary
- `households` — 2 — with 4 members between them
- `organizations` — 1 — Elders Quorum
- `sundays` — 4 — one month, so the calendar page has something to refuse an edit on

**Tester action:**
1. Sign in as the **ward secretary**. Open a member's detail page. The organization controls are now
   visible (default: hidden). Change the member's organization and save.
2. Sign in as the **bishop**. Open the calendar, open a Sunday. The edit controls are gone.
3. Sign in as the **counselor**. Open the same Sunday. The edit controls are gone here too — the
   override named only the bishop.

**Verification checklist:**
- [ ] The ward secretary sees organization controls on the member page and the save succeeds
- [ ] `member_organizations` holds the new row (check in Supabase; there is no audit viewer yet)
- [ ] An `audit_log` row was written for the change
- [ ] The bishop cannot edit a Sunday — the controls are absent, not disabled
- [ ] The counselor cannot edit a Sunday either, though the override never named that role
- [ ] The bishop can still reach `/admin/users` — `admin.*` is locked and the override did not touch it
- [ ] No console errors on any of the five page loads

**Note for the walkthrough:** every 403 assertion this scenario could make is already covered by
`tests/routes/role-access-overrides.test.ts`. Keep this scenario to what needs eyes — that the page
and the route agree, and that the controls are absent rather than present-and-broken. This follows
the trimming `route-tests-and-realtime` applied to scenarios 012 and 013.

---

## Validation Commands

Run in this order. Stop at the first failure.

```bash
# 1. Type check FIRST — after Task 3 this is the worklist, not just a gate.
#    Expect ~25 errors across 18 files, then zero.
npm run typecheck

# 2. Lint (dropped ROLE_PERMISSIONS imports will show up here)
npm run lint

# 3. Harness types (only if Task 9's seed changes touch testing/)
npm run harness:typecheck

# 4. Full suite — signatures changed app-wide, so run all of it, not a filter.
#    Runs over the network against the hosted project; expect a few minutes.
npm run test

# 5. Production build. Required, not optional.
#    lint and typecheck both PASS a server-only import reaching a client component;
#    only the build catches it (plans/retros/roster-b-picker-and-orgs.md), and this
#    change edits lib/auth/navigation.ts and lib/calendar/orgRotationScope.ts, both of
#    which are deliberately free of createServerSupabaseClient.
npm run build
```

---

## Integration Notes

**How this connects.** `resolveRoleAccess()` and `mergeRoleAccess()` already exist and are already
used correctly by 37 call sites. This plan does not introduce a mechanism; it removes the escape
hatch that let 25 sites skip it, and it fixes two semantics that would have bitten Phase 11.

**Breaking changes.**

- `can()`, `assertCan()`, `manageableOrgIds()` and `visibleNavigationItems()` change signature. All
  four are internal; nothing outside this repo calls them. The breakage is compile-time and total,
  which is the point.
- The stored `role_access` shape changes from a permission list to an add/remove delta. **No
  migration is needed: nothing writes `role_access` today**, in this repo or in the hosted project's
  seed (`supabase/seed/ward.sql` writes `cross_org_visibility` and `timezone` only). Verify that
  claim during execution with a single service-role query before starting Task 2; if any ward has a
  non-null `settings->'role_access'`, stop and report it rather than silently reinterpreting it.

**New failure surface.** 18 route files gain a 500 path they did not have, because
`resolveRoleAccess()` throws when the `wards` read fails. This is deliberate. Do not add a fallback
to `ROLE_PERMISSIONS`; falling back can now be wrong in either direction.

**One extra `wards` read per guarded request.** A single-row primary-key lookup, on requests that
already run at least one other query. Uniformity was chosen over saving it: "if you check a
permission, you resolved role access" has no exceptions to remember, whereas "resolve unless the
permission is locked" is a rule someone gets wrong. If it ever measures as a problem, the fix is role
access in the JWT claims, which Phase 11 already implies with its re-login warning.

**Documentation to update:** CLAUDE.md §4 and `plans/11-notifications-admin.md` (Task 11). SPEC.md
does not describe `role_access`, so it needs no change.

**What this deliberately does not do.**

- No admin UI. Phase 11 owns the matrix screen; this plan makes the screen's promises keepable.
- No change to which permissions each role holds by default. The two judgement calls
  `foundation-c-services` handed forward (`roster.view` for both secretaries, `agendas.view` for
  `ward_council_member`) stay open for Phase 11 to settle.
- No change to how a refusal is rendered. Pages keep `can()` + `NotPermitted`; routes keep
  `assertCan()` + `respondToRouteError`.
- `audit.view` stays overridable — see the note at the end of Task 1.
