# Plan: AI C — Topic Suggestions and Message Drafting

**Created:** 2026-08-23
**Type:** feature
**Structure:** Sequential — plan 3 of 3 for Phase 5 ([05-ai-platform.md](05-ai-platform.md))
**Depends on:** [ai-a-client-and-settings.md](ai-a-client-and-settings.md) and
[ai-b-knowledge-and-retrieval.md](ai-b-knowledge-and-retrieval.md) — both executed and merged first

---

## Overview

Spending the platform. Two routes, each thin by design: assemble context, retrieve, call, return a
draft.

**Topic suggestions** (`POST /api/topics/ai-suggest`) generate candidate topics with scriptures and
conference talks, and write them to `topic_candidates` as `pending` — the accept/reject queue
`talks-c` built and shipped empty specifically so this route would have nowhere else to put them.

**Message drafting** (`POST /api/assignments/[id]/ai-message`) returns a confirmation or thank-you
draft as **plain text that is written to no column at all**. It lands in the same two textareas
`buildConfirmationMessage` and `buildThankYouMessage` already fill, and the existing approve buttons
are still the only thing that saves anything.

This plan closes Phase 4's AI retrofit and Phase 5 both.

**Success criteria**

- A bishopric member clicks Suggest Topics, waits, and finds new candidates in the pending queue —
  with citations they can check — and **not one new row in `topics`**.
- A counselor clicks Draft with AI at the CONFIRM stage, reads a message shaped by the ward's tone
  settings, edits it, and approves it. Approving is still what saves it.
- A thank-you draft visibly uses what the bishopric wrote in the assignment's comment thread.
- Every AI failure from `ai-a`'s six kinds reaches the user as its own sentence, beside a textarea
  that still holds whatever was there before.
- The structural no-autosave tests pass: neither route writes to `topics`, `notify_message`, or
  `thank_you_message`.

---

## Relevant Files

### Create

| File | What it does |
|---|---|
| `lib/ai/topicSuggestions.ts` | Output schema + the user prompt for topic generation |
| `lib/ai/messageDrafts.ts` | User prompts for the confirmation and thank-you drafts |
| `lib/validation/aiRequests.ts` | Zod schemas for both request bodies |
| `app/api/topics/ai-suggest/route.ts` | POST — writes only to `topic_candidates` |
| `app/api/assignments/[id]/ai-message/route.ts` | POST — writes nothing |
| `app/(app)/talks/topics/SuggestTopicsButton.tsx` | Client — the button and its progress state |
| `components/assignments/AiDraftButton.tsx` | Client — shared by both textareas |

### Modify

| File | What changes |
|---|---|
| `app/(app)/assignments/ContactStagePanel.tsx` | An `AiDraftButton` above each of the two textareas |
| `app/(app)/assignments/[sunday_id]/page.tsx` | Pass the assignment's comment thread down |
| `app/(app)/talks/topics/TopicList.tsx` | Mount `SuggestTopicsButton`, refresh the queue after |

**No migration. No new dependency. No schema change.** `topic_candidates` (migration 028) already
has every column this route writes, including the CHECK constraint that makes an accepted candidate
with no reviewer unrepresentable.

---

## Dependencies

Everything is already in place from `ai-a` and `ai-b`:

- `callClaude`, `callClaudeStructured`, `MESSAGE_MAX_TOKENS`, `GENERATION_MAX_TOKENS`, `AiRequestError`
- `buildSystemPrompt`, `MODULE_INSTRUCTIONS`, `CITATION_INSTRUCTION`
- `retrieveChunks`
- `getActiveAiSettings`
- `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`
- `listComments`, `getAssignment`, `listTopics`, `listCandidates`

---

## Known Pitfalls (from retro context)

- **[talks-c-prayers-topics]** — **`POST /api/topics` sets `source: "manual"` itself and refuses to
  read it from the request**, so an AI suggestion cannot be laundered into the library as if a person
  typed it. `PATCH /api/topic-candidates` is the *only* path that writes `source: "ai_generated"`.
  This plan must not add a second one.
- **[talks-c-prayers-topics]** — **the candidate queue has no bulk path, deliberately.** No array in
  the schema, no "accept all". A bulk accept is an auto-add wearing a button. Generating ten
  candidates at once is fine; accepting them in one click is not.
- **[talks-c-prayers-topics]** — migration 018's `topics_ward_title_key` is a unique index on
  `(ward_id, lower(title))`, four migrations away from the table. A suggestion duplicating an existing
  topic already 409s at accept time; this plan should stop it landing in the queue at all.
- **[talks-b-month-planner]** — **a disabled button reads as "this is coming".** A waived external
  speaker's contact stages render as "Not applicable" with no controls, and the AI button must not
  reappear there.
- **[talks-c-prayers-topics]** — `Input` requires an `id`; give every new control a distinct one.
- **[roster-b-picker-and-orgs]** — `ContactStagePanel` is a client component. It must not import
  `lib/ai/client`, `lib/ai/retrieve`, or any module that reaches `next/headers`. It talks to the
  routes over `fetch`, like every other control on that panel.
- **[route-tests-and-realtime]** — read the header of `tests/helpers/routeClient.ts` before the first
  route test; the `vi.mock` hoisting trap is the single most likely hour to lose.
- **[foundation-c-services]** — `can()`/`assertCan()` need role access passed explicitly. Resolve
  once per request.

---

## A gap this plan has to close first

The phase plan says the thank-you draft's most important input is *"the bishopric's personal comments
from the APPRECIATE stage"* — "they are what makes the message not generic. Pass them prominently."

**There is no such field.** `ContactStagePanel.tsx:148` passes `comments: []` to
`buildThankYouMessage`, hard-coded, and nothing anywhere writes it. The template has always had the
parameter and never had the data.

**Resolution: use the assignment's comment thread.** `assignment_comments` at
`level: "assignment"` already exists, `talks-b` already renders it as a live thread on the Sunday
detail page, `listComments({ assignmentId })` already reads it, and it is exactly where a bishopric
member writes *"he talked about his mission and the room went completely quiet."* It is attributable,
it is already ward-scoped and bishopric-only, and it needs no schema change.

So: the page passes the thread down, `buildThankYouMessage` finally receives real comments, and the
AI route passes them to Claude prominently. **This also fixes the non-AI template**, which has been
rendering a generic thank-you since `talks-b` for want of an input nobody had wired.

Add a line under the thank-you textarea: *"Anything the bishopric wrote in the comments on this
assignment is used here."* Otherwise the connection is invisible and the field stays empty forever.

---

## Tasks

### Task 1: Request validation

**File:** `lib/validation/aiRequests.ts` (create)

```ts
export const aiSuggestTopicsSchema = z.object({
  seed: z.string().trim().max(300).nullable().default(null),
  count: z.number().int().min(1).max(10).default(5),
});

export const aiMessageSchema = z.object({
  type: z.enum(["confirmation", "thank_you"]),
});
```

`count` is capped at 10. Beyond that the queue stops being a queue a person reads and becomes a list
they skim — which is how a bulk accept gets asked for.

`seed` is an optional nudge ("something for the youth", "fast Sunday"). Null is the ordinary case and
means "use the ward's standing topic preferences".

---

### Task 2: Topic suggestion prompt and output schema

**File:** `lib/ai/topicSuggestions.ts` (create)

Pure — no client, no database. Builds strings and a schema; the route does the calling.

```ts
export const topicSuggestionsSchema = z.object({
  topics: z.array(z.object({
    title: z.string().min(3).max(120),
    category: z.enum(TOPIC_CATEGORIES),
    description: z.string().min(10).max(500),
    suggestedScriptures: z.array(z.string().max(80)).max(5),
    suggestedTalks: z.array(z.object({
      speaker: z.string().max(80),
      title: z.string().max(160),
      conference: z.string().max(40),
    })).max(3),
  })).min(1),
});

export type TopicSuggestions = z.infer<typeof topicSuggestionsSchema>;

export function buildTopicSuggestionPrompt(input: {
  count: number;
  seed: string | null;
  existingTitles: readonly string[];
  recentlyUsedTitles: readonly string[];
}): string;

export function buildRetrievalQuery(input: {
  seed: string | null;
  topicPreferences: string | null;
  wardContext: string | null;
}): string;
```

**On the schema.** `category` is the existing `TOPIC_CATEGORIES` union from `types/domain.ts`, so a
suggestion cannot carry a category the `topic_candidates` CHECK constraint would reject.
`suggestedScriptures` is an array of reference strings ("Alma 32:21") matching what
`listTopicOptions()` already reads for the confirmation message — **check the shape `talks-c` writes
into `topics.suggested_scriptures` and match it exactly**, or the accept path will produce a topic
whose scriptures the confirmation template cannot read.

**On the prompt.** Keep it plain. The phase plan is explicit and it is worth repeating in a comment:
current models follow instructions closely, and step-by-step scripts and emphatic ALL-CAPS
directives degrade output. State the task, name the constraints once, and stop.

The prompt must include `existingTitles` and `recentlyUsedTitles` as "already in this ward's library,
suggest something else" — asking for novelty in the prompt is cheaper and produces better
suggestions than filtering duplicates afterwards. Task 4 filters anyway, because a prompt is a
request and a filter is a guarantee.

`buildRetrievalQuery` composes the search string for `retrieveChunks`. With no seed, the ward's
topic preferences and context *are* the query — which is what makes suggestions ward-specific rather
than generic.

---

### Task 3: Message draft prompts

**File:** `lib/ai/messageDrafts.ts` (create)

Pure.

```ts
export function buildConfirmationPrompt(input: {
  speakerFirstName: string | null;
  date: DateOnly;
  topicTitle: string | null;
  slotLengthMinutes: number | null;
  suggestedScriptures: readonly string[];
}): string;

export function buildThankYouPrompt(input: {
  speakerFirstName: string | null;
  date: DateOnly;
  comments: readonly string[];
}): string;
```

**The signatures are deliberately identical to `ConfirmationMessageInput` and `ThankYouMessageInput`
in `lib/assignments/messageTemplate.ts`.** That file's header already promises it: *"Phase 5 replaces
the BODY of these functions, not their signature. The AI drafting route delivers its text into the
same textarea these fill."* Matching the shapes means the route can build both the AI prompt and the
template fallback from one object, and a caller swapping one for the other changes nothing but the
words.

Reuse `formatSundayLabel` from `lib/calendar/dates.ts`. A `date` column must never be round-tripped
through local time.

**The thank-you prompt puts the comments first**, under their own heading, before anything else. The
phase plan calls them the important part; burying them under the speaker's name and the date is how
they get treated as trivia. Say plainly in the prompt that these are the bishopric's own
observations and the message should be built around them.

Both prompts state the output is a short message for a **text message**, not an email — that is what
`SmsHandoff` does with it, and a model told nothing will write four paragraphs.

---

### Task 4: Topic suggestion route

**File:** `app/api/topics/ai-suggest/route.ts` (create)

POST, `topics.manage`. **`topics.manage`, not `topics.view`** — same reasoning
`/api/topic-candidates` records for its PATCH: generating candidates is an act of building the
library, not reading it. It also spends money.

Session outside the try; client, role access, `assertCan` inside; `respondToRouteError` at the end.

1. `aiSuggestTopicsSchema.parse(await readJsonBody(request))`.
2. Load in parallel: `getActiveAiSettings`, `listTopics(wardId, { status: "active" })`,
   `listCandidates(wardId, "pending")`.
3. `retrieveChunks(buildRetrievalQuery(...), wardId, { limit: 8, client: supabase })`. Topic
   generation is the one place worth the full eight — it is the most open-ended request in the app.
4. `buildSystemPrompt({ settings, module: "topic_suggestions", retrievedChunks })`.
5. `callClaudeStructured({ system, userPrompt, effort: "high", maxTokens: GENERATION_MAX_TOKENS,
   format: zodOutputFormat(topicSuggestionsSchema) })`. **`"high"`**, per the phase plan's table.
6. **Filter before inserting.** Drop any suggestion whose title case-insensitively matches an existing
   active topic, an archived topic, or a pending candidate, and de-duplicate within the response
   itself. Migration 018's unique index would catch the first case at accept time as a 409, which is
   a worse place to find out: the bishopric has already read it and decided they want it.
7. **Insert what survives into `topic_candidates` with `status: "pending"`, `reviewed_by: null`,
   `reviewed_at: null`, `accepted_topic_id: null`.** Nothing else. The `topic_candidates_review_pair`
   CHECK enforces that trio, so a mistake here is a constraint violation rather than a silent
   auto-accept.
8. `writeAuditLog({ action: "topic_candidates_generated", module: "talks",
   detail: { requested, returned, inserted, filtered } })`. All four numbers — "asked for 5, got 5,
   inserted 3" is the only way anybody understands where the other two went.
9. Return `{ candidates, filteredCount }` with 201.

**A response where everything was filtered returns 200 with an empty array and `filteredCount`
set — not an error.** "Every suggestion was something you already have" is a real answer and the UI
says so.

> **This route must never touch `topics`.** No insert, no update. It reads titles to avoid duplicates
> and that is all. `PATCH /api/topic-candidates` is the only path to the library, and Task 9's test
> asserts it structurally.

---

### Task 5: Message drafting route

**File:** `app/api/assignments/[id]/ai-message/route.ts` (create)

POST. `params` is a `Promise` in Next 16.

**Permission depends on `type`, and must match the panel's own gate exactly:**

| `type` | Permission | Which textarea |
|---|---|---|
| `confirmation` | `talks.confirm` | the CONFIRM stage |
| `thank_you` | `talks.plan` | the APPRECIATE stage |

`ContactStagePanel` gates those two textareas on `canConfirm` and `canPlan` respectively. Gating the
AI button any wider would let somebody who cannot approve a message still generate one — an outbound
vendor call and a spend by a person with no authority over the result.

1. Parse `aiMessageSchema`; `getAssignment(wardId, id, supabase)`; 404 with
   `"That assignment is not in your ward."` when missing.
2. **Refuse a waived assignment with a 409** and the message *"This speaker was invited outside the
   ward and is not being contacted."* ITER-004's entire point is that these stages are not
   outstanding work; offering to draft a message for one contradicts what the panel says three
   inches away. Check `contactWaivedAt`.
3. Resolve the speaker through `speakerFrom()` — a member or an external name — and the Sunday date.
4. For `confirmation`: topic title and `suggestedScriptures` from the topic, exactly as
   `[sunday_id]/page.tsx` already resolves them.
   For `thank_you`: `listComments({ assignmentId: id })`, mapped to their `comment` strings, newest
   last so the prompt reads chronologically.
5. `retrieveChunks` — **only for `confirmation`**, and only when there is a topic. A confirmation
   naming a scripture the speaker can prepare from is better with the corpus; a thank-you for a talk
   that already happened is about what the bishopric observed, and retrieved doctrine makes it
   preachy. Passing no chunks means `buildSystemPrompt` omits layer 3, which is a supported state.
6. `callClaude({ system, userPrompt, effort: "medium", maxTokens: MESSAGE_MAX_TOKENS })`.
7. `writeAuditLog({ action: "ai_message_drafted", module: "talks",
   detail: { assignmentId, type, outputTokens } })` — **never the message text.**
8. Return `{ draft: text }`.

> **This route writes nothing to `assignments`.** Not `notify_message`, not `thank_you_message`, not
> the stage. The existing `PATCH /api/assignments/[id]` with an explicit approve click is still the
> only thing that saves a message, and Task 9 asserts both columns are untouched — including after a
> draft the user then abandons.

---

### Task 6: The shared draft button

**File:** `components/assignments/AiDraftButton.tsx` (create)

`"use client"`. Module-scoped under `components/assignments/` per CLAUDE.md §5 — the same reason
`LastPrayedLabel` went in `components/prayers/`.

```tsx
type AiDraftButtonProps = {
  assignmentId: string;
  type: "confirmation" | "thank_you";
  onDraft: (text: string) => void;
  disabled?: boolean;
};
```

- Label "Draft with AI"; while running, "Drafting…" and disabled. `effort: "high"` topic runs aside,
  a message draft still takes several seconds — a button with no progress state will be clicked
  three times.
- On success, call `onDraft(text)`. The parent **replaces the textarea contents**. It does not
  append, and it does not save.
- On failure, render `body.error` through `<FormError />` and **leave the textarea exactly as it
  was**. Losing an edited draft to a rate limit is the worst version of this feature.
- Beneath it, one muted line: *"A starting point. Read it, change it, and approve it when it says
  what you mean."*

**A confirm step before replacing a textarea the user has already edited.** Compare the current value
against the last value this component produced (or the template's initial value); if it differs, ask
first. Silently discarding somebody's typing is not recoverable.

---

### Task 7: Wire the panel

**Files:** `app/(app)/assignments/ContactStagePanel.tsx`,
`app/(app)/assignments/[sunday_id]/page.tsx` (both modify)

**Panel:**
- Add `assignmentComments: readonly string[]` to `ContactStagePanelProps` and pass it into the
  `buildThankYouMessage` call at line ~148, replacing the hard-coded `comments: []`. **This is the
  gap-closing change** and it improves the non-AI template on its own.
- Mount `<AiDraftButton type="confirmation" onDraft={setConfirmationDraft} />` above the CONFIRM
  textarea and `<AiDraftButton type="thank_you" onDraft={setThankYouDraft} />` above the APPRECIATE
  one.
- **Both sit inside the existing `stage === "…" && canX` branches**, so a waived stage — which
  renders `NOT_APPLICABLE_LABEL` and no controls at all — gains nothing. Do not add a disabled
  variant for the waived case; that is precisely what `talks-b` designed against.
- Add the muted line under the thank-you textarea explaining where the comments come from.

**Page:** it already resolves the topic and its scriptures for this panel. Add
`listComments({ assignmentId })` to that same resolution and pass the mapped strings down. Fetch the
threads for the page's assignments together rather than one call per card.

---

### Task 8: Wire the topics page

**Files:** `app/(app)/talks/topics/SuggestTopicsButton.tsx` (create),
`app/(app)/talks/topics/TopicList.tsx` (modify)

`SuggestTopicsButton` sits above `CandidateQueue`. A count selector (1–10, default 5), an optional
one-line seed input with an `id`, and the button. Hidden entirely when `canManage` is false.

On success it calls `TopicList`'s existing `onReviewed`-style refresh so the new candidates appear
without a reload — `CandidateQueue` already takes that callback, so use the path that exists rather
than adding a second refresh mechanism.

Report the outcome as a sentence: *"5 suggestions, 3 added to the queue — 2 were topics you already
have."* When everything was filtered, say that and nothing else; an empty queue with a success toast
is a confusing pair.

`CandidateQueue` itself is **unchanged**. It already renders pending candidates with accept and
reject, one at a time, with no bulk path. That is the whole reason `talks-c` built it before there
was anything to put in it.

---

### Task 9: Tests

| File | Kind | Asserts |
|---|---|---|
| `tests/lib/topicSuggestionPrompt.test.ts` | pure | Prompt composition and the output schema |
| `tests/lib/messageDraftPrompts.test.ts` | pure | Both prompts, comment prominence |
| `tests/routes/ai-suggest.test.ts` | route, real RLS | Phase 5 test **no-autosave**, filtering, permissions |
| `tests/routes/ai-message.test.ts` | route, real RLS | Phase 5 test **no-autosave**, waiver, permissions |

Both route suites `vi.mock("@/lib/ai/client")` so `callClaude` and `callClaudeStructured` resolve
fixed values — this plan is testing *the route's* behaviour, not Claude's. Everything else stays real:
seeded fixtures, a genuinely authenticated client, real RLS. Also mock `@/lib/ai/retrieve` to return
a fixed pair of chunks, so no OpenAI call happens in CI.

**`ai-suggest.test.ts`:**
- A successful run inserts N `topic_candidates`, all `pending` with null reviewer and reviewed-at.
- **`topics` row count for the ward is identical before and after** — read with the service client.
  This is the phase plan's most important assertion.
- A suggestion whose title matches an existing topic case-insensitively is filtered; the response
  reports it; nothing is inserted for it.
- A suggestion matching a *pending candidate* is filtered too.
- Every-suggestion-filtered returns 200 with an empty array, not a 500.
- `callClaudeStructured` throwing `AiRequestError("rate_limited")` returns **429** with the
  rate-limit sentence, and **zero** candidates were inserted.
- `ward_secretary` → 403. (`topics.manage` is bishopric-only; confirm against
  `lib/auth/permissions.ts` first, per CLAUDE.md §8.)

**`ai-message.test.ts`:**
- Confirmation as a counselor → 200 with a draft; re-read the assignment with the service client and
  assert `notify_message` is **still null**.
- Thank-you as a counselor → 200; `thank_you_message` still null; `pipeline_stage` unchanged.
- The prompt handed to `callClaude` **contains the seeded comment text** — assert on the mock's call
  argument. Without this, the gap this plan exists to close could silently reopen.
- A waived assignment → **409**, and no vendor call was made (assert the mock was not called).
- Another ward's assignment id → 404.
- `music_coordinator` holds `talks.view` but neither `talks.plan` nor `talks.confirm` → 403 on both
  types. (CLAUDE.md §8 names this exact fixture as the one whose permissions are not the intuitive
  answer — check the matrix rather than guessing.)
- An `AiRequestError("refused")` → 422 with the refusal sentence, and both columns still null.

---

## Test Scenarios (Harness)

> Check `testing/scenarios/manifest.json` before numbering — 024 and 025 were free on 2026-08-23,
> assuming `ai-a` took 020/021 and `ai-b` took 022/023.

### Scenario 024: Suggestions reach a queue, never the library

**Tags:** `ai`, `talks`, `topics`, `full`
**Purpose:** CLAUDE.md rule 3 is the rule this whole phase is built around, and the only way to be
sure is to watch a real generation land and check what moved. Seeding gives an existing library so
duplicate filtering is exercised rather than assumed, and a corpus so the citations are real.

**Seed data summary**
- `wards` — 1; `users` — bishop, counselor, ward_secretary
- `ai_settings` — 1 version with a distinctive ward context ("many young families, several recent
  converts")
- `topics` — 6 active, with two titles obvious enough that a model will very likely re-suggest them
  ("Faith", "Repentance")
- `topic_candidates` — 1 pending, so the queue is not empty at the start
- `knowledge_documents` + `document_chunks` — a small seeded corpus with deterministic embeddings

**Tester action:** As the bishop, open `/talks/topics`, note the library size and the queue size, ask
for 5 suggestions, and read what arrives. Accept one, reject one. Then generate again with a seed
("something for fast Sunday").

**Verification checklist**
- [ ] The button shows progress and cannot be double-clicked
- [ ] New candidates appear in the pending queue **without a reload**
- [ ] The library count is **unchanged** until an accept is clicked
- [ ] Suggestions reflect the ward context in `ai_settings` — not generic topics
- [ ] Each suggestion carries at least one scripture reference, and the references are real and
      checkable
- [ ] A re-suggested "Faith" is filtered, and the result sentence says how many and why
- [ ] Accepting **one** candidate adds exactly one topic; rejecting one adds none
- [ ] There is no "accept all" control anywhere
- [ ] The seeded run produces visibly different suggestions from the unseeded one
- [ ] `ward_secretary` sees no Suggest button and gets "Not permitted" at `/talks/topics`
- [ ] Works at 375px and in both themes

### Scenario 025: Drafting a message that nobody sent

**Tags:** `ai`, `talks`, `full`
**Purpose:** The message routes write nothing, and the value of that is only legible in a browser —
generate a draft, walk away, come back, and see that nothing was kept. This also walks the comment
thread → thank-you connection, which is new behaviour and cannot be seeded into existence any other
way.

**Seed data summary**
- `wards` — 1; `users` — bishop, counselor (both bishopric), music_coordinator
- `ai_settings` — 1 version with a distinctive tone ("warm and brief, never formal")
- Four assignments on one Sunday, deliberately staged:
  - one at **CONFIRM** with a topic and suggested scriptures
  - one at **APPRECIATE** with **three assignment-level comments** from different bishopric members
  - one at **APPRECIATE** with **no comments**
  - one **external speaker with contact waived** (ITER-004)

**Tester action:** As the counselor, draft a confirmation, edit it, navigate away without approving,
and come back. Then draft both thank-yous. Then look at the waived assignment.

**Verification checklist**
- [ ] The confirmation draft reflects the seeded tone setting — noticeably, not subtly
- [ ] It names the topic, the date, and the length, and reads like a text message not an email
- [ ] Editing the draft and navigating away loses it — **nothing was saved**; the textarea returns to
      the template default
- [ ] Approving is still what saves it, and only then
- [ ] Drafting again over an edited textarea **asks before replacing**
- [ ] The thank-you for the commented assignment **visibly uses all three comments**
- [ ] The thank-you for the uncommented one is still a usable message, not a broken one with a gap
- [ ] The line explaining where comments come from is present and true
- [ ] The **waived** assignment shows "Not applicable" and **no AI button at all** — not a disabled one
- [ ] `music_coordinator` can view the Sunday but sees no draft buttons
- [ ] Turn the API key off mid-scenario: the error appears **beside the textarea**, the text already
      typed is still there, and the button can be clicked again
- [ ] Works at 375px and in both themes

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

No `db:push` — this plan adds no migration.

---

## Integration Notes

- **Phase 4 closes here.** `04-talks-pipeline.md`'s AI retrofit and `05-ai-platform.md`'s Definition
  of Done both complete with this plan. Update both files' checklists.
- **ITER-004's Phase 4 half stays closed and its Phase 6 half stays open.** This plan touches
  external speakers only to *refuse* to draft for them. The backlog note is explicit that the scope
  stays open until the program and public-page questions ship — do not close it.
- **The thank-you comment fix is a behaviour change to non-AI code.** `buildThankYouMessage` has been
  receiving an empty array since `talks-b`; after this it receives real comments and the template's
  output changes for every assignment that has any. That is the intended fix, but it is worth naming
  in the commit rather than letting it look like AI collateral.
- **`messageTemplate.ts` is unchanged**, keeping the promise in its own header comment. The AI route
  is an alternative *source* for the same textarea, not a replacement for the template — and the
  template is what shows when the API key is missing, which is the graceful degradation the phase
  plan's "failures are visible" rule needs on the other side.
- **Handed to Phase 6:** `AI_MODULES` gains `hymn_suggestions` and `program_edit`, and
  `MODULE_INSTRUCTIONS` gains a block for each. `/api/hymns/suggest` and `/api/programs/[id]/ai-edit`
  are thin routes over exactly the machinery this plan uses. The conversational program editor is the
  one genuinely new shape — it needs multi-turn history, which nothing in Phase 5 has, and SPEC.md
  §Program AI Editor describes it. Note that Sonnet 5 does **not** support mid-conversation system
  messages; the history goes in `messages`, and the program draft state goes in the system prompt,
  rebuilt per turn above the cache breakpoint.
- **Documentation:** SPEC.md §API Routes — mark `/api/topics/ai-suggest` and
  `/api/assignments/[id]/ai-message` built, removing the "NOT BUILT — Phase 5" note on line 75.
  FEATURES.md §Module 3 — record that the thank-you draws on the assignment's comment thread.
- **Breaking changes:** `ContactStagePanelProps` gains a required prop. It has exactly one caller
  (`app/(app)/assignments/[sunday_id]/page.tsx`), and `tests/components/assignments/ContactStagePanel.test.tsx`
  will need the new prop added to its fixtures.
