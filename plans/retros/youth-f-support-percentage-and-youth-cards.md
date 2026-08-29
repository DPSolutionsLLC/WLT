---
id: youth-f-support-percentage-and-youth-cards
type: feature
iter: null
commits: [3a33109]
date: 2026-08-29
files:
  - lib/youth/profileNeed.ts
  - app/(app)/youth/YouthOverview.tsx
  - app/(app)/youth/EventList.tsx
  - app/(app)/youth/FollowUpForm.tsx
  - app/(app)/youth/page.tsx
  - app/api/youth/logs/route.ts
  - app/api/youth/logs/[id]/route.ts
related:
  - youth-e-overview-and-cross-navigation
  - youth-c-coverage-and-calendar
  - youth-d-followup-and-report-feed
  - visits-f-stewardship-and-all-orgs
  - youth-follow-up-controls
---

## What was done

`/youth` listed **one card per activity profile**, so Ethan doing basketball and track rendered as
two cards — `youth_activity_profiles` has no uniqueness on the member. A card is now a **young
person**, with one pill per activity carrying a **support percentage**, and the three need-rankings
collapsed to two sorts (`priority`, `name`) with a direction toggle.

The metric also required a write-path fix: a leader who turned up without signing up could not
record that they went, so the app reported neglect that did not happen.

## Key decisions

- **The horizon is every past home game PLUS the next one** — not the whole season. Set by the user
  mid-review after seeing the first version. Counting the whole remaining season would let an
  imported fixture list drag every percentage down for a reason nobody did anything about; counting
  only the past would make the number **unmovable**, since no action a leader could take today would
  change it. The next event is therefore judged on whether anybody is **signed up**, not on confirmed
  attendance — nobody can confirm a game not yet played — so one metric asks two different questions
  of the same column, on purpose, and `describeActivitySupport()` names the two halves in separate
  clauses rather than reporting one blended fraction.
- **Confirmed attendance only, home games only.** `confirmed_attendance` is `boolean | null` and
  carries three meanings; only `true` is support on a played game. Home-only reuses
  `isExpectedPast()` rather than restating it — factored to `carriesCoverageExpectation()` so the
  past half and the next-event half cannot drift.
- **A null percentage sorts LAST in both directions**, which is the deliberate **opposite** of the
  sort it replaced. `nobody_all_season` sorted `lastAttendedOn: null` *first*, because there null
  meant "nobody has ever been" — a real signal. Here null means nothing has been played and nothing
  is coming up, which is no data at all, so `VisitProgressTable.compareNullable()`'s rule applies
  instead. The two rules look identical and are opposite; both directions are asserted explicitly.
- **"Did you go?" is asked of everybody, reversing youth-d.** That slice hid the control without an
  attendee row because there was "no such question to answer"; a metric counting confirmed attendance
  created one. Answering "I went" now creates the row with `assignedBy: null` — null means they added
  themselves, and stamping it would be the `talks-d` hole a fourth time. **Only on `true`**: a row
  created to record an absence would put somebody on the list the coverage badge counts.

## Pattern

**A gate removed without revisiting the number beside it, and a number whose meaning was set by a
sentence nobody re-read.** The first version shipped a defensible metric — "the whole season" — that
the user only recognised as wrong once it was on screen with real names against it. The arithmetic
was right and the *question it answered* was not, which no test could have caught.

The general form, now seen three times in this module: **the number, the sentence on the card and
the sort must be one computed value** (`summariseCoverage`, `describeHouseholdForVisits`, ITER-022,
and the `Covered · 0` defect youth-e's walk found). `youth-f` adds the corollary — **the horizon of
a metric is a product decision, not an implementation detail**, and it belongs in front of a person
before the tests are written around it.

## What the walk found

**No defects.** 33 checks were settled against the hosted database with the service client rather
than read off the screen, including both write paths (the created attendee row, and the refusal that
must create nothing) and the assertion the slice turns on — reversing the sort direction leaves the
three no-data young people last.

Of seven judgement questions put to the user, four were approved, one was unanswerable because it
bundled two questions, and **two changed the work**: the horizon above, and closing out a season
(now ITER-028, which reverses the standing "no season boundary is introduced" decision).

## What was asked for and is NOT built

- **Closing out a season** — ITER-028. Needs schema, a read path, and at least one new page.
- **A trigger for "Did you go?"** rather than a blanket ask. The trigger the user named — a leader
  with their own youth at the same event — is **not computable**: `users` and `members` are unrelated
  rows (no `users.member_id`), and an event belongs to exactly one profile until ITER-024's occasion
  link exists. Kept as an interim by explicit decision, recorded in CLAUDE.md §9 so it does not
  quietly become the destination.
