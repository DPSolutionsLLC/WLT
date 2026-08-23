-- talks-d, migration 029: refresh the cached goals.status column.
--
-- Numbered 029, not the plan's 027. 027 and 028 were taken by sunday-types-meeting-split and
-- talks-c before this slice was written.
--
-- ---------------------------------------------------------------------------------------------
-- THE UI NEVER READS THIS COLUMN.
-- ---------------------------------------------------------------------------------------------
-- lib/goals/queries.ts does not even SELECT `status`. Every status a person sees is computed on
-- read by lib/goals/goalStatus.ts, because a stored status goes stale silently — a goal that fell
-- overdue at midnight would read "on track" until something remembered to run
-- (04-talks-pipeline.md §Step 9 and §Pitfalls).
--
-- This function exists so a future report or notification has an INDEXABLE value to filter on
-- without recomputing every row in SQL. If it and goalStatus() ever disagree, goalStatus() is
-- right and this is the thing to fix.
--
-- It must match lib/goals/goalStatus.ts exactly:
--   anchor   = coalesce(last_fulfilled_at, created_at), truncated to a UTC day
--   due      = anchor + desired_frequency_months months
--   overdue  when today >= due
--   due_soon when 80% or more of the interval has elapsed
--   on_track otherwise
--   null status when desired_frequency_months is null — no interval, no bucket
--
-- ---------------------------------------------------------------------------------------------
-- SCHEDULING: pg_cron IS NOT ENABLED ON THIS PROJECT.
-- ---------------------------------------------------------------------------------------------
-- supabase/migrations/001_extensions.sql creates exactly two extensions, `pgcrypto` and `vector`.
-- There is no `cron` schema to call, so this migration schedules nothing and invents no scheduler
-- of its own — a `pg_cron` call in here would fail the push on a project that does not have it,
-- and a fake scheduler (a trigger, a "refresh on read") would be worse than no scheduler at all.
--
-- To schedule it later, enable pg_cron from the Supabase dashboard and then run, once:
--
--   select cron.schedule(
--     'refresh-goal-status',
--     '15 7 * * *',                       -- 07:15 UTC, after midnight in every US time zone
--     $$select refresh_goal_status()$$
--   );
--
-- Until then it is callable by hand: `select refresh_goal_status();`
--
-- ---------------------------------------------------------------------------------------------
-- SECURITY DEFINER, with a pinned search_path — the same requirement every function in migration
-- 019 carries. It writes across every ward, which no caller's RLS would permit, and a definer
-- function without a pinned search_path is a privilege-escalation vector.

create function refresh_goal_status()
  returns integer
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  with anchored as (
    select
      goal.id,
      goal.desired_frequency_months as months,
      (coalesce(goal.last_fulfilled_at, goal.created_at) at time zone 'UTC')::date as anchor_day
    from goals goal
  ),
  recomputed as (
    select
      anchored.id,
      case
        when anchored.months is null then null
        -- The zero-or-negative interval guard comes BEFORE the division, exactly as
        -- `if (interval <= 0) return "overdue"` does in lib/goals/goalStatus.ts.
        when current_date >= due_day then 'overdue'
        when due_day <= anchored.anchor_day then 'overdue'
        when (current_date - anchored.anchor_day)::numeric
             / (due_day - anchored.anchor_day)::numeric >= 0.8 then 'due_soon'
        else 'on_track'
      end as status
    from anchored
    -- `+ interval 'N months'` CLAMPS rather than rolling over — 2026-01-31 plus one month is
    -- 2026-02-28 — which is the behaviour addMonths() in lib/calendar/dates.ts was written to
    -- match. The two agreeing here is not a coincidence to preserve by luck.
    cross join lateral (
      select (anchored.anchor_day + make_interval(months => anchored.months))::date
    ) as due (due_day)
  )
  update goals
  set status = recomputed.status
  from recomputed
  where goals.id = recomputed.id
    and goals.status is distinct from recomputed.status;

  get diagnostics changed = row_count;

  return changed;
end;
$$;

comment on function refresh_goal_status() is
  'Refreshes the cached goals.status column for every ward. The UI never reads this column — '
  'lib/goals/goalStatus.ts computes status on read and is the source of truth. Not scheduled: '
  'pg_cron is not enabled on this project (see the header of migration 029).';

-- The column is filtered by a future report, not by a route, so one plain index on the pair a
-- report would ask for: this ward's goals in this state.
create index if not exists goals_ward_status_idx on goals (ward_id, status);
