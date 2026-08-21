# Plan: Talks C — Prayers & the Topic Library

**Created:** 2026-08-20
**Type:** feature
**Phase:** 4 of 13 — part 3 of 4 ([plans/04-talks-pipeline.md](04-talks-pipeline.md))
**Structure:** Sequential — depends on `talks-a` and `talks-b`; `talks-d` follows

---

## Overview

Two smaller features that share nothing with each other except the Sunday they hang off: the
prayer pipeline and the topic library. Both are simple next to the talk pipeline, and both feed
Phase 6's program builder.

**Key requirements**

1. Prayers run a **four-stage pipeline of their own** — `assign → ask → confirm → done` — with no
   approval gate. Same member picker, same rotation awareness.
2. "Last prayed" shows beside each name in the picker so the bishopric can spread it around.
3. The topic library is CRUD plus `last_assigned_at`, which updates when an assignment referencing
   the topic reaches **`approve`** — not `plan`, not `complete`.
4. **AI-suggested topics are proposals, never auto-added.** Build the accept/reject queue *now*
   with a manual add path, so Phase 5 only has to supply candidates.

**Success criteria**

- Invocation and benediction assignable per Sunday, each moving through its own four stages
- The picker shows "Last prayed March 2025" beside a name, and nothing at all for someone with no
  history — never "Never", which reads as a judgement
- A topic reaching `approve` on any assignment stamps `last_assigned_at`; reverting does not
  un-stamp it
- The candidate queue accepts and rejects individually, and **nothing enters `topics` without an
  explicit accept**
- Prayer names and topic titles are readable by the program builder in Phase 6
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all pass

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `supabase/migrations/026_topic_candidates.sql` | create | The accept/reject queue table + RLS; prayer rotation index |
| `types/database.ts` | modify | Regenerate (`npm run db:types`) |
| `types/domain.ts` | modify | `TOPIC_CANDIDATE_STATUSES`, `TOPIC_CATEGORY_LABELS` |
| `lib/prayers/queries.ts` | create | Prayer reads and writes. **Server-only** |
| `lib/prayers/prayerPipeline.ts` | create | Pure — the four-stage machine. **Client-importable** |
| `lib/prayers/lastPrayed.ts` | create | Pure — last-prayed lookup shaping. **Client-importable** |
| `lib/topics/queries.ts` | create | Topic reads and writes. **Server-only** |
| `lib/topics/topicRotation.ts` | create | Pure — `last_assigned_at` staleness bucketing |
| `lib/validation/prayer.ts` | create | Zod schemas |
| `lib/validation/topic.ts` | create | Zod schemas |
| `app/api/prayers/route.ts` | create | `GET` by Sunday or month, `POST` create |
| `app/api/prayers/[id]/route.ts` | create | `PATCH` — stage transition or member change |
| `app/api/topics/route.ts` | create | `GET` with filters + `last_assigned_at`, `POST` create |
| `app/api/topics/[id]/route.ts` | create | `PATCH` edit or archive |
| `app/api/topic-candidates/route.ts` | create | `GET` pending queue, `PATCH` accept or reject |
| `app/(app)/prayers/page.tsx` | create | Prayer tracker |
| `app/(app)/prayers/PrayerBoard.tsx` | create | `"use client"` — per-Sunday invocation/benediction |
| `app/(app)/topics/page.tsx` | create | Topic library |
| `app/(app)/topics/TopicList.tsx` | create | `"use client"` — filters, edit, archive |
| `app/(app)/topics/TopicForm.tsx` | create | Manual add — the path Phase 5 reuses |
| `app/(app)/topics/CandidateQueue.tsx` | create | Accept/reject, one at a time |
| `components/assignments/LastPrayedLabel.tsx` | create | The picker annotation |
| `lib/assignments/queries.ts` | modify | Stamp `last_assigned_at` on the `review → approve` transition |
| `tests/lib/prayerPipeline.test.ts` | create | Four stages, legal and illegal moves |
| `tests/lib/lastPrayed.test.ts` | create | Shaping, including the no-history case |
| `tests/lib/topicRotation.test.ts` | create | Staleness buckets and boundaries |
| `tests/db/topic-last-assigned.test.ts` | create | The stamp fires at `approve` and only there |
| `tests/rls/topic-candidates.test.ts` | create | Cross-ward isolation on the new table |
| `SPEC.md` | modify | Record the candidates table and its route |

---

## Dependencies

- **No new packages.**
- **Permissions already exist:** `topics.view`, `topics.manage`. Prayers ride on `talks.plan` and
  `talks.view` — **do not add a `prayers.*` permission**; a prayer is part of planning the meeting,
  and 04-talks-pipeline.md puts the whole phase behind bishopric access.
- **Schema already exists** for `topics` and `prayer_assignments` (migration 005), and migration
  019 already gives `prayer_assignments` a **ward-scoped** select policy — note that this is *not*
  the bishopric-only shape `assignments` has. Verify before assuming; if prayers should be
  bishopric-only, that is a policy change to raise, not to make silently.
- **`MemberPicker` interface is frozen.** Prayers use `multiple={false}` and the default
  `filter.statuses: ["active"]`.

---

## Known Pitfalls (from retro context)

- **[roster-b] `lib/<module>/queries.ts` is server-only.** `prayerPipeline.ts`, `lastPrayed.ts` and
  `topicRotation.ts` must import types only — `PrayerBoard` and `TopicList` are client components.
  Only `npm run build` catches a violation.
- **[calendar-a] Do not concatenate select column lists.** One `const` per table, reused.
- **[foundation-c] The `notification_settings` seed is per ward and runs at seed time only.** If
  this slice adds a trigger key, existing wards need a migration insert as well as the seed edit —
  the same two-part change `talks-a` Task 1 makes.
- **[foundation-c] A denied UPDATE returns zero rows, not an error.** Re-read with the service
  client in `tests/rls/topic-candidates.test.ts`.
- **[04-talks-pipeline.md] `last_assigned_at` at `approve`, not `complete`.** The whole point is to
  stop the bishopric *planning* a repeat, which happens long before the talk is given.

---

## Tasks

### Task 1: Migration — the topic candidate queue

**File:** `supabase/migrations/026_topic_candidates.sql` (create)

```sql
-- Talks C, migration 026: the AI-topic accept/reject queue.

-- Phase 5 writes candidates here; a bishopric member accepts each one before it becomes a row in
-- `topics`. This table exists so there is NOWHERE for a generated topic to land except a queue
-- (CLAUDE.md rule 3: no AI output reaches a human or a database row without explicit approval).
create table topic_candidates (
  id                   uuid primary key default gen_random_uuid(),
  ward_id              uuid not null references wards (id) on delete cascade,
  title                text not null,
  category             text check (category in ('doctrinal','scriptural','conference_talk','seasonal','custom')),
  description          text,
  suggested_scriptures jsonb,
  suggested_talks      jsonb,
  status               text not null default 'pending' check (status in ('pending','accepted','rejected')),
  accepted_topic_id    uuid,
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (accepted_topic_id, ward_id) references topics (id, ward_id) on delete set null,
  foreign key (reviewed_by, ward_id) references users (id, ward_id),
  constraint topic_candidates_review_pair check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

alter table topic_candidates enable row level security;

-- Bishopric-only, matching `assignments` rather than the ward-wide loop.
create policy topic_candidates_select on topic_candidates
  for select to authenticated using (ward_id = current_ward_id() and is_bishopric());
create policy topic_candidates_insert on topic_candidates
  for insert to authenticated with check (ward_id = current_ward_id() and is_bishopric());
create policy topic_candidates_update on topic_candidates
  for update to authenticated
  using (ward_id = current_ward_id() and is_bishopric())
  with check (ward_id = current_ward_id() and is_bishopric());
create policy topic_candidates_delete on topic_candidates
  for delete to authenticated using (ward_id = current_ward_id() and is_bishopric());

create index prayer_assignments_member_idx on prayer_assignments (ward_id, member_id, stage);
create index topics_ward_status_idx on topics (ward_id, status, last_assigned_at);
```

> `tests/rls/ward-isolation.test.ts` sweeps every table and skips exactly two (`wards`, `hymns`).
> A new table joins the sweep automatically — check it passes rather than adding a skip.

Then `npm run db:push` and `npm run db:types`.

### Task 2: The prayer pipeline

**File:** `lib/prayers/prayerPipeline.ts` (create)

```ts
export type PrayerTransitionResult = { ok: true } | { ok: false; message: string };

export function canTransitionPrayer(
  from: PrayerStage,
  to: PrayerStage,
  context: { memberId: string | null; askedAt: string | null; confirmedAt: string | null;
             actorIsBishopric: boolean; reason?: string },
): PrayerTransitionResult
export function nextPrayerStage(from: PrayerStage): PrayerStage | null
```

Gates: `assign → ask` needs a member; `ask → confirm` needs `askedAt`; `confirm → done` needs
`confirmedAt`. Backward moves follow the talk pipeline's rule — bishopric plus a reason. Same-stage
is rejected.

**Deliberately a separate module from `lib/assignments/pipeline.ts`.** The two machines share a
shape but not a domain, and merging them behind a generic would mean one set of gates answering two
different questions — the mistake `FAST_SUNDAY_DISPLACING_TYPES` is currently living out on the
calendar side (GROUP-01).

### Task 3: Last-prayed shaping

**Files:** `lib/prayers/lastPrayed.ts`, `components/assignments/LastPrayedLabel.tsx` (create)

```ts
export type LastPrayed = { memberId: string; lastPrayedAt: string | null };
export function lastPrayedLabel(lastPrayedAt: string | null): string | null
```

- Returns `"Last prayed March 2025"`, or **`null`** when there is no history.
- **Never render "Never".** Someone who has not been asked is not a category of person; render
  nothing and let the absence speak.
- Only prayers that reached `done` count — the same completed-only rule the talk rotation uses.
- Client-importable.

### Task 4: Prayer data layer and routes

**Files:** `lib/prayers/queries.ts`, `lib/validation/prayer.ts`,
`app/api/prayers/route.ts`, `app/api/prayers/[id]/route.ts` (create)

- `listPrayers(wardId, filter, client)` — by `sundayId` or date range, both types per Sunday
- `upsertPrayer(wardId, sundayId, prayerType, memberId, client)` — one invocation and one
  benediction per Sunday; a second write to the same slot replaces the member rather than inserting
- `transitionPrayer(...)` — sets `stage` and its timestamp (`asked_at` + `asked_by`, `confirmed_at`)
- `listLastPrayed(wardId, memberIds, client)` — one query for the whole picker, not one per member
- Routes mirror `app/api/sundays/[id]/org-conducting/route.ts`: `requireSessionUser()` outside the
  try, `assertCan` inside, `respondToRouteError` in the catch, `writeAuditLog` on every mutation
  (`prayer_assigned`, `prayer_stage_changed`).
- **Prayers survive `speaking_slots = 0`.** `lib/calendar/queries.ts` already documents this —
  a fast Sunday still has an invocation and a benediction. Do not gate prayer creation on the slot
  count; that guard belongs to speakers only.

### Task 5: Topic library

**Files:** `lib/topics/queries.ts`, `lib/topics/topicRotation.ts`, `lib/validation/topic.ts`,
`app/api/topics/route.ts`, `app/api/topics/[id]/route.ts` (create)

- `listTopics(wardId, filter, client)` — filters by category and status, ordered by
  `last_assigned_at` nulls first so unused topics surface
- `createTopic` sets `source: "manual"`; `updateTopic` edits or flips `status` to `archived`.
  **Archive, never delete** — a topic referenced by an assignment must not vanish from its history
- `suggested_scriptures` and `suggested_talks` are `jsonb`. **Validate their shape on write with
  Zod**, for the reason `calendar-a` gives about `slot_config`: nothing validates a jsonb blob on
  read, and Phase 6 reads these directly, so a malformed entry stored today breaks a program PDF
  months from now, far from the boundary that accepted it
- `topicRotation.ts` — pure staleness bucketing (`unused` / `fresh` / `recent`) for the picker

### Task 6: Stamp `last_assigned_at`

**File:** `lib/assignments/queries.ts` (modify)

In `transitionAssignment()`, when the target stage is `approve` and the assignment has a
`topic_id`, stamp that topic's `last_assigned_at` with `now()`.

- **Only at `approve`.** Not at `plan` — a plan that never gets approved should not burn the topic.
  Not at `complete` — the bishopric needs the signal while they are still choosing.
- **A revert does not un-stamp it.** The topic genuinely was chosen for a Sunday; the stamp records
  that consideration, and rolling it back would re-offer a topic they just discussed.
- A stamp failure logs and continues — it must not fail the transition. Same contract as
  `writeAuditLog`.

### Task 7: The candidate queue

**Files:** `app/api/topic-candidates/route.ts`, `app/(app)/topics/CandidateQueue.tsx` (create)

- `GET` returns pending candidates. `PATCH` accepts one (`status: "accepted"`, insert into `topics`
  with `source: "ai_generated"`, link `accepted_topic_id`) or rejects one (`status: "rejected"`).
- **Accept and reject are per-candidate.** No "accept all" — a bulk accept is an auto-add wearing a
  button, and CLAUDE.md rule 3 says every generated topic is a draft a human accepts individually.
- The queue is empty until Phase 5 writes to it. **Ship it empty**, with a line saying suggestions
  arrive when AI topics are switched on. An empty state that explains itself is the deliverable.
- Audit `topic_candidate_reviewed` with `{ candidateId, status }`.

### Task 8: Pages

**Files:** `app/(app)/prayers/page.tsx`, `PrayerBoard.tsx`, `app/(app)/topics/page.tsx`,
`TopicList.tsx`, `TopicForm.tsx` (create)

- Both Server Components resolve the session and use `can()` → `<NotPermitted>`, never `assertCan`
  (auth-b).
- `PrayerBoard` — a month of Sundays, each with invocation and benediction, member picker plus
  `LastPrayedLabel`, and the four-stage control per prayer.
- `TopicList` — filters, edit, archive, and the candidate queue beneath. `TopicForm` is the manual
  add path Phase 5 reuses for an accepted candidate.
- Both must work at 375px in both themes.

---

## Testing Strategy

| File | Asserts |
|---|---|
| `tests/lib/prayerPipeline.test.ts` | All 16 (from, to) pairs: the three forward moves and backward moves succeed, everything else is rejected. Backward needs bishopric plus a reason |
| `tests/lib/lastPrayed.test.ts` | A date formats as month and year; **null returns null, never "Never"**; a prayer below `done` does not count |
| `tests/lib/topicRotation.test.ts` | Bucket boundaries; a null `last_assigned_at` is `unused` and sorts first |
| `tests/db/topic-last-assigned.test.ts` | Against the hosted project: the stamp fires on `review → approve` and on no other transition; a later revert leaves it stamped |
| `tests/rls/topic-candidates.test.ts` | Ward A's bishop cannot read or write ward B's candidates; a secretary and an org president are refused all four verbs. Negative UPDATE/DELETE assertions re-read with the service client |

---

## Test Scenarios (Harness)

### Scenario 014: Prayer rotation across a month
**Tags:** `[talks, full, prayers]`
**Purpose:** "Last prayed" is a nudge, and whether a nudge works is a judgement about wording and
placement that no unit test reaches. Seeding matters because a useful last-prayed spread needs a
year of prayer history behind several members — tedious and error-prone to build by hand.

**Seed data summary:**
- Ward — Harness Test Ward; users `bishop`, `counselor1`
- Members — 12 active adults; 4 with prayers at `done` spread across the last 18 months, 2 with
  prayers stuck at `ask`, 6 with no prayer history at all
- Sundays — June 2026 generated; 06-07 is fast Sunday with `speaking_slots = 0`

**Tester action:** Assign invocation and benediction across June and walk one prayer to `done`.

**Verification checklist:**
- [ ] The picker shows "Last prayed <Month Year>" for the four with history
- [ ] The six with no history show **nothing** beside their name — not "Never"
- [ ] The two stuck at `ask` also show nothing; an unfinished prayer is not a prayer given
- [ ] **06-07 accepts prayers despite `speaking_slots = 0`** — the fast-Sunday case
- [ ] Each prayer moves `assign → ask → confirm → done` one explicit step at a time
- [ ] Assigning a second member to the same slot replaces rather than duplicating
- [ ] Works at 375px in both themes
- [ ] Audit rows exist for each assignment and each stage change

### Scenario 015: Topic library and the empty candidate queue
**Tags:** `[talks, full, topics, ai-boundary]`
**Purpose:** Proves the accept/reject boundary is real *before* Phase 5 can put anything through
it — the cheapest moment to find out that a candidate can reach `topics` without an accept. Also
checks that `last_assigned_at` moves at the right moment, which is the one thing about this feature
a bishopric will notice being wrong.

**Seed data summary:**
- Ward — Harness Test Ward; users `bishop`, `secretary`
- Topics — 8 across all five categories: 3 never assigned, 3 assigned 2–14 months ago, 2 archived
- Assignments — one at `review` carrying a never-assigned topic, ready to approve
- Topic candidates — 3 `pending` rows inserted directly (standing in for Phase 5)

**Tester action:** Browse and filter the library, approve the waiting assignment, then work the
candidate queue.

**Verification checklist:**
- [ ] Never-assigned topics sort first; archived ones are hidden unless asked for
- [ ] Approving the assignment stamps its topic's `last_assigned_at` immediately
- [ ] Sending that assignment back to `plan` leaves the stamp in place
- [ ] Each candidate is accepted or rejected **individually**; there is no accept-all
- [ ] An accepted candidate appears in `topics` with `source = 'ai_generated'` and links back
- [ ] A rejected candidate leaves `topics` untouched
- [ ] With the queue emptied, the empty state explains where suggestions come from
- [ ] The secretary can view topics and cannot add, edit, archive, or review a candidate
- [ ] Works at 375px in both themes

---

## Validation Commands

```bash
npm run db:push
npm run db:types
npm run lint
npm run typecheck
npm test
npm run build
```

---

## Integration Notes

- **Phase 6 reads both.** Prayer names and topic titles land on the printed program. Expose them
  through `lib/prayers/queries.ts` and `lib/topics/queries.ts` rather than letting the program
  builder query the tables directly.
- **Phase 5 writes only to `topic_candidates`.** It never inserts into `topics`. If a Phase 5 plan
  proposes otherwise, that is the rule-3 violation this table exists to make impossible.
- **`prayer_assignments` has a ward-scoped select policy, not a bishopric-only one** (migration
  019). Confirm that is intended before the RLS test encodes it. If prayers should be
  bishopric-only, raise it — do not tighten a policy as a side effect of this slice.
- **Breaking changes: none.** One new table; nothing existing changes shape. The one edit to an
  existing file is the `last_assigned_at` stamp in `lib/assignments/queries.ts`.
