# Plan: Talks D — Speaker Reliability & Goals

**Created:** 2026-08-20
**Type:** feature
**Phase:** 4 of 13 — part 4 of 4 ([plans/04-talks-pipeline.md](04-talks-pipeline.md))
**Structure:** Sequential — depends on `talks-a`, `talks-b` and `talks-c`. Closes Phase 4

---

## Overview

The two features that read what the pipeline wrote: a speaker reliability profile on the member
detail page, and a goals board whose overdue items surface on the calendar.

This slice also closes a promise `roster-b` made. `ReliabilityFlag` has rendered nothing since it
was created, with a comment saying Phase 4 owns the logic and that guessing a rule would be worse
than showing nothing. This is where that gets paid off — or deliberately not.

**Key requirements**

1. Four pattern flags, computed by a **pure, tested function**, on a bishopric-only tab.
2. **Flags are informational.** They never block an assignment, never leave the bishopric view, and
   are worded neutrally. This is pastoral data about real people.
3. Goal status is **computed on read**. The `status` column stays a cache and the UI always trusts
   the computed value.
4. Overdue and due-soon goals fill the `goalAlerts` reserved region `calendar-b` left on
   `SundayCell` and `SundayCard`.

**Success criteria**

- Each of the four flags fires on its boundary condition and not one day before
- The reliability tab appears for bishop and counselors and for nobody else — proven from the
  browser console, not just by a hidden tab
- No flag field appears on any shared member response
- `goalStatus()` returns the right bucket for every boundary including never-fulfilled
- Overdue goals show on calendar cells in both the grid and the 375px list
- `ReliabilityFlag` either renders real flags or still renders nothing **on purpose**, recorded
  either way in the retro
- Phase 4's Definition of Done is fully met; `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build` all pass

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `lib/assignments/reliabilityFlags.ts` | create | Pure — the four flags. **Client-importable** |
| `lib/goals/goalStatus.ts` | create | Pure — `goalStatus()`. **Client-importable** |
| `lib/goals/queries.ts` | create | Goal reads and writes. **Server-only** |
| `lib/assignments/queries.ts` | modify | `listSpeakerHistory()` — bishopric-only, its own call |
| `lib/validation/goal.ts` | create | Zod schemas |
| `app/api/goals/route.ts` | create | `GET` list with computed status, `POST` create |
| `app/api/goals/[id]/route.ts` | create | `PATCH` edit or mark fulfilled |
| `app/api/members/[id]/speaker-history/route.ts` | create | Bishopric-only. **A separate call, deliberately** |
| `app/(app)/roster/member/[id]/SpeakerHistoryTab.tsx` | create | The profile — history table plus flags |
| `app/(app)/roster/member/[id]/page.tsx` | modify | Mount the tab behind a bishopric check |
| `app/(app)/goals/page.tsx` | create | Goals board |
| `app/(app)/goals/GoalBoard.tsx` | create | `"use client"` — filters, create, mark fulfilled |
| `components/roster/ReliabilityFlag.tsx` | modify | Extend the union; keep the honesty note |
| `components/goals/GoalStatusBadge.tsx` | create | on_track / due_soon / overdue |
| `components/goals/GoalAlerts.tsx` | create | The `goalAlerts` reserved region |
| `app/(app)/calendar/page.tsx` | modify | Pass `goalAlerts` into `SundayCard` |
| `components/calendar/MonthGrid.tsx` | modify | Thread `goalAlerts` into `SundayCell` |
| `supabase/migrations/027_goal_status_refresh.sql` | create | Nightly refresh of the cached column |
| `tests/lib/reliabilityFlags.test.ts` | create | Each flag on its boundary and not before |
| `tests/lib/goalStatus.test.ts` | create | Every bucket boundary, including never-fulfilled |
| `tests/rls/speaker-history.test.ts` | create | History is bishopric-only and ward-scoped |
| `tests/components/roster/ReliabilityFlag.test.tsx` | create | Renders the extended union; empty renders nothing |
| `plans/04-talks-pipeline.md` | modify | Tick the Definition of Done; record deviations |
| `SPEC.md` | modify | Record the speaker-history route |

---

## Dependencies

- **No new packages.**
- **Permissions already exist:** `goals.view`, `goals.manage`. Speaker history rides on
  `talks.view` **plus** an explicit bishopric check — see Task 3.
- **Schema already exists.** `assignment_history` (migration 005) and `goals` (migration 010). The
  only migration here is the nightly refresh function.
- **`goals` is under migration 019's ward-scoped loop**, so every authenticated ward member can
  read and write it. The route is the write boundary — the same asymmetry `roster-a` and `roster-b`
  recorded for `members`, `households` and `member_organizations`. Record it in the retro rather
  than quietly tightening the policy.

---

## Known Pitfalls (from retro context)

- **[04-talks-pipeline.md] Reliability flags leaking.** They must never reach a non-bishopric
  response. Query them in a **separate bishopric-only call**, not as a field on the shared member
  type. A field that exists on the shared type will eventually be serialized somewhere it should
  not be — this is CLAUDE.md rule 9 in reverse.
- **[04-talks-pipeline.md] Storing computed goal status.** It goes stale silently. Compute on read;
  treat the column as a cache the nightly function refreshes.
- **[roster-b] `ReliabilityFlag`'s union is a starting point, not a contract.** Extend it. Its
  comment block explains why it renders nothing today — **keep the reasoning** when you replace the
  implementation, because it is still the rule that governs a fifth flag someone adds later.
- **[roster-b] `lib/<module>/queries.ts` is server-only.** `reliabilityFlags.ts` and
  `goalStatus.ts` are imported by client components; types only.
- **[foundation-c] A denied read returns an empty set, not an error.** In
  `tests/rls/speaker-history.test.ts`, prove the secretary gets *nothing back*, and prove the row
  exists for the bishop in the same fixture — otherwise an empty result proves only that the seed
  failed.
- **[calendar-a] Compute-on-read has a cost.** The goals board and the calendar both compute
  status. Keep `goalStatus()` pure and cheap; do not reach for a database function.

---

## Tasks

### Task 1: The four flags

**File:** `lib/assignments/reliabilityFlags.ts` (create)

```ts
export type ReliabilityFlagKind =
  | "frequent_decliner"
  | "late_canceller"
  | "not_asked_recently"
  | "not_spoken_recently";

export type SpeakerHistoryEntry = {
  outcome: AssignmentHistoryOutcome;
  cancellationDaysNotice: number | null;
  sundayDate: string;
};

export function reliabilityFlags(
  history: readonly SpeakerHistoryEntry[],
  asOf: Date,
): readonly ReliabilityFlagKind[]
```

Exactly the table in 04-talks-pipeline.md §Step 8:

| Flag | Condition |
|---|---|
| `frequent_decliner` | Declined 2 or more times |
| `late_canceller` | Cancelled within 7 days of the assignment |
| `not_asked_recently` | No assignment in 18+ months |
| `not_spoken_recently` | No completed talk in 2+ years |

- **`asOf` is a parameter, never `new Date()` inside.** A function that reads the clock cannot be
  tested at a boundary.
- Use the UTC date-only helpers in `lib/calendar/dates.ts`. Do not introduce a second date idiom —
  `calendar-a` built those specifically as the defence against the timezone pitfall.
- The two "recently" flags fire only when there **is** history. A member who has never been asked
  is not a "not asked recently" case; they are a member with no history, and saying otherwise
  invents a pattern from an absence.
- Client-importable.

### Task 2: Extend `ReliabilityFlag`

**File:** `components/roster/ReliabilityFlag.tsx` (modify)

- Replace the placeholder union with the four kinds above and give each a **neutral** label:
  "Declined twice recently", "Cancelled close to the date", "Not asked in over a year",
  "Has not spoken in two years". Not "unreliable", not "no-show", nothing a bishop would be
  uncomfortable reading aloud.
- **Keep the comment block's reasoning**, updated. The rule it states — a flag that looks right is
  worse than no flag — governs the next person who wants to add a fifth.
- `MemberPicker` passes `showFlags` already; wiring the data is Task 3's job.

### Task 3: Speaker history, in its own call

**Files:** `lib/assignments/queries.ts` (modify),
`app/api/members/[id]/speaker-history/route.ts` (create)

```ts
export async function listSpeakerHistory(
  wardId: string, memberId: string, client?: SupabaseClient<Database>,
): Promise<SpeakerHistoryEntry[]>
```

- Reads `assignment_history` joined to the assignment's Sunday for the date.
- **Never add flags or history to the shared member type** in `lib/roster/queries.ts`. This is the
  one design rule of this task; a separate call is what keeps a flag out of a response that a
  non-bishopric caller might one day receive.
- The route asserts `talks.view` **and** that the caller's role is in `BISHOPRIC_ROLES`. Both:
  `talks.view` is the module gate, and the bishopric check is the leak defence.
  `assignment_history` is already bishopric-only in RLS — that is the real boundary; these make the
  refusal an honest 403.
- Audit is not needed on a read. `writeAuditLog` is for mutations (CLAUDE.md rule 6).

### Task 4: The profile tab

**Files:** `app/(app)/roster/member/[id]/SpeakerHistoryTab.tsx` (create), `page.tsx` (modify)

- Columns: date, assignment type, outcome, notice given, counselor notes. Flags above the table.
- Mount behind a bishopric check in the Server Component using `can()`, not `assertCan()` (auth-b).
  A non-bishopric viewer sees **no tab at all** — not a disabled tab, which advertises that the
  data exists.
- Empty state: "No speaking history yet." No flags, no empty table.
- **External speakers never appear here.** They write no `assignment_history` row (talks-a
  Decision 3), so this falls out for free — but assert it in the RLS test so it stays true.

### Task 5: Goal status

**File:** `lib/goals/goalStatus.ts` (create)

```ts
export function goalStatus(
  lastFulfilledAt: Date | null,
  frequencyMonths: number,
  asOf: Date,
  createdAt: Date,
): "on_track" | "due_soon" | "overdue"
```

- `due_soon` at 80% of the interval elapsed; `overdue` past it.
- **Never fulfilled counts as overdue once the interval has passed since creation** — hence
  `createdAt`, which the phase plan's signature omits. Record the addition as a deviation.
- `asOf` is a parameter, for the same reason as Task 1.
- Client-importable.

### Task 6: Goals data layer, routes and board

**Files:** `lib/goals/queries.ts`, `lib/validation/goal.ts`, `app/api/goals/route.ts`,
`app/api/goals/[id]/route.ts`, `app/(app)/goals/page.tsx`, `GoalBoard.tsx`,
`components/goals/GoalStatusBadge.tsx` (create)

- `target_type` / `target_id` is **polymorphic with no foreign key** (migration 010's comment is
  explicit). The route must verify the target resolves to a live row in the right table before
  insert — the database will not, and a goal pointing at a deleted household is a permanent
  mystery on the board.
- `GET /api/goals` returns each goal with `status` **computed**, never the column's value. The
  column is a cache.
- `PATCH` edits, or marks fulfilled by setting `last_fulfilled_at`.
- Audit `goal_created`, `goal_updated`, `goal_fulfilled`.
- Board groups by status with overdue first, filterable by target type. 375px, both themes.

### Task 7: The nightly refresh

**File:** `supabase/migrations/027_goal_status_refresh.sql` (create)

- A function that recomputes `goals.status` for every ward, matching `goalStatus()` exactly.
- **The UI never reads this column.** It exists so a future report or notification has an indexable
  value. If the function and the pure function ever disagree, the pure function is right.
- Schedule it with `pg_cron` if the extension is available on the hosted project; if it is not,
  **say so and leave the function callable manually** rather than inventing a scheduler. Check
  `supabase/migrations/001_extensions.sql` before assuming.

### Task 8: Goal alerts on the calendar

**Files:** `components/goals/GoalAlerts.tsx` (create), `app/(app)/calendar/page.tsx`,
`components/calendar/MonthGrid.tsx` (modify)

- Fills the third reserved region. `talks-b` filled `speakers` and `pipelineStatus`; this completes
  the set `calendar-b` left.
- Overdue and due-soon only. An on-track goal on a calendar cell is noise.
- One fetch for the month, passed down — not one per cell.
- The cell is `min-h-40` and already sized for all three regions. If it is not, **raise it** rather
  than resizing the cell; `03-calendar.md` §Step 5 designed that height specifically so Phase 4
  would not have to.

### Task 9: Close out Phase 4

**Files:** `plans/04-talks-pipeline.md`, `SPEC.md` (modify)

- Walk the phase's Definition of Done checklist and tick each item, or record honestly why one is
  not met.
- Record every deviation across all four slices: the `createdAt` parameter on `goalStatus()`, the
  `topic_candidates` table, the `/api/assignment-comments` and `/api/members/[id]/speaker-history`
  routes, the contact-waiver design, and the `assignment_reverted` trigger key.
- **The eight-test table in the phase plan does not match what was built.** Four slices produced a
  different, larger set. Update the table to the truth rather than leaving a spec that describes
  tests nobody wrote.

---

## Testing Strategy

| File | Asserts |
|---|---|
| `tests/lib/reliabilityFlags.test.ts` | Each flag fires **on** its boundary and not one day before: decline #2 but not #1; 7 days' notice but not 8; 18 months but not 17; 2 years but not 23 months. A member with no history gets no flags. `asOf` drives every case — no test reads the clock |
| `tests/lib/goalStatus.test.ts` | `on_track` below 80%, `due_soon` at exactly 80%, `overdue` past 100%. Never-fulfilled is `on_track` before the interval and `overdue` after. A zero or negative frequency is rejected at the schema, not here |
| `tests/rls/speaker-history.test.ts` | A ward secretary, an org president and a youth account read **nothing** from `assignment_history`, while the bishop reads the seeded row in the same fixture. Cross-ward isolation. An external speaker's completed assignment produced no history row |
| `tests/components/roster/ReliabilityFlag.test.tsx` | All four kinds render their label; an empty array renders nothing at all |

---

## Test Scenarios (Harness)

### Scenario 016: Reliability flags on real history
**Tags:** `[talks, full, reliability, privacy, permissions]`
**Purpose:** Two things no unit test reaches. First, that the flags **read** as pastoral rather
than as a verdict — the wording is the feature, and only a person can judge it. Second, and higher
risk, that the data does not leak: `tests/rls/speaker-history.test.ts` proves the policy, but a
walkthrough with the browser console open proves the *route* does not hand it to a secretary who
asks directly.

**Seed data summary:**
- Ward — Harness Test Ward; users `bishop`, `counselor1`, `secretary`, `eqpres`, a youth account
- Members — 6 adults with hand-built histories: one declined twice, one cancelled 3 days out, one
  last asked 20 months ago, one who last spoke 26 months ago, one clean, one with no history
- Assignments — one completed **external** speaker on a past Sunday, to prove it wrote no history

**Tester action:** Open each member's detail page as the bishop, then as the secretary, then hit
`/api/members/[id]/speaker-history` directly from the console as the secretary.

**Verification checklist:**
- [ ] Each of the four seeded members shows exactly the one flag they earned, and the clean member
      shows none
- [ ] The member with no history shows "No speaking history yet" and no flags
- [ ] Every flag's wording is neutral — nothing a bishop would hesitate to read aloud
- [ ] The counselor's view is identical to the bishop's, item for item (CLAUDE.md §7)
- [ ] The secretary sees **no tab at all** — not a disabled one
- [ ] **The secretary's direct call to the history route returns 403**, and the response body
      contains no history data
- [ ] `eqpres` and the youth account are refused the same way
- [ ] The external speaker appears nowhere in any history table
- [ ] Flags appear in the `MemberPicker` planning view only when the caller is bishopric
- [ ] Works at 375px in both themes

### Scenario 017: Overdue goals reach the calendar
**Tags:** `[talks, full, goals, calendar]`
**Purpose:** The third reserved region is the last piece of the Phase 3 → Phase 4 contract, and
whether three stacked regions still fit a calendar cell at 375px is a question only a real screen
answers. Seeding matters because a spread of goal statuses needs fulfilment dates placed carefully
either side of the 80% boundary.

**Seed data summary:**
- Ward — Harness Test Ward; users `bishop`, `eqpres`
- Goals — 8: two overdue, two due-soon straddling 80%, two on-track, one never fulfilled and past
  its interval, one never fulfilled and still inside it
- Targets — a mix of member, household, org and group, including **one pointing at a deleted
  household** to prove the board degrades honestly
- Sundays — July 2026 generated, with assignments and speakers already in place from `talks-b`

**Tester action:** Work the goals board, mark one fulfilled, then open the calendar.

**Verification checklist:**
- [ ] Overdue sorts first; the two straddling 80% land in the right buckets
- [ ] The never-fulfilled goal past its interval reads overdue; the one inside reads on-track
- [ ] The goal with a dead target renders something honest, not a blank row or a crash
- [ ] Marking a goal fulfilled moves it to on-track immediately, with no reload
- [ ] Overdue and due-soon appear on calendar cells; on-track goals do not
- [ ] **All three reserved regions render together** — speakers, pipeline status, goal alerts —
      in the grid and in the 375px card list, with no clipping and no horizontal scroll
- [ ] Both themes; every panel keeps a visible border in dark mode
- [ ] `eqpres` can read goals and the write controls behave as the route allows — record what
      actually happens, since RLS is ward-wide here and the route is the boundary

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

- **Closes `roster-b`'s open promise.** `ReliabilityFlag` has rendered nothing since it was
  created. If the four flags land, say so in the retro. If they do not, say **that** — a fifth
  hand-forward is a legitimate outcome, a silent one is not.
- **Completes the Phase 3 → Phase 4 contract.** All three reserved regions on `SundayCell` and
  `SundayCard` are now filled. Nothing about those components should need restructuring; if it
  does, that is a finding worth recording, because `calendar-b` sized them specifically to avoid it.
- **Breaking changes: none.** `ReliabilityFlag`'s prop shape is unchanged — only the union widens,
  and no current caller passes a value, since it has always rendered nothing.
- **Phase 11 seam.** The goals board is bishopric-and-org-leadership today by permission but
  ward-wide by RLS. Phase 11 owns the role access matrix and inherits this asymmetry along with the
  `member_organizations` one `roster-b` handed it. Record both in the same place.
- **Phase 4 is complete when this slice lands.** Confirm the phase's Definition of Done, then
  Phase 5 (AI platform) or Phase 7 (visits) unblocks — INDEX.md's dependency graph shows 7–9 are
  independent of 4–6, so two tracks become available here.
