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
6. Type `talks about the temple`. **Read the refusal properly** — this is the item that matters
   most in this scenario.
7. With that proposal still on screen from step 5, name it `Prophets` and try to save it.
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

Not yet walked.
