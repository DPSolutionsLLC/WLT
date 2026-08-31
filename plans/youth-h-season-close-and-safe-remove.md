# Plan: Youth H — Closing Out a Season, and a Remove That Cannot Destroy an Account

**Created:** 2026-08-30
**Type:** feature + bugfix
**Scope refs:** ITER-028 ITER-031
**Structure:** Unified

---

## Overview

Two backlog items that are the same button.

**ITER-028** — `/youth` ranks young people on a support percentage computed from every past home
game on a profile plus the next one, and **nothing ever leaves that computation**. A basketball
season that finished in February keeps contributing to Ethan's number in October. A ward two years
in is ranking its youth on games nobody remembers.

**ITER-031** — `Remove` on an activity deletes unconditionally. Migration 009 cascades
`youth_activity_profiles → activity_events → {activity_attendees, activity_logs →
activity_private_notes}`, so one press destroys a season, every sign-up, every pastoral follow-up
**and the private notes rule 5 calls private forever**. The audit row records `profileId`, `orgId`
and `memberId` and nothing about what went with them. `2809aef` added a confirm dialog; a dialog
can be clicked through and is not protection.

**They resolve together.** Once a season can be *closed*, "I want this off my list" has an answer
that destroys nothing, and the destructive path narrows to what it should always have been: an
activity created by mistake with nothing recorded against it.

### Product decisions taken 2026-08-30 (asked and answered before planning)

1. **Close is primary; Remove survives only for empty activities.** The card offers `Close`. A hard
   `Remove` renders only when the activity has **no events at all**. The server refuses a destructive
   delete independently, naming Close as the alternative.
2. **A young person whose every activity is closed STAYS on `/youth`**, with a "nothing running"
   state and a link to their history. They must not vanish, and must not read as somebody with no
   activities.
3. **A closed season's unwritten follow-ups still appear** in *Waiting on your follow-up*. Closing
   ends the ranking, not the obligation — otherwise Close becomes a way to dismiss work a leader
   committed to.
4. **The ward-wide historical overview is CUT.** Per-youth history only. ITER-028's own scope lists
   the overview last and says nobody has named the question it answers.

### Success criteria

- A leader can close a season; its pills leave `/youth`; its history stays reachable.
- A closed season is reopenable (a mistake is recoverable).
- `Remove` cannot destroy a follow-up, proved by a route test that re-reads the row.
- A young person with every season closed still renders, sorts last, and reads as deliberate.
- The number, the sentence on the card and the sort remain **one computed value** (`youth-f`).

---

## Relevant Files

**Create**

- `supabase/migrations/060_activity_profile_close.sql` — `closed_at`, and the `security definer`
  follow-up counter the refusal needs.
- `app/api/youth/profiles/[id]/close/route.ts` — PATCH: close and reopen.
- `app/(app)/youth/history/[member_id]/page.tsx` — per-youth history.
- `app/(app)/youth/history/[member_id]/YouthHistory.tsx` — the client half.
- `tests/rls/youth-profile-close.test.ts`
- `tests/routes/youthProfileClose.test.ts`
- `testing/scenarios/youth/scenario-060-the-season-is-over/` (`scenario.md`, `seed.ts`)

**Modify**

- `types/database.ts` — regenerate (`npm run db:types`). Do not hand-edit.
- `lib/youth/queries.ts` — `ActivityProfile.closedAt` and `eventCount`; `ACTIVITY_PROFILE_COLUMNS`;
  `mapActivityProfileRow`; `closeActivityProfile()`; `deleteActivityProfile()` guard.
- `lib/validation/youth.ts` — `closeActivityProfileSchema`.
- `lib/youth/profileNeed.ts` — `youthNeed()` takes running vs closed; `YouthNeed.closedCount`.
- `app/(app)/youth/YouthOverview.tsx` — group from ALL profiles, compute from RUNNING only.
- `app/(app)/youth/ActivityProfileList.tsx` — Close control; Remove gated on `eventCount === 0`.
- `app/(app)/youth/youthQueries.ts` — mutation + invalidation keys for close/reopen.
- `app/api/youth/profiles/[id]/route.ts` — DELETE refuses when follow-ups exist.
- `CLAUDE.md` §9 — record the reversal of "no season boundary is introduced".
- `plans/INDEX.md` — add the `youth-h` slice row.
- `tests/lib/youthProfileNeed.test.ts`, `tests/routes/youthProfiles.test.ts`,
  `tests/components/youth/ActivityProfileList.test.tsx` — extend.

---

## Dependencies

No new libraries. Uses `writeAuditLog()`, `assertCan()`, `resolveRoleAccess()`,
`canManageActivityProfile()`, `readWardTimezone()`, and the `routeClient` test helper — all shipped.

---

## Known Pitfalls (from retro context)

- **`youth-f` — the number, the sentence and the sort must be ONE computed value.** Seen three
  times in this module (`summariseCoverage`, `describeHouseholdForVisits`, the `Covered · 0`
  defect). If `closed_at` filters the pills but not the sort or the sentence, this ships a fourth
  time. Everything must come out of the single `rows` pass in `YouthOverview`.
- **`youth-e` — carry the WHOLE row, not fields off it.** `worstUpcomingAttendees` exists because
  a state and a count taken from two different rows disagreed while each was individually correct.
- **`visits-f` — a null sorts LAST in both directions**, and this module has two null rules that
  look identical and are opposite. A youth with only closed seasons has `lowestSupport === null`,
  which already sorts last. **Assert it rather than assume it.**
- **`youth-a` / `visits-d` / `youth-d` — a control the policy refuses is still a bug.** Seen FOUR
  times. `Close` must be gated on `canManageActivityProfile()` exactly as Edit and Remove are.
- **`talks-d` — never compare a nullable column that can be null on both sides.** 054d's write
  policies carry an explicit `org_id is null` branch; the close route inherits that policy and must
  not add its own narrower check.
- **`youth-c` — `npm run build` catches what lint, typecheck and the suite miss** (a server-only
  module pulled into the browser bundle). The build is in the validation list and is not optional.
- **`roster-c` / `visits-b` — a comment asserting a match is not a test.** The client-side Remove
  gate and the server-side refusal are two expressions of one rule; test both.

---

## Tasks

### ITER-028 Tasks — closing out a season

#### Task 1: Migration 060

**File:** `supabase/migrations/060_activity_profile_close.sql` (create)

**Action:** Add `closed_at`, and a `security definer` function that counts follow-ups on a profile.

**Details:**

- Header comment in the house style. State that this migration is **purely additive** — a nullable
  column and a function; it sets nothing `NOT NULL`, narrows no CHECK and tightens no policy — so
  **no `HELD_BACK_UNTIL_DEPLOYED` entry in `tests/db/migrations.test.ts`** and no row-count check.
  Migration 059's header states this rule; follow it and say why.

```sql
alter table youth_activity_profiles add column closed_at timestamptz;
```

- **A timestamp, never a boolean.** "When did this season end" is the question the history page
  asks, and a boolean cannot answer it. **Nullable** — null means running, and a season closed by
  mistake is reopened by setting it back to null. **Never a delete.**
- **No new RLS policy.** Closing is an `UPDATE` on `youth_activity_profiles`, and migration 054d's
  `youth_activity_profiles_update` already describes exactly the right boundary
  (`is_bishopric() or entered_by = auth.uid() or org_id = current_org_id()`, with the explicit
  `org_id is null` branch). Adding a second policy would be a second copy of the answer. **Say this
  in the migration comment** so a later reader does not "notice the omission".
- **The follow-up counter**, which exists because `activity_logs` reads are org-scoped (057c) so
  the acting user's own client cannot see another organization's follow-ups:

```sql
create or replace function activity_profile_followup_count(target_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from activity_logs log
  join activity_events event
    on event.id = log.event_id and event.ward_id = log.ward_id
  where event.profile_id = target_profile_id
    and event.ward_id = current_ward_id();
$$;
```

- **Why `security definer` is correct here and does not break rule 2.** It returns a COUNT and
  never a row — no note text, no author, no event title reaches the caller. It is used only to
  REFUSE a write. The `current_ward_id()` filter keeps it ward-scoped, so it cannot be used to
  probe another ward. Document all three points in the comment; this is the kind of function a
  later reader will widen.

#### Task 2: Types and the data layer

**File:** `lib/youth/queries.ts` (modify), `types/database.ts` (regenerate)

**Action:** Carry `closedAt` and an event count on `ActivityProfile`.

**Details:**

- Run `npm run db:types` after `npm run db:push`. **Never hand-edit `types/database.ts`.**
- `ActivityProfile` gains:
  - `closedAt: string | null`
  - `eventCount: number` — **the true count, past events included.** The existing comment in
    `ActivityProfileList.tsx` predicted this exactly: *"A true count means an embedded count on a
    shared query plus its type, mapper and route; that belongs with ITER-031's refusal-and-unlink."*
    Fulfil it here rather than deferring again.
- `ACTIVITY_PROFILE_COLUMNS` gains `closed_at` and `activity_events(count)`. Map the PostgREST
  count shape in `mapActivityProfileRow` — it arrives as `[{ count: n }]`, and an activity with no
  events yields `[]`, so map that to `0` explicitly rather than relying on `?? 0` swallowing a
  shape change.
- New `closeActivityProfile(wardId, profileId, closedAt, client)` — sets `closed_at` to the passed
  value (an ISO string to close, `null` to reopen) and returns the updated row, or `null` when RLS
  refused. **Follow `updateActivityProfile()`'s existing shape**, including its zero-row handling:
  an RLS-denied UPDATE is a zero-row success, not an error.
- `listActivityProfiles()` keeps returning **every** profile, running and closed. The read path
  decides what to show — a query that filtered here would make a fully-closed youth unreachable
  from every caller at once, which is decision 2's trap.

#### Task 3: The close route

**File:** `app/api/youth/profiles/[id]/close/route.ts` (create),
`lib/validation/youth.ts` (modify)

**Action:** `PATCH` closing and reopening, with its own audit action.

**Details:**

- Schema, in `lib/validation/youth.ts`:

```ts
export const closeActivityProfileSchema = z.object({ closed: z.boolean() });
export type CloseActivityProfileInput = z.infer<typeof closeActivityProfileSchema>;
```

- **Its own route, not a field on `updateActivityProfileSchema`.** Closing a season is a distinct
  decision that deserves its own audit action, on the precedent of `approve` on assignments and
  programs. A partial patch would record it as an ordinary edit — the exact reasoning
  `updateActivityProfileSchema` already gives for keeping `memberId` and `orgId` unpatchable.
- Handler shape, mirroring `PATCH /api/youth/profiles/[id]` line for line:
  - `requireSessionUser()` → `createServerSupabaseClient()` → `resolveRoleAccess()`
  - `assertCan(user, "youth_activities.manage", roleAccess)` — **`.manage`, not `.log`.** A closed
    season is a coordination decision, not a pastoral note.
  - `getActivityProfile()` first; 404 with a sentence when absent.
  - `closeActivityProfile()`; a `null` return is RLS refusing → 404 with `WRITE_REFUSED`.
  - `writeAuditLog()` with action `youth_activity_profile_closed` or
    `youth_activity_profile_reopened`, detail carrying `profileId`, `orgId`, `memberId`, `closedAt`.
    **Two actions, not one with a boolean** — an audit reader scanning for destructive-ish events
    should not have to parse a payload to tell which happened.
  - `respondToRouteError()` in the catch, with `route` and `fallbackMessage`.
- **Reopening is the same route with `{ closed: false }`**, which is what makes a mistake
  recoverable and is why `closed_at` is nullable rather than a one-way flag.
- **Emit no notification.** Nothing in this module notifies on a coordination edit, and adding the
  first one here would be a decision this plan has not been asked to take.

#### Task 4: `youthNeed` learns about closed seasons

**File:** `lib/youth/profileNeed.ts` (modify)

**Action:** Compute from running profiles only; report how many are closed.

**Details:**

- `youthNeed()`'s `profiles` parameter gains `closedAt: string | null` on its element type.
- Inside, partition once:
  - `running` = `closedAt === null` → drives `activities`, `lowestSupport`, `upcomingCount`,
    `worstUpcoming`, `worstUpcomingAttendees`, `soonestNeedOn`. **Every existing computation reads
    `running` and nothing else.**
  - `YouthNeed` gains `closedCount: number` and `hasRunning: boolean`.
- **`lowestSupport` is already `null` when there are no running activities**, and `compareYouth`
  already sorts null last in both directions. **That is the correct behaviour and it comes for
  free — do not add a branch for it.** Add a test asserting it in both directions instead, beside
  the existing pair, because this module has two null rules that look identical and are opposite.
- Add a `describeClosedSeasons(need)` returning a sentence or `null`, following
  `describeActivitySupport()`'s shape. It must read as deliberate, not as an absence:
  *"Nothing running. 2 closed seasons."* — never `0%`, never an empty card.
- **Do not touch `carriesCoverageExpectation()`.** ITER-030 is the item that changes it, and its
  scope names that function as its single insertion point. Two items editing one function in
  sequence is fine; two items editing it at once is how a rule gets retuned by accident.

#### Task 5: `/youth` renders a fully-closed young person

**File:** `app/(app)/youth/YouthOverview.tsx` (modify)

**Action:** Group by member from ALL profiles; compute from running only.

**Details:**

- **This is the task decision 2 turns on, and the trap is one line.** The `byMember` grouping is
  built from `profiles`. If closed profiles are filtered out before it, a young person with every
  season closed produces no group and **vanishes from the ward** — which is exactly what ITER-028
  says must not happen.
- So: build `byMember` from **every** profile, and let `youthNeed()` do the partition (Task 4).
  The `rows` `useMemo` stays the single pass everything reads — the sort, the pills, the badge, the
  count and the new "nothing running" line all come out of it. **`youth-f`'s rule, and the reason
  this file already carries a comment saying so.**
- `profileIds` (which the expanded card filters on) should stay **all** profile ids, so expanding a
  card still shows the closed season's events in the schedule. The ranking excludes them; the
  schedule is a record of what happened and should not develop a hole.
- Render, when `hasRunning === false`: no pills, the `describeClosedSeasons()` sentence, and the
  "See their history" link. Keep the card's existing structure — this is a state, not a variant.
- **"See their history" renders on every card that has at least one closed season**, not only on
  fully-closed ones. A youth with one running and one finished season has history worth reaching.

#### Task 6: The per-youth history page

**File:** `app/(app)/youth/history/[member_id]/page.tsx` +
`app/(app)/youth/history/[member_id]/YouthHistory.tsx` (create)

**Action:** List that young person's closed seasons with their final numbers and their events.

**Details:**

- Server Component resolves the session, `assertCan(user, "youth_activities.view", roleAccess)`,
  `readWardTimezone()`, and `asOf`. Follow `app/(app)/youth/events/[id]/page.tsx` — the closest
  existing shape (a detail page under `/youth` with a dynamic segment).
- **`params` is a Promise in Next 16**: `const { member_id } = await params`.
- **The final number is RECOMPUTED with `closedAt` as the clock, never stored.** Call
  `activitySupport(profile, events, new Date(profile.closedAt))`. This is ITER-028's one real
  design question, and recomputing is what keeps *"nothing in this project refreshes anything"*
  intact — the same stored-versus-computed argument this module has had six times, answered the
  same way each time.
- **Every date formatter names its zone** and a turn-up-at `timestamptz` uses the **ward's**
  (`c24d52b`, CLAUDE.md §9). `tests/lib/explicitTimeZone.test.ts` reads the source and will fail
  on any formatter that omits it — including in a brand-new file.
- Empty state: a young person with no closed seasons reads as *"No finished seasons yet."*, not a
  blank page.

---

### ITER-031 Tasks — a Remove that cannot destroy an account

#### Task 7: The server-side refusal

**File:** `app/api/youth/profiles/[id]/route.ts` (modify)

**Action:** Refuse `DELETE` when any follow-up exists, naming Close as the alternative.

**Details:**

- Before `deleteActivityProfile()`, call the `activity_profile_followup_count` RPC from Task 1.
- When the count is greater than zero, return **409** with a sentence that names the alternative:

  > *"This activity has follow-ups recorded against it, so it cannot be removed. Close it instead —
  > its history stays readable and it leaves the support ranking."*

  **The count is NOT disclosed and neither is any content.** `activity_logs` reads are org-scoped,
  so the deleter may not be entitled to know whose follow-ups those are or how many. *"has
  follow-ups recorded against it"* is the right amount to say — ITER-031's scope settles this, and
  it is a rule 5 judgement rather than an obvious call, so **write the reasoning into the route**.
- **Refused, not confirmed.** `visits-f`'s empty-bulk-replace is the precedent: refuse, and name
  the alternative in the same sentence. A dialog that can be clicked through is not protection for
  a pastoral record.
- **Write no audit row for the refusal.** A refused write is not a mutation; scenario 049's walk
  established that refused calls leave no audit rows, and a row here would make the audit log
  disagree with that.
- On the path that DOES delete, **enrich the audit detail** with `eventCount` and
  `activityName`, so the log finally records what was lost. Today it carries three ids and
  ITER-031 names that as part of the defect.

#### Task 8: Close primary, Remove only when empty

**File:** `app/(app)/youth/ActivityProfileList.tsx` (modify),
`app/(app)/youth/youthQueries.ts` (modify)

**Action:** Add Close/Reopen; render Remove only for an activity with no events.

**Details:**

- Both controls stay inside the existing
  `canManage && canManageActivityProfile(user, profile)` branch. **Do not widen that gate** — it
  was walked across four accounts in scenario 049 and is correct; ITER-031 is explicit that this is
  about what the press does, not who may press.
- `Close` → `PATCH .../close` with `{ closed: true }`. On a closed profile the control reads
  `Reopen` and sends `{ closed: false }`.
- **Close carries a confirm worded by consequence**, following `DocumentList.tsx`'s house rule and
  the confirm `2809aef` already added here — but it is a mild one, because closing destroys
  nothing: *"Close Varsity basketball for Ethan Brooks? Its games and follow-ups stay readable, and
  it stops counting towards how well he is supported. You can reopen it."*
- **`Remove` renders only when `profile.eventCount === 0`.** This gate is **exact, not an
  approximation**: `activity_logs.event_id` has been `NOT NULL` since migration 057 and references
  `activity_events`, so **no events implies no follow-ups**. Write that reasoning into the comment
  — a later reader will otherwise assume it is a heuristic and "improve" it.
- The existing `removeProfile()` confirm can now **name a true count**, since `eventCount` is on
  the profile. But with the gate above it only ever renders at zero, so simplify the sentence to
  the empty case: *"Remove Varsity basketball from Ethan Brooks? Nothing has been recorded against
  it yet."* **Delete the "NO COUNT, DELIBERATELY" comment block** — it documents a constraint this
  task removes, and a stale comment asserting a limitation is `roster-c`/`visits-b`'s defect a
  fourth time.
- **The server refusal stays regardless** (rule 2). The UI gate and the policy are two expressions
  of one rule and neither is the boundary on its own.
- Invalidate `YOUTH_PROFILES_QUERY_KEY` **and** the events/attendees keys after close or reopen, on
  `FOLLOW_UP_MUTATION_INVALIDATES`' precedent — the pills, the ranking and the schedule all move.

#### Task 9: Documentation

**File:** `CLAUDE.md` (modify), `plans/INDEX.md` (modify)

**Action:** Record the reversal and the new slice.

**Details:**

- **CLAUDE.md §9 must record that "no season boundary is introduced" is REVERSED**, and why: its
  test was "wait until a ward reuses a profile across years", superseded by a direct product
  request, which is a better reason than the one it was waiting for. ITER-028's scope says to
  record the reversal rather than quietly contradict the entry — this project's §9 is written as a
  history of decisions and a silent contradiction is the failure mode it exists to prevent.
- Also record: **Close is the primary control and Remove is reserved for an activity with nothing
  recorded**, with the exact-gate reasoning (`activity_logs.event_id` is `NOT NULL`).
- Add the `youth-h` row to the Phase 8 slice table in `plans/INDEX.md`.

---

## Testing Strategy

Per CLAUDE.md §8 priority order.

**1. RLS — `tests/rls/youth-profile-close.test.ts` (create)**

- An `org_president` closes their own organization's profile → succeeds.
- The same president closes **another** organization's profile → **zero rows**, and the row
  re-read with the service client still has `closed_at = null`. **An RLS-denied UPDATE is a
  zero-row success, not an error** — assert by re-reading, never by expecting a throw.
- A ward-wide profile (`org_id is null`) closed by a `ward_council_member` with no organization →
  succeeds. This is 054d's explicit null branch and the `talks-d` hole; assert it directly.
- A user in ward B cannot close a profile in ward A.
- Seed with `seedFixtures(handles)`, `fixtures.cleanup()` in `afterAll`.

**2. Route — `tests/routes/youthProfileClose.test.ts` (create)**

- Close → 200, `closed_at` non-null read back with the service client, audit row
  `youth_activity_profile_closed`.
- Reopen → 200, `closed_at` null, audit row `youth_activity_profile_reopened`.
- A role holding `.log` but not `.manage` → **403**, and the row re-read unchanged.
- An unknown profile id → 404.
- `{ closed: "yes" }` → 400 from Zod.

**3. Route — `tests/routes/youthProfiles.test.ts` (extend)**

- **DELETE on a profile with a follow-up → 409**, the row **re-read and still present**, its events
  still present, and **no audit row written**. This is the test the whole item exists for.
- DELETE on a profile with events but no follow-ups → succeeds (Close is advice, not a lock; only a
  written account is protected).
- DELETE on an empty profile → succeeds, audit detail carries `eventCount: 0` and `activityName`.
- **A follow-up written by ANOTHER organization still blocks**, proving the `security definer`
  counter sees what the caller cannot. Seed the log as a different org's user.

**4. Pure logic — `tests/lib/youthProfileNeed.test.ts` (extend)**

- A closed profile contributes nothing to `lowestSupport`, `upcomingCount` or `worstUpcoming`.
- A youth with one running and one closed season is ranked on the running one alone.
- **A youth with every season closed still produces a `YouthNeed`**, with `hasRunning: false`,
  `closedCount` correct, and `lowestSupport: null`.
- **That youth sorts LAST under `priority` in BOTH directions** — asserted explicitly, beside the
  existing opposite-null pair, because the two rules look identical and are opposite.
- `describeClosedSeasons()` pluralises (`1 closed season` / `2 closed seasons`) and returns `null`
  when there are none. `youth-b-D3` was "1 events updated"; this module has shipped that defect.
- The history page's frozen number: `activitySupport(profile, events, closedAt)` returns the same
  value when computed again a month later.

**5. Component — `tests/components/youth/ActivityProfileList.test.tsx` (extend)**

- `Remove` is **absent** when `eventCount > 0`; **present** when `eventCount === 0`.
- `Close` is present on a running profile, `Reopen` on a closed one.
- Neither renders when `canManageActivityProfile()` is false — the `youth-a-D1` shape, now a
  fourth control that could repeat it.
- **Prove each assertion can fail before believing it** (the `notification-trigger-drift` rule).

**6. Migration — `tests/db/migrations.test.ts`**

- 060 is applied and is **not** in `HELD_BACK_UNTIL_DEPLOYED`. Migration 059's header explains why
  an unnecessary entry is harmful: it hides a real migration from the everything-is-applied
  assertion.

---

## Test Scenarios (Harness)

### Scenario 060: The season is over

**Tags:** `youth`, `full`, `close`, `delete`

**Purpose:** Closing a season and removing an activity are both hard to set up by hand — one needs
a finished season with real follow-ups written by *another organization's* leader, which is
precisely the state the refusal must detect and the tester cannot see. Seeding is what makes the
central check observable at all.

**Seed data summary:**

- Ward — Harness Test Ward.
- Users — `ym-president` (Young Men), `yw-president` (Young Women), `bishop`, `ward-council`
  (no organization).
- Members — 3 youth: **Ethan Brooks** (two activities, one to close), **Maya Diaz** (one activity,
  already closed — the fully-closed card), **Josh Kim** (one activity, brand new, **no events** —
  the only removable one).
- Profiles — 5: one running with 12 past events and a follow-up **written by `yw-president`**
  (the cross-org refusal); one running and empty; one already `closed_at`; two ordinary.
- Events — ~20 across the profiles, a mix of past and upcoming, home and away.
- Logs — 2, one of them by another organization's leader.

**Tester action:** Sign in as `ym-president`; close a season from `/youth/profiles`; watch the pills
leave `/youth` without a reload; open the history link; reopen it; try to Remove the activity that
has follow-ups; then Remove the empty one.

**Verification checklist (machine-checkable):**

- [ ] Closing a season removes its pill from the young person's `/youth` card **without a reload**.
- [ ] `closed_at` is non-null in `youth_activity_profiles`, and an audit row
      `youth_activity_profile_closed` exists.
- [ ] **Maya Diaz still appears on `/youth`** with no pills, "Nothing running. 1 closed season.",
      and a history link — she does not vanish.
- [ ] Maya sorts **last** under Priority, and **still last** when the direction is reversed.
- [ ] The history page shows the closed season's final percentage, and it is **unchanged** when the
      page is reloaded a day later (recomputed against `closed_at`, not `now`).
- [ ] Reopening restores the pill and writes `youth_activity_profile_reopened`.
- [ ] **`Remove` is not rendered** on the activity with 12 events.
- [ ] `DELETE` on that activity **by direct API call** → **409**, the sentence names Close, and the
      profile, its events and its logs are **all still present** when re-read with the service
      client.
- [ ] **No audit row** was written for the refused delete.
- [ ] `Remove` **is** rendered on Josh Kim's empty activity, and removing it succeeds.
- [ ] A closed season's unwritten follow-up **still appears** in *Waiting on your follow-up*.
- [ ] `yw-president`'s follow-up blocks the delete even though `ym-president` cannot read it.
- [ ] Neither `Close` nor `Remove` renders on another organization's activity.
- [ ] No horizontal overflow at 375px; every button and form control at least 44×44.

**Needs a human eye:**

- [ ] Does "Nothing running" read as deliberate, or as a young person the app has lost track of?
- [ ] Does the refusal sentence make the alternative obvious, or does it read as a dead end?
- [ ] Is it clear that Close is the ordinary action and Remove the exception?
- [ ] Does the history page answer "how well was he supported last season" at a glance?

---

## Validation Commands

```bash
# Apply the migration to the linked hosted project, then regenerate types
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests
npm test

# Production build — NOT optional.
# youth-c: `npm run build` caught what lint, typecheck and 2982 tests all missed.
npm run build
```

---

## Integration Notes

- **`npm run db:reset` wipes the hosted database.** Do not run it. `db:push` only (CLAUDE.md §9).
- **Migration 051 is still deliberately unapplied** and lives in `HELD_BACK_UNTIL_DEPLOYED`.
  Do not disturb that entry while adding 060.
- **`FollowUpPanel.tsx` is deliberately NOT modified.** Decision 3: a closed season's unwritten
  follow-ups still surface. Recording the non-change is the point — a later reader finding the
  panel untouched should find a decision rather than assume an oversight.
- **`carriesCoverageExpectation()` is deliberately NOT modified.** That is ITER-030's single
  insertion point, and its scope names it. Sequence ITER-030 after this.
- **ITER-031's "unlink from the occasion" alternative is NOT built.** The user's phrase — *"the
  current youth could be disconnected"* — had two candidate meanings, and decision 1 settled it as
  Close rather than unlink. `youth-g` already ships an unlink on `/youth/events/[id]`, so the
  capability exists where it belongs; a second entry point from the activity list would be a second
  meaning of the same word. **Record this in the retro** rather than leaving it looking forgotten.
- **Breaking change: none.** `closed_at` is nullable and every existing profile reads as running,
  so no ward's `/youth` moves on the day this ships — the same absent-means-default idiom as
  `household_stewardships`, `household_visit_cadences` and 054a's `org_id`.
- **After execution, run `/confirm`** and walk scenario 060. Phase 8's record is that every slice
  walked has found defects a green suite could not see; four of the seven found the same
  offered-control shape.
