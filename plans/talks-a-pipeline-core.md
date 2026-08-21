# Plan: Talks A — Pipeline Engine & Assignment API

**Created:** 2026-08-19
**Type:** feature
**Phase:** 4 of 13 — part 1 of 4 ([plans/04-talks-pipeline.md](04-talks-pipeline.md))
**Scope refs:** ITER-004 (external speakers — schema and pipeline shape land here)
**Structure:** Sequential — `talks-b`, `talks-c`, `talks-d` follow and depend on this plan

---

## Overview

Everything Phase 4 needs beneath the UI: one migration, four pure modules, the assignment
data-access layer, four API routes, and the phase's highest-priority tests. **No pages and no
components** — `talks-b` builds the month planner on top of what this lands.

This is the `calendar-a` shape repeated: land the rules as pure functions with the routes that
call them, prove them against the hosted database, then build screens against a layer that is
already correct.

**Key requirements**

1. The nine-stage pipeline is a **pure, tested state machine**. Every transition is explicit,
   gated, and audited. No field update ever moves a stage as a side effect.
2. APPROVE requires an approval row from **all three** bishopric members. Editing an approved
   assignment invalidates those approvals and notifies.
3. A speaker may be a ward member **or** an external person (ITER-004) — a visiting stake
   leader, a missionary reporting home. The contact stages for an external speaker are
   **explicitly waived and recorded**, never silently skipped and never left looking like an
   outstanding task nobody can complete.
4. Speaker history counts an assignment only when it reached `complete`. A reverted assignment
   is absent from it. External speakers never enter it at all.
5. Every route asserts bishopric access and writes an audit row.

**Success criteria**

- `npm run test` green, including every test in the Testing Strategy below
- `POST /api/assignments/[id]` with `action: "transition"` rejects every illegal stage move with
  a message naming the missing gate, and accepts every legal one
- Two of three bishopric approvals cannot reach `approve`; three can
- Editing an assignment that already has approvals clears them and emits `plan_change_requested`
- An external speaker reaches `complete` with the contact stages marked waived, writes no
  `assignment_history` row, and appears in no rotation query
- A Sunday marked stake conference reverts its assignments to `plan` **and now notifies** — the
  gap `calendar-b` handed forward is closed
- `npm run lint`, `npm run typecheck` and `npm run build` all pass

**Explicitly out of scope for this plan** — belongs to a later slice:

| Deferred to | What |
|---|---|
| `talks-b` | Month planner, assignment detail page, realtime comment UI, `sms:` handoff and copy fallback, the CONFIRM textarea |
| `talks-c` | Prayer pipeline, topic library CRUD, `last_assigned_at`, the AI-candidate accept/reject queue |
| `talks-d` | Reliability flags, the goals board, `goalStatus()`, calendar cell alerts |
| Phase 5 | AI drafting of the confirmation and thank-you messages. This plan stores the message; it does not generate it |
| Phase 11 | Read-only pipeline status for the ward secretary |

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `supabase/migrations/025_talks_pipeline.sql` | create | External speaker columns + contact waiver, the approval uniqueness constraint, indexes, the new trigger key |
| `supabase/seed/notification_triggers.sql` | modify | Add `assignment_reverted` so a ward seeded from scratch gets it too |
| `types/database.ts` | modify | Regenerate after the migration (`npm run db:types`) — never hand-edited |
| `types/domain.ts` | modify | `COUNTS_TOWARD_ROTATION`, `PIPELINE_STAGE_ORDER`, `SPEAKER_KINDS`, external-speaker title bounds |
| `lib/assignments/pipeline.ts` | create | Pure state machine — `canTransition`, `requiredFieldsFor`, `nextStage`. **Client-importable** |
| `lib/assignments/speaker.ts` | create | Pure — member / external / empty speaker discrimination and display naming. **Client-importable** |
| `lib/assignments/rotation.ts` | create | Pure — `countsTowardRotation(type)` and the completed-only history filter. **Client-importable** |
| `lib/assignments/queries.ts` | create | Every assignment read and write; the only module here touching Supabase. **Server-only** |
| `lib/validation/assignment.ts` | create | Zod schemas shared by routes and (in `talks-b`) forms |
| `app/api/assignments/route.ts` | create | `GET` by `sundayId` or month, `POST` create at stage `plan` |
| `app/api/assignments/[id]/route.ts` | create | `PATCH` — a discriminated union of "update fields" and "request a transition" |
| `app/api/assignments/[id]/approve/route.ts` | create | `POST` record an approval or a change request |
| `app/api/assignment-comments/route.ts` | create | `GET` + `POST` at both `month` and `assignment` level |
| `lib/calendar/queries.ts` | modify | `revertAssignmentsToPlan()` emits `assignment_reverted` — closes the `calendar-b` gap |
| `tests/lib/pipelineTransitions.test.ts` | create | Every legal transition succeeds, every illegal one is rejected. **Highest priority in the phase** |
| `tests/lib/approvalGate.test.ts` | create | 2-of-3 cannot reach APPROVE; 3-of-3 can; a duplicate row cannot fake a third |
| `tests/lib/declineFlow.test.ts` | create | A decline returns to `plan` and clears the speaker |
| `tests/lib/rotationEligibility.test.ts` | create | `countsTowardRotation` per type; reverted and external assignments absent from history |
| `tests/lib/externalSpeaker.test.ts` | create | Waiver gating, display naming, the exactly-one-speaker rule |
| `tests/db/assignment-approvals.test.ts` | create | Approval invalidation and the unique constraint, against the hosted project |
| `tests/rls/assignment-access.test.ts` | create | Cross-ward isolation; bishopric-only reads and writes |
| `SPEC.md` | modify | Record the added comments route and the external-speaker columns |
| `plans/04-talks-pipeline.md` | modify | Record the deviations listed under Decisions Already Made |

---

## Dependencies

- **No new packages.** Zod 4, `@supabase/supabase-js`, and Vitest 4 are already present.
- **Existing services to use, not reinvent:**
  - `requireSessionUser()` — `lib/auth/session.ts`
  - `assertCan(user, permission, roleAccess)` and `resolveRoleAccess(supabase, wardId)` — `lib/auth/permissions.ts`
  - `readJsonBody(request)` and `respondToRouteError(error, context)` — `lib/auth/routeErrors.ts`
  - `writeAuditLog(params, client)` — `lib/audit/writeAuditLog.ts`
  - `emitNotification(params, client)` — `lib/notifications/emitNotification.ts`
  - `notifyOtherBishopric(params, client)` — `lib/notifications/notifyOtherBishopric.ts`
  - `getSunday()`, `listBishopricUsers()` — `lib/calendar/queries.ts`
- **Permissions already exist.** `talks.view`, `talks.plan`, `talks.approve`, `talks.request`,
  `talks.confirm` are in `PERMISSIONS`. Do not add new ones.
- **RLS already exists.** Migration 019 grants `assignments`, `assignment_approvals`,
  `assignment_comments` and `assignment_history` bishopric-only SELECT/INSERT/UPDATE/DELETE via
  its `is_bishopric()` loop. **Do not write new policies for these four tables** — verify the
  existing ones in the RLS test instead.
- **All eight notification trigger keys already exist** in `supabase/seed/notification_triggers.sql`:
  `plan_submitted`, `plan_approved`, `plan_change_requested`, `assignment_declined`,
  `message_approved_ready`, `sunday_confirmation_request`, `issue_flagged_post_sunday`,
  `appreciation_comments_ready`. This plan adds a ninth, `assignment_reverted`.

---

## Decisions Already Made

Record these in `plans/04-talks-pipeline.md` when the work lands.

1. **ITER-004 is inline fields, not a reusable table.** `external_speaker_name` and
   `external_speaker_title` on `assignments`, with a CHECK that a row has a member **or** an
   external name, never both. A saved list of stake leaders was considered and rejected as
   machinery nobody has asked for; a name is retyped each time. Revisit only if a ward complains.
2. **The contact stages are waived explicitly, not skipped.** One column pair,
   `contact_waived_at` / `contact_waived_by`, settable only when `member_id is null`. It is what
   lets an external speaker cross REQUEST → CONFIRM → NOTIFY and APPRECIATE → COMPLETE. ITER-004
   forbids a silent skip; a waiver is a recorded decision with a name and a timestamp on it.
3. **External speakers never enter speaker history.** `assignment_history.member_id` is
   `not null`, so this falls out of the existing schema — do not relax that column.
4. **PATCH takes a discriminated union.** `{ action: "update", … }` or
   `{ action: "transition", … }`, never both in one request. The phase's first pitfall is implicit
   stage advancement; making the two mutually exclusive *by shape* means the schema rejects it
   rather than a reviewer catching it.
5. **`/api/assignment-comments` is a new route SPEC.md does not list.** One table serves both
   comment levels, so one route serves both rather than splitting month-level comments awkwardly
   under `/api/sundays/[id]`. Update SPEC.md §API Routes in the same change (CLAUDE.md §1).
6. **The planner keys off `speakingSlots`, not `SundayType`.** A Sunday with no meeting already
   carries `speaking_slots = 0` from `generateSundays.ts`. Creating an assignment on a Sunday with
   zero slots is refused on that basis alone. This is deliberately independent of ITER-002 and
   ITER-003, which remain unbuilt — nothing here needs them, and nothing here should anticipate
   their shape.

---

## Known Pitfalls (from retro context)

- **[roster-b] `lib/<module>/queries.ts` is server-only, and a client component importing it
  fails the build.** `queries.ts` imports `createServerSupabaseClient`, which imports
  `next/headers`. `talks-b` renders the pipeline in client components, so `pipeline.ts`,
  `speaker.ts` and `rotation.ts` must import **types and `@/types/domain` only** — no Supabase, no
  `next/headers`. `npm run typecheck` and `npm run lint` both pass a boundary violation; only
  `npm run build` catches it. Run the build.
- **[foundation-c] An RLS-denied UPDATE or DELETE succeeds with zero rows; it does not raise.**
  In `tests/rls/assignment-access.test.ts`, every negative write assertion must re-read the row
  with the service client and prove it is unchanged. INSERT is the only one of the four that
  returns an error.
- **[foundation-c] Vitest must not run these files in parallel.** Already configured
  (`fileParallelism: false`); do not add `concurrent` to the new suites. They run over the network
  against the shared hosted project, so they must clean up after themselves and must not assume an
  empty table.
- **[foundation-c] A generic table parameter over all tables exhausts the TypeScript heap.** Keep
  generic table names away from generic column strings in any new helper.
- **[calendar-a] Do not concatenate select column lists.** Declare one `const ASSIGNMENT_COLUMNS`
  string and reuse it; a built-up list is how a column silently goes missing.
- **[calendar-b] A checklist item asserting behaviour nobody traced through the data layer is a
  guess.** Trace the revert path before asserting on it.
- **[calendar-c] The `is not null` clause in an RLS org branch is load-bearing.** Not directly
  applicable here — these four tables are bishopric-only — but read `tests/rls/org-isolation.test.ts`
  before assuming any policy shape.
- **[04-talks-pipeline.md §Pitfalls] `counts_toward_rotation` is not a "cancelled" flag.** It
  records whether an assignment **type** counts. Never set it false to mean "this got cancelled".

---

## Tasks

### Task 1: Migration — external speakers, the waiver, and the approval constraint

**File:** `supabase/migrations/025_talks_pipeline.sql` (create)
**Action:** Add the ITER-004 columns, close the approval-uniqueness hole, add indexes, and insert
the new trigger key for existing wards.

**Details:**

```sql
-- Talks A, migration 025: external speakers, contact waiver, approval uniqueness.

-- ITER-004. A speaker is a ward member OR an external person, never both. The third arm of the
-- CHECK is an empty slot: an assignment at stage 'plan' legitimately has no speaker yet, and a
-- calendar revert puts a filled one back into exactly that state.
alter table assignments
  add column external_speaker_name  text,
  add column external_speaker_title text,
  add column contact_waived_at      timestamptz,
  add column contact_waived_by      uuid,
  add constraint assignments_speaker_exactly_one check (
       (member_id is not null and external_speaker_name is null)
    or (member_id is null     and external_speaker_name is not null)
    or (member_id is null     and external_speaker_name is null)
  ),
  -- The contact stages may only be waived for somebody the ward is not contacting. Waiving them
  -- for a ward member would hide a real outstanding task.
  add constraint assignments_waiver_external_only check (
    contact_waived_at is null or member_id is null
  ),
  add constraint assignments_waiver_pair check (
    (contact_waived_at is null and contact_waived_by is null)
    or (contact_waived_at is not null and contact_waived_by is not null)
  ),
  add foreign key (contact_waived_by, ward_id) references users (id, ward_id);

-- Without this, one counselor can insert three approval rows and satisfy a 3-of-3 gate alone.
-- The gate counts rows; the database is what makes each row a distinct person.
alter table assignment_approvals
  add constraint assignment_approvals_one_per_user unique (assignment_id, user_id);

create index assignments_ward_sunday_idx  on assignments (ward_id, sunday_id);
create index assignments_ward_member_idx  on assignments (ward_id, member_id, pipeline_stage);
create index assignment_history_member_idx on assignment_history (ward_id, member_id);
create index assignment_comments_sunday_idx on assignment_comments (ward_id, sunday_id);

-- calendar-b handed this forward: the revert-to-'plan' path notifies nobody because no key
-- exists. 03-calendar.md asks for the planner to be told. Existing wards get it here; a ward
-- seeded from scratch gets it from supabase/seed/notification_triggers.sql.
insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select id, 'assignment_reverted', array['bishop', 'counselor']::text[], true
from wards
on conflict do nothing;
```

> Before writing `on conflict do nothing`, check whether `notification_settings` has a unique
> constraint on `(ward_id, trigger_key)`. If it does not, use a `where not exists` guard instead —
> `on conflict do nothing` with no matching constraint is a no-op that silently inserts duplicates.

---

### Task 2: Seed the new trigger key

**File:** `supabase/seed/notification_triggers.sql` (modify)
**Action:** Add `('assignment_reverted', array['bishop', 'counselor'])` to the **Talk pipeline**
block, and update the "Twenty-four keys; count them against the spec" comment at the top of the
file to the new count.

---

### Task 3: Regenerate database types

**Command:** `npm run db:push` then `npm run db:types`
**Action:** Push migration 025 to the linked hosted project and regenerate `types/database.ts`.
Never hand-edit that file (CLAUDE.md §5).

> `npm run db:reset` **wipes the hosted database** (CLAUDE.md §9). Use `db:push`.

---

### Task 4: Domain types

**File:** `types/domain.ts` (modify)
**Action:** Add the constants the pure modules need. Follow the existing `Record`-not-lookup
convention so a new enum member fails to compile until somebody decides its answer.

**Details:**

```ts
// Whether an assignment TYPE counts toward the ward's member speaking rotation
// (04-talks-pipeline.md §Step 2). A Record rather than a lookup with a fallback: an assignment
// type added to ASSIGNMENT_TYPES must not silently default to counting.
//
// This is NOT a "cancelled" flag. A cancelled or reverted assignment is excluded by its STAGE,
// never by this column.
export const COUNTS_TOWARD_ROTATION: Record<AssignmentType, boolean> = {
  sacrament_talk: true,
  organizational: false,
  returning_missionary: false,
  new_member: false,
  youth_speaker: false,
  high_council: false,
  other: false,
};

// The one stage that means the talk actually happened. Every speaker-history and
// "who has spoken recently" query filters on it (04-talks-pipeline.md §Step 2, rule 1).
export const COMPLETED_STAGE: PipelineStage = "complete";

export const SPEAKER_KINDS = ["member", "external", "empty"] as const;
export type SpeakerKind = (typeof SPEAKER_KINDS)[number];

export const MAX_EXTERNAL_SPEAKER_NAME = 120;
export const MAX_EXTERNAL_SPEAKER_TITLE = 60;
```

`PIPELINE_STAGES` and `PIPELINE_STAGE_LABELS` already exist — reuse them, do not redeclare.

---

### Task 5: The pipeline state machine

**File:** `lib/assignments/pipeline.ts` (create)
**Action:** The pure heart of the phase. Build and test this before anything calls it.

**Details:**

```ts
import { PIPELINE_STAGES, type PipelineStage, type Role } from "@/types/domain";

export type PipelineAssignment = {
  stage: PipelineStage;
  memberId: string | null;
  externalSpeakerName: string | null;
  topicId: string | null;
  slotNumber: number | null;
  requestOutcome: RequestOutcome | null;
  notifyMessage: string | null;
  notifySentAt: string | null;
  sundayConfirmedAt: string | null;
  thankYouSentAt: string | null;
  contactWaivedAt: string | null;
};

export type TransitionContext = {
  assignment: PipelineAssignment;
  approvals: readonly { userId: string; approved: boolean | null }[];
  bishopricUserIds: readonly string[];
  actorIsBishopric: boolean;
  reason?: string;
};

export type TransitionResult =
  | { ok: true }
  | { ok: false; message: string };

export function stageIndex(stage: PipelineStage): number
export function nextStage(from: PipelineStage): PipelineStage | null
export function isBackwardTransition(from: PipelineStage, to: PipelineStage): boolean
export function requiredFieldsFor(stage: PipelineStage): readonly string[]
export function canTransition(
  from: PipelineStage,
  to: PipelineStage,
  context: TransitionContext,
): TransitionResult
```

**Forward gates** — exactly the table in 04-talks-pipeline.md §Step 1:

| From → To | Gate | Refusal message |
|---|---|---|
| `plan` → `review` | A speaker (member **or** external name), `topicId`, and `slotNumber` are set | names the missing one(s) |
| `review` → `approve` | Every id in `bishopricUserIds` has an approval row with `approved === true` | "Waiting on 1 of 3 approvals." |
| `approve` → `request` | Reached only from `review`; sets `approved_at` | — |
| `request` → `confirm` | `requestOutcome === "accepted"` **or** `contactWaivedAt` is set | "Log the speaker's answer first." |
| `confirm` → `notify` | `notifyMessage` is non-empty **or** `contactWaivedAt` is set | "Approve the confirmation message first." |
| `notify` → `speak` | `notifySentAt` is set **or** `contactWaivedAt` is set | "Mark the message as sent first." |
| `speak` → `appreciate` | `sundayConfirmedAt` is set | "Confirm the meeting happened first." |
| `appreciate` → `complete` | `thankYouSentAt` is set **or** `contactWaivedAt` is set | "Send the thank-you first." |

**Rules that apply to every transition:**

- A forward move to any stage other than `nextStage(from)` is rejected. Stages are not skippable.
- A backward move is legal **only** when `actorIsBishopric` is true **and** `reason` is a non-empty
  trimmed string. The caller writes the audit row carrying that reason.
- `request` → `plan` is the one *expected* backward move (a decline). It is not special-cased in
  `canTransition`; it is an ordinary backward move whose side effects the route performs.
- A transition to the same stage is rejected — it is almost always a double-submitted form.
- `contactWaivedAt` satisfies four gates and **no others**. It never substitutes for a speaker,
  a topic, an approval, or `sundayConfirmedAt`. The meeting either happened or it did not,
  regardless of who spoke.

**Import nothing but `@/types/domain`.** This module is imported by client components in `talks-b`.

---

### Task 6: Speaker discrimination

**File:** `lib/assignments/speaker.ts` (create)
**Action:** One place that answers "who is speaking", so no caller ever reads `member_id` and
`external_speaker_name` and reaches its own conclusion.

**Details:**

```ts
export type AssignmentSpeaker =
  | { kind: "member"; memberId: string }
  | { kind: "external"; name: string; title: string | null }
  | { kind: "empty" };

export function speakerFrom(row: {
  memberId: string | null;
  externalSpeakerName: string | null;
  externalSpeakerTitle: string | null;
}): AssignmentSpeaker

// "President Mark Andersen" when a title is set, "Mark Andersen" when it is not. A member
// speaker returns null — the caller resolves a member name from the roster, and this module
// deliberately does not reach for one.
export function externalDisplayName(speaker: AssignmentSpeaker): string | null

export function isExternalSpeaker(speaker: AssignmentSpeaker): boolean
export function contactStagesApply(speaker: AssignmentSpeaker): boolean
```

**A title is typed, never derived.** `users` records no gender and
`bishopricDisplayName()` in `lib/calendar/queries.ts` deliberately refuses to guess an honorific
for that reason (ITER-004 §Scope Notes). Do not add a title-guessing heuristic here.

Import nothing but `@/types/domain`. Client-importable.

---

### Task 7: Rotation eligibility

**File:** `lib/assignments/rotation.ts` (create)
**Action:** The completed-only filter that keeps a voided assignment out of speaker history.

**Details:**

```ts
export function countsTowardRotation(type: AssignmentType): boolean

// The predicate every "who has spoken recently" calculation runs through
// (04-talks-pipeline.md §Step 2, rule 1). An assignment counts only when it REACHED `complete`
// AND its type counts AND it names a ward member. A reverted assignment sits at `plan` and is
// excluded for free; an external speaker has no member_id and is excluded by construction.
//
// Filtering on existence instead counts a talk that never happened, quietly suppresses that
// member from the rotation for months, and produces no symptom until somebody asks why a family
// has not been asked to speak in a year.
export function countsAsSpokenTalk(row: {
  stage: PipelineStage;
  assignmentType: AssignmentType;
  memberId: string | null;
}): boolean
```

Import nothing but `@/types/domain`. Client-importable.

---

### Task 8: Validation schemas

**File:** `lib/validation/assignment.ts` (create)
**Action:** Zod schemas for every route body. Follow `lib/validation/calendar.ts` — no `wardId` on
any schema, ever; it comes from the session.

**Details:**

```ts
export const externalSpeakerSchema = z.object({
  name: z.string().trim().min(1).max(MAX_EXTERNAL_SPEAKER_NAME),
  title: z.string().trim().max(MAX_EXTERNAL_SPEAKER_TITLE).nullable().optional(),
});

export const createAssignmentSchema = z.object({
  sundayId: z.uuid("Choose a Sunday from the calendar."),
  assignmentType: z.enum(ASSIGNMENT_TYPES),
  slotNumber: z.number().int().min(1).max(MAX_SPEAKING_SLOTS),
  slotLengthMinutes: z.number().int().min(1).max(60).nullable().optional(),
  memberId: z.uuid().nullable().optional(),
  externalSpeaker: externalSpeakerSchema.nullable().optional(),
  topicId: z.uuid().nullable().optional(),
}).superRefine(/* memberId and externalSpeaker are mutually exclusive — mirror the DB CHECK */);

// The discriminated union that makes implicit stage advancement unrepresentable.
export const updateAssignmentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), fields: assignmentFieldsSchema }),
  z.object({
    action: z.literal("transition"),
    to: z.enum(PIPELINE_STAGES),
    reason: z.string().trim().max(300).optional(),
  }),
  z.object({ action: z.literal("waive_contact"), note: z.string().trim().max(300).optional() }),
]);

export const approveAssignmentSchema = z.object({
  approved: z.boolean(),
  comment: z.string().trim().max(1000).nullable().optional(),
}).superRefine(/* approved === false requires a comment — a change request without a reason
                  is a dead end for the planner */);

export const createCommentSchema = z.discriminatedUnion("level", [
  z.object({ level: z.literal("assignment"), assignmentId: z.uuid(), comment: z.string().trim().min(1).max(2000) }),
  z.object({ level: z.literal("month"), sundayId: z.uuid(), comment: z.string().trim().min(1).max(2000) }),
]);

export const listAssignmentsQuerySchema = /* either sundayId, or from+to date range */;
```

Reuse `MAX_SPEAKING_SLOTS` and `dateOnlySchema` from `lib/validation/calendar.ts` rather than
redeclaring them.

---

### Task 9: The assignment data-access layer

**File:** `lib/assignments/queries.ts` (create)
**Action:** Every Supabase read and write for this slice. Server-only. Follow
`lib/calendar/queries.ts` for structure, error handling, and the snake_case→camelCase mapping at
this single boundary.

**Details:**

- One `const ASSIGNMENT_COLUMNS` string, reused everywhere. **Do not concatenate select lists**
  (calendar-a pitfall).
- `mapAssignmentRow(row): Assignment` — the one place snake_case becomes camelCase.
- Exported functions:
  - `listAssignments(wardId, filter, client)` — by `sundayId` or by date range joined through `sundays`
  - `getAssignment(wardId, id, client)` — returns `null` when absent or RLS-denied; the two are
    indistinguishable here and both mean "not yours" (foundation-c)
  - `createAssignment(wardId, input, plannedBy, client)` — always at stage `plan`, and sets
    `counts_toward_rotation` from `countsTowardRotation(input.assignmentType)`. **The user never
    picks it twice.** It is stored rather than derived so a later policy change does not rewrite
    history.
  - `updateAssignmentFields(wardId, id, fields, client)` — never touches `pipeline_stage`
  - `transitionAssignment(wardId, id, to, stamps, client)` — sets the stage **and** its timestamp
    column in one update
  - `listApprovals(wardId, assignmentId, client)`
  - `recordApproval(wardId, assignmentId, userId, approved, comment, client)` — upsert on the new
    `(assignment_id, user_id)` constraint
  - `clearApprovals(wardId, assignmentId, client)` — the invalidation path
  - `listComments(wardId, filter, client)` / `createComment(wardId, input, userId, client)`
  - `writeAssignmentHistory(wardId, assignment, outcome, client)` — **skipped entirely when
    `memberId` is null**; `assignment_history.member_id` is `not null` and an external speaker has
    none. This is ITER-004's "speaker history is not distorted" requirement, enforced by schema.
  - `countAssignmentsOnSunday(wardId, sundayId, client)` — used by the create route's slot guard
- Every function surfaces its Supabase error with an actionable message. Never `catch {}`
  (CLAUDE.md rule 7).

---

### Task 10: `GET` / `POST /api/assignments`

**File:** `app/api/assignments/route.ts` (create)
**Action:** List and create. Follow `app/api/sundays/[id]/org-conducting/route.ts` exactly for
shape: `requireSessionUser()` outside the try, everything else inside, `respondToRouteError` in the
catch.

**Details:**

- **GET** — `assertCan(user, "talks.view", roleAccess)`. Accepts `?sundayId=` or `?from=&to=`.
  Returns assignments with their stage, type, speaker, topic id, and approval count.
  > **Check the query parameter name against the handler** before `talks-b` fetches it. The
  > members route reads `getAll("status")`, singular, and a client sending `statuses` gets no
  > error — the parameter is silently ignored (roster-b pitfall).
- **POST** — `assertCan(user, "talks.plan", roleAccess)`. Body is `createAssignmentSchema`.
  1. `getSunday()` — 404 with "That Sunday is not on your ward's calendar." when absent
  2. **Refuse when `sunday.speakingSlots === 0`** — 409 with "That Sunday has no speaking slots.
     Set its speaking slots on the calendar first." Key off `speakingSlots`, not `SundayType`
     (Decision 6)
  3. Refuse when `slotNumber > sunday.speakingSlots`
  4. Refuse a duplicate `slotNumber` on the same Sunday — 409 naming the slot
  5. Create at stage `plan`; audit `assignment_created` with module `talks`

---

### Task 11: `PATCH /api/assignments/[id]`

**File:** `app/api/assignments/[id]/route.ts` (create)
**Action:** The one route in this slice with non-obvious side effects. `params` is a `Promise` in
Next 16; type the props explicitly rather than with the generated `RouteContext` helper, which only
exists after a build (foundation-a).

**Details, per `action`:**

**`action: "update"`** — `assertCan(user, "talks.plan", roleAccess)`.
- Applies the fields. **Never touches `pipeline_stage`.**
- **If approval rows exist, clear them** and emit `plan_change_requested` to the other bishopric
  members with a body naming the assignment and what changed. Without this a counselor can approve
  a plan and have it changed underneath them (04-talks-pipeline.md §Step 3).
- Audit `assignment_updated`, with `approvalsInvalidated: true|false` in the detail.

**`action: "transition"`** — the permission depends on the target stage: `talks.approve` for
`review → approve`, `talks.request` for `approve → request`, `talks.confirm` for
`confirm → notify`, `talks.plan` otherwise.
1. Load the assignment, its approvals, and `listBishopricUsers()`
2. Call `canTransition()`. On `{ ok: false }` return **409** with `message` — a 400 would say the
   request was malformed, and it was not; the assignment simply is not ready
3. On success, `transitionAssignment()` sets the stage and its timestamp:
   `review`→`plan_submitted_at`, `approve`→`approved_at`, `request`→`requested_at` +
   `requested_by`, `complete`→`completed_at`
4. **Side effects by target stage:**
   - `review` — emit `plan_submitted`
   - `approve` — emit `plan_approved`
   - `plan` **from `request`** (a decline) — set `request_outcome = 'declined'`, **clear
     `member_id` / external speaker fields**, write an `assignment_history` row with outcome
     `declined` (member speakers only), emit `assignment_declined`
   - `complete` — write an `assignment_history` row with outcome `completed` (member speakers
     only), set `completed_at`
5. Audit `assignment_stage_changed` with `{ from, to, reason }`. A backward move without a reason
   was already refused by `canTransition`.

**`action: "waive_contact"`** — `assertCan(user, "talks.request", roleAccess)`.
- Refuse with **409** when `memberId` is not null: "This speaker is on the ward roster — contact
  them rather than waiving it." The DB CHECK is the real boundary; this makes the refusal honest.
- Sets `contact_waived_at = now()` and `contact_waived_by = user.id`. Does **not** move the stage —
  a waiver is a fact about the assignment, and the transition is still explicit.
- Audit `assignment_contact_waived`.

---

### Task 12: `POST /api/assignments/[id]/approve`

**File:** `app/api/assignments/[id]/approve/route.ts` (create)
**Action:** Record one bishopric member's decision. `assertCan(user, "talks.approve", roleAccess)`.

**Details:**

- Refuse with 409 unless the assignment is at stage `review` — an approval on a plan that has
  moved on is meaningless.
- `approved: true` → upsert the approval row. Then check whether every bishopric member has now
  approved; if so, include `readyToApprove: true` in the response so `talks-b` can prompt the
  transition. **Do not advance the stage here** — that is the phase's first pitfall, and APPROVE
  stays an explicit transition through Task 11.
- `approved: false` → a change request. Record the row with its comment, transition the assignment
  back to `plan`, clear the other approval rows, and emit `plan_change_requested`.
- Audit `assignment_approval_recorded` with `{ approved, stage }`.

---

### Task 13: `GET` / `POST /api/assignment-comments`

**File:** `app/api/assignment-comments/route.ts` (create)
**Action:** Both comment levels through one route. `assertCan(user, "talks.view", roleAccess)` to
read, `talks.plan` to write.

**Details:**

- GET accepts `?assignmentId=` or `?sundayId=`, exactly one. Returns comments oldest-first with
  the author's user id and display name.
- POST takes `createCommentSchema` and sets `level` from the discriminant, never from the client's
  say-so beyond that.
- Audit `assignment_comment_created`.
- **Realtime is `talks-b`'s job.** This route only has to make the row exist; Supabase Realtime
  publishes it without a server round trip.

---

### Task 14: Close the revert-notification gap

**File:** `lib/calendar/queries.ts` (modify)
**Action:** `revertAssignmentsToPlan()` currently reverts silently. Emit `assignment_reverted`
after a successful revert.

**Details:**

- Read the affected assignments' `planned_by` before the update, so the notification reaches the
  person whose planning work was voided (03-calendar.md asks for the planner). Fall back to the
  bishopric when `planned_by` is null.
- Emit **once per revert operation** with a count, not once per assignment. A Sunday turning into
  stake conference with three speakers is one event, not three notifications.
- Body names the date and what happened: "Three speaking assignments on 2026-05-03 went back to
  planning because that Sunday became Stake Conference."
- `emitNotification` never throws, so this cannot fail the calendar change — the same contract
  `writeAuditLog` has.
- **Do not change the revert semantics.** Assignments still go to `plan`, never deleted. The
  comment block above the function explains why; leave it there.

---

### Task 15: Update the specs

**Files:** `SPEC.md`, `plans/04-talks-pipeline.md` (modify)
**Action:** Keep the specs true (CLAUDE.md §1).

- **SPEC.md §API Routes → Assignments:** add `GET/POST /api/assignment-comments`.
- **SPEC.md §Database Schema → assignments:** add `external_speaker_name`,
  `external_speaker_title`, `contact_waived_at`, `contact_waived_by`.
- **plans/04-talks-pipeline.md:** append a "Decisions made in talks-a" section recording the six
  items under Decisions Already Made above.

---

## Testing Strategy

Per CLAUDE.md §8 priority order. Pure logic first — it is cheap and it is where the rules live.

| File | Asserts |
|---|---|
| `tests/lib/pipelineTransitions.test.ts` | **Highest priority.** Table-driven over all 81 (from, to) pairs: exactly the eight forward moves and the backward moves succeed, every other pair is rejected. Same-stage rejected. Backward rejected for a non-bishopric actor. Backward rejected with a blank reason. Each gate's refusal message names the missing field |
| `tests/lib/approvalGate.test.ts` | 0-, 1-, 2-of-3 cannot reach `approve`; 3-of-3 can. Three rows from one user cannot (guards the pure function even though the DB constraint also blocks it). An `approved: false` row does not count toward the three. A bishopric of two — a ward mid-reorganization — needs both, not three |
| `tests/lib/declineFlow.test.ts` | `request → plan` is legal for a bishopric actor with a reason; the route's clearing of the speaker is asserted on the field-level helper |
| `tests/lib/rotationEligibility.test.ts` | `countsTowardRotation` is correct for all seven types. `countsAsSpokenTalk` is false for a reverted (`plan`) assignment, false for every stage below `complete`, false for an external speaker at `complete`, true only for a completed `sacrament_talk` naming a member |
| `tests/lib/externalSpeaker.test.ts` | `speakerFrom` returns each of the three kinds. `externalDisplayName` prefixes a title when set and does not when null. A waiver satisfies exactly the four contact gates and none of the others — assert explicitly that a waiver does **not** let `plan → review` pass without a topic, and does **not** substitute for `sundayConfirmedAt` |
| `tests/db/assignment-approvals.test.ts` | Against the hosted project: the `(assignment_id, user_id)` unique constraint rejects a second row. Editing an assignment with approvals clears them. The `assignments_speaker_exactly_one` CHECK rejects a row with both a member and an external name. The waiver CHECK rejects a waiver on a member assignment |
| `tests/rls/assignment-access.test.ts` | Ward A's bishop cannot read or write ward B's assignments, approvals, comments, or history. A ward secretary, an org president, and a youth account are refused all four tables. **Every negative UPDATE/DELETE assertion re-reads the row with the service client** — a denied write returns zero rows, not an error (foundation-c) |

**Route handlers stay unit-untested**, for the fifth slice running — there is no local server
(roster-b). The library layer beneath them is tested and `talks-b`'s harness scenario drives the
routes by hand.

Seed fixtures go through `tests/helpers/seed.ts` and authenticate via `tests/helpers/asRole.ts`.
The RLS suite must clean up after itself and must not assume an empty table — it runs over the
network against the shared hosted project.

---

## Test Scenarios (Harness)

**No harness scenario in this slice.** It follows the `calendar-a` precedent exactly: the
API-only slice shipped none, and every one of the eleven existing scenarios attaches to a slice
that rendered a screen. There is nothing here a tester can walk — no pages, no components, and the
routes have no UI to drive them from.

`talks-b` owns the first two, and they are already visible from here:

- **Scenario 012 — the three-approval gate**, seeding a bishopric of three plus a month of
  planned assignments. Seeding earns its place because building 2-of-3 and 3-of-3 states by hand
  across three accounts is tedious and easy to get subtly wrong.
- **Scenario 013 — a ward conference with an external speaker**, proving the waived contact
  stages read as "not applicable" on screen rather than as an outstanding task, which is the
  precise failure ITER-004 exists to prevent.

**Still outstanding from earlier phases, and not this plan's to fix:** `scenario-008`
(roster-b's member picker) has been handed forward three times and is the interface `talks-b`
consumes first — roster-b's retro says to run it before Phase 4 starts. `scenario-011`
(calendar-c) is written but unwalked. Neither blocks this slice, since this slice renders nothing.

---

## Validation Commands

```bash
# Push the migration to the linked hosted project, then regenerate types
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck

# Tests
npm test

# Production build — the ONLY thing that catches a client component importing a
# server-only module (roster-b pitfall). Lint and typecheck both pass that violation.
npm run build
```

---

## Integration Notes

- **Connects to Phase 3 in two directions.** It reads `sundays` for slot counts and Sunday
  identity, and it is read *by* `lib/calendar/queries.ts`, whose revert path Task 14 extends.
  Task 14 is the only change to a Phase 3 file; keep it to the notification and leave the revert
  semantics alone.
- **Breaking changes: none.** Every column added is nullable and every constraint is satisfied by
  existing rows — the `assignments` table is empty in every environment.
  `assignment_approvals_one_per_user` is the one to watch: if any environment somehow holds two
  approval rows for one user on one assignment, the migration fails. Check before pushing.
- **`ReliabilityFlag` stays a no-op.** It renders nothing today by design, and `talks-d` owns
  extending it. Do not wire it up from this slice with a guessed rule — roster-b's comment on that
  component explains why a flag that looks right is worse than no flag.
- **Phase 5 seam.** `notify_message` and `thank_you_message` are plain columns this slice reads and
  writes. Phase 5 adds `POST /api/assignments/[id]/ai-message`, which returns a *draft* a human
  approves before it lands in either column. Nothing here should auto-populate them (CLAUDE.md
  rule 3).
- **Phase 6 seam.** The program builder reads the speaker off an assignment. It must go through
  `speakerFrom()` rather than reading `member_id`, or an external speaker vanishes from the
  printed program. The public page (`/public/[slug]`) shows first name + last initial for ward
  members; an external speaker is a **different privacy case** — a visiting stake president is
  normally named in full — and that decision belongs to Phase 6, not here.
- **Documentation:** SPEC.md and `plans/04-talks-pipeline.md` are updated by Task 15. A retro file
  is generated by `/execute` on completion.
