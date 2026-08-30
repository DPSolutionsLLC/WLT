# Plan: youth-g — The Occasion Link and the Event-Detail View

**Created:** 2026-08-29
**Type:** feature
**Scope refs:** ITER-024 (plus the parked event-detail half of ITER-020)
**Phase:** 8 — Youth activity support, slice G

---

## Overview

`activity_events.profile_id` is a single foreign key, so **an event belongs to exactly one young
person**. Ethan Brooks and Josh Kim on the same basketball team, at the same game on Friday, are
**two rows**, two calendar cards, and nothing anywhere records that they are the same evening in
the same gym.

ITER-024 decided **Option A′** on 2026-08-29: keep one row per youth — the module's atom is already
correct, because a commitment is to *a young person on an occasion* — and add only the missing fact
that **two atoms can share an evening**. One nullable link, and every want in ITER-020 becomes
reachable.

This slice ships that link **and the screen that reads it**. ITER-024's own Sequencing section is
explicit that a stored link nothing reads changes no screen, which is why the two are one plan.

### Key requirements

1. **An occasion is an explicit, stored identity** — never inferred from a matching title and date.
2. **One row per youth survives.** Each event keeps one profile, one organization, one coverage
   state, one follow-up shape. Nothing that shipped in slices A–F is reworked.
3. **An event-detail view** at `/youth/events/[id]` listing **every young person tied to the
   occasion**, each with their own coverage badge and their own `AttendeeControls`.
4. **Two ways to build an occasion**, both decided 2026-08-29:
   - **Join two existing rows** — the Ethan-and-Josh case, two rows already imported from separate
     school feeds.
   - **Add a young person you notice is missing** — creates their row inside the same occasion.
5. **An occasion-level alert**: worst-of across the occasion's rows, using `coverageRank()` — the
   rule `ActivityCalendar` already applies to day cells, reused rather than invented.
6. **`/youth/calendar` marks, it does not collapse.** One card per young person still, with a quiet
   *"+2 others at this game"* line linking to the occasion. Decided 2026-08-29: an occasion spans
   youth, organizations and activity types, so collapsing would leave all four of that page's
   filters without a single answer.
7. **Cross-navigation**, closing ITER-020's table: any card → the event → the occasion's young
   people → a young person's card.

### Decisions taken at planning time, and not to be re-litigated

- **An occasion is identity only** — `id`, `ward_id`, `created_by`, `created_at`. No name, no date,
  no place. Those already live on the rows, and a second copy could disagree with the first.
  ITER-024's first open question, answered as its own text recommends.
- **The ICS import does not create occasions in this slice.** ITER-024 calls this answerable later
  and says the column is useful without it. A leader joins imported rows by hand, which is exactly
  the flow this slice builds. Record it as handed forward; do not build a matching key.
- **Cross-organization occasions are supported and fall out rather than being engineered.** An
  occasion may hold a Young Men row and a Young Women row; each leader writes about their own
  organization's young person, and every existing gate keeps its single answer.

### Success criteria

- Two event rows for one real game can be joined by a person, from either row, and unjoined again.
- `/youth/events/[id]` shows every young person on that occasion, each with their own badge and
  their own "I'll go".
- An occasion where **one** young person has nobody committed reads as an alert, even when the
  others are covered.
- `/youth/calendar` and `/youth`'s `EventList` both link into the detail view and both say how many
  others share the game — **counted from the unfiltered list**.
- No existing coverage number, follow-up gate, ICS import behaviour or RLS policy changes.

---

## Relevant Files

### Create

- `supabase/migrations/059_activity_occasions.sql` — the `activity_occasions` table, its four
  policies, `activity_events.occasion_id`, its composite foreign key, and one index.
- `lib/youth/occasions.ts` — server-only data access for occasions (create, join, unlink, read).
- `app/api/youth/events/[id]/occasion/route.ts` — `POST` joins this event to another; `DELETE`
  takes it out of its occasion. Mirrors `app/api/youth/events/[id]/attend/route.ts`.
- `app/(app)/youth/events/[id]/page.tsx` — the event-detail Server Component.
- `app/(app)/youth/events/[id]/EventDetail.tsx` — the client component that renders the occasion.
- `app/(app)/youth/events/[id]/JoinOccasionPicker.tsx` — the "this is the same game as…" control.
- `app/(app)/youth/events/[id]/AddYouthToOccasion.tsx` — the "another young person was at this"
  control.
- `tests/rls/activity-occasions.test.ts`
- `tests/lib/youthOccasions.test.ts`
- `tests/routes/youthOccasions.test.ts`
- `testing/scenarios/youth/scenario-059-two-young-people-one-game/scenario.md`
- `testing/scenarios/youth/scenario-059-two-young-people-one-game/seed.ts`
- `plans/retros/youth-g-occasions-and-event-detail.md` — written by `/execute`, not now.

### Modify

- `types/database.ts` — regenerate with `npm run db:types`. Never hand-edit.
- `lib/youth/queries.ts` — `ActivityEvent.occasionId`, `ACTIVITY_EVENT_COLUMNS`,
  `mapActivityEventRow`, `createActivityEvent` (writes `occasion_id`), `ListActivityEventsOptions`
  and `listActivityEvents` (an `occasionId` filter).
- `lib/youth/coverage.ts` — add `worstCoverage()`, client-importable, beside `summariseCoverage()`.
- `lib/validation/youth.ts` — `occasionWithEventId` on `createActivityEventSchema`, `occasionId` on
  `listActivityEventsQuerySchema` (the asymmetry is deliberate — Task 9), and a new
  `joinOccasionSchema`.
- `app/api/youth/events/route.ts` — resolve `occasionWithEventId` into an occasion (creating one and
  stamping the source row when there is none) before the insert; record it in the audit detail.
- `app/(app)/youth/youthQueries.ts` — `YOUTH_OCCASION_QUERY_KEY`, `fetchOccasionEvents()`,
  `OCCASION_MUTATION_INVALIDATES`.
- `app/(app)/youth/calendar/ActivityCalendar.tsx` — the title becomes a link to the detail page;
  the "+N others at this game" line; the sibling count computed from the **unfiltered** rows.
- `app/(app)/youth/EventList.tsx` — the same two additions.
- `testing/infrastructure/seedUtils.ts` — `createActivityOccasion()`, and `occasionId` on
  `createActivityEvent()`.
- `CLAUDE.md` — a §9 decision entry.
- `SPEC.md` — the new table, the new column, the two new routes, the new page.
- `plans/INDEX.md` — the `youth-g` slice row, and ITER-027 recorded as unblocked.
- `.iterate/scopes/ITER-024.md` — the `**Plan:**` line.
- `.iterate/BACKLOG.md` — the plan link, and ITER-027 no longer blocked.

### Read first, change nothing

- `supabase/migrations/054_youth_activity_scope.sql` — the composite-foreign-key column list, and
  why `activity_events` has no `org_id`.
- `supabase/migrations/047_visit_appointment_set_null_column.sql` — the bug the column list fixes.
- `lib/youth/activityOwnership.ts` — three mirrors of three policies, and why they are allowed to
  disagree. **No fourth mirror is added by this slice** (see Pitfall 4).
- `lib/youth/profileNeed.ts` — the "carry the whole row, not two fields of it" lesson.

---

## Dependencies

**No new libraries.** Nothing here needs one.

Existing pieces this slice reuses rather than rebuilds:

| Piece | Used for |
|---|---|
| `components/youth/AttendeeControls.tsx` | "I'll go" per young person on the detail page — **rendered, never forked** |
| `components/youth/CoverageBadge.tsx` | the per-row badge and the occasion badge |
| `coverageRank()` / `COVERAGE_STATES` (`types/domain.ts`) | worst-of across the occasion |
| `eventCoverage()` (`lib/youth/coverage.ts`) | unchanged; called once per row |
| `writeAuditLog()`, `assertCan()`, `respondToRouteError()`, `readJsonBody()` | every route |
| `tests/helpers/routeClient.ts` | the route suite |

**No new notification trigger key.** Nothing here notifies anybody, so
`supabase/seed/notification_triggers.sql`, `SPEC.md`'s key list and
`tests/db/notification-triggers-seed.test.ts` are all untouched — and ITER-023 means that is now an
assertion rather than an assumption. Say so in the retro rather than leaving it silent.

---

## Known Pitfalls (from retro context)

Each of these is a failure this repository has already recorded. They are ordered by how likely
they are to happen again here.

**1. `on delete set null` on a composite foreign key must carry its column list.**
`visits-d` shipped a bare `set null` on a composite key in migration 046; it nulls **every**
referencing column including `ward_id`, which is `not null`, so the cascade raised and the parent
row became undeletable. Migration 047 fixed it, and 054a restates the rule. Migration 059 writes
`on delete set null (occasion_id)`, and a test proves an occasion can be deleted with events
pointing at it.

**2. A stored value the clock decides goes stale, and nothing here refreshes anything.**
`youth-a` / `youth-c` removed `covered`, `uncovered` and `completed` from `activity_events.status`
for this reason. The occasion's coverage is therefore **computed on read** from its rows, exactly
as `eventCoverage()` and `profileNeed()` are. **No `coverage` column, and no count column on
`activity_occasions`.**

**3. Carry the whole row, not two fields of it.** `youth-e`'s walk found every covered card reading
`Covered · 0` above an event card reading `Covered · 1`, because `ProfileNeed` carried the state and
the date but not the **count** of the event it described — and the existing check pinned the state,
so the wrong number passed it. `worstCoverage()` therefore returns a whole `EventCoverage`, never a
`CoverageState`, and the occasion badge renders that one value.

**4. A control the policy refuses is still a bug — and its mirror is a control hidden that the API
allows.** `visits-d`, then `youth-a`-D1, then ITER-021: three sightings. But
`lib/youth/activityOwnership.ts` ends by saying, deliberately, that **there is no
`canManageActivityEvent()`** — `activity_events` keeps migration 019's ward-wide write policies, so
the database permits any holder of `youth_activities.manage` to edit any event, and a helper here
would either restate `true` or invent a rule the policy does not enforce. `activity_occasions` gets
the **same ward-wide policies for the same reason**, so the linking controls gate on
`youth_activities.manage` **and nothing else**. **Do not add a fourth mirror to
`activityOwnership.ts`.** If occasions should ever be narrowed, the migration comes first.

**5. A count beside a list must answer the list's question.** `roster-b`, restated by `visits-b`
and `visits-f`. `ActivityCalendar` filters client-side by young person, organization, activity type
and home/away. The **"+N others at this game" count must be computed from the unfiltered rows** —
filter to Ethan and the honest answer is still "+2 others", not "+0". Compute the occasion grouping
before the filter is applied, and write a comment saying why.

**6. A Server Component prop never refetches.** `youth-a`-D2, and the whole reason
`app/(app)/youth/youthQueries.ts` exists. The detail page must **seed** the shared cache, not hand
down a finished list — otherwise joining an occasion succeeds, invalidates keys the page does not
read, and changes nothing on screen. `ActivityCalendar`'s own header records this as "the single
most likely bug in this area".

**7. Every view is its own cache entry.** `visits-c` found a bookmark made under one filter
invisible under another until a reload. The occasion fetch is keyed on the occasion id, and
`OCCASION_MUTATION_INVALIDATES` names **all three** keys it moves, following the file's own
established habit of writing the answer down before the bug rather than after it.

**8. A constant imported from a `"use client"` module reaches a Server Component as a function,
not a string.** `visits-d`'s "Log this visit" flow was completely dead from this. Anything
`page.tsx` imports must come from a module with no `"use client"` directive —
`app/(app)/youth/youthQueries.ts` is the pattern, and it says so in its own header.

**9. `npm run build` catches what lint, typecheck and the suite do not.** `youth-c` shipped a
constant in a server-only module that pulled `next/headers` into the browser bundle; 2982 tests
were green. `lib/youth/coverage.ts` carries a standing "client-importable — keep it that way"
instruction, and `worstCoverage()` goes in that file. **Run the production build.**

**10. A filter parameter the route's schema does not carry is silently ignored.** `roster-b`.
Adding `occasionId` to `ListActivityEventsOptions` without adding it to
`listActivityEventsQuerySchema` produces a page that looks filtered and is not.

**11. `params` is a `Promise` in Next 16**, and `PageProps` only exists after a build
(`foundation-a`). Type it explicitly, as `app/(app)/roster/household/[id]/page.tsx` does.

**12. Check the permission matrix before asserting a 403.** CLAUDE.md §8: `music_coordinator` holds
`talks.view` and `org_president` does not, and the intuitive answer is often wrong.
`lib/auth/permissions.ts` is the source of truth for who holds `youth_activities.manage`.

**13. An RLS-denied UPDATE or DELETE is a zero-row success, not an error.** Only INSERT raises.
Assert a refused write by **re-reading the row with the service client**.

---

## Tasks

### Task 1: Migration 059 — the occasion link

**File:** `supabase/migrations/059_activity_occasions.sql` (create)

**Action:** Add `activity_occasions`, its policies, `activity_events.occasion_id`, its composite
foreign key, and one index.

**Details:**

Write the header in the house style of 054–058: what it does, whether it applies immediately, and
why. **This migration is purely additive** — a new table, a nullable column, one index, and no
`set not null`, no `CHECK` narrowing and no tightening of anything that exists. So **nothing here
can fail on a row that exists**, no row count is load-bearing, and there is **no entry in
`HELD_BACK_UNTIL_DEPLOYED`**. Say that plainly rather than performing a count check the file does
not need; 054–058 counted rows because each of them tightened something, and this one does not.

```sql
-- 059a. The occasion: an identity, and nothing else.
create table activity_occasions (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, ward_id)
);
```

- **`unique (id, ward_id)` is the composite foreign key's target**, exactly as `organizations` and
  `youth_activity_profiles` carry one for the keys that reference them.
- **`created_by` mirrors `youth_activity_profiles.entered_by`** — read migration 009 and copy its
  declaration and its `on delete` behaviour verbatim. An occasion must survive the deletion of the
  user who created it, for the reason a profile does.
- **No title, no date, no location.** Identity only (ITER-024's first open question). A comment
  should say that those live on the rows and a second copy could disagree with the first.

```sql
-- 059b. The link.
alter table activity_events add column occasion_id uuid;

alter table activity_events
  add constraint activity_events_occasion_id_ward_id_fkey
    foreign key (occasion_id, ward_id) references activity_occasions (id, ward_id)
    on delete set null (occasion_id);
```

- **The column list on `set null` is not optional.** Write the same comment 054a writes, naming
  migrations 046 and 047: a bare `set null` on a composite key nulls `ward_id` too, which is
  `not null`, so the cascade raises and the parent becomes undeletable.
- **`set null` rather than `cascade`, deliberately.** Deleting an occasion must not delete the
  games. An event with no occasion is the ordinary state of every event in the ward.
- **Nullable, and null means "this game is only this young person's".** The same absent-means-
  default idiom as `household_stewardships`, `household_visit_cadences` and `054a`'s `org_id`.
  There is no sentinel occasion meaning "alone".

```sql
-- 059c. Policies: ward-wide, all four, matching activity_events.
```

Four policies on `activity_occasions`, following migration 019's generated shape:
`ward_id = current_ward_id()` on all four, `to authenticated`.

**Write the reasoning down, because a reader will assume this should be org-scoped:**

- `activity_events` keeps migration 019's ward-wide policies and has **no `org_id`** (054d says
  why). An occasion is the same kind of thing one layer up, and narrowing it would be a second
  scoping rule for an answer that already lives on the profile.
- **A cross-organization occasion is the point, not an edge case.** ITER-024 calls it "a pleasing
  consequence": an occasion holds a Young Men row and a Young Women row, and each leader writes
  about their own organization's young person. A write policy comparing `current_org_id()` would
  make exactly that unwritable.
- **The read must be uniformly evaluable.** This is migration 056c's load-bearing rule arriving
  again: if one reader could see occasion rows another could not, "who else is at this game" would
  have two different answers from the same data at the same instant.

```sql
-- 059d. Index.
create index activity_events_occasion_idx on activity_events (ward_id, occasion_id);
```

Leads with `ward_id`, following `018_indexes.sql`, `054e`, `055d`, `056d` and `057e`. Every read of
an occasion's rows is this index.

**Apply it:** `npm run db:push`, then `npm run db:types`.

---

### Task 2: The event type learns about the link

**File:** `lib/youth/queries.ts` (modify)

**Action:** Carry `occasion_id` through the type, the select list, the mapper, the insert and the
filter.

**Details:**

- `ActivityEvent` gains `occasionId: string | null`. Comment it: **null means this game is only
  this young person's**, and it is the ordinary state of nearly every row.
- Add `occasion_id` to `ACTIVITY_EVENT_COLUMNS`. **One string literal on one line** — a `+`
  concatenation widens the type to `string` and defeats supabase-js's literal parsing, degrading
  every row to something untyped (`calendar-a`). The file already carries that warning twice.
- Map it in `mapActivityEventRow`, and add it to `ActivityEventRow`.
- `createActivityEvent` takes the occasion **as a fourth parameter, already resolved**:
  `createActivityEvent(wardId, input, eventType, occasionId: string | null, client?)`. This is
  exactly the shape `eventType` already has there, and that parameter's own comment gives the
  reason: taking it here rather than reading it off `input` means **one place decides**, and a
  caller that forgot is a type error rather than a row silently written null. Keep
  `calendar_id: null` as it is — a hand-entered event belongs to no calendar, whatever occasion it
  joins.
- `ListActivityEventsOptions` gains `occasionId?: string`, and `listActivityEvents` applies
  `.eq("occasion_id", options.occasionId)` when present. Filtered **in the database**, following
  the note already in that function.

**This is CLAUDE.md rule 9 and the global serialization rule in one:** a route now writes a column
the frontend model must know about, in the same change, or it is silently dropped.

---

### Task 3: `worstCoverage()`

**File:** `lib/youth/coverage.ts` (modify)

**Action:** Add one pure function beside `summariseCoverage()`.

```ts
export function worstCoverage(
  coverages: readonly EventCoverage[],
): EventCoverage | null
```

**Details:**

- Reduces by `coverageRank()` — lower is worse — which is the same rule `ActivityCalendar` applies
  to a day cell and `profileNeed()` applies across a profile. Import `coverageRank` from
  `types/domain`; this file already imports from there and nowhere else.
- **Returns the WHOLE `EventCoverage`, never just its state.** Pitfall 3: `youth-e`'s walk found
  `Covered · 0` above `Covered · 1` because a value carried the state and the date but not the
  count. The badge, the count and the date the occasion renders all come off this one object.
- **Ties break on the soonest `daysUntil`**, matching how `profileNeed()` resolves "the soonest
  event holding the worst state". A `null` `daysUntil` (past or cancelled) never wins a tie against
  a real one.
- **Returns `null` for an empty list** — no signal, not "fine". `visits-f`'s comparator lesson, and
  the same shape `ProfileNeed.worstUpcoming` uses.
- Keep the file's standing header rule: it imports **types and nothing else**, so it stays
  client-importable. Do not reach for `lib/youth/queries.ts` here.

**Do not change `ActivityCalendar`'s day-cell reduction.** It reduces to a `CoverageState`, not to
an `EventCoverage`, so switching it is not a pure substitution — and adjacent refactoring is out of
scope (CLAUDE.md §7). Write a one-line comment on `worstCoverage()` naming the day cell as the same
rule expressed over a different return type, so the relationship is on the record.

---

### Task 4: Validation

**File:** `lib/validation/youth.ts` (modify)

**Details:**

- `createActivityEventSchema` gains
  `occasionWithEventId: z.uuid("That event is not valid.").optional()`.

  **It names the EVENT to share a game with, not an occasion id, and that is the whole point.**
  When a leader adds a missing young person to a game that is not yet an occasion, no occasion id
  exists for the client to send — so a client holding one would either have to make two calls that
  can half-succeed, or invent an id. Naming the other event instead keeps *which occasion* a server
  decision and removes an impossible client state. It is the same reasoning `joinOccasionSchema`
  below rests on: a body that could name its own occasion is a body that can put a row somewhere
  nobody looked at.

  Comment it beside the existing `eventType` note: **absent means this game is only this young
  person's**; present means the caller is adding a young person to a game that already exists.
- `updateActivityEventSchema` does **not** gain it. Follow the reasoning already in that file for
  `profileId` and `memberId`: joining and unjoining an occasion is its own action with its own
  route and its own audit row, and a partial patch that silently moved a row between occasions
  would be recorded as an ordinary edit.
- `listActivityEventsQuerySchema` gains `occasionId: z.uuid("That occasion is not valid.").optional()`.
  **Required**, per Pitfall 10 — a parameter this schema does not carry is silently ignored.
- New:

```ts
export const joinOccasionSchema = z.object({
  otherEventId: z.uuid("Choose which event is the same game."),
});
export type JoinOccasionInput = z.infer<typeof joinOccasionSchema>;
```

No `occasionId` in the body: the caller names the **other event**, and the route decides whether
that means creating an occasion or joining an existing one. A body that could name its own occasion
is a body that can put a row somewhere nobody looked at.

---

### Task 5: The occasion data layer

**File:** `lib/youth/occasions.ts` (create)

**Action:** Server-only data access. Follow `lib/youth/attendees.ts`'s shape and header style.

**Details:**

```ts
export type ActivityOccasion = {
  id: string;
  createdBy: string | null;
  createdAt: string;
};

export async function createOccasion(
  wardId: string, createdBy: string, client?: SupabaseClient<Database>,
): Promise<ActivityOccasion>;

export async function getOccasion(
  wardId: string, occasionId: string, client?: SupabaseClient<Database>,
): Promise<ActivityOccasion | null>;

export async function setEventOccasion(
  wardId: string, eventId: string, occasionId: string | null,
  client?: SupabaseClient<Database>,
): Promise<boolean>;

export async function deleteOccasionIfEmpty(
  wardId: string, occasionId: string, client?: SupabaseClient<Database>,
): Promise<boolean>;
```

- **Every function runs under the caller's own client**, so migration 059c's policies decide.
  Nothing here branches on a role (CLAUDE.md rule 2). State it in the header, as
  `lib/youth/attendees.ts` does.
- `setEventOccasion` returns `false` on zero rows — Pitfall 13: an RLS-denied UPDATE is a zero-row
  success, not an error.
- **`deleteOccasionIfEmpty` runs after an unlink**, and only when the occasion has **fewer than two
  rows left**. A one-row occasion is not wrong, but it is a link to nothing, and leaving them
  behind means a ward accumulates identities that describe no shared evening. Deleting it is safe
  because the composite key is `on delete set null (occasion_id)`, so the last row simply becomes
  unlinked. Write that reasoning in the function.
- **Reading an occasion's events is `listActivityEvents(wardId, { occasionId, includePast: true })`,
  not a function here.** One place resolves an event list; a second would be a second answer to
  the same question (`visits-f`).
- The header must carry `lib/youth/queries.ts`'s standing sentence: **this module never selects
  from `activity_private_notes` and never imports the module that will** (CLAUDE.md rule 5).

---

### Task 6: The join and unlink route

**File:** `app/api/youth/events/[id]/occasion/route.ts` (create)

**Action:** `POST` joins this event to another; `DELETE` takes it out of its occasion. Follow
`app/api/youth/events/[id]/attend/route.ts` for structure, constants and error phrasing.

**Details — `POST`:**

1. `requireSessionUser()`, `resolveRoleAccess()`, `assertCan(user, "youth_activities.manage", roleAccess)`.
   **`.manage`, not `.view`** — linking two young people's games is a coordination decision, and
   the attend route's `.view` gate is for putting yourself down, which is a different act.
2. Parse the route id with `z.uuid(...)`; parse the body with `joinOccasionSchema`.
3. Resolve **both** events with `getActivityEvent` through the caller's own client. Either missing
   → `404` *"That event is not in your ward."* Resolving before the write is the pattern
   `POST /api/youth/events` already follows, and its comment says why: the composite foreign key
   would otherwise answer with a constraint violation nobody can act on.
4. **Refuse the four cases that are not a join**, each with a sentence a person can act on:

   | Case | Status | Sentence |
   |---|---|---|
   | `eventId === otherEventId` | 400 | "An event cannot be the same game as itself." |
   | both already in the **same** occasion | 409 | "Those two are already recorded as the same game." |
   | both in **different** non-null occasions | 409 | "Both of those are already part of a game with other young people. Take one out of its game first, then join it to this one." |
   | the two events are on different **days** | *allowed*, see below | — |

   **Merging two occasions is refused deliberately.** Silently absorbing one into the other would
   move rows nobody named, and the audit row would record it as an ordinary join. The sentence
   names the alternative rather than just refusing — the `visits-f` empty-bulk-replace precedent,
   where a refusal that names the alternative is what makes it a decision rather than a wall.

   **A date mismatch is NOT refused.** An all-day tournament entry and a 7:30pm game genuinely can
   be the same occasion, and `youth-c`'s rule applies: a near-miss a clever matcher would catch is
   exactly the case where a person should be asked — and here a person *has* been asked, and
   answered. The picker in Task 9 narrows what is *offered*; the route does not second-guess it.

5. Otherwise:
   - neither has an occasion → `createOccasion()`, then `setEventOccasion()` on both;
   - exactly one has one → `setEventOccasion()` on the other, into it.
6. `writeAuditLog()` with `action: "youth_activity_occasion_joined"`, `module: "youth_activities"`,
   detail `{ occasionId, eventId, otherEventId, created: boolean }`. **`created` matters**: it is
   the difference between "started a game" and "added to one", and an audit row that cannot answer
   it leaves a reader guessing at exactly the moment they care.
7. Respond `{ occasionId, events }` where `events` is the occasion's rows, so the client has the
   new state without a second round trip.

**Details — `DELETE`:**

1. Same gate, same id parsing.
2. `404` if the event is not in the ward. If `occasionId` is already null, `409` *"That event is
   not part of a game with anybody else."*
3. `setEventOccasion(wardId, eventId, null)`, then `deleteOccasionIfEmpty()`.
4. `writeAuditLog()` with `action: "youth_activity_occasion_left"`, detail
   `{ occasionId, eventId, occasionRemoved: boolean }`.
5. Respond `{ occasionId: null }`.

**Both handlers wrap in `respondToRouteError`** with a `route:` string and a `detail` carrying
`wardId` and `userId`, exactly as every other youth route does.

---

### Task 7: `POST /api/youth/events` accepts an occasion

**File:** `app/api/youth/events/route.ts` (modify)

**Details:**

- After the profile is resolved and before the insert, when `input.occasionWithEventId` is present:
  1. Resolve that event with `getActivityEvent()` through the caller's own client. Missing → `404`
     *"That event is not in your ward."* Resolving before the write is what the profile check
     directly above already does, and its comment says why: the composite foreign key would
     otherwise answer with a constraint violation nobody can act on.
  2. If that event already has an `occasionId`, use it.
  3. If it does not, `createOccasion()` **and stamp the source event with it** via
     `setEventOccasion()` — so the two rows come out of one request either both linked or neither,
     rather than leaving a leader with a new event that shares nothing.
  4. Hand the resolved id to `createActivityEvent` as its fourth parameter.
- **This whole branch requires `youth_activities.manage`, which the route already asserts.** Adding
  a young person to somebody else's game is the same coordination decision the join route gates,
  and the two must not disagree.
- **Do not copy `eventType` from the source row, and do not add a branch that could.** The route's
  existing rule stands unchanged: absent means classify from the location, present means a person
  decided. A row added to an occasion whose location does not match the ward's venue list becomes
  `tbd` — **`away` is always a human's word** (`youth-c`), and spreading one leader's hand
  correction onto a row they never looked at is exactly what that rule refuses. `tbd` is loud: it
  renders *"Home or away?"* and asks a person.
- Add `occasionId: event.occasionId` to the audit detail.

---

### Task 8: The event-detail page

**File:** `app/(app)/youth/events/[id]/page.tsx` (create)

**Action:** A Server Component that seeds the cache for `EventDetail`.

**Details:**

- Type `params` explicitly as `Promise<{ id: string }>` (Pitfall 11); do not use the generated
  `PageProps` helper.
- `requireSessionUser()`, `createServerSupabaseClient()`, `resolveRoleAccess()`.
- `can(user, "youth_activities.view", roleAccess)` → `NotPermitted` when false. **`can()`, not
  `assertCan()`** — a `ForbiddenError` escaping a Server Component becomes a 500 whose message Next
  strips in production (`auth-b`). Every youth page carries this comment; copy it.
- `getActivityEvent(...)`; `notFound()` when null, following
  `app/(app)/roster/household/[id]/page.tsx`.
- **One clock**, `const asOf = new Date()`, resolved once and handed down as an ISO string. The
  rule every youth page and every youth lib file carries.
- Fetch, in parallel where they do not depend on each other:
  - the occasion's rows — `listActivityEvents(wardId, { occasionId, includePast: true, asOf })`
    when `event.occasionId` is non-null, otherwise just `[event]`;
  - `listActivityProfiles(wardId)` — for the names on each row **and** for the "add a young person"
    picker;
  - `listAttendeesForEvents(wardId, ids)` for every row at once — one query for the screen, not one
    per card;
  - **the same-day candidate list** for the join picker: `listActivityEvents(wardId, { from, to,
    includePast: true, asOf })` bounded to the event's own day in the **ward's** zone
    (`lib/ward/wardTimezone.ts`). See Task 9 for why the ward's zone and not the reader's.
  - `assignableUsers` — bishopric only, mapped down to `{ id, label }` on the server so the email
    and role `listWardUsers` returns never cross into a client component. Copy the block from
    `app/(app)/youth/calendar/page.tsx` rather than re-deriving it.
- Compute `canManage = can(user, "youth_activities.manage", roleAccess)` and
  `isBishopric` the way the other youth pages do.
- **This page does not import `lib/youth/privateNotes.ts`, and must not.** Every youth page carries
  that sentence; this one needs it too (CLAUDE.md rule 5).
- Render a heading, a "Back to the ward activity calendar" link, and `<EventDetail … />`.

---

### Task 9: The event-detail client component

**File:** `app/(app)/youth/events/[id]/EventDetail.tsx` (create)

**Action:** Render the occasion — one card per young person — and the controls that build it.

**Details:**

- `"use client"`. Reads the shared cache via `useQuery`, seeded by the page's props
  (`initialData`), so a mutation moves the screen. **Pitfall 6 is the single most likely bug in
  this slice**: a Server Component prop never refetches, and joining an occasion would otherwise
  succeed and change nothing.
- Compose rows in a `useMemo`, exactly as `ActivityCalendar` and `EventList` do: an `ActivityEvent`
  joined to its profile and its attendees.
- **The occasion badge, above the rows.** `worstCoverage(rows.map(r => eventCoverage(r.event, asOf)))`
  rendered with `CoverageBadge`. Beside it, a sentence naming what it means when the worst state is
  `uncovered` — something like *"One of these young people has nobody going."* This is ITER-020
  item 4's rule, and ITER-024's table entry, both satisfied by `coverageRank()` reused.
- **One card per young person**, each with:
  - the young person's name as a link to `/youth?youth=<profileId>` — the existing deep link,
    unchanged, which `/youth` already resolves to the owning member;
  - their activity name, their own `CoverageBadge`, the `Cancelled` chip and the *"From a schedule
    feed"* chip on the same conditions `EventList` uses;
  - `<AttendeeControls>` — **rendered, never forked**. `visits-c` proved the report feed could be
    reused by supplying a mapper rather than a second component, and the same discipline applies.
  - a `Not the same game` control when the occasion has more than one row and `canManage` — calls
    `DELETE /api/youth/events/[id]/occasion`.
- **The two build controls, shown only when `canManage`:**
  - `<JoinOccasionPicker>` — *"This is the same game as…"*
  - `<AddYouthToOccasion>` — *"Another young person was at this"*
- Every mutation invalidates `OCCASION_MUTATION_INVALIDATES`.
- Errors surface through `FormError`, with the route's sentence when there is one. **Never swallow
  one** (CLAUDE.md rule 7).
- Works at 375px and in both themes. Use the existing tone tokens
  (`COVERAGE_EDGE_CLASSES`, `Card`) rather than new colours — and remember `youth-d`'s finding that
  `--surface` inverts meaning between themes, so check any new panel in **both**.

**File:** `app/(app)/youth/events/[id]/JoinOccasionPicker.tsx` (create)

- A `select` (or the repo's existing picker primitive — check `components/ui/`) over the
  **same-day candidates** the page fetched, excluding this event and every row already in this
  occasion.
- Each option reads `<time> · <young person> · <activity>` so the person choosing has the three
  facts that distinguish two games. **Never the title alone** — two rows reading *"Game vs
  Roosevelt"* and *"Game against Roosevelt"* are the case this whole design exists for.
- **The day is bounded in the WARD's zone, not the reader's**, and this is the one place in this
  module where that is right. `ActivityCalendar`'s header is emphatic that a card is bucketed into
  a day in the *reader's* zone so the day matches the time printed on it — that is about
  **rendering**. This is a **query bound**: it must be the same set of candidates for every reader,
  or two leaders looking at the same game would be offered different options. Use
  `lib/ward/wardTimezone.ts`. Write the distinction down; it is exactly the kind of thing a later
  reader "corrects".
- Empty candidate list → render a sentence, not an empty control: *"No other youth activity is
  scheduled that day."* — and say what to do instead (add a young person below).

**File:** `app/(app)/youth/events/[id]/AddYouthToOccasion.tsx` (create)

- A picker over `ActivityProfile[]`, excluding every profile already on this occasion.
- Options read `<young person> · <activity>`, because a young person may have two activities and
  the row being created belongs to one of them (`youth-f`'s whole reason for existing).
- On submit, **one** `POST /api/youth/events` carrying the source row's `title`, `eventDate` and
  `location`, plus `occasionWithEventId: <the event being viewed>`, and **no `eventType`** (Task 7).
- **One request, whether or not the occasion exists yet.** The client never holds an occasion id and
  never makes two calls that could half-succeed; the route resolves or creates the occasion and
  stamps both rows (Task 7). The component's only job is to prefill the three copied fields and name
  the event it is joining.
- Note the asymmetry, because it is deliberate: **`createActivityEventSchema` takes
  `occasionWithEventId`** (a write, where the occasion may not exist yet) while
  **`listActivityEventsQuerySchema` takes `occasionId`** (a read, where it certainly does).

---

### Task 10: Cross-navigation and the "+N others" marker

**Files:** `app/(app)/youth/calendar/ActivityCalendar.tsx`, `app/(app)/youth/EventList.tsx` (modify)

**Details:**

On both card renderers:

1. The event **title becomes a `Link`** to `/youth/events/[id]`. This closes ITER-020's table row
   *"any card → the event → event detail"*.
2. Below the young person's line, when the event has an occasion with other rows in it:

   ```
   +2 others at this game  →
   ```

   linking to the same page. Singular/plural handled — `youth-b`'s walk found *"1 events updated"*
   shipped past a green suite, and a plural bug is invisible to every test that does not read the
   sentence.
3. **Render nothing when the count is zero.** `talks-c`'s render-nothing-rather-than-"Never" rule:
   *"+0 others"* is noise on the ordinary card, which is nearly every card.

**The count, and this is Pitfall 5 in the concrete:**

- Build a `Map<occasionId, count>` from the **unfiltered** event list — before
  `ActivityCalendar` applies its four client-side filters, and before `EventList` narrows to one
  profile.
- Write a comment saying why: filter the calendar to Ethan and Josh's row disappears, but the
  honest answer to *"who else is at this game"* is still two. A count computed after the filter
  answers a different question from the one the words claim.
- **No extra request.** Siblings share an instant, and both pages' filters are date-bounded, so
  every sibling of a fetched event is in the same fetch. Say that in the comment so nobody adds an
  N+1 later.

---

### Task 11: Shared cache keys and fetchers

**File:** `app/(app)/youth/youthQueries.ts` (modify)

**Details:**

- `export const YOUTH_OCCASION_QUERY_KEY = "youth-activity-occasion";`
- `fetchOccasionEvents(occasionId: string): Promise<ActivityEvent[]>` — hits
  `/api/youth/events?occasionId=<id>&includePast=true`. **`includePast=true` always**: an occasion
  you are reading may already have happened, and the page must not empty out the moment the game
  ends.
- The query key is `[YOUTH_OCCASION_QUERY_KEY, occasionId]` — the occasion id is **part of the
  key**, for the reason `includePast` is part of the events key (`visits-c`).
- ```ts
  export const OCCASION_MUTATION_INVALIDATES = [
    [YOUTH_OCCASION_QUERY_KEY],
    [YOUTH_EVENTS_QUERY_KEY],
    [YOUTH_ATTENDEES_QUERY_KEY],
  ] as const;
  ```
  All three, and write the reason above it in the file's established voice: the occasion list
  obviously; the **events**, because the "+N others" marker on `/youth` and `/youth/calendar` is
  derived from `occasionId` on the event rows; the **attendees**, because adding a young person
  creates a row whose attendee list the detail page renders immediately. This module has been
  bitten three times by somebody reasonably assuming the answer was one key — write it down before
  the bug, as `FOLLOW_UP_MUTATION_INVALIDATES` already does.
- **No `"use client"` directive in this file**, and `page.tsx` imports components from this
  directory and never a constant (Pitfall 8). The file's header already states both rules.

---

### Task 12: Seed utilities

**File:** `testing/infrastructure/seedUtils.ts` (modify)

**Details:**

- `createActivityOccasion(options: { id?: string; createdBy?: string })` → inserts an
  `activity_occasions` row, keyed with `testUuid("occasion:…")` like every other helper.
- `createActivityEvent` gains `occasionId?: string`, written straight through.
- Follow the file's existing habit of a comment naming the migration a helper's shape comes from.

---

## Testing Strategy

Written in CLAUDE.md §8's priority order.

### 1. RLS — `tests/rls/activity-occasions.test.ts` (create)

Model it on `tests/rls/youth-activity-scope.test.ts`. Seed with the service client, assert with
authenticated anon clients, `fixtures.cleanup()` in `afterAll`, and clean up after itself — these
run over the network against the shared hosted project.

- A user in ward A **cannot read** ward B's occasion.
- A user in ward A **cannot insert** an occasion carrying ward B's `ward_id`.
- A user in ward A **cannot update or delete** ward B's occasion — assert by **re-reading the row
  with the service client** (Pitfall 13), not by expecting an error.
- **An event cannot be linked to another ward's occasion** — the composite foreign key refuses it.
  This is an INSERT/UPDATE that genuinely raises.
- **The cross-organization case is allowed, and this is the assertion that proves the decision:**
  a Young Men president may link a Young Women youth's event into the same occasion. If this test
  fails, the policy has been narrowed and the feature is gone.
- **Deleting an occasion leaves its events standing, with `occasion_id` null** — this is the
  migration 046/047 regression, and it is why the column list on `set null` exists.

### 2. Pure logic — `tests/lib/youthOccasions.test.ts` (create)

- `worstCoverage([])` → `null`. Assert it explicitly: no signal is not "fine".
- Worst-of ordering across every pair of `COVERAGE_STATES`, driven off the array rather than
  hardcoded, so a state added later fails here rather than silently ranking last.
- **The whole object is carried**: given a `covered` row with 3 attendees and an `uncovered` row
  with 0, the result is the `uncovered` one *with its own `attendeeCount` and `daysUntil`*. This is
  the `youth-e` regression written as a test — the version that only pins the state passes while
  the badge reads the wrong number.
- Tie-break: two `uncovered` rows, the nearer `daysUntil` wins; a `null` `daysUntil` never beats a
  real one.

### 3. Routes — `tests/routes/youthOccasions.test.ts` (create)

Use `tests/helpers/routeClient.ts`. Read its header first — it documents the `vi.mock` hoisting
trap. Only the client factory is mocked; every query still runs against the hosted project as a
genuinely authenticated user, so a passing test proves the policy allowed it.

- `POST` with neither event in an occasion → 201/200, an occasion created, both rows stamped.
- `POST` with one event already in an occasion → the other joins it, **no new occasion created**
  (assert the occasion count).
- `POST` with the same event twice → 400.
- `POST` with both in the **same** occasion → 409.
- `POST` with both in **different** occasions → 409, and **assert neither row moved** by re-reading
  both with the service client.
- `POST` naming an event in another ward → 404.
- `DELETE` unlinks, and **removes the occasion when fewer than two rows remain**; assert the
  surviving row still exists with `occasion_id` null.
- `DELETE` on an event with no occasion → 409.
- **An audit row is written for both**, with `created` / `occasionRemoved` present.
- **A 403 for a role holding `youth_activities.view` but not `.manage`.** Check
  `lib/auth/permissions.ts` for who that actually is before writing the assertion (Pitfall 12) —
  do not guess.

### 4. Routes — `tests/routes/youthEvents.test.ts` (extend)

- `POST /api/youth/events` with `occasionWithEventId` naming an event that has no occasion →
  **creates one and stamps both rows**.
- …naming an event that has one → the new row joins it.
- …naming an event in another ward → 404, and **no event row created** (re-read with the service
  client).
- The new row's `eventType` is **classified from its own location**, not copied from the source
  row. Seed a source row hand-corrected to `away` with a location that matches no venue, and assert
  the new row is `tbd`. This pins `youth-c`'s "`away` is always a human's word" against exactly the
  shortcut a later reader would take.

### 5. Components — `tests/components/youth/` (extend or create)

- The "+N others" marker renders from the **unfiltered** list: render with a filter active that
  hides a sibling and assert the count is still right. This is the only place Pitfall 5 can be
  caught by a test rather than by a walk.
- The marker renders **nothing** at zero.
- Singular vs plural: "+1 other at this game" / "+2 others at this game".

### Not tested, deliberately

- Whether two rows *are* the same real game. That is a person's judgement and the whole reason the
  link is explicit (ITER-024's stated trap).

---

## Test Scenarios (Harness)

### Scenario 059: Two young people, one game

**Directory:** `testing/scenarios/youth/scenario-059-two-young-people-one-game/`
**Tags:** `[youth, full, occasions, event-detail, cross-org]`
**Part:** 9

**Purpose:** Prove that one real game held as two rows can be joined by a person, that the detail
view answers *"who else is in that gym"*, and that an occasion where **one** young person has nobody
committed reads as an alert while the others read as covered. Seeding matters because the honest
starting state is *two rows a school feed produced weeks apart, in two different organizations* —
twenty minutes of clicking to build by hand, and wrong the moment the clock moves.

**Seed data summary:**

- **Ward** — Harness Test Ward, `cross_org_visibility: false`, `home_venues: ["Lincoln High School"]`
- **Users** — `bishop@…`, `ym-president@…` (**sign in as this one**), `yw-president@…`
- **Households / members** — 3 youth: Ethan Brooks, Josh Kim (Young Men), Ava Reyes (Young Women)
- **Activity profiles** — 3: Ethan · Varsity basketball (YM), Josh · Varsity basketball (YM),
  Ava · Varsity basketball (**YW** — the cross-organization case, and the one to add by hand)
- **Activity calendars** — 2, one per Young Men profile, `source_type: "ics_upload"`, so both rows
  carry a `source_uid` and render the *"From a schedule feed"* chip
- **Events** — 6:
  - **Game against Roosevelt**, +3 days, 7:00pm, at Lincoln High School — **two rows**, Ethan's and
    Josh's, **no occasion**, imported. Ethan's has **nobody** down; Josh's has `ym-president` down.
  - Two unrelated games the same day (a track meet, a choir rehearsal) so the join picker has
    plausible wrong answers in it and the tester has to read the young person's name.
  - One game **the following week**, so the picker's same-day bound is visible as a bound.
  - One **past** game already in a two-row occasion, so the detail view is proved to work on a game
    that has happened.
- **Attendees** — 2 rows

**Sign in with:** `ym-president@harness.wardleadershiptools.test`.
**Why the Young Men president:** they own both Roosevelt rows, and adding **Ava** — a Young Women
youth — is the cross-organization case falling out of the design rather than being engineered.

**Tester action:**

1. `npm run seed -- youth/scenario-059-two-young-people-one-game`, `npm run dev`
2. Open `/youth/calendar`. Read the two Roosevelt cards — **two cards, one game**, and neither says
   anything about the other. This is the state the slice exists to fix.
3. Click the title of **Ethan's** Roosevelt card. Read the detail page before touching anything.
4. Press **This is the same game as…**. Read every option: it should offer the same-day events and
   **not** next week's, and each option should name the young person, not just the title.
5. Choose **Josh Kim · Varsity basketball**. Save.
6. Read the occasion badge. Josh has somebody going and Ethan does not, so the occasion must read
   as an **alert**, not as covered.
7. Press **I'll go** on **Ethan's** row and watch the occasion badge — **without reloading**.
8. Press **Another young person was at this** and add **Ava Reyes · Varsity basketball**.
9. Read Ava's new row: its home/away chip, and who is down for it.
10. Go back to `/youth/calendar`. Read the Roosevelt cards again.
11. Filter the calendar to **Ethan** only, and read the marker on his card again.
12. Open the **past** occasion's detail page from `/youth` (expand a card, show past events).
13. On one row, press **Not the same game**. Then re-join it.
14. Read `/youth/events/[id]` at 375px, in both light and dark.

**Verification checklist:**

- [ ] Before step 5, `/youth/calendar` shows **two separate Roosevelt cards** with no marker on
      either.
- [ ] The join picker offers only events on **the same day**, and names the young person and the
      activity on every option — not the title alone.
- [ ] The picker does **not** offer the event you are already on.
- [ ] After joining, the detail page lists **both** Ethan and Josh, each with their own badge and
      their own **I'll go**.
- [ ] With Josh covered and Ethan not, the **occasion badge reads the alert**, and a sentence
      beside it says one of these young people has nobody going.
- [ ] Pressing **I'll go** on Ethan's row changes the occasion badge **without a reload**.
- [ ] Adding **Ava Reyes** creates a row on the same occasion, owned by **Young Women**, and the
      Young Men president was permitted to do it.
- [ ] Ava's new row is chipped **Home** (the location matches the ward's venue list) — and if the
      seed's location is altered to something unmatched, it reads **Home or away?** and never
      **Away**.
- [ ] Ava's row carries **no** *"From a schedule feed"* chip; the two imported rows still do.
- [ ] Back on `/youth/calendar`, all three cards read **"+2 others at this game"** and each links to
      the same page.
- [ ] **Filtered to Ethan only, his card still reads "+2 others at this game"** — not "+0". This is
      the one checklist line most likely to catch a real defect.
- [ ] A card with no occasion renders **no marker at all** — not "+0 others".
- [ ] The **past** occasion renders in full; its rows are not hidden because the game has happened.
- [ ] **Not the same game** removes one row and leaves the others intact; re-joining restores it.
- [ ] Unlinking down to a single row leaves that row with **no marker** and no dangling occasion.
- [ ] At 375px nothing overflows, and every control is at least 44px tall — `visits-e`'s walk found
      a 176×16 tap target on the one control that slice added.
- [ ] In **dark** mode the occasion panel reads as a panel, not as a hole — `youth-d` found exactly
      that, because `--surface` inverts meaning between themes.

---

## Validation Commands

Run in this order.

```bash
# Apply the migration and regenerate the types
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests
npm test

# Production build — REQUIRED, not optional
npm run build
```

**`npm run build` is not a formality here.** `youth-c` shipped a constant in a server-only module
that pulled `next/headers` into the browser bundle; lint, typecheck and 2982 tests were all green
and the build is what caught it. This slice adds a new client component and a new pure module that
must stay client-importable, which is the same shape exactly.

---

## Integration Notes

### How it connects

- **Migration 059 is purely additive.** Every existing row gets `occasion_id: null`, which means
  "this game is only this young person's" — the state every event is in today. **No ward's screen
  moves on the day this ships**, which is the same absent-means-default guarantee
  `household_stewardships` (052) and `household_visit_cadences` (050) were built with.
- **Nothing from slices A–F is reworked.** Each row keeps one profile, so ITER-021's follow-up gate
  keeps its single answer, `eventCoverage()` is unchanged, `activity_logs` keeps its shape and its
  guarantees, and the ICS import's match key is untouched. That was the whole argument for A′ over
  the full many-to-many, and the retro should say whether it held.

### Breaking changes

None. The only behaviour change on an existing screen is two additions to a card — a linked title
and a marker that renders nothing when there is no occasion.

### Migration steps

`npm run db:push` then `npm run db:types`, before the code. **No `HELD_BACK_UNTIL_DEPLOYED` entry** —
that allowlist is for the contract half of an expand-and-contract pair, and an entry that is not
needed hides a real migration from the assertion that everything on disk has been applied.

### Documentation to update, in the same change

1. **`CLAUDE.md` §9** — a new decision entry. It must record: the occasion is **identity only**; the
   link is **explicit and stored, never matched by title and date** (and why —
   `classifyLocation.ts`'s refusal of near-miss matching is the same rule); `activity_occasions`
   carries **ward-wide policies on all four verbs**, matching `activity_events`, because a
   cross-organization occasion is the point and because the read must be uniformly evaluable
   (056c); `/youth/calendar` **marks rather than collapses**, and the four filters are the reason;
   and the ICS import **does not create occasions**, handed forward.
2. **`SPEC.md`** — `activity_occasions`, `activity_events.occasion_id`, the two new routes, the new
   page. SPEC is a source of truth; if it disagrees with this, flag it and fix it here.
3. **`plans/INDEX.md`** — a `youth-g` row in the Phase 8 slice table, and **ITER-027 recorded as
   unblocked**, since this is the schema it was waiting on.
4. **`.iterate/scopes/ITER-024.md`** — `**Plan:** plans/youth-g-occasions-and-event-detail.md`.
5. **`.iterate/scopes/ITER-027.md`** and **`.iterate/BACKLOG.md`** — ITER-027 is no longer blocked.
   **Do not build it here.** Its two halves — telling a leader who else will be there, and offering
   to record a contact afterwards — are their own scope, and its own notes are emphatic that the
   "after" half must offer and never write on its own, and must read as a prompt rather than a
   checklist of people you failed to greet.
6. **`.iterate/scopes/ITER-025.md`** — its Sequencing section says to settle ITER-024 first, because
   a leader wanting to comment on a young person may find that youth is a row their own
   organization owns. That is now true and testable. Record it; do not decide the policy here.

### Deliberately not built

- **Merging two occasions.** Refused with a sentence naming the alternative (Task 6).
- **The ICS import creating occasions.** ITER-024's second open question, answerable later.
- **A name on an occasion.** ITER-024's first open question, answered as identity only.
- **Collapsing the calendar to one card per occasion.** Decided against 2026-08-29; the four filters
  are the reason and it is written into `CLAUDE.md` so it is not quietly reversed.
- **ITER-027 and ITER-025.** Unblocked by this slice, and each is its own scope.
