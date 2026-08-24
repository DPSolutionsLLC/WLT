---
id: ai-a-client-and-settings
type: feature
iter: null
commits: ["3cf9d28"]
date: 2026-08-23
files:
  - lib/ai/errors.ts
  - lib/ai/client.ts
  - lib/ai/moduleInstructions.ts
  - lib/ai/systemPrompt.ts
  - lib/ai/queries.ts
  - lib/validation/aiSettings.ts
  - app/api/ai-settings/route.ts
  - app/api/ai-settings/history/route.ts
  - app/api/ai-settings/restore/[id]/route.ts
  - app/api/ai-settings/preview/route.ts
  - app/(app)/ai-settings/page.tsx
  - app/(app)/ai-settings/AiSettingsForm.tsx
  - app/(app)/ai-settings/PreviewPanel.tsx
  - app/(app)/ai-settings/VersionHistory.tsx
  - lib/auth/routeErrors.ts
  - types/domain.ts
related:
  - foundation-c-services
  - route-tests-and-realtime
  - talks-c-prayers-topics
  - roster-b-picker-and-orgs
  - auth-b-invites-admin
---

## What was done

The first real Claude call in this app, and the panel that configures every later one. Three
things that only prove each other together: the **client** (`claude-sonnet-5`, adaptive thinking,
effort nested in `output_config`, six typed error kinds), the **system prompt assembler** (pure,
takes resolved settings as an argument, cache breakpoint on the last stable block), and the
**AI Settings panel** — seven sections, append-only versioning, history, restore, and a preview
that runs against *unsaved* draft settings.

Five routes, 69 tests, two harness scenarios. `callClaude` has exactly one caller — the preview
route — which was the point: the client is proven through a surface a human can see before
anything depends on it. `ai-b` adds retrieval behind an already-tested interface; `ai-c` adds the
rest of the callers.

## Key decisions

- **`buildSystemPrompt` is pure and takes settings, not a `wardId`** — a deliberate deviation from
  the phase plan. A function that resolves its own ward needs a database to test, and every other
  pure rule here (`goalStatus`, `messageTemplate`, `prayerPipeline`) is a function of its inputs
  for that reason. The caller resolves; this assembles.
- **The cache breakpoint sits on the LAST STABLE block, with retrieved chunks after it.** Caching
  is a prefix match, so anything cached after per-request chunks never hits. The test asserts
  breakpoint *placement*, never a non-zero `cache_read_input_tokens` — the ~1024-token minimum
  prefix means a sparse ward legitimately never caches, and a test asserting otherwise would fail
  for a reason that is not a bug.
- **Six error kinds, six distinct sentences, and an unknown error is RETHROWN.** Folding the
  unknown case into `invalid_request` would tell a user "nothing was saved" without knowing
  whether that is true. A test asserts the message set has size six, so a copy-paste that
  collapses two failures fails there rather than in front of a bishop.
- **`lib/ai/queries.ts` has no update function and no delete function**, and that absence *is* the
  versioning guarantee rather than a rule somebody has to remember. Restore appends a copy.
- **Preview takes `ai_settings.manage`, not `.view`** — it spends money and sends ward text to a
  third-party vendor, which is the authority to change settings rather than to read them. It is
  audited despite mutating nothing, because a spend with no record is not something an audit log
  should be silent about.
- **Saver names come from a second query, not a PostgREST embedded join** — the FK to `users` is
  composite (`saved_by, ward_id`) and embedded-join syntax over one depends on a generated
  constraint name.
- **SPEC.md said `claude-sonnet-4-6`; it now says `claude-sonnet-5`.** CLAUDE.md had carried the
  override as a note since Phase 0. Fixed the spec in the same change rather than leaving two
  documents disagreeing (CLAUDE.md §1).

## What the walkthrough found

**Restoring a version updated the history and left the form showing stale values**, so a restore
looked like it had done nothing. `router.refresh()` re-runs the Server Component and hands down
fresh props but **deliberately preserves client state**, so `useState(() => toDraftState(...))`
never ran a second time. The form was the only visible evidence a restore had happened, and it
was the one thing that did not move.

Every server-side test passed throughout — nothing server-side was ever wrong. The route suite
proved the row was appended with the right content and the right saver; the RLS suite proved the
policy allowed it. **Neither could see the screen.** That is the gap the harness exists for, and
it is the second time in this project a defect has lived entirely in the space between a correct
server and a component that never re-read it.

Fixed by resetting draft state during render when the active version id changes — React's
documented pattern for state that must follow a prop, and preferable to a `key` on the parent,
which would remount the form and discard the "Saved" note with it. Covered by
`tests/components/ai-settings/AiSettingsForm.test.tsx`, which was confirmed to fail without the
fix before being kept.

**The generalisable lesson, stated precisely:** copying a Server Component's data into `useState`
and relying on `router.refresh()` is safe **only while that component is the sole writer of that
data**. Then the refreshed props already equal the state and the staleness is invisible. It breaks
the moment a *sibling* changes the same data — which is exactly what `VersionHistory` does to
`AiSettingsForm`.

Checked the rest of the codebase rather than leaving the claim speculative.
`CalendarSettingsPanel`, `SundayEditor` and `OrgConductingEditor` all have the same *shape* — state
seeded from a server prop, `router.refresh()` after a write — but each is currently the only writer
of what it displays, so none of them is presently wrong. They are worth remembering the day a
second control lands on one of those pages, because the failure is silent and no server-side test
can see it.

## Handed forward

- `buildSystemPrompt`'s `retrievedChunks` parameter and the layer-3 branch ship here, tested with
  an empty list. `ai-b` supplies real chunks and changes no signature.
- `callClaudeStructured` and three unused `AI_MODULES` entries are for `ai-c`.
  `MODULE_INSTRUCTIONS` already holds a block for each.
- **ITER-009** (name a settings version) and **ITER-010** (per-leader settings applied on the
  conducting rotation) were both raised during the walkthrough and backlogged. ITER-010 is
  architectural: it turns "the ward's AI settings" into two layers and needs a new RLS shape.
