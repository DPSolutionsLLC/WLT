---
id: sacrament-references-over-pgvector
type: feature
iter: null
commits: ["b34a000"]
date: 2026-09-24
files:
  - supabase/migrations/079_talk_references.sql
  - supabase/migrations/080_talk_references_bishopric_read.sql
  - lib/references/queries.ts
  - lib/references/finalize.ts
  - lib/references/suggestions.ts
  - lib/validation/references.ts
  - lib/calendar/queries.ts
  - lib/topics/finalize.ts
  - lib/knowledge/queries.ts
  - lib/sacrament/sundayStatus.ts
  - app/api/sundays/[id]/references/route.ts
  - app/api/sundays/[id]/references/[referenceId]/route.ts
  - app/api/sundays/[id]/references/search/route.ts
  - app/api/sundays/[id]/references-decision/route.ts
  - app/(app)/sacrament/page.tsx
  - components/sacrament/ReferencesPill.tsx
  - components/sacrament/ReferencesEditor.tsx
  - components/sacrament/ReferenceSearchDialog.tsx
  - components/sacrament/ManualReferenceDialog.tsx
  - components/sacrament/referenceShared.ts
  - components/sacrament/FinalizeToggle.tsx
  - components/sacrament/FinalizeTopicsButton.tsx
  - components/sacrament/StatusPill.tsx
  - components/sacrament/SundayCard.tsx
  - components/ui/Modal.tsx
  - types/domain.ts
related:
  - sacrament-topics-finalize-and-history
  - p4-sacrament-a-hub-and-reskin
  - ai-b-knowledge-and-retrieval
  - roster-b-picker-and-orgs
  - p3-shell-and-tile-dashboard
  - foundation-c-services
  - ward-callings-model
  - youth-g-occasions-and-event-detail
---

## What was done
P4 module 1, slice `c`. The prototype's References pill and modal, built on WLT's semantic retrieval
(`retrieveChunks`, pgvector, the ward's conference scope) instead of the prototype's keyword match.
A `Refs` pill after Topics opens a modal on `/sacrament`. For each talk with a topic the bishopric
searches, ticks one or more results (plus the topic's own suggested scriptures), or types a
Scripture / General conference talk by hand. The day is then **finalized** or **skipped**, which are
two timestamps on `sundays` under a CHECK forbidding both (migration 079). References attach to
the talk (`assignments` row), never a slot. Walking scenario 074 twice reworked the slice
substantially, driven by the user's answers.

## Key decisions
- **Bishopric-only, end to end** (migration 080, user decision 074-D2). 079 let `talks.view`
  (the music coordinator) read references. The user said nobody else should see them, so the read
  narrowed to `is_bishopric()`, the GET route asserts `talks.plan`, and the pill is **absent**
  without it. There is no read-only mode left to maintain.
- **Skip only when empty; add clears a skip** (074-D1). "Not giving references this round" over
  listed references is two claims on one pill. The add rule deviates from the prototype on
  purpose. The skip refusal is a 409 naming the alternative, and nothing is deleted to allow it.
- **A topic change un-finalizes References but leaves a skip** (decision 2).
  `unfinalizeTopicsIfNeeded()` now clears both stamps in one UPDATE through
  `clearTalkShapeStamps()`. Its name no longer tells the whole story and its header says so.
- **The page shows the choice, the choosing happens in windows.** Each talk gets small
  Search / Add manually buttons (28px to see, 44px to tap), and a **Search any topic** button above
  the talks opens the same window empty with an "Add to" picker. Search uses TanStack Query keyed
  on the submitted words, never an effect: the lint rule refused setState-in-effect, and the query
  cache also stops "Add to" changes spending a second embedding call.
- **The shared `Modal` changed twice, and both changes affect every popup.** It now closes only on
  its OWN `close` event, because React propagates `close` through the component tree, so a nested
  window used to close its parent (proven with a test that fails without the guard). It also fits
  its content: a bottom sheet on phones, a centred card from md up.

## What broke along the way
- **`h-auto` on a modal `<dialog>` stretches it to the cap.** A modal dialog is fixed with inset 0,
  so `height:auto` fills the viewport and the card sits at the top of an invisible full-height box.
  The browser default is `fit-content`; the fix is `h-fit`. Only measuring the element's box in a
  real browser caught it, because the screenshot just looked "top-aligned".
- **`npm run build` over a running `npm run dev` left every API route answering 404**, including
  sign-in, while pages still rendered. Stop the dev server, delete `.next`, and restart.
- **Two checklist lines could not fail, and one was unreachable.** Uploads are unlabelled, so
  "no (part n of m)" always passed. No seeded Sunday was open with zero references. The seed gave
  no topic suggested scriptures, so the new picks were unwalkable until the seed was fixed.
- **Retrieval is ward-scoped, and the user wants a shared, admin-loaded corpus for every ward.**
  That was raised and NOT built. It collides with rule 1 and the per-ward conference scope, and
  needs its own plan.
