---
id: sunday-types-meeting-split
type: feature
iter: [ITER-002, ITER-003]
commits: ["39f1f61"]
date: 2026-08-22
files:
  - types/domain.ts
  - supabase/migrations/027_sunday_meeting_types.sql
  - lib/calendar/meetingSeries.ts
  - lib/calendar/resolveConductingUser.ts
  - lib/calendar/generateSundays.ts
  - lib/calendar/queries.ts
  - app/api/sundays/[id]/route.ts
  - app/api/sundays/[id]/org-conducting/route.ts
  - components/calendar/ConductingLabel.tsx
  - components/calendar/SundayTypeBadge.tsx
  - app/(app)/calendar/sunday/[id]/OrgConductingEditor.tsx
related: [calendar-a-rules-and-api, calendar-b-month-view, calendar-c-rotation-cadence, role-access-overrides, roster-b-picker-and-orgs]
---

## What was done

Split `FAST_SUNDAY_DISPLACING_TYPES`, which had been answering two different questions with one
list — "this Sunday cannot BE Fast Sunday" and "this Sunday holds no sacrament meeting" — into two
named lists plus a `holdsSacramentMeeting()` predicate. Added `ward_conference` as a real Sunday
type, which is the first type that cannot be Fast Sunday while still holding an ordinary meeting.
Made the conducting rotation skip Sundays that hold no meeting, for both cadences, and made that
skip apply forward to already-generated months behind the existing confirm dialog.

## Key decisions

- **A CHECK constraint, not a convention.** `sundays_no_conductor_without_meeting` makes "a
  conductor on a Sunday with no meeting" unrepresentable, with a backfill in the same migration.
  The consequence is that `updateSunday()` must clear `conducting_user_id` in the *same* UPDATE
  that changes the type — a loud failure rather than a silent wrong answer.
- **`sunday_org_conducting` is guarded in TypeScript, not SQL, on purpose.** A constraint there
  cannot see the Sunday's type, so it would need a trigger, and this repo has no triggers at all.
  The rule lives in `lib/calendar/queries.ts` and in a **409** from the org-conducting route — not
  a 403, because the caller's permissions are fine and the Sunday's state is what refuses. The
  asymmetry is documented in the migration so the next reader does not think it was forgotten.
- **The meeting series predicts un-generated months rather than walking stored rows.** Months are
  generated on demand, so gaps are routine. A stored-rows-only walk would count a gap as zero
  cancellations and then *store* the wrong conductor. The prediction is exactly right because an
  un-generated month cannot hold a hand-set stake conference — the only cancellation possible
  there is general conference, which is predictable from the date. A stored row always wins.
- **`resolveConductingUser()`'s new parameter is required, not defaulted.** The compiler produced
  the worklist, which is the lesson `role-access-overrides` paid for: a defaulted parameter is how
  25 call sites came to silently ignore the ward's configuration.
- **Monthly cadence skips only a wholly dead month.** One cancelled Sunday inside a month changes
  nothing, because one person already holds the whole month. Expressed as one walk with two
  projections — count Sundays for weekly, count months containing a Sunday for monthly — so there
  is one rule rather than two to keep in step.

## Known gaps, accepted

- **A re-shift can overwrite a per-Sunday conducting override.** Storage *is* the override; there
  is no `is_override` flag (migration 024), so nothing distinguishes a conductor a human typed from
  one the rotation assigned. Mitigated by warning first with an exact count and writing nothing
  until confirmed, and by never rewriting the past. The fix is a `conducting_source` column and is
  deliberately not in this change.
- **A hand-set speaking-slot count still does not survive a round trip** through Fast Sunday or a
  cancellation. Inherited from `apply_fast_sunday()` and documented there since migration 023.

## Found while building

- **The whole test suite patched a narrower shape than the real form sends, and shipped a broken
  save.** Every DB and route test called `updateSunday()` with `{ type }` alone. `SundayEditor`
  submits the WHOLE form on every save, so a real type change arrives with `conductingUserId` still
  set to whoever the dropdown was showing. The UPDATE object spread `input.conductingUserId` AFTER
  the no-meeting clear, so the form's value silently overwrote the `null` and every confirm hit
  migration 027's CHECK — the constraint doing exactly its job, catching a bug 1098 green tests had
  not. Fixed by deciding `conducting_user_id` ONCE, with the no-meeting rule outranking the
  submitted value: a Sunday that holds no sacrament meeting has no conductor, whatever the form was
  showing. **The lesson is about test inputs, not about spread order** — a suite that only ever
  sends minimal patches cannot see a field-interaction bug, and the fix was verified by
  re-introducing the bug and watching the new test fail.

- **`apply_fast_sunday()` cannot restore slots when the type changes in the same statement.** It
  matches rows still typed `fast_sunday` (migration 023, Step 1), so a Sunday going
  `fast_sunday → ward_conference` kept 0 speaking slots forever. This was a **latent pre-existing
  bug** — reachable through `special` since Phase 3A and simply never exercised — that ITER-003
  made visible, because a ward conference on the first Sunday of a month is exactly that
  transition. Fixed in `updateSunday()`'s single slot-deciding expression rather than in the SQL,
  since that is where the type change is now known.
- **Two existing tests encoded the conflated list and had to change.** `fast-sunday-collision`
  used `holiday` as its vehicle for "this cancels a meeting" — true only while one list answered
  both questions — so the vehicle became `stake_conference` and the intent (a `ward_secretary` sees
  the same warning a bishop does) was preserved exactly. `calendar-generation`'s repair test pinned
  a neighbour's conductor to a value captured before an earlier test in the same file cancelled a
  whole month; the rotation now legitimately resolves differently, so the assertion narrowed to the
  fill-nulls-only guarantee it was actually about.
- **`ensureMonthGenerated()`'s repair test had to be narrowed.** A cancelled Sunday's conductor is
  now legitimately null forever, so the un-narrowed `some(conductingUserId === null)` test would
  have re-run two write passes on every page view of every month containing general conference —
  twice a year, permanently. Exactly the class of bug `calendar-c`'s retro is about.
- **A checklist item asserted behaviour that contradicts the forward-only rule — twice warned,
  still made.** Scenario 015's step 9 said switching the rotation to monthly would make one name
  cover an ALREADY-SEEDED November. It cannot: `replaceConductingRotation()` only inserts rotation
  rows, `conducting_user_id` is stored and never recomputed, and `populateConducting()` fills nulls
  only — so a rotation change never rewrites a month that is already generated. Scenario 011 had
  recorded exactly this, and the plan quoted the `calendar-b` pitfall verbatim ("a checklist item
  asserting behaviour nobody traced through the data layer is a guess"). The type-change path was
  traced; the cadence path was not. Step 9 now switches the cadence effective 2028-01-01 and reads
  January 2028, which has no rows and is generated fresh under the new cadence — and the mechanism
  is now pinned by a real end-to-end test (`conducting-reshift.test.ts`, monthly describe) rather
  than by a checklist claim.
- **This change made two edit paths differ, which is worth knowing about.** A *type* change now
  re-resolves later Sundays via the forward re-shift; a *rotation* change still does not. Both are
  deliberate, but a bishopric who switches to monthly and sees nothing change has hit the second
  one. Recorded in scenario 015's Known limitations; closing that gap is separate work.
- **The harness notification-trigger list had drifted from the SQL seed.**
  `supabase/seed/notification_triggers.sql` has carried `assignment_reverted` since migration 025;
  `testing/infrastructure/seedUtils.ts` never did. Every harness ward therefore dropped that
  notification and logged "Unknown notification trigger". Pre-existing, and invisible until
  scenario 015 became the first walkthrough to confirm a cancellation. The two lists are now
  diffed and equal.
- **November 2027 has four Sundays, not five.** The plan's scenario sketch said five; the calendar
  disagreed. Scenario 015 is written against four, and the checklist still demonstrates the skip
  because the 3rd Sunday is cancelled and the 4th holds the name it would have had.
