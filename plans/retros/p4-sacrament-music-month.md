---
id: p4-sacrament-music-month
type: bugfix
iter: null
commits: ["06910f8"]
date: 2026-09-23
files:
  - app/(app)/music/page.tsx
  - app/(app)/music/SundayMusicCard.tsx
  - lib/sacrament/sundayStatus.ts
  - app/(app)/sacrament/page.tsx
related:
  - p4-sacrament-a-hub-and-reskin
  - talks-c-prayers-topics
  - program-e-music-and-hymns
  - calendar-b-month-view
  - roster-b-picker-and-orgs
  - ai-b-knowledge-and-retrieval
fixes: p4-sacrament-a-hub-and-reskin
---

## What was broken

Defect **072-D1**. The Sacrament hub deep-links a `Music n/3` pill into `/music`, but `/music`
was a rolling six-Sunday horizon from today with no date parameter at all (`HORIZON_SUNDAYS`).
A pill reporting real, correct work on a Sunday more than ~6 weeks out landed on a page reading
*"The next 0 Sundays that hold a sacrament meeting"* and *"There are no sacrament meetings on the
calendar yet."* That is the exact failure the hub was built to prevent — a pill's count must match
the page behind it — and it is structural rather than an artifact of a far-future seed: ~6 weeks
is precisely the horizon a bishopric plans at.

## Root cause

`/music` was built in `program-e` as a standalone destination a coordinator opened from the
sidebar, where "the next few Sundays" is the right default and a date parameter would have had no
caller. `p4-sacrament-a` then gave it an owner that knows which Sunday the reader wants. The hub's
own `hrefsFor()` reasoned carefully about the *wrong* half of the problem — it invoked `roster-b`'s
rule against sending a parameter the destination silently ignores, and concluded it should send
nothing — while missing that the destination could not show the requested date **by any means**.
A correct refusal to send a parameter, guarding a page that could not honour one either way.

## What fixed it

1. **`/music` is a month board**, exactly like `/prayers`, `/assignments`, `/calendar` and
   `/sacrament`: `?month=YYYY-MM`, `MonthNavigation`, a `Music — August 2027` heading.
   `HORIZON_SUNDAYS`, its doubled-window widening and the `.slice()` are deleted. `parseMonthParam`
   is the whole boundary, so `?month=banana` is the current month and never a crash.
2. **Two empty states, because a month has two ways to be empty.** The horizon had one, and its
   sentence is *wrong* for the second: a month whose every Sunday is a stake conference IS on the
   calendar, so telling the reader to add it is a lie. `sundays.length === 0` keeps the sentence
   `/prayers` and `/sacrament` already share, verbatim; `meetingSundays.length === 0` states a fact
   and offers no action, because there is no action to offer.
3. **`sundayPillHrefs()` moved out of the hub page into `lib/sacrament/sundayStatus.ts`**, so the
   href rule is testable rather than private to a Server Component. Music now carries the Sunday's
   own month plus `#sunday-<id>` — the shape Prayer already used — and `SundayMusicCard` carries
   the matching `id` on its root `Card`, which `CardProps` already supported.
4. **The count under the heading is `meetingSundays.length`, not `sundays.length`** — a deliberate
   departure from the two sibling pages, which count every Sunday. This page renders only the
   Sundays that hold a meeting, so counting the others prints a number that disagrees with the list
   directly beneath it (ITER-022 exactly).
5. Scenario 072's 072-D1 is marked FIXED with its original text kept, the ⚠️ block is replaced by
   two plain checks, and scenario 036's steps and first checklist item are corrected — they
   asserted the horizon being deleted and its seeded November 2026 Sundays are no longer on the
   default landing.

## Pattern

**A deep link is two halves, and a green test suite can only ever see one of them.** The new unit
tests pin that the href carries the date; nothing in 3856 passing tests could see that the
destination ignored it. The failure lives in the seam between two pages, which is the same seam
`p3-shell-and-tile-dashboard` recorded four defects in — and it was found the same way, by walking
the app rather than by running it.

The narrower lesson: **giving a page an owner changes what its defaults mean.** `/music`'s rolling
horizon was correct for as long as a person chose when to open it. The moment another page started
telling it which Sunday to show, "the next six from today" stopped being a default and became a
refusal. When a module gains a caller, re-read its parameters as that caller's, not as the
original reader's — and resist the two-modes fix that keeps both, which was considered and rejected
here (`decisions.md` §1, *one mechanism, not two*).
