# Migrations waiting on a deploy

A migration in this directory is **written, reviewed and deliberately not applied yet**. It is
here rather than in `supabase/migrations/` because applying it before the matching application
code is live would break the running app.

`supabase db push` reads `supabase/migrations/` only and does not recurse, so nothing here is
applied by accident. `tests/db/migrations.test.ts` reads the same directory, so a file here does
not trip the "written but never pushed" guard — which is the guard's correct behaviour, because
these have not been forgotten.

## How to release one

1. Deploy the application code that stops using what the migration removes.
2. `git mv supabase/migrations-pending/<file> supabase/migrations/`
3. `npm run db:push`
4. `npm run db:types`
5. `npm run typecheck && npm run test`

Do it in that order. Step 1 is the whole reason the file is here.

## What is waiting

### `049_drop_visit_logs_visited_by.sql` — added 2026-08-25 by `visits-d`

Drops `visit_logs.visited_by`. Migration 046 added `recorded_by` and backfilled it from that
column; the application now reads and writes `recorded_by` and nothing reads `visited_by`.

**Blocked on:** the `visits-d` code being deployed. Until then the live app still selects
`visited_by`, and dropping it would 500 every visit query in production.

**Do not skip it once the deploy has landed.** Two columns meaning "who" is the
two-sources-of-truth problem this codebase refuses everywhere else, and a column nobody reads is
the next person's trap. There is one live consequence while it waits: `visit_logs` has two
foreign keys to `users`, so the PostgREST embed in `lib/visits/queries.ts` has to name its
constraint. That naming stays after the drop — it is correct either way — but the comment
explaining why should be re-read once the ambiguity is gone.
