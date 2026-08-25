---
id: program-e-music-and-hymns
type: feature
iter: null
commits: ["8926419"]
date: 2026-08-25
files:
  - supabase/migrations/042_hymn_source.sql
  - supabase/migrations/043_music_write_scope.sql
  - lib/music/hymnSource.ts
  - lib/music/queries.ts
  - lib/music/hymnSearch.ts
  - lib/music/hymnCandidates.ts
  - lib/music/sundayTopics.ts
  - lib/ai/hymnSuggestions.ts
  - lib/validation/music.ts
  - supabase/scripts/hymns.ts
  - app/api/hymns/route.ts
  - app/api/hymns/suggest/route.ts
  - app/api/hymns/select/route.ts
  - app/api/musical-numbers/route.ts
  - app/(app)/music/page.tsx
  - app/(app)/music/SundayMusicCard.tsx
  - app/(app)/music/HymnSearchModal.tsx
  - app/(app)/music/SuggestHymnsButton.tsx
  - app/(app)/music/MusicalNumberForm.tsx
  - components/music/HymnPicker.tsx
  - components/music/UnverifiedHymnBadge.tsx
  - lib/program/gather.ts
  - app/(app)/program/[sunday_id]/MeetingOrderForm.tsx
  - lib/pdf/values.ts
  - lib/ai/moduleInstructions.ts
  - types/domain.ts
  - supabase/seed/hymns.sql
related:
  - program-a-draft-and-approval
  - program-b-builder-screen
  - program-d-pdf-and-distribution
  - ai-c-feature-routes
  - ai-b-knowledge-and-retrieval
  - talks-c-prayers-topics
  - roster-c-csv-import
  - calendar-c-rotation-cadence
---

## What was done

Phase 6 closed: the music coordinator's screen, hymn search, AI-assisted hymn suggestions and
musical numbers, plus the provenance column that let any of it be built at all. The hymnbook is
still only 42 hand-verified rows of 341, so the other 299 were filled with rows titled
`[Placeholder] Hymn 43` carrying `source = 'placeholder'` — obviously synthetic, believable by
nobody, and deleted by one command when a real hymnbook arrives. `gather.ts` gave up its two
temporary readers to `lib/music/queries.ts`, which is the handover `program-a` named when it
wrote them.

The AI half is the reason the plan existed. ITER-016 recorded two wrong conference-talk citations
in fifteen, and a wrong hymn number is that failure with a congregation singing the result. The
mitigation is that the model never recalls a number: the full candidate list goes into the prompt
so it ranks rather than remembers, and every number that comes back is checked against the table
before it reaches a screen. Walking scenario 036, two generations returned `droppedNumbers: []`
and **the user confirmed three of the suggested numbers against a physical hymnbook** — the first
AI output in this codebase verified against a source outside the app's own data.

## Key decisions

- **Placeholders are ugly on purpose, and carry no topic tags.** The ugliness is the safety
  property — the same instinct as `program-c` omitting fields from `PublicProgram` rather than
  nulling them. Giving them synthetic tags would have made subject search *look* populated while
  returning meaningless results, which is worse for testing than an honestly empty result; walking
  it confirmed this, since `sacrament` returned 14 real hymns and nothing else. `hymns:reset`
  deliberately has no `--all` flag: deleting the 42 verified rows is not something anybody should
  be one flag away from.

- **The candidate list goes in the prompt; the table is the guarantee.** The prompt is a request,
  the post-validation is the promise — the same split `ai-c` used for duplicate topic titles. Only
  the 42 authoritative rows are ever offered as candidates, so a placeholder can never be
  suggested even though it is searchable. If every returned number were dropped that is an error
  with its own sentence, not an empty list, because a silent empty shortlist reads as "the model
  had no ideas" rather than "everything it said was wrong".

- **A selection stores the number AND the title, and writes nothing through to an existing draft.**
  The title is denormalised so a program snapshot survives the hymn table changing under it, and
  choosing a hymn after a draft exists shows up in the refresh diff rather than mutating the
  stored draft — `program-a`'s snapshot rule, unweakened. `ai_suggested` is set in exactly one
  place, which is what makes "how often is the AI actually right" answerable later.

- **Migration 043 narrows the write, not the read**, following 037 exactly: `hymn_selections` and
  `musical_numbers` inserts, updates and deletes are limited to bishopric, music coordinator and
  ward secretary via `current_user_role()`, leaving 019's ward-wide SELECT alone. The ward's
  `role_access` override is honoured by `assertCan()` in the route, not by the policy — the two
  together are strictly narrower than either alone.

## What the walk found

- **A pre-existing bug in `writeAuditLog`, not caused here.** Its redaction regex matches the
  substring `token`, so `outputTokens` is stored as `"[redacted]"`; it also matches `note`, so the
  boolean `hasNotes` is scrubbed. Both are counts, not secrets, and the redaction destroys the
  cost signal the field exists to carry. `topic_candidates_generated` has been logging a redacted
  token count since `ai-c`. Reported and left unfixed — it touches every AI route's audit trail
  and deserves its own change.

- **One checklist item was wrong, and the app was right.** The scenario demanded the card read
  "Two hymns still to choose". The app uses digits for a plural and spells out only the singular,
  which is the convention `program-b`'s list page already follows. The check was rewritten rather
  than the app bent to a checklist written from the plan.

- **Confirming a hymn by hand has nowhere to go.** Three hymns were verified against a real book
  during the walk and the app could not record it: `source` moves from `placeholder` to
  `authoritative` only through `hymns:import`, which needs a whole authoritative file nobody has.
  A per-hymn "I checked this one" path is the obvious next change, and it forces a decision this
  plan did not have to make — `hymns` is the one table with no `ward_id`, so any in-app write to
  it edits every ward's hymnbook. Logged as the follow-up; RLS on `hymns` remains SELECT-only.
