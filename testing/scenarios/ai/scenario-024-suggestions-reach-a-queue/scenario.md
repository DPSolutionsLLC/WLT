---
name: Suggestions reach a queue, never the library
scope: ai-c-feature-routes
part: 1
tags: [ai, talks, topics, full]
prerequisites: none
---

## Purpose

CLAUDE.md rule 3 — *no AI output reaches a human or a database row without explicit approval* — is
the rule this whole phase is built around, and the only way to be sure of it is to watch a real
generation land and then check what actually moved.

`tests/routes/ai-suggest.test.ts` already counts `topics` rows either side of a generation,
including one that fails, and proves every inserted candidate arrives `pending` with a null
reviewer. What it cannot prove is the part a bishopric will judge: whether the suggestions are
*worth having*, whether the citations are real enough to go and check, and whether the outcome
sentence explains where the filtered ones went.

The library is seeded with two titles a model will very likely propose again — "Faith in Jesus
Christ" and "Repentance" — so the duplicate filter is **exercised by the walk** rather than taken
on trust.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Peter Nakamura) — shared bishopric authority |
| | `secretary` (ward_secretary, Ruth Kaufman) — holds **no** topics permission |
| AI settings | 1 version, saved 12 August 2026. Ward context names **young families, recent converts, university turnover**; topic preferences ask for topics **a new member can act on this week** |
| Topics | **6 active.** "Faith in Jesus Christ" and "Repentance" are duplicate bait |
| | Also: "The Sabbath Day", "Temple Worship", "The Book of Mormon", "Come, Follow Me" |
| Topic candidates | **1 pending** — "Ministering with Real Intent", so the queue is not empty at the start |
| Knowledge base | 2 documents, 1 chunk each, **hand-seeded embeddings** — see Notes |

**Sign in with:** `bishop@`, `counselor1@`, `secretary@` — all
`@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

**`ANTHROPIC_API_KEY` and `OPENAI_API_KEY` must both be set.** This scenario makes real calls.

## Steps

1. `npm run seed -- ai/scenario-024-suggestions-reach-a-queue`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open `/talks/topics`.
4. **Write down two numbers before touching anything:** how many topics are in the library, and
   how many candidates are in the Suggested topics queue at the bottom.
5. Leave the nudge blank, leave the count at 5, and press **Suggest topics**. While it runs, try
   to press it again.
6. Read the outcome sentence and then read every new candidate in the queue.
7. Check the library count again — *before* accepting anything.
8. Press **Add to the library** on one candidate. Press **Not this one** on another.
9. Check the library count once more.
10. Set the count to 3, type `something for fast Sunday` in the nudge, and press **Suggest
    topics** again.
11. Compare the two sets of suggestions.
12. Sign out. Sign in as `secretary` and open `/talks/topics` directly.
13. Sign in as `counselor1` and confirm the Suggest panel is there for them too.

## Verification Checklist

### Machine-checkable

- [ ] The button reads **"Thinking…"** while running and cannot be pressed a second time
- [ ] New candidates appear in the queue **without a page reload**
- [ ] The library count at step 7 is **identical** to the one written down at step 4
- [ ] Accepting **one** candidate at step 8 adds **exactly one** topic — not two, not the whole
      batch
- [ ] Rejecting one adds **none**
- [ ] There is **no "accept all" control** anywhere on the page, and no checkbox column
- [ ] Every new candidate carries at least one scripture reference
- [ ] A conference talk citation reads as one line — speaker, title in quotes, then the
      conference — and not as `[object Object]` or a blank
- [ ] The outcome sentence names **three** numbers when something was filtered: how many came
      back, how many were added, how many were already held. **Corrected 2026-08-24:** across three
      runs on the walk **nothing was ever filtered** — the model followed the prompt's "already in
      this ward's library, suggest something else" instruction every time — so this branch of the
      sentence could not be reached from the browser. A tester cannot force a collision on demand.
      The zero-filtered wording (*"N suggestions, N added to the queue."*) was observed and is
      correct; the filtered wording is pinned by `tests/routes/ai-suggest.test.ts`. Treat this as
      opportunistic, not required
- [ ] `secretary` at `/talks/topics` sees **"Not permitted"**, not an empty library
- [ ] `secretary` has no Topics link in the sidebar
- [ ] `counselor1` sees the Suggest panel and can use it
- [ ] No horizontal scrolling at 375px on the Suggest panel or the queue
- [ ] The count select, the nudge input and the button are all at least 44×44
- [ ] Both themes: the Suggest panel is distinguishable from the candidate cards below it

### Needs a human eye

- [ ] Do the suggestions reflect **this ward** — young families, recent converts, university
      turnover — or could they have been generated for any ward anywhere? This is the single most
      important judgement in the scenario.
- [ ] Are the scripture references **real, and about what the suggestion says they are about**?
      Open one and check. A plausible-looking reference to the wrong verse is the failure mode.
- [ ] If "Faith in Jesus Christ" or "Repentance" came back and was filtered — does the sentence
      make it obvious *why* nothing was added for it, or does it read like something went wrong?
- [ ] If **nothing** was filtered on either run, is that believable, or does it suggest the model
      is being told about the existing library and the filter never fires? Record which.
- [ ] Do the seeded run's suggestions read **visibly differently** from the unseeded run's? If the
      two sets are interchangeable, the nudge is not reaching the prompt in any useful way.
- [ ] Read a description cold. Is it a topic a speaker could actually prepare from, or a title
      with a sentence of padding under it?
- [ ] Does the panel make it clear that suggestions land in a **queue** and not in the library?
      Read the wording as somebody who has not seen this before.
- [ ] At 375px, one-handed: can you read a candidate and decide on it without pinching?

## Failure Behavior

- [ ] With `ANTHROPIC_API_KEY` unset, pressing Suggest shows the *not configured* sentence naming
      the API key — **beside the panel**, not as a blank queue
- [ ] The error appears where the button is, and the button becomes pressable again
- [ ] Nothing is added to the queue on a failure — the count before and after is the same
- [ ] Asking for a count outside 1–10 is not reachable through the select at all; the route
      refuses it independently (`tests/routes/ai-suggest.test.ts` covers the 400)
- [ ] Every suggestion being a duplicate produces the "every one was a topic you already have"
      sentence and an unchanged queue — **not** an error

## Walkthrough record

**Walked 2026-08-24 by Claude driving a real browser (Playwright), with screenshots for the
human-eye items.** Every machine-checkable item was performed and verified against the hosted
database with the service-role client, never from the screen alone. **Three** generations were run
rather than the two the steps call for — the third was a deliberate attempt to force a duplicate
collision, and it failed to produce one.

**Observed values**

- Baseline: **6** library topics, **1** pending candidate. No "accept all" control, **0** checkboxes.
- Button during a call: label `Thinking…`, `disabled = true`.
- **Run 1** (count 5, no nudge) → *"5 suggestions, 5 added to the queue."* Queue 1 → 6 with no
  reload; library count unchanged at **6**. Titles: "Making Room for the Savior in a Busy Home",
  "Finding Your Place in a Ward That's Always Changing", "What It Felt Like to Say Yes to Baptism",
  "Small Acts, Real Love: Christlike Service This Week", "Prayer That Doesn't Feel Like a
  Performance".
- Audit row: `topic_candidates_generated` — `requested 5, returned 5, inserted 5, filtered 0,
  seeded false, retrievedChunks 0`.
- All 5 rows: `status pending`, `reviewed_by null`, `reviewed_at null`, `accepted_topic_id null`,
  each with scripture references.
- Talk citations stored flat, e.g. `Elder Dieter F. Uchtdorf, "Of Things That Matter Most",
  October 2010` — never `[object Object]`.
- **Accept one, reject one:** library 6 → **7**. New row "Small Acts, Real Love: Christlike Service
  This Week", `source = ai_generated`; its candidate `status accepted`, `accepted_topic_id
  c69c89a5…`, `reviewed_by 58df6c6b…` (the bishop). Rejected candidate: `status rejected`,
  `accepted_topic_id null`, **no topic created**.
- **Run 2** (count 3, nudge "something for fast Sunday") → *"3 suggestions, 3 added to the queue."*
  "Why We Fast: Turning Hunger into Prayer", "Sharing Your Testimony Without Fear", "Fasting for
  Someone Else This Week" — entirely different in theme from run 1.
- **Run 3** (same nudge) → 3 more distinct fast-Sunday titles, `filtered` **0** again.
- `secretary`: *"Not permitted — The topic library is limited to the bishopric."* No Topics link in
  the sidebar, no Suggest panel, no Suggest button.
- `counselor1`: full access — Suggest panel, 10 individual "Add to the library" buttons, no "accept
  all", 0 checkboxes.
- 375px: horizontal overflow **0px**, **zero** tap targets under 44px, both themes.

**Checklist corrections**

- The "outcome sentence names three numbers when something was filtered" item was made
  conditional. Across three runs `filtered` was **0** every time — the model obeyed the prompt's
  "suggest something else" instruction and never re-proposed a held title — so that branch was
  unreachable from the browser. A tester cannot force a collision on demand. The zero-filtered
  wording was observed and is correct; the filtered wording is pinned by four assertions in
  `tests/routes/ai-suggest.test.ts`.

**Defects found**

1. **The outcome sentence is set before the queue it describes refreshes.** In
   `SuggestTopicsButton.suggest()`, `setOutcome(...)` runs before `await onSuggested()`. After
   run 3 the panel read *"3 suggestions, 3 added to the queue."* while the queue below still showed
   the previous **7**; the database already held **10**. A later read of the same DOM, with no
   interaction, showed all 10 — so nothing was lost, but for a window the screen contradicts
   itself. Awaiting the refresh before setting the outcome would close it. Reproduce: generate
   twice in a row and read the queue immediately.

**Notes for the next walk**

- `retrievedChunks` was **0** on every run, exactly as this scenario's Notes predict — the seeded
  corpus uses unit-vector embeddings that cannot match a real query. **Every citation here came
  from model memory rather than the corpus**, which is the condition under which citations are
  least reliable, and several look wrong on inspection. A walk that wants to judge corpus-grounded
  citations must upload a document through `/knowledge` first.

**Not walked**

- Nothing. All 13 steps were completed, plus a third generation.
- The `ANTHROPIC_API_KEY`-unset failure block was **not** re-walked here; it was walked in full on
  scenario 025 the same day, against the same `AiDraftButton`/`SuggestTopicsButton` error path.

## Notes

**The seeded corpus will not drive the suggestions, and that is expected.** The two seeded
documents carry hand-written unit-vector embeddings (see the comment in
`testing/infrastructure/seedUtils.ts`). They answer a query on the same axis with a similarity of
exactly 1 and every other query with 0 — including the real query embedded from the ward's
settings. So `/knowledge` shows two real documents and the retrieval path genuinely runs, but the
citations in the suggestions come from the model's own knowledge rather than from this corpus.

If you want to judge **corpus-driven** retrieval, upload a document through `/knowledge` first —
that path embeds for real — and then generate. Scenario 022 walks the upload half.

**This scenario spends money.** Each press at `effort: "high"` over up to 8 retrieved passages is
the most expensive single call in the app. Two runs is the intended shape; ten is not.
