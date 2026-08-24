# ITER-013: Retry the Passages That Failed to Embed

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-08-24

## Summary

Give a document with unembedded passages a way to finish. `ai-b` reports a partial embedding
failure honestly and leaves the reader no action to take; this adds the action.

## Context

Raised on 2026-08-24 reviewing the scenario 022 walkthrough. Q2 asked whether
"6 passages, 5 embedded — 1 not searchable" reads as a problem you can ignore. It does, and that
was the intent. The user's objection went past the wording:

> *"I am trying to understand why we wouldn't want to try to fix it somehow... if I uploaded
> something, I would want it to be fully usable. I wouldn't want to only be using part of it."*

Which is correct, and the current design has no answer to it. `ai-b` deliberately does not fail
the upload — a 20,000-chunk volume must not be discarded because one batch of 100 hit a rate limit,
and reporting total failure makes a bishopric upload a second copy. But having chosen to keep the
document, it then offers no way to complete it. The document stays permanently 5-of-6 searchable
and the only lever on screen is Delete.

## Desired Outcome

A document showing unembedded passages offers a retry. Pressing it re-embeds only the passages
that lack a vector, updates the counts, and says what happened. A document with every passage
embedded shows no retry control at all — there is nothing to fix, and a permanent button implies
otherwise.

## Scope Notes

**This is cheaper than it looks, because nothing was thrown away.** `lib/ai/embed.ts` returns
`embeddings` index-aligned with its input and a `failedIndexes` list; `lib/knowledge/ingest.ts`
writes the failed chunks with a **null embedding and their text intact**. So the passage content
is already in `document_chunks.content` — only the vector is missing. A retry re-embeds existing
rows. It does not re-upload the file, re-run `unpdf`, or re-chunk anything, which also means it
cannot produce a different chunk boundary than the original ingest did.

**The failure is usually transient.** A rate limit or a timeout, which is exactly the case a retry
fixes. A genuinely poisoned chunk — one that fails every time — is the case to watch: the control
must not become a button that reports the same failure forever with no explanation. Worth deciding
whether a chunk that fails twice is reported differently.

**Where the control belongs.** `DocumentList` already computes `unembedded` per row to render the
counts, so the condition is in hand. It sits beside Deactivate rather than inside the `More`
disclosure that now holds Delete: retrying is safe and reversible, and the disclosure exists to
put distance between the reader and destruction.

**It needs a route, and the route needs the same permission as the upload.** Re-embedding spends
money at a vendor, so it is `knowledge.manage`, and it writes an audit row like every other
mutation. `POST /api/knowledge/documents/[id]/embed` is the shape that matches the existing four.

**The standard-works script has the same gap.** `ingestStandardWorks.ts` reports failed counts per
volume and exits; there is no way to finish a volume short of deleting and re-ingesting it, which
re-spends every embedding that already succeeded. A `--retry` flag reading the same route or query
would close both at once. Worth doing together, since the pipeline is shared.

**Files this touches:** `app/api/knowledge/documents/[id]/embed/route.ts` (new);
`lib/knowledge/queries.ts`; `app/(app)/knowledge/DocumentList.tsx`;
`supabase/scripts/ingestStandardWorks.ts`; tests for the route and the component.

## Open Questions

- Does a chunk that fails a retry get reported differently from one that has never been tried?
  Without that, a poisoned chunk gives the reader a button that always fails.
- Should the retry be offered automatically on the upload result screen, where the failure is
  first reported, as well as in the document list?
- Is there a case for retrying automatically once, server-side, before reporting the failure at
  all? It would make most partial failures invisible, at the cost of a slower upload.

## Related

- [ai-b-knowledge-and-retrieval](../../plans/retros/ai-b-knowledge-and-retrieval.md) — shipped the
  partial-failure reporting this completes
- [ITER-014](ITER-014.md) — a global library makes an unfinished shared document everyone's problem
  rather than one ward's
