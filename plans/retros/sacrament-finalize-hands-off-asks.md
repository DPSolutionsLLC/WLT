---
id: sacrament-finalize-hands-off-asks
type: feature
iter: [ITER-036]
commits: []
date: 2026-09-30
files:
  - supabase/migrations/088_finalize_speakers_prayers.sql
  - lib/sacrament/finalizePeople.ts
  - lib/sacrament/askImpact.ts
  - lib/sacrament/talkAsks.ts
  - lib/sacrament/sundayAsks.ts
  - lib/todos/askLinks.ts
  - lib/todos/askSource.ts
  - lib/calendar/queries.ts
  - app/api/sundays/[id]/speakers-finalized/route.ts
  - app/api/sundays/[id]/asks/route.ts
  - app/api/assignments/[id]/route.ts
  - app/api/assignments/route.ts
  - components/sacrament/TalkAsksCheck.tsx
  - components/sacrament/FinalizeSpeakersDialog.tsx
  - components/sacrament/SpeakersFinalizedPanel.tsx
  - components/sacrament/ApprovalSafeSave.tsx
  - components/sacrament/TalkRow.tsx
  - app/(app)/assignments/AssignmentModal.tsx
  - app/(app)/todos/AskDetails.tsx
related:
  - sacrament-f1-send-asks-and-answers
  - sacrament-f2-asks-follow-the-conductor
  - sacrament-f2c-cancelled-sunday-work
  - sacrament-f3a-time-elsewhere
  - sacrament-topics-finalize-and-history
---

## What was done
ITER-036 sub-slice `fa`. The user picked topics and speakers on the live site and nothing reached
To Do, because asks came only from a small "Send asks" button gated on References. Now
**finalizing the speakers** (migration 088, `sundays.speakers_finalized_at`) is what puts one "Ask ___
to speak" per speaker not yet asked on the **conductor's** To Do. The control is a check attached to
the Talks pill on the hub, plus a panel on the Topics screen. Its confirm names whose To Do the asks
go to. References no longer gate it: the ask card reads the talk's references live. Changing a
speaker un-finalizes the speakers and withdraws the old person's ask. Every surface that would affect
a scheduled or accepted person warns first, naming them. Scenario 085 was tested by the user.
`fb` (prayers) is still to come and uses 088's `prayers_finalized_at`.

## Key decisions
- **Withdraw is three-way** (`withdrawAsks()`): an untouched ask is deleted, a touched one is closed
  with a line, a scheduled one stays. "Touched" counts only lines the **owner** wrote, so a
  handover's "Taken over from" line does not protect an ask its owner never opened.
- **A scheduled ask is UNLINKED on a speaker change** (the user's decision during execution). The
  plan kept it open on the talk, but migration 083b's one-open-ask-per-(talk, owner) index would then
  have stopped the new speaker ever being asked, silently (23505 counts as "already done"). Unlinked,
  it stays on To Do and My Appointments as an ordinary to-do with its time. On an un-finalize it stays
  linked: the speaker is the same person.
- **A decline never un-finalizes**, even though it clears the speaker. `speakersFinalizeSites.test.ts`
  reads the source to hold that, and it was proved able to fail in both directions.
- **"Pressed" means finalized AND nobody left to ask** (`speakersSettled()`). A stamp with speakers
  still to ask is a half-run, or a stamp a speaker change failed to clear, so pressing again asks
  them rather than un-finalizing over their heads.
- **The D4 warnings are built on the server** (`loadChangeWarnings()`), because the appointment time
  must be in the ward's zone (rule 12). They say "Peter Nakamura has…" when the reader is not the
  holder, and use no pronoun. They reach the Topics screen's windows and Clear buttons, and the month
  planner's modal through `GET /api/assignments`.
- **Deleting a talk does not un-finalize** — a departure from the plan. It introduces nobody new to
  ask, and the f2c reconcile already tells the removed speaker.
