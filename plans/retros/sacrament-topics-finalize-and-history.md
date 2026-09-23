---
id: sacrament-topics-finalize-and-history
type: feature
iter: null
commits: ["ff020e2", "9be5a44", "d0de806"]
date: 2026-09-23
files:
  - lib/auth/navigation.tsx
  - components/layout/ModuleShortcutRow.tsx
  - app/(app)/sacrament/page.tsx
  - supabase/migrations/078_topics_finalized.sql
  - lib/topics/finalize.ts
  - lib/calendar/queries.ts
  - app/api/sundays/[id]/topics-finalized/route.ts
  - app/api/assignments/route.ts
  - app/api/assignments/[id]/route.ts
  - app/api/sundays/[id]/route.ts
  - lib/sacrament/sundayStatus.ts
  - components/sacrament/FinalizeTopicsButton.tsx
  - components/sacrament/TopicsFinalizedPanel.tsx
  - components/sacrament/StatusPill.tsx
  - components/sacrament/SundayCard.tsx
  - app/(app)/assignments/[sunday_id]/page.tsx
  - app/(app)/music/SundayMusicCard.tsx
  - app/(app)/music/page.tsx
  - lib/topics/queries.ts
  - app/(app)/talks/topics/RecentTopicUsage.tsx
  - app/(app)/talks/topics/page.tsx
related:
  - p4-sacrament-a-hub-and-reskin
  - music-collapsed-list-and-rolling-year
  - talks-c-prayers-topics
  - p4-sacrament-music-month
---

## What was done

P4 module 1 slice `b`, in three sub-slices and three commits. **`b1`** takes Topics off the
dashboard and puts it in a row of module shortcuts on the Sacrament hub — the prototype's
`.sac-nav`, which module-map §6.4 records as a standing convention and the original harvest missed
entirely. **`b2`** adds `sundays.topics_finalized_at` (migration 078), the finalize control in two
shapes, and the `Topics pending` dimmed card on `/music` that slice `a` deliberately deferred.
**`b3`** adds a read-only "recently used" list to the top of `/talks/topics`: date, topic, speaker,
visiting speakers included.

## Key decisions

- **The shortcut row is driven from `NAVIGATION_ITEMS`, and the Topics entry survives.**
  `NavigationItem` gained `onDashboard?: boolean` (absent means true) rather than the row being
  deleted and a link hardcoded in the hub — that would have re-typed the label, the icon, the
  permission and the `built` flag into a second place, which is `notification-trigger-drift`
  exactly. `shortcutNavigationItems()` shares one internal filter with `visibleNavigationItems()`,
  so the grid and the row differ in exactly one flag and cannot drift about whether an unbuilt or
  unpermitted module may be linked to. **The row is short today and that is the constraint
  working**: of the prototype's eight, WLT has a navigation row for four.

- **The AI candidate queue kept its home, because only the TILE was deleted.** `/talks/topics` is
  the queue's only home and CLAUDE.md rule 3 forbids AI output reaching a row without an explicit
  accept, so removing the tile without rehoming it would have made the approval step unreachable.
  Both `lib/auth/navigation.tsx` and scenario 017 now say so, because the next reader will wonder
  whether it was considered.

- **`topics_finalized_at` is a TIMESTAMP with no `_by` column.** `youth-h`'s `closed_at` rule for
  the first half — "when did this happen" is the question the card asks, and null is how
  un-finalizing works without a delete. The missing `_by` is migration 069's: a user column on a
  ward-scoped table carried a composite `(user, ward_id)` key that a cross-ward leader fails as a
  500, and rule 6's audit row already records who.

- **⚠️ The un-finalize rule is about WHAT changed, never about WHO moved** — the sharpest edge in
  the slice. A topic set, changed or cleared un-finalizes; so does a new assignment row and a
  change to `speaking_slots`. A pipeline transition, an accept, a decline and every contact field
  do NOT. `PATCH /api/assignments/[id]` carries both kinds, so `topicShapeChanged()` inspects the
  **patch** rather than the route inspecting itself. Getting it backwards is not a visible bug — it
  is a month of finalized topics unravelling one Sunday at a time as speakers are contacted.

- **A test reads the three routes' SOURCE**, the way `explicitTimeZone.test.ts` does. No assertion
  about behaviour can see a fourth write path that forgot to call the helper, because the failure
  is a line that is not there. Both halves were proved able to fail before being believed.

- **`SundayStatusInput.topicsFinalized` is REQUIRED, not optional**, so the compiler enumerates
  every caller — ITER-005's lesson, and it worked: `tsc` named all five call sites, four of them
  test fixtures. And the pill's `finalized` is `boolean | null`, where null means "this pill has no
  finalize concept", so the other three cannot grow a checkmark by accident when References, Talks
  and Prayers get their own later.

- **Un-finalizing returns the Sunday so the route can stop repeating a claim that is no longer
  true.** `PATCH /api/sundays/[id]` reads its Sunday before the stamp is cleared, so answering with
  that row would have handed back a state the server had just changed — ITER-022's
  two-answers-one-fact failure in a response body. Null means "nothing observed", so the caller
  falls back rather than asserting something it did not see.

- **`listRecentTopicUsage` reads `assignments` directly, which two other modules refuse to do**,
  and the reason the composed path is wrong rather than merely verbose: `listTopics()` reads one
  status at a time and defaults to active, so composing would silently drop every ARCHIVED topic —
  and "do not repeat what you did in March" has to include the subject somebody archived in April.
  The privacy reason `sundayTopics.ts` refuses for does not apply here: this is bishopric-only and
  its return type carries no stage, no contact state and no approval.

- **It looks forward as well as back, marked rather than folded in quietly.** The user said "has
  been used"; a topic already on the calendar ahead is an equal repeat risk, so it is included and
  carries a "Coming up" pill. The window is `RECENT_MONTHS` imported from `topicRotation.ts` and
  symmetric — the library's "Used recently" badge renders on the same page, and two definitions of
  one word three inches apart is a disagreement a user notices before a test does.

## What the walk changed

Scenario 073 was walked in a browser on 2026-09-23. 3977 tests were green at the time and none of
them could see any of this.

- **⚠️ THE CHECKMARK WAS NOT ATTACHED, AND THAT WAS THE WHOLE CONTROL.** It shipped as a
  free-standing 44px circle separated by a `gap-1`, sitting in a row of four pills — and the user,
  who asked for this control in the first place, could not tell which pill it belonged to. The
  prototype's own name for it is `FinalizablePill`, "wrapping the existing Pill with an **attached**
  checkmark"; attached was the word that went unimplemented. It is now one segmented control: gap
  0px, the seam is the pill's own right border, the tab drops its left border, and **the visible
  heights are pinned to match** — a step at the seam would be worse than the gap it replaced. The
  44px tap target survives because the BUTTON keeps its box while the visible tab is pill-height.
- **`Recently used` was unusable at 375px** — a fixed 144px date column squeezed the title to 17px
  and its text painted over the speaker's name. It stacks below `sm:` now. The lesson is narrower
  than "test mobile": a fixed-width column plus `flex-1` is fine until the fixed part is most of
  the screen, and the failure is text escaping its box rather than a layout that visibly breaks.
- **The seed could not exercise the feature it was written for.** `listRecentTopicUsage` reads a
  window around **today**; the scenario's deliberately-fixed 2027 dates sat eight months outside
  it, so the panel rendered its empty state and four checks were unreachable at any time. A
  scenario for a feature that is relative to *now* needs data relative to *now* — the fixed dates
  that make a finalize walk legible are exactly wrong for a recency window.
- **The panel's supporting line names who is WAITING rather than who benefits**, on the user's
  reasoning that the point of naming a role is being able to chase them.
- **Left alone by decision:** the panel can call a topic used while the library below calls it
  unused, because the two read different sources (`assignments` vs `topics.last_assigned_at`,
  stamped only at `approve`). Narrowing the panel to approved usage would remove the warning about
  next month's plan, which is most of what it is for.
