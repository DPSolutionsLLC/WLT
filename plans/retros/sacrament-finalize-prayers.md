---
id: sacrament-finalize-prayers
type: feature
iter: [ITER-036]
commits: []
date: 2026-10-01
files:
  - lib/prayers/prayerAsks.ts
  - lib/prayers/prayerOutcome.ts
  - lib/prayers/queries.ts
  - lib/sacrament/finalizePeople.ts
  - lib/sacrament/conductorHandover.ts
  - lib/sacrament/askImpact.ts
  - lib/todos/askLinks.ts
  - lib/todos/askSource.ts
  - lib/todos/queries.ts
  - lib/todos/logLines.ts
  - lib/appointments/queries.ts
  - lib/validation/talkAsk.ts
  - types/domain.ts
  - app/api/sundays/[id]/prayers-finalized/route.ts
  - app/api/prayers/route.ts
  - app/api/prayers/[id]/route.ts
  - app/api/todos/[id]/answer/route.ts
  - app/(app)/prayers/PrayerBoard.tsx
  - app/(app)/prayers/PrayersFinalizeButton.tsx
  - app/(app)/prayers/page.tsx
  - app/(app)/sacrament/page.tsx
  - app/(app)/todos/AskDetails.tsx
  - app/(app)/todos/TodoCard.tsx
  - app/(app)/appointments/AppointmentList.tsx
  - components/sacrament/FinalizeSpeakersDialog.tsx
  - components/sacrament/TalkAsksCheck.tsx
  - components/sacrament/SundayCard.tsx
related:
  - sacrament-finalize-hands-off-asks
  - sacrament-f2c-cancelled-sunday-work
  - sacrament-f2-asks-follow-the-conductor
  - sacrament-f1-send-asks-and-answers
---

## What was done
ITER-036 sub-slice `fb`, the second half of plans/sacrament-finalize-hands-off-asks.md. **Finalizing a
Sunday's prayers** (migration 088's `prayers_finalized_at`, no migration of its own) puts "Ask ___ to
give the opening prayer" (or closing) per prayer not yet asked on the **conductor's** To Do, linked on
`todos.ask_prayer_id`. The control is a check on the hub's Prayer pill and, by the user's choice, a
**Finalize prayers** button on each Sunday of the Prayers board. Accepted moves the prayer to
Confirmed; Declined frees it with no reason. A change of person un-finalizes and withdraws the old
ask by `fa`'s three-way rule. Prayer asks follow the conductor and are told about a cancellation.
Scenario 086 is written, not yet walked.

## Key decisions
- **One function records a prayer's answer** (`lib/prayers/prayerOutcome.ts`). Accepted walks
  `assign → ask → confirm` through `canTransitionPrayer()`, so `asked_by` is the ask's owner and no
  gate is skipped; Declined is `setPrayerMember(null)`. A prayer keeps no decline history, so the
  decline reason moved out of `answerAskSchema` into the answer route, which still requires one for a
  **talk**.
- **A board move to Confirmed or Done is an answer** (the user's decision): the open ask closes as
  Accepted, so nobody asks twice. A move to Asked is not, and leaves it open.
- **A change of person starts the prayer over at `assign`** — reversing `upsertPrayer`'s "an
  existing row keeps whatever stage it has". Found while building, not in the plan: a new person left
  at Confirmed read as having said yes, and `prayerNeedsAsk()` (stage `assign`) would never ask them.
  It is the prayer twin of a speaker change clearing the talk's outcome. Re-saving the same person
  changes nothing.
- **`listToldPrayerIds()` counts only stamped rows.** It counted every to-do linked to a prayer,
  which was harmless while only "let them know" to-dos used `ask_prayer_id`; once asks share the
  column, every prayer anybody was ever asked to give read as "already told". The route test that
  covers it was proved able to fail with the old flag.
- **An open ask on a cancelled prayer is marked, never doubled.** The reconcile stamps it
  `talk_off_at`, like a talk's, and then skips the "tell whoever asked" branch for that prayer, which
  would otherwise add a second to-do when the prayer had been moved to Asked on the board.
- **The confirm and the hub check were generalized, not copied** — `FinalizeSpeakersDialog` and
  `TalkAsksCheck` take a required `kind`. Their file names still say "Speakers"/"Talk"; renaming
  needs the user's permission.
- **`TodoAskSource` became a union** (`kind: "talk" | "prayer"`), so the compiler listed every
  reader that assumed a talk. A cancelled prayer's existing "let them know" to-do now shows its
  prayer and contact line too, where it showed only the Cancelled marker.
- **The change-of-person timeline line is neutral** ("Somebody else was chosen — this ask is no
  longer needed"), by the user's choice, so old talk to-dos read the new wording as well; no new log
  kind and no migration.

## What to watch
- A decline leaves no mark on a prayer: the Prayer pill has no "declined" state, only its count
  dropping (2/2 → 1/2). If a walk finds that too quiet, the fix is a prayer outcome column, which is
  a migration.
