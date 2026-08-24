---
name: The standard works, ingested
scope: ai-b-knowledge-and-retrieval
part: 1
tags: [ai, knowledge, full, script]
prerequisites: none
---

## Purpose

The ingestion script is the one thing in Phase 5 with no automated coverage at scale, and every
one of its failure modes only appears on a real run: a malformed record 30,000 rows in, a second
run silently doubling the corpus, an embedding batch failing without saying so, and a chunk that
splits mid-verse and produces a citation nobody can check.

It also proves the claim the whole plan rests on — that **the script and the upload route share
one pipeline**, so the count the script prints and the count `/knowledge` shows cannot disagree.

A ~177-verse sample corpus exercises every path in about ten seconds: validation, grouping,
chapter labelling, batching, the summary table, and the idempotency refusal. Bring your own full
corpus too if you have one, but do not treat the sample as a lesser test — it reaches everything
except the wall-clock.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (`11111111-1111-4111-8111-111111111111`) |
| Users | `bishop@…` (bishop, Mark Andersen) |
| Knowledge documents | **none** — the script creates them |
| Fixtures | `fixtures/sample-corpus.json` (177 verses, 2 volumes, 9 chapters), `fixtures/sample-corpus-corrupt.json` (the same file with record **137** broken) |

**Sign in with:** `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

The sample corpus contains **placeholder prose, not scripture.** What is under test is grouping,
labelling, batching and refusal — none of which depend on the words. Nothing copyrighted is in
this repository, and a real corpus file you supply is gitignored under `/corpus/`.

## Steps

1. `npm run seed -- ai/scenario-023-standard-works-ingested`
2. Run the ingest, watching the output as it goes:
   ```
   npm run knowledge:ingest -- --corpus testing/scenarios/ai/scenario-023-standard-works-ingested/fixtures/sample-corpus.json --ward 11111111-1111-4111-8111-111111111111
   ```
3. Read the final table.
4. `npm run dev`, sign in as `bishop@…`, open **Knowledge Base**.
5. Search the Retrieval Tester for `charity` and read the source labels.
6. Run the **exact same command again**.
7. Run it once more against `fixtures/sample-corpus-corrupt.json`.
8. Check the exit code of that last run: `echo $?` (bash) or `echo $LASTEXITCODE` (PowerShell).

## Verification Checklist

### Machine-checkable

- [ ] Progress prints **during** the run — lines of the form `Book of Mormon — 40/101 passages
      embedded` — rather than going silent
- [ ] The final table has one row per volume with Passages, Embedded and Failed columns
- [ ] Two volumes appear: **New Testament** then **Book of Mormon** — canonical order as defined
      by `STANDARD_WORKS` in `types/domain.ts` (OT, NT, BoM, D&C, PoGP), *not* the order the
      corpus file lists them in. The fixture deliberately lists Book of Mormon first, so seeing
      New Testament first is the check passing, not failing
- [ ] `/knowledge` lists those two volumes as documents, tagged **Standard works**
- [ ] The passage counts on `/knowledge` **match the table the script printed**
- [ ] Their uploader reads as loaded from the command line, not as a person
- [ ] Retrieval Tester on `charity` returns passages with chapter-and-verse source labels
      (e.g. `Book of Mormon — Alma 32:1–25`)
- [ ] **No label spans a partial verse** — every label ends on a verse boundary
- [ ] The second run **refuses**, naming the existing document and its passage count
- [ ] After the second run, `/knowledge` still shows **two** documents, not four, and the counts
      are unchanged
- [ ] The corrupt run fails naming **record 137** and its field
- [ ] The corrupt run fails **before any embedding is spent** — no progress lines appear
- [ ] The corrupt run exits **non-zero**
- [ ] After the corrupt run, no new document was created

### Needs a human eye

- [ ] Does the progress output tell you it is **working** rather than stuck? A twenty-minute run
      with a full corpus lives or dies on this.
- [ ] Does the refusal on the second run tell you **what to do** to reload deliberately, or only
      that it stopped?
- [ ] Read a source label cold: could you open a physical copy and find that passage?
- [ ] Do the retrieved passages read as **whole thoughts**, or do they start and stop mid-idea?
      This is what the chapter-boundary path exists to get right.
- [ ] Does the final table read as a **report you would trust**, or would you want to go and
      check something it does not show?
- [ ] Is it clear from `/knowledge` alone that these came from a script rather than an upload?

## Failure Behavior

- [ ] Running with no arguments prints the usage line and exits non-zero
- [ ] Running with `--corpus` pointing at a missing file names the path and exits non-zero
- [ ] Running with a corpus that is a JSON **object** rather than an array says so
- [ ] With `OPENAI_API_KEY` removed, the run fails naming **OpenAI** and writes no document
- [ ] Deleting one volume through `/knowledge` and re-running ingests **only** that volume — the
      other is still refused

## Walkthrough record

**2026-08-23 — walked by the user, by hand, at the command line.** Reported as all checks passing.
Claude did not drive this one; the values below were read back from the database afterwards to give
the record something concrete to diff against.

**Confirmed against the database after the run:**

- Two documents, both tagged `standard_works`, both `active`
- **New Testament 9/9 passages embedded; Book of Mormon 12/12** — 21 chunks from 177 verses
- `uploaded_by` is `NULL` on both, so they read as loaded by a script rather than by a person
- Every chunk carries a chapter-and-verse label prefix, e.g. `Alma 32:1–25 (part 1 of 3)`,
  which `lib/ai/retrieve.ts` renders as `Book of Mormon — Alma 32:1–25 (part 1 of 3)`
- Volume order in the database is New Testament before Book of Mormon — canonical, and the
  opposite of the order the fixture lists them in, which is the reordering working

**Correction made to this file.** The checklist item on volume order named *"**Book of Mormon**
and **New Testament**, in that (canonical) order"*, which is backwards: `STANDARD_WORKS` defines
the canon as OT, NT, BoM, D&C, PoGP, and the ingest script re-sorts to it deliberately. Read
literally, the old wording would have failed a correct run. Reworded.

**Observation, not a defect — worth a decision.** All 21 chunks are multi-part: every label names
a full chapter range while the chunk holds one slice of it (`Alma 32:1–25 (part 2 of 3)`). The
splits do fall on verse boundaries, so the check as written passes, and `(part n of m)` is honest
about there being more. But no label narrows to the verses actually in that chunk, so a citation
points at a range up to three times larger than the text it accompanies. Fine for finding the
passage; imprecise if the label is ever quoted as the source of a specific line.

Not yet walked.

## Notes

- The sample corpus takes about ten seconds. A real standard-works corpus is tens of thousands of
  passages and will take **twenty minutes or more** — that is the reason this is a script and not
  a route.
- The script writes with the service-role client and needs no signed-in user. It does need
  `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` in `.env.local`.
- Idempotency is **refusal, not upsert**, and that is deliberate: silently replacing a corpus
  somebody spent twenty minutes building is not a decision a script should make. To reload, delete
  the volume through `/knowledge` first.
- The ward id above is the harness ward. Do not point this at a real ward.
