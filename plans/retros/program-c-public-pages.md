---
id: program-c-public-pages
type: feature
iter: ITER-004 (public half; program-d closes the printed half and the scope)
commits: ["b954176"]
date: 2026-08-24
files:
  - lib/program/publicProjection.ts
  - lib/program/publicQueries.ts
  - lib/supabase/anon.ts
  - app/public/layout.tsx
  - app/public/[slug]/page.tsx
  - app/public/[slug]/ProgramPanel.tsx
  - app/public/[slug]/not-found.tsx
  - supabase/migrations/039_public_program_projection.sql
  - app/api/programs/[id]/approve/route.ts
  - app/(app)/program/[sunday_id]/ProgramBuilder.tsx
  - lib/program/queries.ts
  - lib/program/assembleDraft.ts
  - testing/infrastructure/seedUtils.ts
  - types/database.ts
  - SPEC.md
  - CLAUDE.md
  - FEATURES.md
related:
  - program-a-draft-and-approval
  - program-b-builder-screen
  - foundation-b-schema
  - talks-a-pipeline-core
  - talks-c-prayers-topics
  - ai-b-knowledge-and-retrieval
  - deployment
---

## What was done

The app's only unauthenticated page. `programs.public_data` is a narrow projection computed by one
pure function at approval and stored beside `draft_data` rather than derived from it; migration 039
replaces `public_program` with a view exposing that column and nothing else; `/public/[slug]` is a
no-chrome Server Component reading it through an anon client that cannot reach a base table.

Walking scenarios 032 and 033 with a person reading the real page **reversed two of the plan's own
decisions** and found a dead-end instruction in `program-b`.

## Key decisions

- **A separate column, not a jsonb path into `draft_data`.** `foundation-b-schema` deferred this
  to Phase 6 with the reason written down: `draft_data` carries full surnames, leadership contacts
  *with phone numbers*, and missionary information. A view selecting `draft_data -> 'speakers'`
  would publish whatever a later phase adds under that key, silently. Two columns, one written by
  one tested function.

- **The forbidden fields are ABSENT from `PublicProgram`, not nulled.** There is no
  `leadershipContacts` key to populate by accident, so rendering one is a compile error rather than
  a review miss. `toPublicProgram` builds the object literally and never spreads — a
  spread-then-delete leaks every field added afterwards and fails silently.

- **The highest-value test scans for strings that must not appear**, rather than listing fields
  that may. A test that enumerates allowed fields passes forever, including on the day somebody
  adds `missionaries`. `tests/lib/publicProjection.test.ts` fails when the fixture's phone number,
  address, email or member id appears anywhere in the serialised output, without anybody updating
  the assertion.

- **Names are published IN FULL — reversed from the plan, by the walk.** The page first shortened a
  ward member to "Sarah W." while naming a visiting speaker in full one line below (ITER-004). On a
  real screen that did not read as a privacy rule; it read as a bug nobody had noticed. The
  shortening lived in `publicNameFor()` and is gone. **The boundary did not move** —
  `toPublicProgram()` still reads only `publicName`, `printedName` still has no code path to the
  page — so what changed is what crosses the boundary, not where it is. The name pair is KEPT and
  now means what it says: printed is the paper, public is the web, they default to the same text,
  and a ward can make them differ for one person on one program.

- **`noindex` on the public shell, added with the reversal.** "Anyone holding the link can read a
  ward's full names" and "that roster is gathered into a search index and kept there" are different
  promises, and only the first was intended. Not an access control — the view and the projection
  are — and it costs one line.

- **A gap renders instead of vanishing — also reversed by the walk.** An omitted empty slot LOOKS
  CORRECT: nobody can tell "this meeting has two speakers" from "nobody filled in the third", so
  nothing ever prompts the bishopric to set that Sunday's slot count to two. This is the same
  conclusion `program-b` reached walking scenario 031, arrived at independently on a different
  screen. The optional blocks are still omitted when empty, which is a different rule: no slot
  stands open for a musical number.

- **Distribution is what publishes a program, not approval.** FEATURES.md said "the most current
  *approved* version"; the gate is `status = 'distributed'`, because distribution is the act of
  handing it to the ward. FEATURES.md was corrected rather than the code — it also claimed the page
  "updates instantly if edits are made post-distribution", which the status machine has never
  allowed (`distributed` has no legal transition out).

- **One 404 for every way of not existing.** Unknown slug, deactivated slug, undistributed program
  and unparseable projection all reach `notFound()` with byte-identical output. A database *error*
  is deliberately not one of them — `publicQueries` throws, so a dropped grant surfaces as a 500 in
  a log rather than as a 404 that looks like a typo.

## Pitfalls for whoever comes next

- **A slug identifies a WARD'S PAGE, not a program.** `public_program` joins `public_pages` to
  `programs` on `ward_id` alone, so an active slug matches every distributed program that ward has
  ever had. Found by a test failing, not by reading the SQL. `getPublicProgram` orders by
  `sunday_date` descending and takes one; the `.limit(1)` is load-bearing. `program-d` should create
  at most one program page per ward.

- **A dropped-and-recreated view loses its grants.** `grant select on public_program to anon` is in
  migration 039 for that reason. The failure mode is a public page that 404s for everyone with
  nothing in any log. Verified after `db:push` by reading through the anon key, not by trusting the
  migration.

- **The walk's first render was signed in.** A live Supabase session cookie was still in the browser
  profile, so the page looked correct while "renders signed out" had not been tested at all. The
  scenario warns about exactly this and it still caught an agent. Check `document.cookie` is empty
  before believing anything about this page.

- **A PostgREST bulk insert nulls out keys absent from some rows.** Seeding three `public_pages`
  where only one set `is_active` failed the NOT NULL constraint, because the column list is the
  union of the objects.

- **Harness seeds cannot import `toPublicProgram`.** `lib/program/publicProjection.ts` imports
  through the `@/` alias and `npm run seed` loads no resolver for it (only
  `supabase/scripts/register.mjs` teaches Node that alias). `public_data` is hand-written in the
  seed, like `draft_data`, and must be kept in step by hand.

- **`revalidate = 300` is not applied by `next dev`.** Nothing in the walk exercised the cache;
  `program-d` needs to check the TTL and its `revalidatePath()` against a production build.

- **Migration numbering collided.** The plan said 038; `program-a` had already shipped
  `038_talks_view_read_scope.sql`. The digits before the first underscore are the version
  `supabase db push` reads.

- **Phase 10's public page now disagrees with this one about names.**
  `public_sacrament_assignments` still exposes `first_name` plus `left(last_name, 1)` from migration
  019. Untouched here on purpose — it is a different page owned by a phase that has not been built —
  and flagged in CLAUDE.md and SPEC.md.

- **Reopening as a draft leaves `approved_by` and `approved_at` stamped**, so a draft carries the
  stamps of a withdrawn approval. Harmless today because nothing reads them on a draft; `program-d`
  re-approves and re-distributes, and a "who approved this" line would read the stale pair.

## What the walk changed in program-b

`ProgramBuilder` printed "This program is approved. Reopen it as a draft to change it" inside its
`{locked && …}` branch while every action button sat inside `{canBuild && !locked && …}` — the
instruction rendered exactly where the control did not, and there was **no way to reopen an
approved program from the UI at all**. The route and its test had always worked.

A **Reopen as a draft** button now exists, behind `program.build` and only for `approved`;
`distributed` has no path back (`LEGAL_TRANSITIONS`) and gets its own sentence saying so instead of
an instruction nobody can follow. Its five regression tests assert the **pairing** of an
instruction and the control it names — a test checking only for the button would pass if the
sentence were rewritten, and a test checking only the sentence is exactly what existed, passing,
while the feature was unusable.
