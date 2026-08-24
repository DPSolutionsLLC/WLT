---
id: ai-c-feature-routes
type: feature
iter: null
commits: ["9f3e483"]
date: 2026-08-24
files:
  - lib/ai/topicSuggestions.ts
  - lib/ai/messageDrafts.ts
  - lib/validation/aiRequests.ts
  - lib/topics/queries.ts
  - app/api/topics/ai-suggest/route.ts
  - app/api/assignments/[id]/ai-message/route.ts
  - components/assignments/AiDraftButton.tsx
  - app/(app)/talks/topics/SuggestTopicsButton.tsx
  - app/(app)/talks/topics/TopicList.tsx
  - app/(app)/assignments/ContactStagePanel.tsx
  - app/(app)/assignments/[sunday_id]/page.tsx
related:
  - ai-a-client-and-settings
  - ai-b-knowledge-and-retrieval
  - talks-b-month-planner
  - talks-c-prayers-topics
  - route-tests-and-realtime
---

## What was done

Spent the AI platform. Two thin routes — `POST /api/topics/ai-suggest` writes candidate topics to
`topic_candidates` as `pending` and never touches `topics`, and `POST /api/assignments/[id]/ai-message`
returns a confirmation or thank-you draft as plain text and writes no column at all. Both land in
surfaces `talks-b` and `talks-c` had already built and shipped empty for exactly this. Phase 4's AI
retrofit and Phase 5 both close here.

It also closed a gap the phase plan assumed was already filled: the thank-you template has taken a
`comments` parameter since `talks-b` and `ContactStagePanel` passed `[]` hard-coded, so every
thank-you this app has ever produced was generic. The assignment's own comment thread now feeds it.

## Key decisions

- **The model answers talk citations in three fields and they are flattened to one string before
  insert.** The plan's schema had `suggestedTalks` as an array of objects, but the column stores an
  array of strings and `mapCandidateRow`'s `toSuggestionList()` drops anything that is not one — so
  written through unchanged, every citation would have read back as `null` with no error anywhere.
  The structure survives because it makes the model produce better-formed citations; `formatTalkCitation`
  does the flattening, and the schema's field lengths are set so a composed citation fits the
  200-character limit `lib/validation/topic.ts` puts on a stored suggestion.
- **The suggestion route reads archived topics too.** The plan listed three loads but its own filter
  step wanted archived titles as well, and it was right to: migration 018's unique index is on
  `topics (ward_id, lower(title))` regardless of status, so an archived duplicate would have 409'd at
  accept time — after the bishopric had read the suggestion and decided they wanted it.
- **`createCandidates()` was added to `lib/topics/queries.ts`**, which the plan did not list. The
  module could read, accept and reject candidates but had no insert, and route handlers do not touch
  Supabase directly. It can only write `pending` with a null reviewer, so a caller cannot insert a
  candidate that is already accepted.
- **Retrieval runs for a confirmation and not for a thank-you.** A confirmation naming a scripture
  the speaker can prepare from is better with the corpus behind it; a thank-you is about what the
  bishopric observed, and retrieved doctrine makes it preachy.
- **A null retrieval query means no retrieval.** With no seed and no ward settings there is no
  signal, and embedding the empty string returns the corpus's arbitrary nearest neighbours dressed
  up as relevant material. `buildSystemPrompt` omitting layer 3 is a supported state.
- **After the walk: no comments means no thank-you is offered at all.** The user's judgement was
  that they would not send anything generic at that stage — an in-person thank-you has usually
  already happened, and a form letter afterwards subtracts from it. The textarea, the AI button and
  the SMS handoff are all absent, and the route returns 409 so the refusal holds if the button is
  bypassed. An already-approved message still shows: it was written when there *was* something to say.
- **After the walk: the plain template is reachable again via "Back to the plain version".** Before
  it, the only route back from an AI draft was navigating away, which also discarded the draft. Both
  directions live inside `AiDraftButton` rather than the panel, because that component's record of
  which values nobody typed is what decides whether replacing needs a confirm — a restore driven
  from outside would leave it stale and warn about an edit the user never made.

## What the walk found that the tests could not

Scenarios 024 and 025 were both walked in a browser. Four findings, only one of them from this plan:

1. **`setOutcome()` runs before `await onSuggested()`**, so the panel can say "3 added to the queue"
   while the queue below still shows the old set. Nothing is lost; the screen contradicts itself for
   a window.
2. **The plain thank-you template mangles real comments** — `listPhrase()` was written for scripture
   references and now receives full sentences, producing a comma splice, and it leaves them in the
   bishopric's third person inside a message addressed to the speaker. Latent since `talks-b`;
   visible only once this plan supplied the data. The AI path fixes both; the template does not.
3. **`talks.view` is granted to three roles that RLS refuses.** `assignments` is bishopric-only in
   migration 019's loop, so a music coordinator opening a Sunday sees "4 speaking slots" above
   "Nothing is planned for this Sunday yet." Same shape as ITER-007.
4. **The audit log redacts its own spend figure** — `SENSITIVE_KEY_PATTERN` matches `/token/i`, so
   `outputTokens` stores as `[redacted]`. Inherited from `ai-a`.

**Two suggested conference talk citations were confirmed wrong** — a real speaker on a shifted date,
and a real speaker on a title that is not theirs — while others in the same batch were correct.
`retrievedChunks` was 0 on every run, so they came from model memory. Raised as **ITER-016**: nothing
currently constrains a citation to the ward's corpus, `preferKnowledgeBase` renders as a preference
rather than a rule, and `suggestedTalks` is free text the route inserts unchecked. Uploading real
talks does not close this on its own.

**Two checklist items were corrected during the walk**, both describing states the app cannot reach:
a music-coordinator check that assumed slots would be visible, and a filter check that required an
outcome no tester can force.

## Pitfalls for whoever builds on this

- **A component's initial `currentValue` is a value nobody typed.** Three tests of the edit-protection
  guard failed because they mounted `AiDraftButton` with already-edited text; the component was right
  and the tests were wrong. A real edit arrives by re-render, not by mount.
- **Both route suites mock `@/lib/ai/client` AND `@/lib/ai/retrieve`** so no vendor call happens in
  CI. Everything else stays real — seeded fixtures, an authenticated client, real RLS — so a passing
  route test still proves the policy allowed the query.
- **The no-autosave assertions must re-read with the service client.** A route can report a row it
  did not write, and one that wrote two would report one.
