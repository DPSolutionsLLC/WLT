---
name: Teaching it a filter
scope: ai-d-conference-corpus-scoping
part: 1
tags: [ai, knowledge, full]
prerequisites: none
---

## Purpose

The resolver's value is entirely in whether a person understands what it produced **before** they
accept it. A filter is stored as three columns of enum values; approval means nothing if that is
what somebody is approving. `describeFilter()` renders it as a sentence, and whether that sentence
is genuinely readable is not something a test can answer.

The second judgement is the **refusal**. Typing "talks about the temple" is asking for something
retrieval already does on every single call — filtering by subject is not possible and would not
help if it were. That has to teach rather than block: a bishopric member who reads the refusal
should come away understanding how search works, not feeling told off by a validation error.

This scenario spends one Anthropic call per phrase typed. Four phrases is the whole cost.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop@…` (bishop, Mark Andersen), `secretary@…` (ward_secretary, Ruth Delgado) |
| Standard works | "Book of Mormon" — `standard_works`, null metadata |
| Conference talks | 12 — four conferences × Russell M. Nelson (`prophet`), Dallin H. Oaks (`apostle`), Gerrit W. Gong (`seventy`) |
| Saved filters | 2 — **"Prophets"** (phrase: *talks given by the prophet*, role `prophet`) and **"Elder Gong"** (phrase: *anything by Gerrit W. Gong*, speaker `Gerrit W. Gong`) |

**Sign in with:** `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

> **"Prophets" already exists on purpose.** Step 7 has you try to save a second filter by that
> name, which is how the duplicate-label refusal is reached. Without the seeded one it is
> unreachable.

## Steps

1. `npm run seed -- ai/scenario-027-teaching-it-a-filter`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop@…` and go to **Knowledge Base**. Find the **"Teach it a filter"** card.
4. Type `talks by President Nelson` and press **Work out a filter**. Read the sentence it shows
   before doing anything else. Then press **Save this filter**.
5. Type `talks by prophets`. Read the sentence carefully — note whether it resolved to the
   **calling** or to a list of names, and what it says about when the calling was held.
6. **While that proposal is still on screen**, change **Name it** to `Prophets` and press
   **Save this filter**. This is how the duplicate-label refusal is reached.

   > Do this immediately after step 5. Resolving any new phrase clears the proposal, so the
   > duplicate attempt is unreachable once you have moved on.
7. Type `talks about the temple`. **Read the refusal properly** — this is the item that matters
   most in this scenario.
8. Type `asdfgh qwerty` and press **Work out a filter**.
9. Type `talks from the last five years`, read the proposal, then press **Discard**.
10. Reload the page. Confirm the discarded filter is nowhere — not in the checkbox list, not
    anywhere else.
11. In the scope panel above, tick **Elder Gong** and watch the count sentence.
12. Delete the **"Elder Gong"** filter using its Delete control. Read the confirm before accepting.
13. Sign out, sign in as `secretary@…`, and go to `/knowledge` directly.
14. Re-check the card at 375px and in both light and dark mode.

## Verification Checklist

### Machine-checkable

- [ ] A speaker name resolves, and the sentence shown **names the speaker**
- [ ] "talks by prophets" resolves to the **calling**, not to a list of individual names
- [ ] A subject phrase is refused — no filter is offered and no Save button appears
- [ ] Nonsense is refused without a stack trace, and nothing is saved
- [ ] Accepting adds a checkbox to the scope panel, with the **phrase you typed** shown under it
- [ ] **The phrase box clears after a successful save** — it does not still hold what you typed
- [ ] A duplicate label is refused with a sentence naming the clash, not a 500 and not "please
      try again"
- [ ] Discarding leaves nothing behind — after the reload in step 10 there is no trace of it
- [ ] Ticking a saved filter changes the count sentence in the scope panel
- [ ] Deleting a filter removes its checkbox and **does not remove any document** — the document
      list is unchanged
- [ ] `secretary@…` sees "Not permitted"; the card is not rendered for them at all
- [ ] No horizontal overflow at 375px; the phrase box and both buttons clear 44×44

### Needs a human eye

- [ ] **Is the subject-phrase refusal convincing?** Would a bishopric member come away
      understanding that searching by subject already happens on every call — or would they think
      the feature is broken and try again with different words?
- [ ] Does the sentence describing a proposed filter tell you enough to accept it confidently,
      without having to guess what "apostle" will match?
- [ ] Does the note that a calling is *the one held when the talk was given* land, or does it read
      as a technicality?
- [ ] After discarding, are you confident nothing was written? Does anything on screen make you
      doubt it?
- [ ] Does the delete confirm make clear that documents are untouched?
- [ ] At 375px, is the proposal card distinguishable from the form that produced it?

## Failure Behavior

- The resolver is one Anthropic call. If the AI is unreachable, the card shows the written
  sentence from `lib/ai/errors.ts` for that failure kind, and **nothing is saved** — the route
  writes nothing regardless of outcome.
- A duplicate label returns 409 with a sentence naming the label.
- A proposal that would narrow nothing comes back as *unresolvable* rather than as a saveable
  filter — migration 034 would refuse it at insert, which is far too late.
- `secretary@…` gets "Not permitted" on `/knowledge`; `POST /api/knowledge/filters/resolve` and
  `POST /api/knowledge/filters` both answer 403.

## Walkthrough record

**2026-08-24 — walked by Claude in a browser, not by a person.** Dev server on :3000, seeded
fresh. Review page: `walk-review-027.html`, screenshots in `walk-shots-027/`.

**This walk exercised the resolver route for the first time.** Nothing had ever called
`buildFilterResolverPrompt → callClaudeStructured → zodOutputFormat(resolvedFilterSchema) →
toResolvedFilter`, and `effort: "low"` had never been sent by this codebase. Six live resolutions
ran; all six returned a well-formed object and narrowed correctly.

**Settled by machine (12 items).** Observed values, not ticks — every write re-read from the
database with the service client:

- `talks by President Nelson` → *"Conference talks given by Russell M. Nelson."* Saved row:
  `speakers=["Russell M. Nelson"]`, `roles=null`, `since=null`,
  `source_phrase="talks by President Nelson"` — the phrase, not the label
- `talks by prophets` → *"Conference talks given by President of the Church. Roles are the
  calling held when the talk was given."* Resolved to the ROLE, rendered by label rather than
  the raw `prophet`
- `talks about the temple` → refused, kind `semantic`, no Save control rendered
- `asdfgh qwerty` → refused, kind `unresolvable`, no stack trace, nothing written
- `talks from the last five years` → *"Conference talks from October 2021 onwards."* Discarded;
  after a full page reload `retrieval_filters` still held exactly the expected rows
- **The resolve route wrote nothing on any of the six calls** — `retrieval_filters` count was
  unchanged either side of every resolution
- Duplicate label → **409** and *"A saved filter called "Prophets" already exists. Choose a
  different name."* Proposal retained so the name can be corrected; no row written
- **The phrase box cleared after a successful save** (the `ai-a` `router.refresh()` pitfall)
- Ticking **Elder Gong** moved the count from *12 of 12* to *4 of 12* — correct; Gong has exactly
  four talks in the seeded corpus
- Delete confirm: *"Delete the saved filter "…"? The documents are not affected, and any scope
  using it will simply stop narrowing by it."* After deleting: filters 2 → 1,
  `knowledge_documents` 13 → 13
- `ward_secretary`: "Not permitted" page, neither card rendered, and
  `GET /api/knowledge/filters`, `POST /filters/resolve`, `POST /filters` all **403**
- 375px: **0px** horizontal overflow; no control in the card under 44px; no checkbox target
  under 44px
- Audit: every resolution recorded with its `kind` (3 `filter`, 1 `semantic`, 1 `unresolvable`
  in the first pass), plus `retrieval_filter_saved` and `retrieval_filter_deleted` rows

**Reviewed by the user 2026-08-24 — all six judgement items passed.** The subject-phrase refusal,
the proposal sentence, the role-at-time-of-talk note, the discard state, the delete confirm and
the 375px rendering in both themes were each accepted on sight. Review page:
`walk-review-027.html`.

**Two defects found. One fixed in this walk, one backlogged.**

- **FIXED — the `unresolvable` explanation advised the one thing the app refuses.** Given only
  "explain briefly what would work instead", the model ended with *"or a subject you'd like talks
  about"* — exactly what the `semantic` branch rejects one screen earlier, so a person following
  the advice was refused again for doing as they were told. `buildFilterResolverPrompt` now names
  the three axes that work and rules a subject out explicitly. **Re-verified live against the
  same phrase:** `asdfgh qwerty` now returns *"This doesn't identify anything I can filter on.
  Try naming a speaker, a calling (like apostle or seventy), or a time period instead."* — no
  mention of a subject. The `semantic` branch was re-checked in the same pass and is unharmed;
  its explanation now contrasts with the same three axes, so the two branches agree.
  `tests/lib/filterResolverPrompt.test.ts` (15 tests) pins the constraint, since a prompt cannot
  be tested for what a model will say but CAN be tested for whether the constraint is still in it.
- **BACKLOGGED as ITER-017 — `outputTokens` is redacted out of every AI audit row.**
  `writeAuditLog`'s `SENSITIVE_KEY_PATTERN` matches the substring `token` in the field NAME.
  Pre-existing and wider than `ai-d`: `ai-c`'s routes log the same field, so there is no usable
  record of AI spend anywhere in the app. Failing safe, not leaking.

**One correction made to this checklist.** Step 7 required a proposal from step 5 to still be on
screen, but the intervening step resolved a new phrase and `clearProposal()` had wiped it — the
step described a state the app cannot reach. The duplicate-label attempt is now step 6,
immediately after the resolution it depends on, with a note saying why the order matters.

**A 500 seen mid-walk was NOT an application defect.** The first `DELETE` returned 500 with an
HTML body, and the client reported *"Could not reach the server."* The server error was
`Jest worker encountered 2 child process exceptions` — the Next dev compiler's worker pool dying
on the first lazy compile of that route file. After a dev-server restart the same request
returned `200 {"deleted":true}`, and `tests/routes/knowledge-filters.test.ts` (16 passing, three
of them DELETE) calls the same handler directly. Recorded because the symptom is alarming and
will recur in dev.

**Not walked:** `supabase/scripts/ingestConference.ts`, which needs a manifest and files on disk
and is unreachable from the UI. `retrieval_suggestions` writes were also not observed — the
seeded corpus uses unit-vector embeddings that no typed English query matches, so nothing clears
the similarity floor and there is correctly nothing to record. Scenario 026 uploads real files
and is where that write can be seen.
