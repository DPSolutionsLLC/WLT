---
id: sacrament-f2c-cancelled-sunday-work
type: feature
iter: null
commits: ["5274304"]
date: 2026-09-26
files:
  - supabase/migrations/085_cancelled_sunday_work.sql
  - lib/calendar/queries.ts
  - lib/sacrament/conductorHandover.ts
  - lib/todos/askLinks.ts
  - lib/assignments/queries.ts
  - lib/assignments/reliabilityFlags.ts
  - lib/prayers/queries.ts
  - lib/music/queries.ts
  - lib/topics/queries.ts
  - app/api/sundays/[id]/route.ts
  - app/api/todos/[id]/answer/route.ts
  - app/api/assignments/[id]/route.ts
  - app/api/assignments/[id]/approve/route.ts
  - app/(app)/calendar/sunday/[id]/SundayEditor.tsx
related: [sacrament-f2b-talk-is-off, sacrament-f2-asks-follow-the-conductor, calendar-a-rules-and-api, talks-a-pipeline-core, talks-d-reliability-goals, talks-c-prayers-topics]
---

*Written 2026-09-30, after the fact, from the commit, `plans/sacrament-cancelled-sunday-work.md`
and scenario 081's walk record.*

## What was done
P4 Sacrament slice `f2c`. It **reverses** "reverted to plan, never deleted" (`03-calendar.md`
Pitfall 5, `04-talks-pipeline.md`), and the reversal is recorded in CLAUDE.md §9. A Sunday can
stop holding sacrament meeting, become Fast Sunday, or have a slot cut. When that happens, the
lost talks are stamped `cancelled_at` + `cancelled_reason` instead of being sent back to planning
with their speaker. If the meeting itself goes, so are its prayers, hymn choices and musical
number, and the Sunday's topics and references decisions are cleared. **Nothing is deleted.**
Every reader skips a cancelled row, so the Sunday reads as empty and planning starts over. The
save-time reconcile tells people: speaker history `cancelled` with a null notice, and a "Let ___
know it's cancelled" to-do closed with **Told them**. Walked as scenario 081.

## Key decisions
- **A timestamp and reason pair, not a pipeline stage.** A stage says where a talk *is*;
  cancellation says that it *stopped*, from whatever stage it had reached. The same pair goes on
  `prayer_assignments`, `hymn_selections` and `musical_numbers`.
- **Readers filter at the query layer, not in each screen.** `listAssignments` filters by default
  and takes `includeCancelled`. `tests/lib/cancelledReaders.test.ts` reads the source and fails on
  a reader that forgets. `getAssignment`, `getPrayer` and the speaker-history context read
  cancelled rows on purpose and are named exemptions.
- **Who is told:**
  - a talk or an asked prayer: the person who asked them;
  - a musical number: the person making the change, because `performer` is free text and nothing
    records who arranged it;
  - a hymn: nobody, because there is no person to tell.
  Told them is gated on `personal_tools.use`, not a talk permission. A ward secretary who cancels
  a meeting holds the musical-number to-do and no talk permission.
- **The people side lives in the reconcile, not in `cancelSundayWork()`**, because `lib/calendar`
  must not import the talks or to-do modules (they import it). The reconcile asks of the *state*:
  has this cancelled item ever had a to-do, and does this talk have a `cancelled` history row? A
  retry therefore finishes a half-done run, and Told them can never bring a to-do back.
- **A cancelled talk's speaker history has a null notice, so it never trips `late_canceller`**,
  which is for a speaker who backs out. It counts as neither spoken nor "asked recently" (C7).
- **Prayers and music now BLOCK the confirm when the meeting is lost**, reversing calendar-a
  Decision 4 for that case: they are cancelled now, and that work was somebody's.
- **The notification keeps its trigger key `assignment_reverted`**, so nobody's opt-out moves. Only
  its wording changed.
- **`apply_fast_sunday` no longer touches talks** (migration 085 redefines it). The known gap it
  leaves is written into CLAUDE.md §9: generation can move Fast Sunday onto talks without
  cancelling them, and they read as off until that Sunday's next save.
- Every walk check passed. The f2b route test was rewritten in place, because its scenario became
  this slice's scenario.
