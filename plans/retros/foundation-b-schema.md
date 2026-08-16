---
id: foundation-b-schema
type: feature
iter: null
commits: ["78ef8fe"]
date: 2026-08-15
files:
  - supabase/migrations/001_extensions.sql
  - supabase/migrations/002_core.sql
  - supabase/migrations/003_roster.sql
  - supabase/migrations/011_tithing.sql
  - supabase/migrations/018_indexes.sql
  - supabase/migrations/019_rls.sql
  - supabase/seed/hymns.sql
  - supabase/seed/ward.sql
  - supabase/seed/topics.sql
  - supabase/seed/notification_triggers.sql
  - supabase/config.toml
  - types/database.ts
  - SPEC.md
related: [foundation-a-scaffold]
---

## What was done

Built the entire database in one pass: 19 numbered migrations covering 49 tables, RLS enabled
and policied on every one of them, two restricted public views for the unauthenticated pages,
seed data, and regenerated TypeScript types. Applied to the linked hosted project, which was
empty beforehand.

## Key decisions

- **`ward_id` is `NOT NULL` everywhere, with composite foreign keys.** SPEC.md wrote it
  nullable; a nullable ward_id creates rows belonging to no ward that match no RLS predicate.
  Parents carry `UNIQUE (id, ward_id)` so children reference `(parent_id, ward_id)` — Postgres
  enforces "child ward equals parent ward" instead of trusting application code to keep the
  denormalised column honest.
- **Member notes moved to their own table.** RLS grants or denies a row, never a column, so a
  bishopric-only `members.notes` could not be protected by the security boundary. `members` has
  no `notes` column at all, which means no `select('*')` can ever leak it.
- **Policies are generated in `DO` loops for the three uniform patterns** (ward-scoped,
  bishopric-only, author-only) and hand-written only where a table is genuinely special.
  Twenty-four near-identical policy blocks written by hand is twenty-four chances to drift.
  RLS itself is enabled by looping the catalog, not a hand list, so a table cannot be missed.
- **`audit_log` INSERT is not bishopric-only.** Rule 6 requires every mutation to write there,
  so an org secretary logging a visit must be able to insert. Reads are bishopric-only and
  there is no UPDATE or DELETE policy for anyone — an audit trail that can be edited is not one.
- **`public_program` withholds `draft_data`.** It is an unstructured snapshot that may carry
  full names, so it is unsafe to hand `anon` wholesale. Phase 6 must define a named projection.

## Pitfalls for next time

- **The seed runner does not support psql backslash meta-commands.** The plan called for a
  `supabase/seed.sql` using `\i` includes; that would have silently failed to load anything.
  `[db.seed].sql_paths` in `config.toml` is already an ordered list — use it. Order matters:
  `topics` and `notification_settings` are seeded per ward with a cross join, so `ward.sql`
  must run before them.
- **Supabase no longer auto-exposes new objects to the Data API roles.** Without explicit
  `GRANT`s in migration 019, correct RLS policies still produce an app where every query fails.
  Migration 019 grants to `authenticated`/`service_role`, revokes from `anon`, then grants
  `anon` the two views only, and sets default privileges so future phases do not hit this.
- **A `CHECK` constraint cannot contain a subquery.** Validating that every cheque amount in
  `tithing_entries.checks` is integer cents needed an `IMMUTABLE` function the constraint calls.
- **`SET LOCAL` is a no-op with a warning outside an explicit transaction block.** Migration 014
  uses a plain `SET search_path` to resolve the `vector` type, rather than depending on whether
  the migration runner opens a transaction.
- **Numbered migration filenames work.** `supabase db push` reads the version from the digits
  before the first underscore, so `001_extensions.sql` is valid and applies in numeric order.
  Timestamped files from `supabase migration new` sort after `019`; the two styles coexist.
- **`db:push` does not run seeds — `db:reset` does.** `npx supabase db push --include-seed`
  loads them without wiping the hosted database, which is the safe option on a shared project.

## Known gaps handed to later phases

- **`users` SELECT is self-only** (00-foundation.md pitfall #1). The app cannot yet read another
  user's name, so "conducting: Bro. Smith" has nothing to select. Phase 1 must choose between a
  ward-scoped SELECT policy — safe in practice, because the helper functions are SECURITY
  DEFINER and cannot recurse — or a definer-side view exposing only id/name/role.
- **`activity_*` tables are ward-scoped, not org-scoped.** The plan listed them under org
  scoping, but SPEC.md gives none of them an `org_id` column. Phase 8 decides whether youth
  activity coordination is genuinely org-private; if so it needs an `org_id` migration first.
- **The hymn seed is 42 of 341 hymns**, marked partial in the file header. The full list must be
  sourced before phase 6 ships hymn selection.
- **No auth users are seeded.** `users.id` references `auth.users(id)`, and creating an auth user
  correctly means going through the admin API, not a raw INSERT that breaks on the next Auth
  release. Plan C's `tests/helpers/seed.ts` is the right place.
