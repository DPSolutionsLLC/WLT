-- ITER-055 slice bv4, migration 102: a goal is a sweep or a cadence, it can end, and an ended goal
-- stays on record (plans/bishopric-visits.md D5, P5).
--
-- ADDS COLUMNS, CONSTRAINTS AND ONE INDEX. IT TOUCHES NO POLICY. Migration 099's visit_goals SELECT
-- policy and 019's write policies cover the new columns — RLS grants rows, not columns.
--
-- Every existing goal keeps its meaning: it becomes a `cadence` goal, still active, started on the
-- day it was created.

-- ---------------------------------------------------------------------------
-- 102a. Stop if any organization already has two goals
-- ---------------------------------------------------------------------------
-- The index in 102d makes "the active goal" a database fact. Until now nothing prevented a second
-- goal, and selectActiveGoal() quietly took the newest. Two goals for one organization are refused
-- here with a list, rather than resolved by ending or deleting one — which goal a presidency is
-- working to is theirs to say. `group by` treats two nulls as one group, which is what the index
-- does too (`nulls not distinct`).
do $$
declare
  duplicates text;
begin
  select string_agg(format('(ward %s, org %s: %s goals)', ward_id, coalesce(org_id::text, 'none'), total), ', ')
    into duplicates
  from (
    select ward_id, org_id, count(*) as total
    from visit_goals
    group by ward_id, org_id
    having count(*) > 1
  ) as doubled;

  if duplicates is not null then
    raise exception 'Migration 102 stopped: these organizations have more than one visit goal, and only one may be active. Decide with the ward which one stays active before applying: %', duplicates;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 102b. What kind of goal, when it started, and how it ended
-- ---------------------------------------------------------------------------
-- A `sweep` is "visit every household once" — a finish line. A `cadence` is the rolling interval
-- every goal has been until now.
--
-- `ended_at` is a timestamp, never a boolean (060's `closed_at` precedent): Goal history recomputes
-- a goal's final numbers against the instant it ended, rather than storing them.
alter table visit_goals
  add column kind text not null default 'cadence' check (kind in ('cadence', 'sweep')),
  add column started_on date,
  add column ended_at timestamptz,
  add column end_reason text check (end_reason in ('completed', 'set_aside'));

-- The day each existing goal was created, on the WARD's calendar — a goal made at 7pm in Denver
-- started that day, not the next UTC day. A ward with no zone set falls back to UTC.
update visit_goals goal
set started_on = (goal.created_at at time zone coalesce(nullif(ward.settings ->> 'timezone', ''), 'UTC'))::date
from wards ward
where ward.id = goal.ward_id
  and goal.started_on is null;

-- The route always sends the ward's own date; the default only covers a write from elsewhere.
alter table visit_goals
  alter column started_on set default current_date,
  alter column started_on set not null;

-- ---------------------------------------------------------------------------
-- 102c. The rules the new columns carry
-- ---------------------------------------------------------------------------
-- An end has both halves or neither. Written as an equality of two `is null` expressions so it can
-- actually fail (050's note: a CHECK that evaluates to NULL never rejects anything).
alter table visit_goals
  add constraint visit_goals_end_complete
    check ((ended_at is null) = (end_reason is null));

-- A sweep has no interval. Without this, a sweep row could carry a cadence that nothing reads and
-- that a later reader would take as meaning something.
alter table visit_goals
  add constraint visit_goals_sweep_has_no_cadence
    check (kind <> 'sweep' or (cadence_amount is null and notice_amount is null));

-- ---------------------------------------------------------------------------
-- 102d. One active goal per organization
-- ---------------------------------------------------------------------------
-- `nulls not distinct` so that the goals with no organization count as ONE group too. Without it,
-- two rows with a null org_id would never conflict, and the index would hold for every
-- organization but that one (the talks-d hole, and 055's index for the same reason).
create unique index visit_goals_one_active_per_org
  on visit_goals (ward_id, org_id) nulls not distinct
  where ended_at is null;
