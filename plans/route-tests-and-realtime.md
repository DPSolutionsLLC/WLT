# Plan: Route Handler Tests & the Realtime Publication

**Created:** 2026-08-21
**Type:** feature — with Tasks 7–8 closing a defect recorded in
[plans/confirmations/talks-planner-2026-08-21.md](confirmations/talks-planner-2026-08-21.md)

---

## Overview

Two things that have been handed forward, and one correction to the record.

Every retro since `auth-a` records that route handlers are not unit-tested, and every one gives the
same reason: **there is no local server.** It is now six retros deep and the wording has hardened
from a cost judgement into an impossibility. It was neither, and the most valuable thing this slice
produces is the correction.

What `auth-a` actually wrote, in October, when the app had **two** routes:

> Route handlers are not unit-tested. There is no local server in this setup and standing one
> up for two routes is not worth it; the harness scenarios exercise them instead.

That was a defensible trade at two routes. It was copied forward verbatim through `roster-a`,
`roster-b`, `roster-c`, `talks-a` and `talks-b`, by which point the app has **27 routes** and the
sentence had quietly changed meaning — from *"not worth the setup"* to *"cannot be done"*. Nobody
re-checked it, because a line that appears in six consecutive retros reads as settled.

**A route test does not need a server, and the codebase was already built for it.**
`lib/auth/session.ts` carries this comment, written by `auth-a` in the same slice that declared
routes untestable:

> The optional client is what makes this testable without mocking next/headers — the same shape
> writeAuditLog, scopedQuery, and emitNotification already use.

`tests/helpers/asRole.ts` has returned a real authenticated Supabase client with a live session
since `foundation-c`. The only missing piece is a helper that points a route's
`createServerSupabaseClient()` at one — perhaps twenty lines.

The second half fixes a real defect. **No table in this project is in the `supabase_realtime`
publication** — a grep of `supabase/` finds no publication statement at all. `talks-b` shipped
realtime comment threads that have therefore never updated live, and Phase 11's notification UI
will find the same gap waiting for it. This slice fixes the one table that is broken today and
leaves Phase 11 to add its own, with its own proof.

**Key requirements**

1. **Verify the mechanism before building on it (Task 1).** The correction above is a claim about
   this codebase, and a plan that asserts it without proving it repeats the original mistake in the
   opposite direction. Task 1 is a throwaway spike answering three questions; every later task is
   written against its answers.
2. **RLS stays real.** The route tests mock *how the client is obtained*, never the client itself.
   Every query still runs against the hosted database as a genuinely authenticated user, so a route
   test that passes proves the policy allowed it — not that a stub returned a row.
3. **Adding a table to a publication is a privacy decision.** Supabase applies RLS to
   `postgres_changes`, but this project's rule is that RLS is proven, never assumed (CLAUDE.md rule
   2). Task 8 proves a ward B subscriber receives nothing when ward A inserts a comment. If that
   test fails, the migration is a cross-ward leak and must not ship.
4. **Shrink the manual checklists by exactly what was automated.** Not by judgement — by moving the
   specific checks the new tests now cover, and saying in the scenario which test replaced them.

**Success criteria**

- `tests/helpers/routeClient.ts` exists and a route suite can act as any seeded fixture user
- The four assignment routes have happy-path and auth-denied coverage, plus the specific 409s
  scenarios 012 and 013 list under Failure Behavior
- A cross-ward realtime leak test passes, and comments appear live in a second browser
- Scenarios 012 and 013 shrink to the checks that genuinely need a human, each retired check naming
  the test that replaced it
- `plans/talks-c-prayers-topics.md` is renumbered off the migration number this slice takes
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all pass

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `tests/helpers/routeClient.ts` | create | The whole unlock: mock factories, `actAs()`, request/response helpers |
| `tests/routes/assignments.test.ts` | create | `GET` and `POST /api/assignments` |
| `tests/routes/assignment-detail.test.ts` | create | `PATCH /api/assignments/[id]` — all three actions |
| `tests/routes/assignment-approve.test.ts` | create | `POST /api/assignments/[id]/approve` |
| `tests/routes/assignment-comments.test.ts` | create | `GET` and `POST /api/assignment-comments` |
| `supabase/migrations/026_realtime_publication.sql` | create | Adds `assignment_comments` to the publication, guarded and idempotent |
| `supabase/seed/realtime.sql` | create | The same statements for a ward seeded from scratch |
| `tests/rls/realtime-isolation.test.ts` | create | **The privacy test.** Ward B receives nothing from ward A |
| `testing/scenarios/talks/scenario-012-three-approval-gate/scenario.md` | modify | Trim automated checks; make the realtime check real |
| `testing/scenarios/talks/scenario-013-visiting-speaker-no-phone/scenario.md` | modify | Trim automated checks |
| `testing/scenarios/manifest.json` | modify | Regenerate (`npm run manifest`) |
| `plans/talks-c-prayers-topics.md` | modify | Renumber its migration 026 → 027 |
| `CLAUDE.md` | modify | §8 Testing — record that route tests exist and how to write one |

---

## Dependencies

- **No new packages.** `@testing-library/user-event` is still not installed and Playwright was
  deliberately deferred; neither is needed here. Vitest's `vi.mock` is all this uses.
- **Reuse, do not rebuild:**
  - `tests/helpers/seed.ts` — `seedFixtures(handles, options)` and `fixtures.cleanup()`
  - `tests/helpers/asRole.ts` — `asRole(fixtures, handle)` returns an authenticated client and
    caches the sign-in, which matters against the hosted project's auth rate limit
  - `tests/lib/audit.test.ts` — the existing shape for a node-environment suite that seeds, asserts
    and cleans up. Copy its structure rather than inventing a new one
- **`npm run db:push` must run before the tests**, because Task 8 asserts against a publication that
  does not exist until migration 026 is applied.

---

## Known Pitfalls (from retro context)

- **[auth-a, roster-a/b/c, talks-a] "There is no local server" is the claim this slice disproves.**
  Do not treat it as a constraint. Do treat Task 1 as the thing that earns the right to say so.
- **[foundation-c] An RLS-denied UPDATE or DELETE is a zero-row SUCCESS, not an error.** Only INSERT
  raises. Any route test asserting that a write was refused must **re-read the row** with the
  service client, not merely check that no error came back. A suite that checks `error` alone passes
  while the app leaks.
- **[CLAUDE.md §9] These suites run over the network against the shared hosted project.** Every
  fixture is deleted in `afterAll`, nothing may assume an empty table, and `npm run db:reset` is a
  production wipe — never reach for it to clean up.
- **[talks-a] `emitNotification` must be given `recipientUserIds` as `undefined`, never `[]`.** A
  route test asserting a notification fired needs the trigger seeded; `seedFixtures` takes
  `notificationTriggers` for exactly this.
- **[foundation-a] `params` is a Promise in Next 16.** A route test calls
  `PATCH(request, { params: Promise.resolve({ id }) })`. Passing a bare object type-checks against
  nothing and fails at runtime.
- **[roster-b] Check the query parameter name against the handler.** The route tests are now the
  cheapest place to pin this — a test that sends `statuses` where the handler reads `status` fails
  loudly, which is exactly what did not happen when a client did it.
- **[vitest] `vi.mock` is hoisted above every import.** Its factory cannot close over a variable
  declared later in the file. The helper must expose a mutable module-level holder that `actAs()`
  writes and the factory reads at call time. This is the single most likely hour to lose.

---

## Tasks

### Task 1: The spike — prove the mechanism, then delete it

**File:** `tests/routes/spike.test.ts` (create, then **delete** before the slice ends)

Answer three questions concretely. Write the answers into the retro whatever they turn out to be —
a negative result here is still worth six retros' worth of correction.

1. **Does mocking one module suffice?** `vi.mock("@/lib/supabase/server")` so
   `createServerSupabaseClient()` returns an `asRole()` client. Because
   `resolveSessionUser()` in `lib/auth/session.ts` calls `createServerSupabaseClient()` itself when
   given no argument, `requireSessionUser()` inside the route should then resolve the **real**
   session from the **real** authenticated client, with no second mock. Confirm it does.
2. **Is React's `cache()` active outside a request scope?** `getSessionUser` is wrapped in
   `cache()`, and routes call the no-argument path. If the cache is live under Vitest, the first
   test's user is returned to the second test that acts as somebody else — a suite that silently
   asserts the wrong role. Its own comment says the uncached path is what "keeps fixtures from
   leaking between assertions", and routes do not take that path.
   - **If the cache leaks:** `routeClient.ts` mocks `@/lib/auth/session` as well, returning the
     acting fixture's `SessionUser` directly. Deterministic, at the cost of not exercising session
     resolution — acceptable, because `tests/lib/session.test.ts` already covers it.
   - **If it does not leak:** mock only `@/lib/supabase/server` and let session resolution run for
     real. Preferred, because the test then proves more.
3. **Does a route handler run under `@vitest-environment node`?** Import `GET` from
   `app/api/assignments/route.ts`, call it with `new Request("http://localhost/api/assignments?...")`,
   and read `response.status` and `await response.json()`.

**Stop here and report before continuing.** Answer all three, say plainly what was found, and wait
for the go-ahead before writing any of Tasks 2-6. Questions 2 and 3 can each change the design:
a live `cache()` means `routeClient.ts` mocks a second module and the tests stop exercising real
session resolution, and a route handler that will not run under Vitest at all invalidates the
premise of the whole slice. This is the one checkpoint in the plan; every task after it is
mechanical by comparison.

If the spike contradicts the Overview, say so in those words. A plan that was confidently wrong is
worth more as a correction than as a thing quietly worked around.

### Task 2: The shared route-test helper

**File:** `tests/helpers/routeClient.ts` (create)

```ts
export function actAs(fixtures: Fixtures, handle: FixtureHandle): Promise<void>
export function jsonRequest(url: string, init?: { method?: string; body?: unknown }): Request
export async function readResponse(response: Response): Promise<{ status: number; body: Record<string, unknown> }>
```

- Exposes a module-level holder the hoisted `vi.mock` factory reads at call time; `actAs()` writes
  it. The factory must not close over anything declared after it (see Pitfalls).
- `actAs()` awaits `asRole(fixtures, handle)` and installs that client, so a suite switches acting
  user between assertions with one line.
- Ships a documented usage block at the top — this file is the thing every later slice copies, and
  the six-retro gap existed partly because nobody had written down how.
- **Does not** wrap or re-implement `seedFixtures`. A route suite seeds exactly like an RLS suite.

### Task 3: `GET` and `POST /api/assignments`

**File:** `tests/routes/assignments.test.ts` (create)

Happy path plus auth-denied, plus the refusals scenario 012 lists:

- `bishop` GETs a month range → 200, assignments and `approvalCounts` both present
- `bishop` GETs with `sundayId` → 200, scoped to that Sunday
- GET with neither filter → 400 carrying the union's explicit message, not `"Invalid input"`
- `musicCoordinator` (no `talks.view`) → **403**
- `wardSecretary` (has `talks.view`, lacks `talks.plan`) POSTs → **403**
- `bishop` POSTs to a Sunday with `speaking_slots = 0` → **409**, message naming the slot count
- `bishop` POSTs `slotNumber` beyond the Sunday's slots → **409**
- `bishop` POSTs a slot already taken → **409**
- `bishop` POSTs with both `memberId` and `externalSpeaker` → **400** (the CHECK's honest twin)
- `wardBBishop` POSTs to a ward A Sunday → **404** — "not in your ward", never a leak
- **Every refusal leaves `audit_log` untouched.** Count rows for the ward before and after

### Task 4: `PATCH /api/assignments/[id]` — all three actions

**File:** `tests/routes/assignment-detail.test.ts` (create)

The richest route in the app; three actions, each with side effects.

- `action: "update"` → 200, and **clears existing approvals**; assert the rows are gone by re-read
- An update that invalidated approvals emits `plan_change_requested`
- `action: "transition"` skipping a stage → **409** naming the legal next stage
- A backward transition with **no reason** → **409** naming the reason as what is missing
- A backward transition by a non-bishopric actor → **409**
- The decline path: `request` → `plan` clears the speaker; assert `member_id` is null afterwards
  **by re-reading the row**, and that an `assignment_history` row was written for a member speaker
- The decline path for an **external** speaker writes **no** history row (ITER-004, by schema)
- `action: "waive_contact"` on a **member's** assignment → **409**, message telling the caller to
  contact them rather than waive
- `action: "waive_contact"` on an external speaker → 200, and **does not move the stage**
- Reaching `complete` writes history for a member, and none for an external speaker
- `params` is passed as `Promise.resolve({ id })`

### Task 5: `POST /api/assignments/[id]/approve`

**File:** `tests/routes/assignment-approve.test.ts` (create)

The gate the whole phase rests on. This is where scenario 012's console checks go to retire.

- `counselor1` approves an assignment at `review` → 200, `readyToApprove: false`
- **One user cannot fill the gate alone.** `counselor1` approves three times → one row, and
  `readyToApprove` stays false. This is `assignment_approvals_one_per_user` proven through the route
- All three bishopric members approve → `readyToApprove: true`, **and the stage is still `review`**.
  Approval is never a side effect of the last decision being recorded
- `approved: false` with no comment → **400** with the schema's sentence
- `approved: false` with a comment → sends the plan back to `plan`, clears the **other** approvals,
  and **keeps the refuser's own row** (it carries the only explanation the planner gets)
- Approving an assignment **not** at `review` → **409** telling the caller to reload
- `wardSecretary` → **403**; `musicCoordinator` → **403**
- Every refusal leaves `audit_log` untouched

### Task 6: `GET` and `POST /api/assignment-comments`

**File:** `tests/routes/assignment-comments.test.ts` (create)

- Both filters work and each returns only its own level's rows
- Neither filter → **400** with the union's explicit message
- A comment on another ward's assignment → **404**
- `musicCoordinator` → **403** on both verbs
- The audit row records the comment's **id and level and never its body** — a comment is free text
  about a member and an audit row is bishopric-readable (CLAUDE.md rule 8). Assert the body is
  absent from `detail`

### Task 7: The realtime publication migration

**File:** `supabase/migrations/026_realtime_publication.sql` (create),
`supabase/seed/realtime.sql` (create)

```sql
-- Realtime has never been enabled for any table in this project: before this migration a grep of
-- supabase/ finds no publication statement at all. talks-b shipped comment threads that therefore
-- never updated live, and Phase 11's notification UI would have found the same gap.
```

- Guarded with `if not exists (select 1 from pg_publication_tables ...)` per table, so re-running is
  safe. `db:push` is not the only thing that runs these.
- **Raise if the `supabase_realtime` publication itself is absent** rather than skipping silently.
  A migration that quietly does nothing is the silent failure CLAUDE.md rule 7 forbids.
- Covers `assignment_comments` and **nothing else**. Adding `notifications` alongside it was
  considered and rejected: Task 8 exists because a publication entry is a privacy decision that has
  to be proven, and proving `notifications` means a second isolation test for a table whose UI does
  not exist yet — notification rows are per-recipient, so an unproven entry there is worse than one
  here. **Phase 11 adds that table together with its own leak test.** One table, one proof.
- Default replica identity is sufficient — both subscribers listen for `INSERT` only. `UPDATE` or
  `DELETE` payloads carrying old values would need `replica identity full`; nothing wants that yet.
- **Migration numbering:** `plans/talks-c-prayers-topics.md` also claims `026`. This slice ships
  first, so it takes `026` and Task 9 renumbers talks-c to `027`.

### Task 8: The realtime privacy test

**File:** `tests/rls/realtime-isolation.test.ts` (create)

**This test is what earns the migration the right to ship.** Adding a table to a publication is a
privacy decision, and this project's rule is that RLS is the boundary and is proven rather than
assumed (CLAUDE.md rule 2).

- Subscribe as `wardBBishop` to `assignment_comments` filtered by **ward B**; insert a comment in
  **ward A**; assert **nothing arrives** within a generous timeout
- Subscribe as `bishop` (ward A) with no client-side filter at all; insert in ward A → the row
  arrives; insert in ward B → it does **not**. The `CommentThread` component filters by `ward_id` at
  the subscription, but that is a client-side convenience and a modified client could drop it —
  this asserts the server-side boundary
- `musicCoordinator` (no `talks.view`, and refused by migration 019's bishopric-only policy)
  receives **nothing** even within their own ward
- Unsubscribe in `afterAll`; a leaked channel keeps the suite's socket open and the run hangs
- **If any of these fail, the migration must not ship.** Say so in the retro and stop.

### Task 9: Trim the checklists, renumber talks-c, document the pattern

**Files:** both `scenario.md` files, `plans/talks-c-prayers-topics.md`, `CLAUDE.md` (modify)

- Remove from scenarios 012 and 013 every check now covered by Tasks 3–6 — chiefly both **Failure
  Behavior** sections and the "audit rows exist / audit_log untouched" items. Each scenario keeps a
  short line naming the suite that replaced them, so a reader can see the coverage moved rather than
  vanished.
- **Scenario 012's realtime note becomes a real check.** It currently asks the tester to "say which
  behaviour you saw" because the publication did not exist. With Task 7 shipped it becomes: open
  03-08 in two browsers, post a comment in one, and see it appear in the other without a reload.
- Renumber talks-c's migration to `027_topic_candidates.sql` in its Relevant Files table and its
  Task 1 heading.
- **CLAUDE.md §8** gains route handlers as a genuinely covered layer, with a pointer to
  `tests/helpers/routeClient.ts` — the gap persisted partly because the how was never written down.

---

## Testing Strategy

| File | Asserts |
|---|---|
| `tests/routes/assignments.test.ts` | List filters, both permission gates, all three 409s, cross-ward 404, audit untouched on refusal |
| `tests/routes/assignment-detail.test.ts` | All three PATCH actions, approval invalidation, the decline path's speaker clear and history row, the waiver's member-only refusal and its refusal to move the stage |
| `tests/routes/assignment-approve.test.ts` | The gate counts people not rows, `readyToApprove` never advances the stage, the change-request path keeps the refuser's row |
| `tests/routes/assignment-comments.test.ts` | Both levels, both filters, and that the audit detail never carries the comment body |
| `tests/rls/realtime-isolation.test.ts` | Cross-ward and cross-role realtime isolation — the test that gates the migration |

All five use `// @vitest-environment node`, seed with `seedFixtures`, and clean up in `afterAll`.
`vitest.config.ts` already sets `fileParallelism: false` and a 30s timeout, which these need.

**Not covered, deliberately:** the remaining 23 routes. This slice proves the pattern on the four
routes with concrete manual checks to retire and leaves a documented helper. Backfilling the rest is
a follow-up, and pretending otherwise would make this slice twice its useful size.

---

## Test Scenarios (Harness)

**No new scenario.** This slice adds automated coverage and *removes* manual checks; a new
walkthrough would be the opposite of the point.

Scenario 012 changes shape, per Task 9: it loses both Failure Behavior sections and its audit-row
checks to the new suites, and gains one real check it could not previously make — that a comment
posted in one browser appears in another without a reload, which only became testable once the
publication existed.

---

## Validation Commands

```bash
# The migration must be applied before the realtime test can pass
npm run db:push

npm run lint
npm run typecheck

# Regenerate after the scenario edits, then typecheck the harness
npm run manifest
npm run harness:typecheck

npm test

# Lint, typecheck and tests can all pass while a production build fails
npm run build
```

---

## Integration Notes

- **Nothing in `app/` or `lib/` changes.** The route handlers are tested exactly as they are, which
  is the point — a slice that had to refactor 27 routes to make them testable would be a much
  larger and riskier proposition, and the whole finding is that it is not necessary.
- **The helper is the deliverable.** Four suites are the proof; `tests/helpers/routeClient.ts` is
  what later slices actually consume. Write its usage block for somebody who has never seen
  `vi.mock` hoisting.
- **Breaking changes: none.** One new migration, additive and guarded.
- **The migration number is a live conflict.** `talks-c` claims `026` today. Task 9 renumbers it; if
  talks-c is executed before this slice lands, reverse the direction and take `027` here instead.
- **`npm run db:reset` is a hosted-database wipe** (CLAUDE.md §9). The migration goes on with
  `db:push`. Never reset to pick it up.
- **If Task 8 fails**, the correct outcome is to ship Tasks 1–6 and 9, leave the migration out, and
  record in the retro that Supabase's realtime does not enforce this project's policies the way the
  code assumed. That would be a far more important finding than the tests.
