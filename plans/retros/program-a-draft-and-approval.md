---
id: program-a-draft-and-approval
type: feature
iter: ITER-004 (partial — left open; program-c and program-d close it)
commits: ["91f0f75", "940dea4"]
date: 2026-08-24
files:
  - lib/program/draft.ts
  - lib/program/assembleDraft.ts
  - lib/program/gather.ts
  - lib/program/diff.ts
  - lib/program/queries.ts
  - lib/validation/program.ts
  - app/api/programs/route.ts
  - app/api/programs/by-sunday/[sunday_id]/route.ts
  - app/api/programs/[id]/approve/route.ts
  - app/api/programs/[id]/refresh/route.ts
  - supabase/migrations/036_program_notifications.sql
  - supabase/migrations/037_program_write_scope.sql
  - supabase/migrations/038_talks_view_read_scope.sql
  - supabase/seed/notification_triggers.sql
  - types/domain.ts
  - SPEC.md
related:
  - talks-a-pipeline-core
  - talks-b-month-planner
  - talks-c-prayers-topics
  - calendar-b-month-view
  - foundation-c-services
  - role-access-overrides
  - route-tests-and-realtime
  - sunday-types-meeting-split
---

## What was done

The server half of the sacrament program builder: a versioned `ProgramDraft` shape and its Zod
schema, a pure assembler that turns a Sunday into a snapshot, a pure field-by-field diff, ward-scoped
data access, and four routes that build, read, refresh and approve. No screen, no PDF, nothing
public — `program-b`, `program-c` and `program-d` each build on this one validated draft rather than
re-deriving their own.

Executing it found a defect no plan predicted: `talks.view` had been granted to three non-bishopric
roles since foundation-c and refused by the database ever since, so a ward secretary holding
`program.build` assembled a program with every speaking slot silently empty and got a 200 back.

## Key decisions

- **The draft is a snapshot, and the proof is a database test, not a unit test.** A pure assembler
  will happily assemble twice and agree with itself, so `tests/db/program-snapshot.test.ts` stores a
  draft, changes the assignment's speaker in the hosted database, and re-reads the stored row. That
  is the only shape of test that fails when somebody reintroduces a live read.

- **Every person carries `printedName` AND `publicName`, computed once at assembly.** The rule is
  one question — did the name come from a RECORD, or did somebody TYPE it in order to be printed?
  Records get shortened ("Sarah W."), typed text does not (an external speaker, a presiding
  override, "The Primary children"). `program-c`'s projector selects `publicName` and has no code
  path to the other, which is what makes the public page safe by construction rather than by a SQL
  `CASE` a later migration could get wrong.

- **Migration 038 aligned RLS with the permission matrix, rather than the reverse.** Two existing
  tests had recorded the contradiction as intended behaviour — one saying it "reads like a bug until
  you know both halves", another calling the database "deliberately stricter". It read like a bug
  because it was one. SELECT on `assignments` and `topics` now follows the five roles holding
  `talks.view`; writes stay bishopric-only, and `assignment_approvals`, `_comments` and `_history`
  are untouched, because those are the bishopric deliberating about a person and no program is built
  from them.

- **The read route moved to `/api/programs/by-sunday/[sunday_id]`.** Next.js refuses to build with
  `[sunday_id]` beside `[id]` as sibling dynamic segments. Reusing `[id]` for both meanings would
  have left one folder name standing for a Sunday id in one directory and a program id in its
  siblings; a static segment says which it takes. SPEC.md records it.

- **`POST /api/programs` carries a discriminated `action`.** The plan specified four routes but
  required `program_pending_approval` to fire and said an edit after approval means "move the status
  back to draft first" — neither of which any of the four could do. `build` / `save` / `status` are
  mutually exclusive by shape, the same idiom `updateAssignmentSchema` uses so that saving cannot
  advance a status as a side effect.

- **`missing` is a closed, deduped, meeting-ordered list.** `speaker_slot` appears once however many
  slots are empty: the keys render as one written sentence each, and the same sentence twice says
  nothing about which slot. Ward conference presiding is asked about rather than guessed — the
  bishop still resolves, and `presiding_unconfirmed_ward_conference` tells the bishopric to check.

## Handed forward

- **`prayer_assignments` still has a ward-wide write policy.** Raised while writing migration 037,
  as `talks-c` asked. Left for its own change: narrowing it touches the Phase 4 prayer board, which
  this plan writes no tests for.
- **`music_coordinator` cannot read an assembled program** — they hold `music.view`/`music.manage`,
  not `program.view`. `program.view` was deliberately NOT widened; their screen is `program-e`'s
  `/music` page, and whether they also need the program is a product question.
- **`organist` and `chorister` have no upstream table anywhere in the schema.** They assemble as
  null and appear in `missing` every time until `program-b`'s editor or `program-e`'s music screen
  fills them.
- **Scenarios 028 and 029 are built and seeded but NOT walked** — `program-a` ships no UI. Their
  checklists are written against the screen `program-b` will build and are predictions, not
  observations. Walk them when `program-b` merges.
- **ITER-004 stays open.** The printed half lands in `program-d`, the public half in `program-c`.
