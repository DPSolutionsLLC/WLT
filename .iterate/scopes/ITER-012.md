# ITER-012: Show How Often a Talk Has Been Suggested

**Type:** Feature
**Status:** Backlogged — **logging ships with ITER-011; only the display is deferred**
**Created:** 2026-08-23

## Summary

When the AI suggests a conference talk or a scripture passage, show when it was last suggested and —
once it has come up more than once — how often it comes up.

## Context

Raised on 2026-08-23 alongside ITER-011, in the user's words: *"it wouldn't hurt to build in a
feature that shows the last time a suggested talk was suggested along with a percentage of how often
it is suggested once it has been suggested more than once."*

This is already an idiom in this app rather than a new one. The topic library orders by staleness and
stamps `last_assigned_at`; `lib/prayers/lastPrayed.ts` does the same for prayers. "When was this last
used" is a question this codebase already knows how to answer and already knows how to display.

## Desired Outcome

A suggested talk carries a quiet secondary line: *last suggested 12 August*, and where it applies,
*appeared in 8 of your last 20 generations*.

The percentage is a **diagnostic**, not decoration. A talk surfacing in 40% of generations means the
corpus is too small or retrieval has found a groove — and that is exactly the signal a bishopric
needs to decide whether to widen their scope (ITER-011) or ingest another conference.

## Scope Notes

**This has a deadline, which is why it is written now.** Suggestion history cannot be backfilled. Any
week the write is not happening is a week permanently missing from the denominator, and a percentage
built on three weeks of data is worse than no percentage. **The `retrieval_suggestions` table and its
writes therefore ship inside ITER-011**, before anything displays them. This scope covers the display
only, and can wait as long as it likes.

**Render nothing rather than "Never".** `talks-c-prayers-topics` established this for the last-prayed
nudge and the reasoning transfers exactly: a document suggested once has no meaningful frequency, and
"1 of 1 (100%)" is actively misleading. The user's own framing already said *once it has been
suggested more than once* — the rule and the request agree.

**Decide what the percentage divides by, and say it on screen.** "40%" alone is unreadable. The
denominator that makes it a diagnostic is *runs*, not documents: appeared in N of the last M
generations. That is why `retrieval_suggestions` carries a `run_id` shared across everything one
`retrieveChunks` call returned — without it you can count appearances but have nothing to divide by.

**Choose a window rather than counting forever.** "8 of your last 20" answers a question a bishopric
has; "1,412 of 9,830 since March" does not. The window is a product decision and probably belongs
next to the scope panel, not buried in a constant.

**What it must not log.** `retrieval_suggestions` holds document ids and timestamps. Never the query,
never the prompt, never the generated text — the same line `ai-c` draws for its audit rows.

**Where it displays** is a genuine open question: on the knowledge document list, on the topic
candidate queue, or inline on whatever surface `ai-c` builds for suggestions. Probably more than one,
which argues for a small shared component rather than three formatting sites.

**Files this touches:** a query module over `retrieval_suggestions`; one presentational component;
whichever surfaces adopt it. No migration — ITER-011 already ran it.

## Open Questions

1. **What is the window?** Last 20 generations, last 90 days, or all time. Affects whether the number
   reads as current behaviour or lifetime trivia.
2. **Does the count span modules?** A talk retrieved for a thank-you message and for topic generation
   are different events. Combining them is simpler; separating them is more truthful.
3. **Is there a threshold that warrants a nudge?** A talk over some percentage arguably deserves a
   quiet "your corpus may be too narrow" line — which would make this the first place the app
   volunteers an opinion about retrieval quality.
4. **Do deleted documents keep their history?** The FK cascades today, so deleting a document erases
   its suggestion rows. That is probably right, and it is worth being deliberate about.

## Related

- **ITER-011** — ships the table and the writes this reads. Cannot be reordered.
- **`talks-c-prayers-topics`** — the render-nothing-rather-than-"Never" precedent.
- **`talks-d-reliability-goals`** — the nearest existing example of computed-on-read status shown as
  a quiet secondary line.
- **`plans/05-ai-platform.md`** — the phase this belongs to.
