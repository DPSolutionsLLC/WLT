---
id: visits-a-goals-logs-and-notes
type: feature
iter: null
commits: ["d6b8e6f"]
date: 2026-08-25
files:
  - supabase/migrations/044_visit_log_type_and_private_note_upsert.sql
  - supabase/migrations/045_visit_flag_notification_recipients.sql
  - lib/visits/queries.ts
  - lib/visits/privateNotes.ts
  - lib/visits/flagNotification.ts
  - lib/validation/visit.ts
  - app/api/visit-goals/route.ts
  - app/api/visit-goals/[id]/route.ts
  - app/api/visits/route.ts
  - app/api/visits/[id]/route.ts
  - app/api/visits/[id]/private-note/route.ts
  - app/(app)/visits/page.tsx
  - app/(app)/visits/VisitLogForm.tsx
  - app/(app)/visits/VisitGoalPanel.tsx
  - types/domain.ts
  - supabase/seed/notification_triggers.sql
  - testing/infrastructure/seedUtils.ts
related:
  - talks-d-reliability-goals
  - route-tests-and-realtime
  - roster-a-data-and-pages
  - roster-b-picker-and-orgs
  - role-access-overrides
  - foundation-c-services
---

## What was done

Built the application layer over Phase 0's already-complete visits schema: per-organization visit
goals, household visit logs, the shared/private note split, and ward-council flagging that
notifies only the executive secretary and only once per raise. The RLS boundary and its test
existed already; what was missing was everything above it plus proof that the boundary holds at
the **route** layer, which is where a widened `select` would leak without any policy changing.

Walked in a real browser through scenarios 038 and 039. The boundary held under every probe. One
real defect and two wrong checklist items came out of the walk, and the user's review of the one
judgement it flagged as risky reversed a design decision.

66 new tests. Full suite: 149 files, 2211 passing.

## Key decisions

- **The notes boundary is four independent mechanisms, and the module split is one of them.**
  `lib/visits/queries.ts` never imports `lib/visits/privateNotes.ts`, so "did this response carry a
  private note?" is answerable from an import list without reading a query. The route response type
  is built from a domain type with no such field, making a private note *unrepresentable* rather
  than merely omitted. `tests/routes/visits.test.ts` asserts on `JSON.stringify(body)` rather than
  on field names, so a rename does not silently retire the check.

- **No function that touches private notes accepts a `userId`.** The author is always `auth.uid()`
  — in the module, in the schema, and in the route — so "read someone else's note" is not
  expressible in the API surface. Proven live: posting a note with another author's `userId` in the
  body returned 200 and wrote the note under the *caller's own* id, leaving the other author's row
  untouched. The attack writes the attacker's diary.

- **The flag notification goes to the executive secretary, resolved explicitly.** The seed had
  `['bishop', 'counselor', 'ward_council_member']`; FEATURES.md §Module 9 and 07-visits.md §Step 3
  both say the executive secretary, who owns the ward council agenda. That role holds **no
  `visits.view` permission**, which is what makes "the notification carries the one-liner only"
  structurally true rather than a rule to remember.

- **The stale hosted row was fixed by a migration, not by hand.** The plan said to update the
  linked project's `notification_settings` row directly. Migration 025 set a precedent for data
  backfills as migrations, and doing it that way fixes *every* ward rather than one project —
  so migration 045 exists. A correct seed file plus a stale hosted row is a bug that only ever
  shows up in production behaviour.

- **`flag_sent_at` is never accepted from a request body.** `updateVisitLog()` takes it as a
  separate parameter for exactly that reason: a body that could stamp its own would be able to
  silence the notification the flag exists to send. Unflagging clears it, which is what lets a
  genuine re-raise notify again.

- **A bishopric author must name the organization a visit goal belongs to.** The plan said the
  create schema carries no `orgId` (Task 2) *and* that a bishopric author must supply one (Task 6).
  Task 6 is right: a visit goal with `org_id = null` lands in the hole `org_id = current_org_id()`
  creates — null is never equal to null — so no org leader could read the goal they must act on.
  An `orgId` was added to the schema, honoured only for the bishopric and refused with a 403 for
  anyone else.

## Gaps introduced

- **`visit_overdue` still has nowhere to run.** The trigger is seeded and fires from nothing: no
  `supabase/functions/` directory, and `pg_cron` is not enabled. `visits-d` adds a second
  computed-on-read state (`missed`) with the same absence of a scheduler. **Raise the mechanism
  before `visits-c`.**

- **`visit_goals_select` has no cross-org branch while `visit_logs_select` does** (019_rls.sql
  L358 vs L379), and this slice did not add one. With visibility on, a leader reads another org's
  logs but not the goal supplying their denominator, so a cross-org progress view cannot compute
  "X of Y". Asserted as-is by `tests/rls/visit-cross-org.test.ts` so the asymmetry is recorded
  rather than discovered. `visits-b` decides it.

- **One failure path is untested.** "The visit saved but the private note did not" is handled in
  `VisitLogForm.tsx` and reported as its own sentence, but inducing it needs the note endpoint to
  fail on demand. Covered by reading the code, not by a test.

## What the walkthrough changed

- **A household with no active members was offered as somewhere to visit.** `listHouseholds()`
  filters the members it *attaches*, not the households it *returns*, so a household whose people
  have all moved out comes back present with `members: []`. The page mapped straight to options.
  The plan's own Known Pitfalls warned about this — `DEFAULT_MEMBER_STATUSES` names "a visit-goal
  denominator" as its reason for existing — and it was read past anyway. Fixed by filtering on
  `members.length > 0`. **`visits-b` must apply the same rule to its denominator**, and its plan
  now says so.

- **The emphasis was on the wrong field, and the user caught it.** The private notes box shipped as
  a tinted, heavy-bordered panel. The user's review: *"if anything, the shared notes are the ones
  that should have attention brought to them."* Correct — marking out the private box says "be
  careful" about the only field on the page that is already safe, and a tinted panel with a heavy
  border is also how a form signals a validation error. Rebuilt as one **Notes** section with
  **Shared** and **Private** beneath it; the shared field's label, helper text **and the text being
  typed into it** carry the attention colour, and the private field is ordinary. Watching your own
  sentence come out in a different colour cannot be looked past the way a border can.

- **Two scenario checks described states the app cannot reach.** Scenario 039 told a tester to
  press "Flag for ward council" on an already-flagged visit — whose button reads "Remove ward
  council flag"; the idempotent re-flag is API-only. And three steps said to open the notification
  bell, which does not exist (the 🔔 is a static emoji; Phase 11 owns the notification UI). Both
  corrected in the scenario file rather than skipped.

## Pattern

**A privacy boundary is only as good as the layer you tested it at.** The RLS suite for
`visit_private_notes` had passed since Phase 0 and proved the policy; it would have gone on passing
untouched while a widened `select` in a queries module served the note to a colleague through a
list endpoint. The check that catches that is one that reads a **serialized route response** and
looks for the text — not the field name, the text — as every reader in turn. Test the boundary at
each layer that could cross it, and assert on what a leak would actually look like.
