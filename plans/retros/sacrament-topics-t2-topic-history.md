---
id: sacrament-topics-t2-topic-history
type: feature
iter: null
commits: ["0100400"]
date: 2026-09-29
files:
  - lib/topics/topicHistory.ts
  - lib/topics/queries.ts
  - lib/topics/topicRotation.ts
  - lib/validation/topic.ts
  - lib/validation/pageView.ts
  - app/(app)/talks/topics/page.tsx
  - app/(app)/talks/topics/TopicHistoryList.tsx
  - lib/auth/navigation.tsx
related: [sacrament-topics-t1-topic-words, sacrament-topics-finalize-and-history]
---

## What was done
Sub-slice `t2` of the Topics screen rebuild: the topic library is retired and `/talks/topics` is the
ward's **Topic history** — every topic a talk has carried, all time, with its date and speaker,
searchable and sortable (the sort remembered on the account), upcoming uses marked **Coming up**,
cancelled talks skipped. It has its dashboard tile back and stays on the Sacrament hub's shortcut row.
The library page, its AI candidate queue, four API routes and their two route tests were deleted, and
`lib/topics/queries.ts` shrank from ~850 lines to the one history read.

## Key decisions
- **Pure helpers in `lib/topics/topicHistory.ts`** — `topicSimilarity` (a port of the prototype's
  prefix rule, words of 3+ letters), `similarTopicUses` (one line per distinct topic, its most recent
  use), `timeAgoLabel` (never negative: "Coming up"), `filterAndSortTopicHistory`. `t5`'s topic window
  reuses them.
- **The Sunday's date is EMBEDDED** through its composite foreign key rather than read through
  `listSundays()`, a departure from the plan: `listSundays()` takes a range and a history has none. The
  ask to-do embed already reads `sundays` the same way.
- **Dates render with the year** (`formatSundayLabelWithYear`, not the plan's `formatSundayLabel`):
  a history spans years.
- Dead library code went with its callers: the staleness badge in `topicRotation.ts` (only
  `RECENT_MONTHS` stays, for `t5`) and its test, and the library schemas in `lib/validation/topic.ts`
  (only `setTopicsFinalizedSchema` stays) — which also removed a second `MAX_TOPIC_TITLE` (160) that
  disagreed with the talk's 200. `NavigationItem.onDashboard` is kept though nothing uses it now.
- The two navigation tests that pinned "off the dashboard" were **inverted, not deleted**. Five
  harness scenarios carry a retired/partly-retired note; none was deleted.
- Proved able to fail: prefix, dedupe and "Coming up" broken (5 red); the page-view schema entry
  removed (1 red). The full suite had 3 failures in 2 files (`fetch failed` and 30s timeouts on the
  shared DB, in files t2 does not touch); both files passed rerun alone.
