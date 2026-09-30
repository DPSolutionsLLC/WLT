---
id: sacrament-f2b-talk-is-off
type: feature
iter: null
commits: ["cad9b67"]
date: 2026-09-26
files:
  - supabase/migrations/084_talk_ask_notices.sql
  - lib/sacrament/conductorHandover.ts
  - lib/sacrament/askWarnings.ts
  - lib/sacrament/talkAsks.ts
  - lib/todos/askLinks.ts
  - lib/todos/askSource.ts
  - lib/calendar/queries.ts
  - app/api/sundays/[id]/route.ts
  - app/api/todos/[id]/answer/route.ts
  - app/(app)/todos/TodoCard.tsx
  - app/(app)/todos/AskDetails.tsx
related: [sacrament-f2-asks-follow-the-conductor, sacrament-f1-send-asks-and-answers]
---

*Written 2026-09-30, after the fact, from the commit, the plan's f2b section and scenario 080's
walk record. Part of this slice was superseded the same day by `sacrament-f2c-cancelled-sunday-work`.*

## What was done
P4 Sacrament slice `f2b`, built from the user's answers to walking scenario 079. A talk is **off**
when its Sunday holds no meeting or its slot is gone. `talkIsOff()` computes this and it is never
stored. The save-time reconcile marks each open ask on such a talk (`todos.talk_off_at`) and keeps
it with its owner. The ask then shows **No talk any more** with **Told them** in place of
Accepted / Declined. A speaker who had already accepted gets a "Let ___ know there's no talk"
to-do, owned by their last asker. The calendar's warning now names who was asked and who will tell
them, and a handed-over copy says "Taken over from ___". Migration 084 is additive. Walked as
scenario 080.

## Key decisions
- **Off asks stay with their owner and are never handed over.** The person who asked is the person
  who has to say it is off.
- **The route reconciles the whole month when a save re-resolves Fast Sunday**, because a Fast
  Sunday can move onto a *different* Sunday than the one edited. It also reconciles every
  re-shifted Sunday.
- **`TalkAskInput.isOff` is required**, so every Send asks path had to say whether a talk is off.
  None can offer one.
- **The calendar module still reads no to-dos.** `CalendarChangeWarning` carries
  `atRiskAssignmentIds` and `conductorReshifts`, and the route appends
  `describeAskConsequences()`'s sentences. The dependency stays one-way.
- **Retired by f2c:** the "back on" rule. When a talk came back on, it closed what was left and
  cleared the answers so everyone would be asked from scratch, and Told them cleared the talk's
  answer. f2c released the work outright, so nothing is left to come back. `talk_back_on` stays
  admitted by the CHECK constraint, documented as unused, because dropping an enum value is a
  riskier migration than leaving it.
- **Found while building, not by the walk:** scenario 079's route test had asked speakers on a
  **Fast Sunday**, which has no speaking slots. It passed only because nothing yet knew such a talk
  was off. The test was moved to an ordinary Sunday.
