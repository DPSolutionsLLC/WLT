---
name: Scoping the corpus
scope: ai-d-conference-corpus-scoping
part: 1
tags: [ai, knowledge, full]
prerequisites: none
---

## Purpose

The count sentence and the standard-works exemption are the two things no unit test can judge.

A test can prove scripture survives a recency filter — `tests/db/retrieval-filters.test.ts` does,
from four directions. Only a person can tell you whether the panel made them **believe** it would.
That gap is the whole reason this scenario exists: a bishopric that does not trust the panel will
either never set a scope, or set one and quietly assume it broke their suggestions.

The second judgement is the zero state. A scope matching no talks is a **legitimate** outcome — a
ward may genuinely scope to one speaker in a year they have not ingested — and the panel has to
say what will happen next rather than reading as an error somebody has to undo.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop@…` (bishop, Mark Andersen), `secretary@…` (ward_secretary, Ruth Delgado) |
| Standard works | "Book of Mormon" — `standard_works`, **null speaker/calling/conference**, 3 passages |
| Conference talks | 12 — four conferences (April 2026, October 2025, April 2022, October 2019) × three speakers (Russell M. Nelson `prophet`, Dallin H. Oaks `apostle`, Gerrit W. Gong `seventy`) |
| Unlabelled talk | "An older talk somebody uploaded" — `general_conference` with **no metadata at all** |
| Other | "Stake presidency letter, January 2026" — `other`, null metadata |
| Passages | 18, all embedded |

**Sign in with:** `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

> **The seeded passages will NOT come back from the Retrieval Tester, and that is expected.**
> Their embeddings are hand-written unit vectors rather than real ones, because seeding real ones
> would mean an OpenAI call on every `npm run seed`. A typed English query does not align with
> those axes. **Step 6 has you upload two real files** — those are embedded for real, and they are
> what makes "scripture survived the filter" something you can see rather than infer.

## Steps

1. `npm run seed -- ai/scenario-026-scoping-the-corpus`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop@…` and go to **Knowledge Base** in the sidebar.
4. Read the **"Which conference talks count as reference"** card without changing anything.
   Note the count sentence and the line about the AI settings recency preference.
5. Change **How far back to look** through each option in turn — No limit, Last 2 years,
   Last 5 years, Last 10 years — **without saving**. Watch the count each time.
6. Upload two real files so retrieval has something it can actually match. **Both fixtures are
   original synthetic text, not scripture and not a real conference talk** — nothing copyrighted
   is in this repository (CLAUDE.md §9). Both mention faith heavily, which is what step 8 searches
   for.
   - `fixtures/standard-works-sample.txt` → title "Standard works sample (uploaded)" /
     **Standard works**. Confirm the speaker and conference fields do **not** appear for this kind.
   - `fixtures/conference-talk.txt` → title "The Ordinary Work of Faith" /
     **General conference**, speaker `Jeffrey R. Holland`, calling **Apostle**,
     conference `April 2026`
7. Set **Last 2 years** and press **Save scope**.
8. In **Try a search**, leave *Search using the ward's scope* ticked and search for `faith`.
   Confirm scripture passages are among the results.
9. Untick every calling, then tick only **Seventy**. Read the sentence under the checkboxes.
10. Tick **Seventy** only and set **Last 2 years** — a combination the corpus has no talk for.
    Read what the panel says.
11. Set the scope back to No limit with no callings ticked, and save.
12. Go to **AI settings** and open the version history. Confirm the scope saves appear there.
13. Sign out, sign in as `secretary@…`, and go to `/knowledge` directly.
14. Re-check the whole page at 375px and in both light and dark mode.

## Verification Checklist

### Machine-checkable

- [ ] The count sentence updates as the recency select changes, **before saving anything**
- [ ] "No limit" counts all 13 conference talks; "Last 2 years" counts fewer
- [ ] The sentence states that the standard works are always included
- [ ] Setting "Last 2 years" and searching with the scope ticked **still returns scripture passages**
- [ ] Unticking *Search using the ward's scope* and searching again returns at least as many results
- [ ] "An older talk somebody uploaded" carries a **"Not filterable"** badge; the Book of Mormon
      and the stake letter do **not**
- [ ] The panel reports how many talks have no speaker or date recorded
- [ ] Saving a scope adds a row to the AI settings version history
- [ ] Saving the AI settings form afterwards does **not** clear the scope — go back to
      `/knowledge` and confirm the recency select still shows what you saved
- [ ] The upload form shows speaker, calling and conference **only** when the kind is
      General conference
- [ ] Uploading a General conference file with the speaker blank is refused with a sentence
- [ ] The speaker box suggests names already in the corpus as you type
- [ ] `secretary@…` sees "Not permitted", not an empty panel
- [ ] No horizontal overflow at 375px; every checkbox and control is at least 44×44

### Needs a human eye

- [ ] After reading the count sentence, would you **believe** the standard works are still being
      searched — or would you go and check?
- [ ] Does the line distinguishing this from the AI settings recency preference actually land, or
      does it read as two settings doing the same thing?
- [ ] With no callings ticked, does the sentence make it obvious that means **everything** rather
      than **nothing**?
- [ ] Does the zero-match state read as a deliberate, recoverable choice — or as an error?
- [ ] Does the "Not filterable" explanation make the consequence clear? It is the opposite of what
      the words suggest: such a talk is searched **more** often, not less.
- [ ] At 375px, can you tell at a glance which callings are ticked?

## Failure Behavior

- A save that fails shows the route's own sentence, and the panel keeps what you typed.
- A scope matching zero talks is **saved happily** — it is a legitimate choice. The panel explains
  that suggestions will fall back to the standard works.
- A narrow scope means the Retrieval Tester will often return nothing. That is the similarity
  floor working, not a broken search, and the empty state names the scope as a possible cause.
- `secretary@…` gets "Not permitted" on `/knowledge`, and both filter routes answer 403.

## Walkthrough record

Not yet walked.
