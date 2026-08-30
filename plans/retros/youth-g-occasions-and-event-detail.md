---
id: youth-g-occasions-and-event-detail
type: feature
iter: [ITER-024, ITER-020]
commits: [668debb]
date: 2026-08-29
files:
  - supabase/migrations/059_activity_occasions.sql
  - lib/youth/occasions.ts
  - lib/youth/occasionDay.ts
  - lib/youth/coverage.ts
  - lib/youth/queries.ts
  - lib/validation/youth.ts
  - app/api/youth/events/[id]/occasion/route.ts
  - app/api/youth/events/route.ts
  - app/(app)/youth/events/[id]/page.tsx
  - app/(app)/youth/events/[id]/EventDetail.tsx
  - app/(app)/youth/events/[id]/JoinOccasionPicker.tsx
  - app/(app)/youth/events/[id]/AddYouthToOccasion.tsx
  - app/(app)/youth/youthQueries.ts
  - app/(app)/youth/calendar/ActivityCalendar.tsx
  - app/(app)/youth/EventList.tsx
related:
  - youth-e-overview-and-cross-navigation
  - youth-f-support-percentage-and-youth-cards
  - youth-c-coverage-and-calendar
  - youth-a-profiles-and-events
  - visits-d-attempts-and-appointments
  - visits-f-stewardship-and-all-orgs
---

## What was done

`activity_events.profile_id` is a single foreign key, so an event belonged to exactly **one** young
person: two team-mates at one game were two rows, two calendar cards, and nothing anywhere recorded
that they were the same evening in the same gym. Migration 059 adds `activity_occasions` — an
identity and nothing else — plus a nullable `activity_events.occasion_id`, and `/youth/events/[id]`
is the screen that reads it: every young person on the occasion, each with their own coverage badge
and their own `AttendeeControls`, under one occasion-level badge that is worst-of across the rows.
Two ways to build one (join two existing rows, or add a young person you notice is missing), and a
quiet *"+N others at this game"* marker on both card renderers. Closes ITER-024 and the
event-detail half of ITER-020 that was parked waiting on it; unblocks ITER-027.

## Key decisions

- **An occasion is identity only — no name, no date, no place.** All three already live on the
  event rows it links, and a second copy could disagree with the first. ITER-024's first open
  question, answered as its own text recommended.
- **The link is explicit and stored, never inferred from a matching title and date.** Two school
  feeds write one fixture as *"Game against Roosevelt"* and *"Game vs Roosevelt"* — the seed uses
  exactly that pair — and a matcher that caught it would also join two different games at one
  school on one evening. This is `classifyLocation.ts`'s refusal of near-miss matching arriving in
  a second place. The **route does not even enforce the same-day rule**; the picker narrows what is
  *offered*, because an all-day tournament entry and a 7:30pm game genuinely can be one occasion.
- **Ward-wide policies on all four verbs, matching `activity_events` and pointedly not the
  profile's org-scoped writes.** A cross-organization occasion is the *point*, not an edge case: a
  write policy comparing `current_org_id()` would make a Young Men row and a Young Women row in one
  game unwritable. The read must also be uniformly evaluable (056c's rule again) — "who else is at
  this game" cannot have two answers from the same data. `tests/rls/activity-occasions.test.ts`
  asserts one organization's president linking another's event, so a later narrowing must break a
  test rather than quietly delete the feature.
- **`worstCoverage()` returns the whole `EventCoverage`, never just its state.** `youth-e`'s walk
  found `Covered · 0` above `Covered · 1` because a value carried the state and the date but not
  the count; the badge, the count and the date all come off one object here, and the test asserts
  the numbers rather than only the state.
- **The "+N others" count is computed from the UNFILTERED list.** Filter the calendar to Ethan and
  Josh's row disappears, but the honest answer is still "+2 others". `roster-b`, restated by
  `visits-b` and `visits-f`. `tests/components/youth/OccasionMarker.test.tsx` is the only place a
  test can catch this rather than a walk.
- **Merging two occasions is refused, with a sentence naming the alternative** — absorbing one into
  the other would move rows nobody named, and the audit row would call it an ordinary join
  (`visits-f`'s empty-bulk-replace precedent).
- **The ICS import creates no occasions**, and `eventType` is never copied across an occasion:
  a row added to a game whose location matches no venue comes out `tbd` and asks a person, because
  **`away` is always a human's word** (`youth-c`). The route test pins this against exactly the
  shortcut a later reader would take.

## What the walk found

Scenario 059 was walked in a real browser on 2026-08-29, every write read back with the service
client. The data layer was clean — including the **migration 046/047 regression proved end to
end**: unlinking deleted the occasion without raising, left both games standing with `occasion_id`
null, and kept all eight events. Three defects, all in the new page, all fixed and re-verified:

1. **The join picker overflowed at 375px** (`scrollWidth 393` vs `clientWidth 360`). A `<select>`
   sizes to its widest option and this one's are the longest in the app by design. `min-w-0` is the
   half that fixes it — a flex item's default `min-width: auto` refuses to shrink below its
   content, so `w-full` alone would still have overflowed. `/youth/calendar` measured clean at the
   same width, which is what isolated it to this slice.
2. **A solo event rendered "One of these young people has nobody going"** — plural, about a group
   of one, above a card already carrying the identical badge. Fixed by hiding the whole panel below
   two rows rather than just the sentence: **one row is not an occasion**, and guarding the
   sentence alone would have left the duplicated badge.
3. **A picker option omitted the event's title**, so two events of one young person on one day
   differed only by a time — `4:00 PM · Ethan Brooks · Varsity basketball` was in fact *Track time
   trial*. Raised as a judgement call and answered by the user: the title should be there. The rule
   was *"never the title alone"*, which is still right; dropping it entirely went one step too far.
   This made defect 1 more urgent, which is why the two were fixed together.

**The user's answer to the first judgement question sharpened ITER-027 and is the most valuable
output of the review.** The alert that scope describes is not *"other youth will be there"* but
**"another young person at this event has nobody committed to them"** — the trigger is the coverage
gap, not mere presence, and the recipient is a leader already down for a different row of the same
occasion. Recorded in the scope, with the constraints it implies: it stays a prompt rather than a
duty, and must never fire for an `away` row.

## Pattern

**A screen that reads a stored link is what proves the link was worth storing.** ITER-024's own
Sequencing section said a column nothing reads changes no screen, which is why the schema and the
view were one plan rather than two — and walking it is what turned three plausible-looking
renderings into three fixed defects, none of which any of the 3262 tests could see.
