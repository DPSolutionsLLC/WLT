---
id: sacrament-topics-t3-the-screen
type: feature
iter: null
commits: ["d9dabf8"]
date: 2026-09-29
files:
  - app/(app)/assignments/[sunday_id]/page.tsx
  - components/sacrament/TalkRow.tsx
  - components/sacrament/SpeakerCountStepper.tsx
  - components/sacrament/TalkDetailsWindow.tsx
  - components/sacrament/SpeakerWindow.tsx
  - components/sacrament/TopicWindow.tsx
  - components/sacrament/ApprovalSafeSave.tsx
  - components/sacrament/TopicsFinalizedPanel.tsx
  - lib/sacrament/talkRowStatus.ts
  - lib/assignments/removeTalk.ts
  - lib/assignments/saveAssignment.ts
  - lib/assignments/invalidation.ts
  - supabase/migrations/087_remove_talk.sql
  - app/api/assignments/[id]/route.ts
related: [sacrament-topics-t2-topic-history, sacrament-topics-t1-topic-words, sacrament-topics-finalize-and-history, talks-b-month-planner]
---

## What was done
Sub-slice `t3` of the Topics screen rebuild: `/assignments/[sunday_id]` becomes the prototype's
"What still needs to happen" screen. It has a **Speakers this week** stepper, and one compact row per
slot whose speaker and topic lines each open their own window and carry their own tag. **Details**
opens a window holding slot length, approvals, contacting and comments. Finalize sits at the bottom,
with the prototype's wording. **Delete cancels a talk and shifts the rest up** through migration
087's `remove_talk()` (one transaction, `security invoker`, `talks.plan` + `calendar.manage`), then
runs the f2c reconcile so the people involved are told. Walked as scenario 083, twice.

## Key decisions
- **Declined is checked before "no speaker"**, the reverse of the prototype's order: WLT's decline
  clears the speaker, so the other order could never show "Declined".
- **The row tags read `loadSundayAsks()`**, the hub's own reader, so the page and the Talks pill
  cannot disagree. The Details panels are rendered on the server and passed in as nodes, so opening
  the window fetches nothing, and each row gets its speaker's name rather than the whole roster.
- **One save path and one warning.** `saveAssignment()` and `describeInvalidation()` moved out of
  `AssignmentModal` so the month planner, both windows and Clear share them. `ApprovalSafeSave`
  gives every edit the warn-first step, because any `update` clears every approval.
- **The Delete confirm names who will let the speaker know** (`whoLetsThemKnow()`), using f2c's
  rules: the holder of an open ask, else an accepted talk's last asker, else "You". A speaker
  who was never asked gets no sentence. The walk found the first wording ("Ana Silva will be told")
  overstated it: nobody is told automatically.
- **Walk defects, both fixed after the user's review:** D1, the stepper kept its own count after
  a Delete, so its Save would have put the removed slot back. It now follows the page's count during
  render (not in an effect), which keeps its own "make this the default" offer alive through the
  refresh its save causes. D2, the Clear warning said "Saving". 3,900+ tests could not see D1: every
  component test mounted once. Both regressions are now tests, and D1's was proved able to fail.
- A talk outside the Sunday's slots is only cancelled on Delete; nothing shifts. The audit action
  is `assignment_removed` (house style), carrying no name or topic. `SundaySlotList`'s component went
  with the old page, while `sundaySlotEntries()` and its test stay. `AssignmentEditButton.tsx`, the old page's Plan/Edit button, lost its only
  caller and was deleted with the user's agreement.
