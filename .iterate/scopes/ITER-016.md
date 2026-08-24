# ITER-016: Citations the Model Invented

**Type:** Bug
**Status:** Backlogged
**Created:** 2026-08-24

## Summary

AI-suggested topics carry conference talk citations that look real and are not. Nothing in the
current design constrains a citation to material the ward actually holds, so the model supplies
them from memory — and a citation from memory is a citation that can be wrong in a way nobody
notices until they go looking for the talk.

## Context

Found 2026-08-24 walking scenario 024 for `ai-c`. Three generations produced fifteen candidates.
Spot-checking the talk citations, at least two were wrong and the user confirmed both:

- `Elder Dieter F. Uchtdorf, "Point of Safe Return", April 2021` — the talk is real; the date is
  not.
- `Sister Joy D. Jones, "Powerful Beyond Measure", April 2017` — a real speaker attached to a
  title that is not hers.

Others in the same batch were correct (`Elder Richard G. Scott, "Using the Supernal Gift of
Prayer", April 2007`). That mixture is the problem: a batch where every citation is wrong gets
noticed immediately, and a batch where most are right teaches the bishopric to trust the rest.

**The walk's audit rows show `retrievedChunks: 0` on every run**, because the harness corpus uses
hand-seeded unit-vector embeddings that cannot match a real query. So this walk was the pure
from-memory case. The open question is how much a real corpus actually helps.

## Why uploaded talks do not fix this on their own

The obvious answer — "it will be fine once the ward has uploaded real talks" — is only partly
true, and three specific things stand in the way. All three are in the shipped code today.

1. **Nothing forbids citing outside the retrieved set.** `CITATION_INSTRUCTION` says to cite the
   source of any talk referenced. `renderChunks` says the excerpts are partial. Neither says *only
   reference what you were given*.
2. **`preferKnowledgeBase` renders as a preference, not a rule** — *"Prefer talks and documents
   from the ward's own knowledge base over ones you recall."* That sentence is explicit permission
   to fall back to memory, and it is the ward-facing setting most likely to be read as a guarantee.
3. **`topicSuggestionsSchema.suggestedTalks` is free text.** Three strings, validated for length
   and nothing else. The route inserts whatever comes back.

There is also a structural reason the corpus will usually be thin here. CLAUDE.md §9 fixes the
conference corpus at "forward from now, plus roughly the last two years", deliberately, because
`retrieveChunks` returns 6–8 chunks across the *entire* corpus and more talks crowd out scripture.
So for most topics there will be no relevant talk in the corpus at all, and the model will keep
reaching for one it half-remembers.

**Scripture is a different case and is probably already fine.** The standard works are ingested in
full, so scripture references should ground properly once `knowledge:ingest` has run. This scope is
about *talk* citations.

## Desired Outcome

A conference talk citation that reaches the candidate queue is either verifiably in the ward's
corpus, or is visibly marked as unverified. A bishopric member should never have to guess which
kind they are reading.

## Scope Notes

**The cheap half is a verification pass, not a prompt change.** After `callClaudeStructured`
returns and before `createCandidates` inserts, each suggested talk could be checked against
`knowledge_documents` for that ward. Titles are already stored. A citation with no match is either
dropped or flagged. This is deterministic, testable without a model, and does not depend on
persuading Claude to behave.

**The prompt half is worth doing too, but is not sufficient alone.** Saying "only cite talks that
appear in the material above" reduces invention; it does not eliminate it, and it cannot be tested
except by sampling. Treat it as a second layer, not the fix.

**Dropping and flagging are different products.** Dropping gives a shorter, trustworthy list.
Flagging (*"not in your library — check before using"*) keeps the suggestion and moves the judgement
to a person, which is more in keeping with rule 3. Flagging needs a column on `topic_candidates` and
a place on the card; dropping needs neither.

**Related to ITER-011 and worth sequencing with it.** ITER-011 already adds speaker, date and
calling to `knowledge_documents` so the corpus can be filtered. Those are exactly the fields a
verification pass would match against, and building this first would mean matching on title alone
and then redoing it.

**No test could have caught this**, and that is worth recording. `tests/routes/ai-suggest.test.ts`
mocks `callClaudeStructured` with fixed values, so it asserts what the route does with a citation
and never whether the citation is true. Correctness of model output is explicitly out of scope for
unit tests (CLAUDE.md §8) — which means a verification pass is the only mechanism that can make this
a testable property rather than a hope.

## Open Questions

- Drop or flag? Rule 3 argues for flag; a shorter honest list argues for drop.
- Does a scripture reference need the same treatment once the standard works are ingested, or is
  full-corpus ingest enough to make invented verses rare?
- Should `preferKnowledgeBase` gain a stricter third state — "only the knowledge base" — or is that
  a setting nobody will understand the consequences of?
