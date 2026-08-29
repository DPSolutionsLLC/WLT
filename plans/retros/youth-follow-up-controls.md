---
id: youth-follow-up-controls
type: bugfix
iter: [ITER-021, ITER-022]
commits: [17032a9]
date: 2026-08-29
files:
  - lib/youth/activityOwnership.ts
  - app/(app)/youth/EventList.tsx
  - app/(app)/youth/FollowUpPanel.tsx
  - app/(app)/youth/FollowUpForm.tsx
  - app/(app)/youth/page.tsx
related:
  - youth-d-followup-and-report-feed
  - youth-a-profiles-and-events
  - youth-c-coverage-and-calendar
  - visits-d-attempts-appointments-and-participants
  - visits-a-goals-logs-and-notes
fixes: youth-d-followup-and-report-feed
---

## What was broken

Two defects found walking scenarios 055 and 056, both in the follow-up controls on `/youth`, both
invisible to a green suite.

**ITER-021.** *"Say how it went"* was offered on another organization's event. RLS held and the
route answered 403 with a sentence, so nothing leaked and nothing was written — the leader was
simply invited through a locked door. The **third** sighting of one shape (`visits-d` →
`youth-a`-D1 → here), inside the slice whose own plan quotes the lesson by name.

**ITER-022.** The follow-up form communicated by appearance alone: neither *"Did you go?"* button
carried `aria-pressed`, `aria-checked` or a role, so a screen reader heard two identical buttons and
could not tell which answer was stored. The fill of the primary variant was the only signal.

## Root cause

`EventList` gated the control on `canLog` — the `youth_activities.log` permission, which says
whether a leader may write follow-ups **at all** and never **which ones** — and on
`isFollowUpWritable()`, which is only the clock. Neither knows the event's organization.
`youth-d` applied the ownership mirror to the ward-council flag control and not to the follow-up
control beside it.

`FollowUpPanel` had the same defect and **is not named in ITER-021's scope file**. Because
`activity_attendees` writes are `is_bishopric() or user_id = auth.uid()`, any leader may add
themselves to any organization's event — which puts that event in *Waiting on your follow-up* with
a button the API refuses.

## What fixed it

1. **`canWriteFollowUpOn()`** in `lib/youth/activityOwnership.ts`, mirroring migration 057c's INSERT
   policy, applied at **both** call sites. Its null handling is the deliberate **inverse** of
   `canManageActivityProfile`'s — there a null `org_id` means nobody but the author or the
   bishopric; here it means everybody, because `activity_event_is_in_caller_org` carries an explicit
   `profile.org_id is null` arm. An inversion test asserts both functions together so a "unifying"
   refactor goes red with the reason attached.
2. **The policy is chosen by the action, not by the screen.** Creating is INSERT (057c: bishopric or
   owning organization); changing is UPDATE (058: the author or the bishopric, with **no**
   organization arm). Collapsing them breaks in both directions — the UPDATE rule on a new
   follow-up offers the button everywhere; the INSERT rule on an existing one hides *"Change what
   you wrote"* from a leader who has since moved organizations, which is the mirror mistake.
3. **`aria-pressed` on both buttons in every state**, plus a sentence that always names the stored
   answer. An attribute on one button and not the other is worse than neither.
4. **The private note became a section, not a third field** — a heading, extra space, and a
   different fill — with **no** warning colour, because `visits-a` deliberately moved the caution
   onto the *shared* field and `VisitLogForm` records that highlighting the private box read as an
   error state.
5. **The count follows the button** (found in review, after the first walk). The panel read
   *"Waiting on your follow-up (2)"* above one usable control, because `followUpState()` knows the
   clock and the reader's own rows but nothing about ownership. Non-writable events moved into their
   own group outside the count. The split happens once, so the heading and the lists cannot drift.
6. **The outline carries dark mode** (also found in review). `--surface` is *lighter* than the card
   in light and *darker* in dark, so one "slightly different fill" read as an inset panel in one
   theme and a hole in the other. The dashed border moved to `--muted/60` — a neutral at partial
   strength — rather than raising the fill, which would have made the private block louder than the
   shared one.

The API was **not** narrowed. The route's 403 is what keeps the refusal graceful, and it was
re-proved during the walk by posting straight at the endpoint: 403, and `activity_logs` unchanged.

## Pattern

**A control's permission and a control's scope are two questions, and a screen that asks only the
first will offer what the database refuses.** Recorded three times before it was closed. What
finally closed it was not the record but a **pure, table-tested function** the screen must call —
`canWriteFollowUpOn` beside `canManageActivityProfile` and `canManageActivityLog`, all three
mirroring a named policy, none of them re-derived at a call site.

Two second-order lessons worth as much:

- **Fix every instance, not the one that was found.** `FollowUpPanel` was not in the scope file and
  had the same bug; fixing `EventList` alone would have shipped the shape a fourth time in the
  change that existed to close it. The plan's Task 3 existed only because the pitfall list said to
  grep for every place the control is offered.
- **A gate can make a count lie.** Removing a control without revisiting the number beside it left
  the screen promising two actions and offering one. Whenever a gate hides something, ask what was
  counting it.
