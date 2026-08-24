---
name: Upload, deactivate, delete
scope: ai-b-knowledge-and-retrieval
part: 1
tags: [ai, knowledge, full]
prerequisites: none
---

## Purpose

The upload path cannot be tested end to end anywhere but here. It needs a real file, a real
Storage bucket and a real embedding call, and the one judgement that matters most — whether a
**scanned** PDF is refused with a sentence that explains itself, rather than ingested as a
document with zero passages — can only be made by looking at a real scan.

Seeding gives an existing corpus so that **deactivation is a visible change in retrieval** rather
than a status badge with nothing behind it, and so the delete confirm names a real passage count.

It also carries the one thing about partial failure a bishopric will notice being wrong: that a
document where some passages failed to embed is reported as **usable**, with both numbers on
screen, rather than as a failure that invites a duplicate re-upload.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop@…` (bishop, Mark Andersen), `counselor1@…` (counselor, Peter Nakamura), `secretary@…` (ward_secretary, Ruth Delgado) |
| Knowledge documents | 2, both active — "Elder Holland, April 2024" (`general_conference`, uploaded by the bishop) and "Stake presidency letter, January 2026" (`other`, uploaded by the counselor) |
| Passages | 10 — 4 on the Holland talk (all embedded), 6 on the letter (**5 embedded, 1 not**) |
| Fixtures | `fixtures/sacrament-talk.txt`, `fixtures/stake-letter.md`, `fixtures/conference-talk-text.pdf`, `fixtures/newsletter-scanned.pdf` |

**Sign in with:** `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

> **The seeded passages will NOT come back from the Retrieval Tester, and that is expected.**
> Their embeddings are hand-written unit vectors rather than real ones, because seeding real ones
> would mean an OpenAI call on every `npm run seed`. A typed English query does not align with
> those axes. **Search for text from the documents you upload in step 4** — those are embedded
> for real. The seeded corpus is there for the counts, the toggle and the delete confirm.

## Steps

1. `npm run seed -- ai/scenario-022-upload-deactivate-delete`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop@…` and go to **Knowledge Base** in the sidebar.
4. Upload each of the four fixtures in turn, giving each a title and a kind:
   - `sacrament-talk.txt` → "The Weight of Small Covenants" / Other
   - `stake-letter.md` → "Stake letter, February 2026" / Other
   - `conference-talk-text.pdf` → "Consider the Lilies" / General conference
   - `newsletter-scanned.pdf` → "Ward newsletter" / Other — **this one should be refused**
5. In the **Try a search** box, search for `ministering` and read the results.
6. Deactivate "Consider the Lilies". Search for `lilies` again.
7. Reactivate it and search once more.
8. Delete "Stake presidency letter, January 2026" — read the confirm before accepting it.
   Then delete one of the documents **you uploaded** in step 4. The seeded letter has no stored
   file, so deleting it never runs the branch that removes the object from Storage; only an
   uploaded document exercises that path.
9. Try to upload a file over 10 MB (any large file will do).
10. Sign out, sign in as `secretary@…`, and go to `/knowledge` directly.
11. Repeat step 3 at 375px width, in both light and dark mode.

## Verification Checklist

### Machine-checkable

- [ ] `.txt`, `.md` and the text `.pdf` all ingest, each reporting a plausible passage count
- [ ] The **scanned** PDF is refused, and the message says it may be a **scan** — it does not
      appear in the list as a document with zero passages
- [ ] After the refusal, no row for "Ward newsletter" exists in the document list
- [ ] The seeded letter shows **6 passages, 5 embedded — 1 not searchable**
- [ ] The seeded Holland talk shows **4 passages, all searchable**
- [ ] The upload success line names both numbers ("Added — N passages, N embedded.")
- [ ] A file over 10 MB is refused **before** anything uploads — the button does not spin
- [ ] Retrieval Tester returns passages with readable source labels and a similarity score
- [ ] Deactivating removes that document's passages from the **very next** search, with no
      rebuild step and no page reload
- [ ] Reactivating brings them back
- [ ] The delete confirm names the passage count and says drafts already written are unaffected
- [ ] After deleting an **uploaded** document, its passages no longer appear in any search —
      search for a distinctive phrase from that document's own text. (Checking this against the
      *seeded* letter proves nothing: its embeddings are hand-written unit vectors that never
      match an English query, so the check passes whatever the code does.)
- [ ] Deleting an uploaded document also removes its file from Storage, leaving no orphan
- [ ] Signed in as `secretary`, `/knowledge` shows **"Not permitted"** — not an empty library
- [ ] As `secretary` there is no Knowledge Base link in the sidebar
- [ ] No horizontal scrolling at 375px on any of the three cards
- [ ] Every button is at least 44×44

### Needs a human eye

- [ ] Does the scanned-PDF refusal tell you **what to do next**, or only that something failed?
      Read it cold — would you know to try the text instead?
- [ ] Does "6 passages, 5 embedded — 1 not searchable" read as a **problem you can ignore for
      now**, or does it read as an error? It should be the former: the document is usable.
- [ ] Does the line "This is exactly what the AI receives as reference material" change how you
      read the results underneath it?
- [ ] Do the source labels look like something you could **go and check**? Could you find the
      passage in the original from the label alone?
- [ ] Is the similarity number useful here, or is it noise? This is the one screen where a raw
      number was chosen over words — was that right?
- [ ] When a search returns nothing, does the message read as **a deliberate answer** ("nothing
      was close enough to be worth quoting") or as a failure?
- [ ] Is it obvious that Deactivate is reversible and Delete is not, without reading the confirm?
- [ ] At 375px, can you tell at a glance which documents are active?

## Failure Behavior

- [ ] Uploading with a blank title is refused with "Give the document a title." — the file is
      not uploaded
- [ ] Uploading a `.docx` is refused naming the three types it accepts
- [ ] With `OPENAI_API_KEY` removed from `.env.local` and the dev server restarted, an upload
      fails with a message naming **OpenAI** — not Anthropic. Restore the key afterwards.
- [ ] With the same key removed, the Retrieval Tester reports it cannot reach the search service
      rather than silently returning no results
- [ ] Deleting a document twice (two tabs) gives a 404 on the second, not a 500

Cross-ward isolation, the RLS boundary, and the unembedded-passage exclusion are covered by
`tests/rls/retrieval-scoping.test.ts`. The 403s and the cascade are covered by
`tests/routes/knowledge-documents.test.ts`. Do not re-test them by hand.

## Walkthrough record

**2026-08-23 — walked by Claude in a browser, not by a person.** Started in one session, which was
closed mid-step; resumed and completed in a second. Review page: `walk-review-022.html`,
screenshots in `walk-shots-022/`.

**Settled by machine (18 items).** Observed values, not ticks:

- `.txt`, `.md` and the text `.pdf` each ingested for real — "Added — 1 passage, 1 embedded"
- Scanned PDF refused: *"Only 0 characters of text could be read from this PDF. It may be a scan
  rather than text. Try uploading the text instead."* No row, no Storage object, no audit row
- Seeded letter read "6 passages, 5 embedded — 1 not searchable"; Holland talk "4 passages, all
  searchable"
- 11.0 MB file refused in **53 ms with zero network requests** — the button never left its label
- `.docx` refused naming all three accepted types; blank title refused with "Give the document a
  title." Both cost one round trip and return 400; neither stores anything
- Retrieval on `ministering` returned 0.379 and 0.322
- Deactivate/reactivate round trip on `lilies`: **0.405 → nothing → 0.405**, no rebuild, no reload
- Delete cascade verified against the database: chunks 13 → 7 → 6, rows 5 → 4 → 3
- Deleting an uploaded document removed its Storage object (3 → 2), leaving **zero orphans**
- A phrase from the deleted document's own text no longer returns anything
- Second DELETE on a deleted id returned **404**, not 500
- 375px: horizontal overflow **0 px** in both themes; 34 controls measured, smallest exactly 44 px
- Audit log carries all six mutations with correct actions and details

**One defect found.** The delete confirm renders "removes the document and all **1** of its
passages" for a single-passage document — the plural branch is unconditional. Step 8 as originally
written deletes the six-passage seeded letter, which is exactly the case that hides it.

**Corrections made to this file.** Step 8 now also deletes an uploaded document, because the
seeded letter has `file_url = null` and so never runs the Storage-removal branch. The post-delete
search check was unfalsifiable as written (seeded embeddings are unit vectors that match no English
query) and now names an uploaded document and a phrase from its own text.

**Not walked, and why:**

- The two `secretary` items — signing in as a second account would put `HARNESS_TEST_PASSWORD`
  into a session transcript. Settled by code instead: `ward_secretary` holds no `knowledge.*`
  permission, the page returns `<NotPermitted>` without `knowledge.view`, and the sidebar entry is
  gated on the same permission. The live rendering is unconfirmed.
- The two `OPENAI_API_KEY`-removed items — editing `.env.local` was refused by the permission
  layer and not worked around. The message is proven by `tests/lib/embedBatching.test.ts:191`
  (`rejects.toThrow(/OpenAI/)`); the live path still needs a human.

**Not a defect, recorded so it is not re-reported:** the floating "N" badge overlapping the first
document row at 375px is the Next.js dev-mode indicator (`NEXTJS-PORTAL`). It does not exist in a
production build.

## Notes

- The two PDF fixtures are generated, not downloaded — `conference-talk-text.pdf` carries a real
  text layer (851 characters extract cleanly) and `newsletter-scanned.pdf` deliberately has none,
  which is exactly what a scan looks like to a text extractor. Neither contains anything
  copyrighted.
- Uploads take a few seconds each: the file is parsed, chunked and then embedded in batches. The
  button says "Reading and indexing…" throughout. That is not a hang.
- `npm run seed:clean` deletes the harness ward whole, including its documents. It does **not**
  remove objects from the `knowledge-documents` storage bucket — files you uploaded during the
  walk stay there until deleted through the app.
