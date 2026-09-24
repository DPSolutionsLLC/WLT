---
name: References, finalize and skip
scope: p4-sacrament-c
part: 1
tags: [talks, sacrament, references, ai, full, finalize, permissions]
prerequisites: none
---

## Purpose

This slice adds a **References** pill to every Sunday with speaking slots. It opens a modal where
a member of the bishopric searches the ward's own library, taps results onto a talk, types
references by hand, and then **finalizes** or **skips** the day's references. Tests already prove
the rules. Three things are left for a person to judge, because no assertion can see them:

- **Does the modal read as a place to choose references**, and not a place where references were
  chosen for you? Nothing in it is generated, and the page has to make that clear.
- **Does the References checkmark read as attached to its pill**, the same way the Topics one does?
- **Do topic changes behave the way the user decided?** A topic change should quietly return a
  finalized Sunday to open, keep its references, and leave a skip alone.

The seed saves you from building the three states by hand. It creates one Sunday in each state,
plus a fast Sunday with no talks.

**What is already automated:** the citation rules (`tests/lib/referenceSuggestions.test.ts`), the
pill model (`tests/lib/sacramentSundayStatus.test.ts`), RLS (`tests/rls/talk-references.test.ts`),
and every route, including decision 2 and a real search against the database
(`tests/routes/talk-references.test.ts`). The modal's states and the pill's shape are covered by
`tests/components/sacrament/`.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Peter Nakamura) |
| | `music` (music_coordinator, Hannah Restrepo): holds `talks.view`, **not** `talks.plan` |
| Members | Sarah Whitfield, Andre Bell, Claire Bennett |
| Topics | 7 |
| Sundays | Four, **relative to today**: the next four Sundays. The seed prints their dates |
| | **A** (+1 week): 3 slots, topics finalized, **2 references on talk 1**, References **finalized** |
| | **B** (+2 weeks): 2 slots, topics set, **0 references**, References **skipped** |
| | **C** (+3 weeks): 3 slots, topics set, **1 manual reference** (a Talk), References **open** |
| | **D** (+4 weeks): fast Sunday, **0 slots** |
| Knowledge | **None.** Step 3 uploads real documents, because seeded vectors match no real query |

**Sign in with:** `bishop@`, `counselor1@`, `music@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-074-references-finalize-and-skip`, and note the four dates it
   prints.
2. `npm run dev`, then open http://localhost:3000 and sign in as `bishop`.
3. Open `/knowledge` and upload **two** short real documents: a conference talk (tag it General
   conference, with a speaker and a date) and a scripture chapter (Standard works). Wait until
   both are listed as active.
4. Open `/sacrament`, moving to the next month if needed, and read the four cards before touching
   anything.
5. On **C**, press the **Refs** pill.
6. On Talk 1's title row, press **Search**. The search window searches the topic straight away.
   Read the results, then change the words and press Search again.
7. Tick one **Suggested for this topic** scripture and one result, and press **Add 2 references**.
   Watch the pill behind the modal.
8. On Talk 1's title row, press **Add manually**. Choose **General conference talk**, type a
   reference, and press Add.
9. Remove the reference the seed put there with its **✕**.
9b. Try to tick **skip this Sunday** while C has references.
9c. Press **Search any topic** above the talks. Choose a different talk in **Add to**, type any
    words, search, tick a result and add it.
10. Press **Finalize references**. Close the modal and look at C's checkmark. Reopen the modal,
    press **Undo**, and close it again.
11. On **A**, press the Topics pill to open `/assignments/[A]`. Edit Talk 2 and change its
    **topic** to a different one. Save.
12. Go back to `/sacrament` and look at A. Open A's References modal.
13. Do the same topic change on **B**, then look at B.
14. On A, press the **Topics** checkmark and then the **References** checkmark so both are
    finalized (step 11 cleared both). Then press the **Topics** checkmark again to un-finalize the
    topics, and look at A's Refs checkmark.
14b. On **B**, press its References checkmark to un-skip it. B is now open with **zero**
    references — the only way to reach that state, since the seed has none. Read its checkmark,
    then open its modal and read **Finalize references**.
15. Resize to **375px** and open C's modal. Try dark mode too.
16. Sign out. Sign in as `music` and open `/sacrament`.
17. Sign out. Sign in as `counselor1` and finalize or skip one Sunday's references.

## Verification Checklist

The pill row

- [ ] **D** shows **no** Refs pill. A, B and C each show `Refs` directly **after** `Topics`
- [ ] **A** reads `Refs 2` with a **filled, attached** checkmark
- [ ] **B** reads `Refs: skipped` with a **filled** checkmark
- [ ] **C** reads `Refs 1` in the amber (partial) tone with an **empty** checkmark
- [ ] The References checkmark sits against its pill the same way the Topics one does, with no gap
      and no step in height
- [ ] Step 5: pressing C's Refs pill **opens the modal** and does **not** open the programme

Search: the prototype's UI over WLT's retrieval

- [ ] The References modal shows each talk's **title, speaker and chosen references only**, with
      **Search** and **Add manually** on the title row, and no search field or manual row under it
- [ ] Remove is a **small ✕ beside each citation**, on the same line
- [ ] Search and Add manually are **small** buttons grouped on the talk's title line, and still
      easy to tap
- [ ] **Search any topic** sits above all the talks
- [ ] Every window is **only as tall as its content**: on a phone it rises from the bottom, on a
      computer it is centred
- [ ] No wording anywhere calls the scriptures or talks "the ward's"
- [ ] Step 6: the search window has already searched the topic when it opens, and the words can be
      changed and searched again
- [ ] Results name **real citations from the documents you uploaded**, grouped under
      **Scriptures** and **General conference talks**
- [ ] The topic's **suggested scriptures** appear first, as picks
- [ ] The window says **"Select one or more, then press Add."**
- [ ] Step 9c: the free search opens **empty** and searches nothing until asked, shows no topic
      suggestions, and puts the pick on the talk chosen in **Add to**
- [ ] An uploaded scripture is cited by its **document title** (e.g. `Alma 32`). *Corrected
      2026-09-23 by walking it:* this line used to check for no "(part n of m)" suffix, which
      **cannot fail for an upload** — only `npm run knowledge:ingest` labels chunks; an upload is
      unlabelled. The suffix rule is covered by `tests/lib/referenceSuggestions.test.ts`
- [ ] A conference talk appears **once**, reading `Title — Speaker, Month Year`
- [ ] Each result shows a short italic snippet from the passage
- [ ] A search for something nothing matches reads *"Nothing in your ward's library matched
      closely enough…"*, not an error
- [ ] Step 7: both ticked items were added with **one press**, the window closed, and the pill
      behind the modal moved **without a reload**. Reopening Search shows them as **Added**
- [ ] Closing the search window leaves the References modal open behind it
- [ ] Step 8: the manual window offers **only Scripture and General conference talk**, and the new
      reference shows a **Conference talk** chip
- [ ] Step 9: removing a reference updates the pill behind the modal

Finalize, skip, undo

- [ ] Step 14b: with zero references and no decision, **Finalize references** is disabled, and so
      is the pill's checkmark, which says why. *Corrected 2026-09-23:* no seeded Sunday is open with
      zero references, so this was unreachable until step 14b was added
- [ ] Step 10: **Finalize references** fills C's checkmark. The modal reads *"✓ Finalized — N
      references ready."*, pluralised correctly. **Undo** empties the checkmark again
- [ ] The skip checkbox is **disabled while finalized**
- [ ] **Step 9b: the skip checkbox is disabled while references exist**, and says *"Remove the
      references first to skip this Sunday."* (defect 074-D1, decided 2026-09-23)
- [ ] Ticking the skip checkbox on a Sunday with **no** references reads *"Skipped for this Sunday —
      nothing to finalize."* and the pill reads `Refs: skipped`
- [ ] Adding a reference to a **skipped** Sunday clears the skip. This deliberately differs from
      the prototype

⚠️ Decision 2: a topic change un-finalizes References, and nothing else does

- [ ] **Step 12: A's Refs checkmark is EMPTY again**, and its **2 references are still listed** in
      the modal
- [ ] **Step 13: B still reads `Refs: skipped`**
- [ ] **Step 14: un-finalizing A's Topics by its checkmark does NOT change A's Refs checkmark**
- [ ] Nothing asked you to confirm the un-finalize, and no error appeared

The music coordinator

- [ ] **No Refs pill at all** on any Sunday — references are the bishopric's alone (defect 074-D2,
      decided 2026-09-23, migration 080). Every other pill is still there

Mobile and theme

- [ ] At **375px** the modal is full height and scrolls inside itself
- [ ] The manual row (kind, reference, Add) **wraps** without horizontal scroll
- [ ] Dark mode is legible throughout, including the Added row and the snippets

The record

- [ ] `audit_log` shows `talk_reference_added`, `talk_reference_removed`,
      `sunday_references_finalized`, `sunday_references_skipped` and `sunday_references_reopened`,
      and **no citation text** in any detail
- [ ] `talk_references` has **no `created_by`** column (migration 069 explains why)

Judgement: feeds the next slice, not a defect

- [ ] Does the intro sentence make it clear **nothing was generated**?
- [ ] Would a bishop want the topic's own **suggested scriptures** offered as one-tap chips here?

## Failure Behavior

| Check | Test |
|---|---|
| Citation rules: one per talk, scripture labels without part suffixes, dropped unknown documents, sort | `tests/lib/referenceSuggestions.test.ts` |
| Pill order, states, `countText`, no href | `tests/lib/sacramentSundayStatus.test.ts` |
| Ward isolation, music reads but cannot write, org president sees nothing, document delete keeps the citation, the CHECK | `tests/rls/talk-references.test.ts` |
| Every route, 403s, 409 at zero, decision 2 in all four directions, a real search | `tests/routes/talk-references.test.ts` |
| Modal states, read-only mode, Added marker, pluralisation | `tests/components/sacrament/ReferencesEditor.test.tsx` |
| The pill is a button, the checkmark gated on `talks.plan` | `tests/components/sacrament/SundayCard.test.tsx` |

## Walkthrough record

**Walked 2026-09-23, AGENT-DRIVEN** through a real browser (Playwright MCP) against the hosted
project, with every write read back through the service-role client (`.walk074/db.ts`).
Screenshots are in `.walk074/` (git-excluded). **The human-judgement items were NOT confirmed by
a person in this pass.** They were captured and handed over, so this record is agent evidence plus
a screenshot review, not a person using the app.

Seeded Sundays: A 2026-09-27, B 2026-10-04, C 2026-10-11, D 2026-10-18. Uploaded
`Keeping Our Covenants Close` (general conference, Elder Walk Example, April 2025: 2 chunks) and
`Alma 32` (standard works: 1 chunk).

**Observed, and read back:**
- Pill row: D had no Refs pill. A read `Refs 2` filled/pressed, B `Refs: skipped` pressed, C
  `Refs 1` amber/unpressed, each directly after Topics. The checkmark tab starts at the pill's
  right edge (x=215 = x=215), with the same top and both 22px tall, identical to Topics. Tap
  targets were 44px.
- C's pill opened the modal and the URL stayed on `/sacrament`.
- A search for "The Power of Covenants" returned **one** talk suggestion (from a 2-chunk document)
  reading `Keeping Our Covenants Close — Elder Walk Example, April 2025`. A search for "faith is
  like a seed…" returned both groups; the scripture was cited `Alma 32`. An unrelated query
  returned the "Nothing … matched closely enough" sentence.
- Tapping the result stored `source: search` with the document linked, and the row read
  **Added**. The hub pill moved to `Refs 2` with no reload, about 1.5s later (dev-mode refresh).
- The manual Talk reference was added with Enter: `kind: talk, source: manual`. Removing the
  seeded one deleted its row.
- Finalize stamped `references_finalized_at`. The footer read "✓ Finalized — 3 references
  ready." and the skip checkbox was disabled. Undo nulled both columns. The hub checkmark alone
  finalized and un-finalized as well.
- Adding a reference to skipped C cleared the skip (both null).
- **Decision 2:** a topic change on A nulled `references_finalized_at` and `topics_finalized_at`,
  and both references survived. The same change on B left `references_skipped_at` at its seeded
  `2026-09-02T17:30:00Z`. Un-finalizing A's Topics by hand left `references_finalized_at` at
  `03:59:51.953Z`, unchanged.
- Step 14b: B read `Refs 0` with its checkmark disabled, titled "Add a reference or skip first",
  with the same text in screen-reader-only form. **Finalize references** was disabled.
- 375px: the modal was 375×812 and scrolled inside itself (1526 in 743), with no horizontal
  overflow in the modal or on the page. The manual row wrapped with Add on its own line. The only
  control under 44px was the 20px skip checkbox, inside a 44px label. Dark mode rendered.
- `music`: the pill was present and there were no checkmarks. The modal had one button (Close),
  no inputs, and read "These references are finalized." Direct POST, DELETE, PATCH and search
  requests all returned **403**, and the database was unchanged.
- `counselor1` skipped B (`references_skipped_at` stamped).
- Audit: 3 `talk_reference_added`, 1 `talk_reference_removed`, 4 `sunday_references_finalized`,
  3 `sunday_references_reopened` and 2 `sunday_references_skipped`, matching the actions taken,
  with **no citation text** in any detail. `talk_references.created_by` does not exist.

**Findings, reported and NOT fixed:**
- **074-D1: skipping is allowed while references exist.** C was skipped with 2 references
  attached; the pill read `Refs: skipped` over them and the rows stayed. That is the "two claims on
  one pill" contradiction the add-clears-skip deviation exists to prevent, reached from the other
  direction. The plan decided "skipping requires none" and never decided "skipping while some
  exist". It needs a product decision.
- **074-D2: the read-only modal keeps the editing intro.** A music coordinator reads "tap a result
  to add it, or type a reference yourself" above a list with no such controls.

**Checklist corrections:** the "(part n of m)" line could not fail for an upload, so it was
rewritten. The disabled-at-zero line was unreachable with the seed, so step 14b was added. Step
14 assumed Topics was still finalized after step 11 cleared it, so it was rewritten.

**Not walked:** nothing outstanding. The judgement items are handed to the user.

**User's answers, 2026-09-23, and what changed:** D1: skipping is now refused while references
exist (UI and a server 409). D2: references are bishopric-only (pill absent for everyone else,
migration 080 narrows the read). The attached checkmark was approved and is to be reused for the
Talks pill. The corpus wording no longer says "the ward's". The modal was reworked: per-talk
**Search** and **Add manually** buttons opening their own windows, several picks added at once,
the topic's suggested scriptures as picks, and Remove as a small ✕. Manual kinds are Scripture or
General conference talk only. The checklist above was rewritten to match.

**Re-walked 2026-09-24, AGENT-DRIVEN, after the rework** — re-seeded, the two documents uploaded
again, and every write read back through the service-role client. Human-judgement items handed
over again; this is agent evidence plus screenshots (`.walk074/r2-*.png`), not a person using it.

- The References modal has **no text field or select** in it. Each title row carries exactly
  `Search — Talk N: …` and `Add manually — Talk N: …`, and each reference is one 44px row with a
  44×44 ✕ inline. The intro reads "Searches the scriptures and general conference talks by
  meaning…", with no "ward's".
- Search opened as a **second dialog** and had already searched the topic ("The Power of
  Covenants"). It showed the two suggested scriptures first, then the matching conference talk.
  Add stayed disabled until something was ticked.
- A tick **survived a re-worded search** ("faith is like a seed…", which added a Scriptures
  group). One press of **Add 2 references** stored `Mosiah 18:8–10` (manual, no document) and
  `Alma 32` (search, document linked). The window closed, the References modal stayed, and the
  pill read `Refs 3`.
- Reopening Search showed Mosiah as **ticked, disabled and "Added"**. **Escape closed only the
  search window** — the Modal close-guard, proven in a real browser.
- Add manually offered **exactly** Scripture / General conference talk. Enter added a
  "Conference talk" reference and closed the window.
- **D1:** while references existed the skip checkbox was disabled with "Remove the references
  first to skip this Sunday.", and a direct PATCH `skipped` returned **409** with the same
  sentence, leaving the database unchanged. At zero references (step 14b) the checkbox was
  enabled and skipping stamped `references_skipped_at`.
- **Decision 2** re-proven through the UI: A's topic change cleared `references_finalized_at`
  (with both references kept), B's skip survived at `2026-09-02T17:30:00Z`, and un-finalizing
  A's Topics by hand left References at `06:43:59.853Z`.
- **D2:** as `music` the hub showed no Refs pill on any card, the word "Refs" nowhere, and no
  checkmarks. The API read returned **403**.
- `counselor1` finalized C from the hub checkmark.
- 375px: both dialogs were 375×812 with nothing overflowing; the search window is legible in dark.
- Audit: 3 added, 1 removed, 3 finalized, 2 reopened, 1 skipped — matching the actions — with
  no citation text in any detail. The refused skip wrote no row.

**Environment note, not a defect:** running `npm run build` while `npm run dev` was up left the dev
server answering 404 for every API route. Stopping it, deleting `.next` and restarting fixed it.
Don't build over a running dev server.

**Seed change:** the Faith and Covenants topics now carry `suggested_scriptures`, because without
them the "Suggested for this topic" checks could not be reached.

**Round three, from the user's answers (2026-09-24), agent-checked in the browser:** the
title-row buttons are small (28px to see, 44px to tap). **Search any topic** above the talks opens
the search window empty, with an **Add to** picker; a pick added from it landed on Talk 3 as chosen
(read back: slot 3, `search`, document linked). The hint "Select one or more, then press Add." is
shown. **Every Modal now fits its content** — a shared change: the manual window measured 318px,
centred on desktop and a bottom sheet flush with the bottom edge at 375px, while the long
References list still caps and scrolls. One defect was found and fixed during the check: `h-auto` on
a modal `<dialog>` stretched the invisible box to full height, so short windows sat at the top of
an empty frame. It is now `h-fit`, and `components/ui/Modal.tsx` says why.

## Notes

**Why the dates are relative.** The hub opens on the current month. Fixed dates drift out of view,
which is what scenario 073's walk found for its Recently used panel.

**Why there is no seeded corpus.** The harness's hand-written unit vectors match no real query, so
a seeded search would return nothing and every search check would pass or fail for the wrong
reason. Uploading through `/knowledge` embeds for real.

**Steps 7 onwards change data.** Re-seed for a clean run. Uploaded documents live in the harness
ward and are removed by `npm run seed:clean`.
