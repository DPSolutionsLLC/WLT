-- ITER-018, migration 051: the CONTRACT half. Drops what migration 050 replaced.
--
-- ---------------------------------------------------------------------------
-- DO NOT APPLY THIS UNTIL THE NEW CODE IS DEPLOYED
-- ---------------------------------------------------------------------------
-- The deploy order is:
--
--   1. `npm run db:push` applies migration 050, which is additive and safe against the running
--      build — the live code keeps reading `cadence`, `cadence_months`, `goal_period_start` and
--      `goal_period_end`, all of which still exist.
--   2. Deploy the application. The new build reads `cadence_amount`, `cadence_unit`,
--      `notice_amount`, `notice_unit` and `deadline`, all of which exist by then.
--   3. Apply THIS migration. Nothing reads the dropped columns any more.
--
-- Running this before step 2 takes /visits down: lib/visits/queries.ts names every column it
-- selects explicitly, and PostgREST answers a select list naming a missing column with an error
-- rather than a partial row.
--
-- No index is dropped alongside these. 018_indexes.sql:29 indexes `visit_goals (ward_id)` only,
-- and nothing in the repo indexes `goal_period_start` — checked rather than assumed.

alter table visit_goals
  drop column cadence,
  drop column cadence_months,
  drop column goal_period_start,
  drop column goal_period_end;
