---
id: sacrament-topics-t5-topic-window
type: feature
iter: null
commits: ["00b6745"]
date: 2026-09-29
files:
  - components/sacrament/TopicWindow.tsx
  - app/api/assignments/topic-suggestions/route.ts
  - lib/ai/topicSuggestions.ts
  - lib/validation/aiRequests.ts
  - lib/topics/topicHistory.ts
  - lib/topics/queries.ts
  - app/(app)/talks/topics/TopicHistoryList.tsx
  - components/sacrament/SpeakerWindow.tsx
related: [sacrament-topics-t2-topic-history, sacrament-topics-t4-speaker-window, sacrament-topics-t3-the-screen]
---

## What was done
Sub-slice `t5`, the last of the Topics screen rebuild: the topic window becomes the prototype's
AssignTopicModal. It shows **"Used before, most recent first"** while you type, offers **Check topic**,
and has **Suggest topics**, which asks Claude for ideas through a new
`POST /api/assignments/topic-suggestions` that writes nothing but its audit row. Suggestions are
drafts: tapping one only fills the box (rule 3). The library's candidate schema and helpers were
removed. Walking scenario 084 (which also covers t2 and t4) led to a history window, a one-year hint
lookback and three fixes.

## Key decisions
- **Common words don't count toward similarity.** The t2 port matched on any word of three or more
  letters, which includes "the", "and", "our": "The Sabbath" read as similar to "The Atonement", and
  the AI filter would have discarded almost everything. The prototype's comment intended this; its
  code did not do it.
- **The suggestions are filtered by the SAME rule as the hint** (`topicSimilarity`), against the
  last `RECENT_MONTHS` and everything upcoming, so a suggestion is never one the hint would flag.
  "More suggestions" sends what is already shown. The route test counts `assignments`, `topics` and
  `topic_candidates` on both sides of a success and of a failure. That the call carries adaptive
  thinking and no `budget_tokens` is proven where it is set, in the client's own test, which gained
  the structured path.
- **The user's decisions after the walk:** the Topic history shows the last **6 months** by default,
  adjustable, remembered with the sort; the page-view schema defaults `months`, so views saved before
  the window existed still read. The hint and Check topic look back **one year**
  (`HINT_LOOKBACK_MONTHS`); anything already planned always counts. A visitor shows with their title
  ("President Hale"). The speaker list's flags stack in a column on a phone and never squeeze the
  name. The markdown asterisks around AI citations were **kept**: the user found them fine.
- **Found by the walk and fixed:** D1, the history dropped a visitor's title. D3, flags crushed the
  name even at 1280px. D4, the audit detail's `outputTokens` was always `[redacted]`, because
  `writeAuditLog()` blanks any key containing "token"; the old library route had the same useless field.
- The walk made real Claude calls: 5 ideas returned, 2 filtered, in about 11 s. One run returned
  nothing new and the first walk script only waited for ideas, which is why the script now waits for
  an idea or a message.
