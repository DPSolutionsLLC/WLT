# ITER-014: A Global Reference Library, With a Curator

**Type:** Feature
**Status:** Backlogged — **the schema decision is not deferrable; the UI is**
**Created:** 2026-08-24

## Summary

Make the standard works and General Conference talks available to **every** ward rather than
re-uploaded by each one, with ward-specific documents staying private to their ward, and a curator
who decides what enters the shared library.

## Context

Raised on 2026-08-24 reviewing the scenario 022 walkthrough, thinking ahead to the app serving more
than one ward. The user's shape, in their words:

> *"have the standard works and any general conference talks be globally available to all of the
> users of the app. but then have them able to upload their own references as well that would only
> pertain to their ward... maybe we should make it possible for others to upload general conference
> talks, but they would not be available app wide until approved by someone like myself. a curator
> responsible for the global library... not that it would have to be approved in order for it to be
> usable for the uploader, but just to make the decision as to if it should be part of the global
> library or not."*

Today every ward would re-upload the same conference talk and pay for the same embeddings, and
`ai-b`'s corpus is ward-scoped with no notion of anything shared.

## Desired Outcome

A ward opening the knowledge base sees the shared library and its own documents. It can deactivate
anything shared for its own use without affecting other wards, and cannot delete it. A ward member
uploading a conference talk gets immediate use of it, and may submit it for the global library; a
curator accepts or declines. Accepted, it becomes shared and locked. The curator can also add
categories as new kinds of shared material appear.

## Scope Notes

**This breaks a stated rule, and should do so deliberately.** CLAUDE.md rule 1 says every table has
`ward_id`, "no exceptions — not even for 'single ward' tables like `hymns` (that one is the sole
exception, documented in the schema)". A global library creates the second exception. Amend the rule
in the same change rather than letting the code quietly contradict it.

**The curator is the first app-wide role, and that is the hard part.** All nine roles are
ward-scoped, and RLS resolves a ward from `users.ward_id` — `lib/supabase/scoped.ts` and every
policy in migration 019 assume it exists. A curator has authority across wards and belongs to one,
or to none. This is a new shape in the authorisation model, not a tenth row in the permission
matrix, and it deserves its own design pass. `sacrament_manager` is the nearest precedent for "a
role that does not fit the others" and it is not very near.

**Retrieval has to match ward-owned OR shared.** `match_document_chunks` filters on `ward_id`
today. ITER-011 is already adding filter parameters to that same function, so the two want
designing together rather than one migrating over the other.

**Wards already have the "what do I use" lever.** ITER-011's scoping panel is exactly the control
for "shared, but not for us" — a global library should not ship a second, parallel mechanism for
the same decision. Deactivation of a shared document must be per-ward state, not a column on the
shared row.

**Categories become data.** `KNOWLEDGE_TYPE_TAGS` is a hardcoded const in `types/domain.ts` with a
matching CHECK constraint. Curator-created categories make it a table, which also means
`KNOWLEDGE_TYPE_TAG_LABELS` stops being exhaustive at compile time.

**Copyright is a real decision here, not a footnote.** One ward holding its own copy of a
conference talk is a different posture from a central library distributing it to every ward. The
talks are freely available from the Church, but freely readable is not the same as licensed for
redistribution, and `.gitignore` already carries the line "Nothing copyrighted enters this
repository." This should be answered deliberately before the feature is built, and it is not a
question the codebase can answer.

**The bus factor is worth naming.** A single curator who keeps conference talks current is a person
who can be unavailable. Wards must remain fully functional with a stale shared library, which the
per-ward upload path already gives them.

## The Part That Cannot Wait

Multi-ward **UI** is explicitly out of scope for v1 (`plans/INDEX.md`, Scope Guardrails: "the data
model supports it, the interface does not"), so the curator screens are genuinely post-v1.

But **whether `knowledge_documents.ward_id` is nullable is a schema decision**, and changing it
later means a migration plus re-scoping every RLS policy on that table and its `document_chunks`
cascade — with rows already in it. Making the column nullable now, with a policy that reads
"ward_id = session ward OR ward_id IS NULL", costs one migration and no UI. Retrofitting it costs
a data migration on live ward data.

Decide the column now. Build the curator later.

## Open Questions

- Does a ward's deactivation of a shared document need to survive that document being re-published
  by the curator?
- Who owns a submitted-but-declined document — does it stay the ward's private copy indefinitely?
- Is the curator a role on a user, or a separate table of grants? The first is simpler; the second
  survives the curator changing wards.
- Do shared documents count against anything a ward sees as its own — storage, counts, limits?

## Related

- [ITER-011](ITER-011.md) — the scoping panel is the per-ward "what do I use" lever this depends on
- [ITER-013](ITER-013.md) — an unfinished shared document affects every ward, not one
- [ai-b-knowledge-and-retrieval](../../plans/retros/ai-b-knowledge-and-retrieval.md) — shipped the
  ward-scoped corpus this generalises
