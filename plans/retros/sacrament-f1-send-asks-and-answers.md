---
id: sacrament-f1-send-asks-and-answers
type: feature
iter: null
commits: ["5eacb3b"]
date: 2026-09-26
files:
  - supabase/migrations/083_talk_asks.sql
  - lib/todos/askLinks.ts
  - lib/todos/askSource.ts
  - lib/sacrament/talkAsks.ts
  - lib/sacrament/sundayAsks.ts
  - lib/assignments/requestOutcome.ts
  - lib/assignments/historyOutcome.ts
  - app/api/sundays/[id]/asks/route.ts
  - app/api/todos/[id]/answer/route.ts
  - app/api/assignments/[id]/route.ts
  - app/(app)/todos/TodoCard.tsx
  - app/(app)/todos/AskAnswerDialog.tsx
  - app/(app)/todos/AskDetails.tsx
  - app/(app)/appointments/AppointmentList.tsx
  - components/sacrament/TalkAsksCheck.tsx
  - components/sacrament/StatusPill.tsx
related: [p5-a-todo-core, p5-b-agenda-link-two-keys, p5-c-schedule-and-my-appointments, sacrament-topics-finalize-and-history, talks-a-pipeline-core]
---

*Written 2026-09-30, after the fact, from the commit, the plan
(`plans/sacrament-talk-asks-conductor-and-assistant.md`) and scenario 078's walk record.*

## What was done
P4 Sacrament slice `f1`. **Send asks** puts one "Ask ___ to speak" to-do per speaker on the
**conductor's** list (U1). Each ask is answered on the to-do itself: **Accepted**, or **Declined**
with a reason and an optional note. The answer is recorded on the talk through one shared
function (`requestOutcome.ts`), so a decline reopens the slot and reaches speaker history (U7).
The Sunday card's Talks pill gains four computed states: to ask, asks sent, all accepted, and
needs a new speaker. Migration 083 adds the ask link, the outcome columns, and every log kind
that f2 and f3 would need. Walked as scenario 078.

## Key decisions
- **"Not yet asked" is computed, never stored.** A talk needs an ask when it has a speaker, no
  open ask, and no recorded outcome. There is no `talks_finalized_at`. The gate is References
  decided (finalized *or* skipped), and **no conductor means no asks** (400 with a sentence).
- **An open ask cannot be ticked or deleted.** Accepted / Declined replace the checkbox. ✕ answers
  **409** with "Record their answer instead…", and nothing is audited for the refusal. Once
  answered, the ask deletes like any other to-do.
- **Another person's to-do is written only by the service role, behind the route's own check.**
  That is p5-b's rule, and `askLinks.ts` is its second instance. The audit detail carries ids
  only, never a title, phone or note.
- **Visitors are asked too**, marked "Not on the roster — no contact on file" (U8). Their answer
  lands on the talk but not in speaker history, which holds members only.
- **The ask card reads the topic and contact live from the talk**, not from a copy in the notes.
  Schedule pre-fills **With**, and My Appointments carries Accepted / Declined, so the answer can
  be recorded at the meeting itself.
- **Walk defects, both fixed:**
  - **078-D1.** Send asks re-enabled itself for about 1.5s between the POST returning and
    `router.refresh()` landing. The refresh now runs in a transition, and the button stays
    "Sending…" until it lands.
  - **078-D2.** A speaker change cleared the outcome but kept `request_notes`, so the previous
    speaker's decline note sat on the new speaker's talk. By the user's decision, both are now
    cleared together.
- **Layout rework from the user's review:** every to-do's Schedule / Edit / ✕ moved to a row under
  the text. At 375px an ask's title had been squeezed to 102px across three lines.
