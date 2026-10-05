---
id: sacrament-music-topics-handoff
type: feature
iter: [ITER-038]
commits: []
date: 2026-10-04
files:
  - lib/music/topicsHandoff.ts
  - lib/email/musicEmails.ts
  - lib/notifications/musicEmailPreference.ts
  - app/api/sundays/[id]/topics-finalized/route.ts
  - app/api/session/music-email/route.ts
  - app/(app)/music/MusicEmailToggle.tsx
  - app/(app)/music/page.tsx
  - app/(app)/music/MusicReviewControls.tsx
  - app/api/sundays/[id]/music/review/route.ts
  - lib/music/musicReview.ts
  - lib/topics/finalize.ts
  - lib/calendar/queries.ts
  - lib/sacrament/conductorHandover.ts
  - lib/todos/musicLinks.ts
  - components/sacrament/FinalizeToggle.tsx
  - components/sacrament/FinalizeTopicsButton.tsx
  - components/sacrament/StatusPill.tsx
  - components/sacrament/SundayCard.tsx
related:
  - sacrament-music-submit-review
  - sacrament-music-people
  - sacrament-topics-finalize-and-history
  - sacrament-f2c-cancelled-sunday-work
---

## What was done

ITER-038 slice `mc`, the last of three. Finalizing a Sunday's topics now puts "Choose the music for
…" on every active music coordinator's To Do, with the topic titles (never a speaker) in its notes.
It also writes a notification row and emails anybody who ticked the new toggle on `/music`. The
Finalize control shows one line saying who was told. Un-finalizing topics, editing a talk's topic,
or turning the Sunday into Fast Sunday returns submitted music to draft as "Topics changed".
Finalizing again tells the coordinator the topics changed. A send-back now emails the submitter too.

## Key decisions

- **First handout, topics changed, or nothing — decided by the route's read BEFORE its write.** The
  plan's rule ("a completed choose to-do means the topics changed") misfired after an ordinary
  submit, which completes those to-dos, and missed a coordinator still mid-way. Never handed out →
  first handout; handed out and the stamp just moved → "Topics changed"; already finalized → nothing.
- **The finalize always stands.** A failed handoff or email is a sentence in the response (`music`),
  shown beside the control, never a 500 over a Sunday that was finalized. The retry sentence says
  "Undo and finalize again", because pressing a pressed checkmark un-finalizes.
- **Three places clear the topics stamp, and all three reopen the music.** The un-finalize route,
  `unfinalizeTopicsIfNeeded()` (`clearTalkShapeStamps()` now reports whether it cleared the topics
  stamp, so there is no extra read), and the reconcile for `cancelSundayWork()`. A source-reading
  test holds all three, and each was proved able to fail.
- **One toggle, two preference rows.** It is read as ON only when both rows are on. The in-app
  opt-out (`is_enabled`) is never touched. The toggle is shown only to a music coordinator.
- **A send-back's email problem shows in the send-back window.** Refreshing unmounts the review
  controls, so the refresh waits until the window closes.

## Gaps and limits

- Sundays finalized before this deploys get no to-do until someone undoes and re-finalizes them.
- `notification_user_prefs` is unique per (user, trigger), not per ward. A person whose row was
  written in another ward gets a 400 sentence here, not a save. Fixing that needs a migration.
- The in-app notification row has nowhere to show until P12's bell exists.
- Scenario 088 walked 2026-10-04 by an agent; the user answered all six judgement questions the same day.

## Walk (scenario 088, 2026-10-04)

Walked by Claude in Playwright: 11 of 11 steps, 0 app defects. The walk found a **harness** gap: the
test ward has no `notification_settings` unless a scenario calls `seedNotificationTriggers()`, so the
first run wrote the to-do but no notification row. The 088 seed now calls it; 087's seed still does not.

The user's one change from the walk: on the Sacrament hub the Finalize line squeezed the Topics pill,
so it now renders into a slot under the card's pill row (`FinalizeToggle`'s `resultSlotId`, a React
portal; with no slot it stays beside the control). The Topics screen panel is unchanged.
