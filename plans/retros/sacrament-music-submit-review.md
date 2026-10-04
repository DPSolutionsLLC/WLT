---
id: sacrament-music-submit-review
type: feature
iter: [ITER-038]
commits: []
date: 2026-10-04
files:
  - lib/music/musicCompletion.ts
  - lib/music/musicReview.ts
  - lib/music/musicCoordinators.ts
  - lib/todos/musicLinks.ts
  - lib/todos/queries.ts
  - lib/todos/logLines.ts
  - lib/sacrament/conductorHandover.ts
  - app/api/sundays/[id]/music/submit/route.ts
  - app/api/sundays/[id]/music/review/route.ts
  - app/api/sundays/[id]/music/route.ts
  - app/api/hymns/select/route.ts
  - app/api/musical-numbers/route.ts
  - app/api/todos/[id]/route.ts
  - app/(app)/music/SundayMusicCard.tsx
  - app/(app)/music/SubmitMusicButton.tsx
  - app/(app)/music/MusicReviewControls.tsx
  - app/(app)/music/page.tsx
  - app/(app)/todos/TodoCard.tsx
  - app/(app)/program/[sunday_id]/page.tsx
  - components/layout/ContextualBackLink.tsx
  - types/domain.ts
related:
  - sacrament-music-people
  - sacrament-finalize-hands-off-asks
  - sacrament-finalize-prayers
  - sacrament-f2c-cancelled-sunday-work
---

## What was done

ITER-038 slice `mb`. The music coordinator **submits** a Sunday's music once it is complete
(3 hymns, chorister, organist, and the musical number if there is one) and the topics are final.
The conductor gets "Review the music" on To Do. Any bishopric member except the submitter
**approves** it or **sends it back with a note**, which reopens the coordinator's "Choose the
music". Any later change to the music returns it to draft with a banner and closes the open
review. `/music` cards show `n/m picked` plus a workflow pill, and the programme page shows a soft
"Music not approved yet" line that blocks nothing.

## Key decisions

- **One status writer.** `lib/music/musicReview.ts` is the only code that writes
  `sunday_music.status`. The table has no write policy, so nothing can skip it.
  `tests/lib/musicReopenSites.test.ts` holds every music write route to `reopenMusicAfterWrite()`.
- **One completion rule.** `musicCompletionFor()` drives the pill and the Submit button, and the
  server re-checks it on submit and on approve.
- **Music to-dos close themselves.** They have no checkbox and can't be deleted while open: a
  ticked review would leave music waiting on a review nobody holds.
- **The conductor's review stays open after a send-back** (the user's answer walking scenario 087).
  Its timeline gets "Sent back: <note>", and the resubmission lands on that same to-do as "Music
  submitted for review". It first closed as "Marked complete", which said nothing.
- **Submit writes the to-dos first and the status last.** A half-finished run then leaves a Draft
  card with Submit still on it, and pressing again finishes the run.
- **The reconcile raises a music failure as `AskLinkWriteError`.** Its two callers already report
  that type with their own sentence.

## What to watch

- The hub's Music pill counts hymns out of 3, while the card counts everything out of 5 or 6
  (by plan). The two numbers can now differ.
- The full suite runs out of memory on this machine with several workers. Run it in chunks with
  `--maxWorkers=1`.
- During the walk, typing into the login form was unreliable through the Chrome extension.
  Setting the field values the way React expects (native value setter plus an input event) worked
  every time.
- Slice `mc` (finalizing topics tells the coordinator, plus the email preference) is still to build.
  Scenario 087 should gain its steps then.
