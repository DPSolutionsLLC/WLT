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

Nothing. The directory is kept — with this README — because the pattern is worth having ready the
next time a migration has to wait on a deploy, and an empty directory with instructions is
cheaper than rediscovering the idea under pressure.

## Released

- **`049_drop_visit_logs_visited_by.sql`** — added 2026-08-25 by `visits-d`, released 2026-08-26
  once the Vercel deploy of that code was live. Dropped `visit_logs.visited_by`, which migration
  046 had already backfilled into `recorded_by`.

  Checked before applying, because dropping a column is irreversible: no code anywhere read the
  column (only comments, historical scenario prose, and one route test that sends `visitedBy` as
  a junk body key precisely to prove it is ignored); every `visit_logs` row had `recorded_by`
  set, so no row depended on the column for its meaning; and the deployed site answered 200.

  One consequence to notice: `visit_logs` now has a single foreign key to `users` again, so the
  PostgREST embed in `lib/visits/queries.ts` is no longer ambiguous. It still names its
  constraint on purpose — an inferred embed is a query that silently changes meaning the next
  time somebody adds a second foreign key to the same table.
