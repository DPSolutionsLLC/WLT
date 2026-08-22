---
id: route-tests-and-realtime
type: feature
iter: null
commits: ["0db037f"]
date: 2026-08-21
files:
  - app/(app)/assignments/CommentThread.tsx
  - tests/helpers/routeClient.ts
  - tests/routes/assignments.test.ts
  - tests/routes/assignment-detail.test.ts
  - tests/routes/assignment-approve.test.ts
  - tests/routes/assignment-comments.test.ts
  - tests/rls/realtime-isolation.test.ts
  - tests/components/assignments/CommentThread.test.tsx
  - tests/db/roster-import.test.ts
  - supabase/migrations/026_realtime_publication.sql
  - supabase/seed/realtime.sql
  - testing/scenarios/talks/scenario-012-three-approval-gate/scenario.md
  - testing/scenarios/talks/scenario-013-visiting-speaker-no-phone/scenario.md
  - plans/talks-c-prayers-topics.md
  - CLAUDE.md
related: [talks-b-month-planner, talks-a-pipeline-core, foundation-c-services, auth-a-session-shell]
---

## What was done

Route handlers are now unit-tested. `tests/helpers/routeClient.ts` mocks one module —
`@/lib/supabase/server` — so a handler can be called as an ordinary function with an `asRole()`
client behind it; 65 tests now cover the four assignment routes. Migration 026 adds
`assignment_comments` to the `supabase_realtime` publication, the first table this project has
ever published, and `tests/rls/realtime-isolation.test.ts` proves the cross-ward and cross-role
boundaries before it ships. Scenarios 012 and 013 lost both Failure Behavior sections to the new
suites and 012 gained a realtime check it could not previously make.

Closes the realtime defect recorded in
[plans/confirmations/talks-planner-2026-08-21.md](../confirmations/talks-planner-2026-08-21.md) §2 —
which turned out to be two defects, not one. Scenario 012 was re-walked and passed, including the
two-browser live-comment check that could not be made before.

## Key decisions

- **Mock the client factory, never the client.** Every query in a route test still runs against the
  hosted project as a genuinely authenticated user, so a passing route test proves the RLS policy
  allowed it. A mocked client would produce suites that pass while the app leaks.
- **One table in the publication, one proof.** `notifications` was considered and deliberately left
  out. A publication entry is a privacy decision; notification rows are per-recipient rather than
  per-ward, so an unproven entry there would be worse than one here. Phase 11 adds it with its own
  leak test.
- **Every realtime negative carries a control row.** See the correction below — this was the most
  important change in the slice and it was not in the plan.

## Corrections to the record

**1. "There is no local server" was never true, and had hardened over six retros.** `auth-a` wrote
it in October as a cost judgement about two routes, and it was copied verbatim through `roster-a`,
`roster-b`, `roster-c`, `talks-a` and `talks-b` until it read as an impossibility at 27 routes.
Nobody re-checked, because a line appearing in six consecutive retros reads as settled. A route
handler is an exported async function taking a `Request`; the seam was already in
`lib/auth/session.ts`, put there by the same slice that declared routes untestable. The helper that
unlocked it is about twenty lines. **The lesson is about the copying, not the testing:** a
constraint inherited from a retro needs re-deriving when the thing it was measured against has
changed by an order of magnitude.

**2. A timeout-based negative is not a proof — and the first version of this suite proved it.**
The realtime isolation tests originally waited 10s, saw nothing, and declared privacy. Run before
the migration, all three negatives PASSED while realtime was entirely dead. They were measuring
silence, and silence is produced equally by a working policy, an unapplied migration, a cold
subscription and a switched-off feature. The rewrite inserts the forbidden row FIRST and a control
row the subscriber is entitled to receive SECOND, then waits for the control and asserts the
forbidden one is absent. WAL streams in commit order, so a control that arrives proves the
subscriber was live and had already been offered the row before it. The suite went from 49s to 10s
as a side effect. **Generalisable: any test whose pass condition is "nothing happened" needs a
positive control in the same window, or it is asserting that the test harness works.**

**3. A known missing dependency was hiding a second, unrelated bug — and only a human found it.**
`talks-b` recorded "realtime comment updates do not work; `assignment_comments` is not in the
publication, the channel logs a console error." That was true, and it was a complete-sounding
explanation, so nobody looked past it. Adding the publication revealed the real blocker underneath:
`CommentThread` named its channel `assignment-comments:${wardId}` — the SAME topic for every thread
on the page. A Sunday renders one per slot plus one for the month, `createBrowserClient()`
memoises, so all four got the same channel back; the first subscribed it and the second's `.on()`
threw, taking the page down with a runtime error. Fixed by keying the topic on the target AND a
`useId()` instance id, so it is correct by construction rather than by no page happening to render
a target twice.

**Nothing automated in this slice could have caught it.** `tests/rls/realtime-isolation.test.ts`
subscribes its own channels and never renders the component; it passed while the page was
unusable. It took opening the page in two browsers. There is now a component test covering it,
with a fake client that reproduces the two behaviours that caused it — same topic returns the same
channel, and `.on()` after `subscribe()` throws.

**Generalisable: a known-broken dependency is a comfortable place for a second bug to hide.** When
a fix removes the documented cause and the symptom survives, the prior diagnosis was incomplete
rather than wrong — and "we already know why that is broken" is what stops anyone checking.

**4. An unordered query with a positional assertion had been passing on luck.**
`tests/db/roster-import.test.ts` asserted `membersCreated === 9` on the row it `find`-ed by
`totalRows === 10` — but the idempotent-repeat import replays the IDENTICAL payload, so two of the
three audit rows match that predicate, and the query had no `ORDER BY`. Postgres returns rows in
no particular order, so it had been passing on whichever row the heap happened to return first.
This slice's route tests wrote enough new `audit_log` rows to flip it, and the test started failing
with nothing about the import changed.

Fixed by ordering on `created_at` and asserting both rows positionally — the repeat's
`membersCreated === 0` is now pinned rather than being the ambiguity that broke it. A scan of every
other `audit_log` and `notifications` query in `tests/` found no second instance.

**Generalisable, and it is the same shape as correction 2:** a test that selects rows without an
ORDER BY and then indexes or `find`s into the result is asserting against an implementation detail
of the storage engine. On a shared hosted project (CLAUDE.md §9) that detail moves as unrelated
suites write rows, so the failure surfaces far from its cause.

**5. `music_coordinator` holds `talks.view`.** The plan specified it as the no-`talks.view` fixture
in three tasks; it is not one — they pick hymns from the speaking plan and are meant to see it.
`org_president` is the right fixture. Checking the matrix in `lib/auth/permissions.ts` costs
nothing and the intuitive answer was wrong.

**6. Scenario 012 asserted a 403 that is actually a 404.** Editing an assignment as `secretary`
returns 404, not 403: `PATCH /api/assignments/[id]` reads the row before checking the permission,
and migration 019 makes `assignments` bishopric-only, so RLS hides it first. The check was ticked
by hand during the talks-b walkthrough. Console commands pasted by a human get ticked on the shape
of the answer rather than its status code, which is most of the argument for moving them into
tests.

**7. `canTransition`'s "only the bishopric can move an assignment back" is unreachable through the
route.** `talks.plan` is held only by bishop and counselor, and `is_bishopric()` is exactly
`role in ('bishop','counselor')` — so anyone who can read an assignment is already bishopric and
everyone else gets a 404 first. The rule is real, is tested where it is reachable in
`tests/lib/pipelineTransitions.test.ts`, and is defence in depth against a `role_access` override.
It is not dead code; the route test says so in a comment so nobody deletes it.

## Known pitfalls for the next slice

- **`vi.mock` is hoisted above every import.** Its factory cannot close over anything declared later
  in the file. The acting client lives in `routeClient.ts` and the factory reaches it through an
  `await import()` at call time. This is documented at the top of that file; read it first.
- **React's `cache()` is inert outside a request scope.** Measured, not assumed: a `cache()`d
  function called twice with identical arguments runs twice, because there is no dispatcher. This
  is why route tests exercise real session resolution instead of mocking `@/lib/auth/session`. If a
  future React version changes it, the symptom is every acting user behaving like the first one.
- **`npm run db:push` needs a valid CLI access token.** CLI 2.114 provisions a temporary DB role
  through the management API first, so an expired token in Windows Credential Manager
  (`Supabase CLI:supabase`) fails at "Initialising login role" with a bare 401. `npx supabase login`
  fixes it. `--debug` is what surfaces the actual cause.
- **Order any query you then index into.** `.order("created_at")` before `data[0]`, `find()`, or
  `limit(1)`. Without it the assertion depends on heap order, which moves as other suites write
  rows to the same shared table — and the failure lands in a file nobody touched.
- **A realtime channel topic must be unique per subscriber, and the browser client is shared.**
  `createBrowserClient()` memoises, so two components asking for the same topic get the same
  channel and the second one's `.on()` throws. Any new component that subscribes needs its own
  topic — include a `useId()` in it. This is what broke the comment threads.
- **Realtime authenticates separately from PostgREST.** `client.realtime.setAuth(accessToken)` must
  be called before subscribing, or the socket is anonymous and every policy refuses it — which
  looks exactly like working isolation.
- **Unsubscribe every channel in `afterAll`.** A leaked channel holds the socket open and the run
  hangs after the last assertion passes.
- **The remaining 23 routes are not covered.** That is a documented follow-up, not an oversight. The
  helper is what makes backfilling them cheap; CLAUDE.md §8 documents how.
