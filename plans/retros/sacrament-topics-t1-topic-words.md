---
id: sacrament-topics-t1-topic-words
type: feature
iter: null
commits: ["05f0df9"]
date: 2026-09-29
files:
  - supabase/migrations/086_talk_topic_words.sql
  - lib/assignments/queries.ts
  - lib/validation/assignment.ts
  - lib/assignments/pipeline.ts
  - lib/topics/finalize.ts
  - app/api/assignments/[id]/route.ts
  - app/api/assignments/[id]/ai-message/route.ts
  - app/api/sundays/[id]/references/route.ts
  - components/sacrament/ReferenceSearchDialog.tsx
  - lib/sacrament/sundayAsks.ts
  - lib/todos/askSource.ts
  - lib/music/sundayTopics.ts
  - lib/program/gather.ts
  - app/(app)/assignments/AssignmentModal.tsx
  - app/(app)/assignments/[sunday_id]/page.tsx
  - testing/infrastructure/seedUtils.ts
related: [sacrament-topics-finalize-and-history, sacrament-references-over-pgvector]
---

## What was done
Sub-slice `t1` of the Topics screen rebuild (plans/sacrament-topics-screen-rebuild.md): a talk's
topic is now the words typed for it, in `assignments.topic_title` (migration 086, backfilled from the
library). Every reader switched off `topic_id` — the pipeline gate, the hub counts, the finalize
rule, the ask to-do embeds, the music card, the program and the AI confirmation draft — and the month
planner's topic `<select>` became a text input. `topics.last_assigned_at` is no longer stamped.

## Key decisions
- `topic_id`, `topics` and `topic_candidates` are kept for their data and simply no longer written or
  read; dropping them is a later, held-back migration.
- **A user-visible loss, deliberate:** the one-tap "Suggested for this topic" scripture picks in the
  References search window are gone — they came from the library's `suggested_scriptures`. The AI
  confirmation draft now takes its scriptures from the talk's own `scripture` references, which are
  what the planner actually chose (the read is bishopric-only, so anyone else gets none).
- Blank is stored as null in both the schema and the data layer, so "no topic" has one stored form and
  migration 086's CHECK is never what refuses it. `ProgramSources.topicTitles` was removed rather than
  kept empty — it existed only to resolve library ids.
- The harness seed helper copies a library topic's title onto the talk when a seed passes `topicId`,
  exactly as the backfill did, so ~20 older scenarios keep their topics without being edited.
- `tests/db/topic-last-assigned.test.ts` was **inverted, not deleted**, so the reversal reads as a
  decision. The backfill is checked against the live table (the `hymn-seed` pattern), because no test
  can run migration SQL.
- Proved able to fail: `topicShapeChanged` pointed back at `topicId` (4 red), the PATCH route's finalize
  guard removed (source test red), the write/length rules broken (3 red), the scripture filter removed
  (1 red).
