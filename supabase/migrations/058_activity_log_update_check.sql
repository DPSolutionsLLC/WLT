-- Phase 8 slice D, migration 058: A CORRECTION TO 057c, FOUND BY ITS OWN TEST.
--
-- APPLIES IMMEDIATELY. It replaces one policy and touches no column and no data.
-- HELD_BACK_UNTIL_DEPLOYED stays empty; do not add an entry.
--
-- ---------------------------------------------------------------------------
-- WHAT 057c GOT WRONG, AND WHY THE COMMENT DID NOT CATCH IT
-- ---------------------------------------------------------------------------
-- 057c wrote:
--
--   using      (ward_id = current_ward_id() and (is_bishopric() or logged_by = auth.uid()))
--   with check (ward_id = current_ward_id() and logged_by = auth.uid())
--
-- and explained the difference as: "the bishopric may CLEAR A FLAG on somebody's follow-up (they
-- own the agenda), but WITH CHECK's `logged_by = auth.uid()` means nobody, bishopric included,
-- may leave behind a row attributed to a different author."
--
-- THE FIRST HALF OF THAT SENTENCE IS FALSE UNDER THE SECOND. WITH CHECK is evaluated against the
-- RESULTING row, and a bishopric member clearing somebody else's flag leaves `logged_by` exactly
-- as it was — somebody else's. So the check fails and the update is refused with a bare
-- `new row violates row-level security policy`. The clause did not prevent reattribution; it
-- prevented the bishopric touching another author's follow-up AT ALL, which is the one thing the
-- USING clause had gone out of its way to allow.
--
-- Found by tests/rls/activity-logs.test.ts on 2026-08-28, on its first run — which is what an RLS
-- suite is for. Nothing shipped with it.
--
-- ---------------------------------------------------------------------------
-- WHY A POLICY IS THE WRONG PLACE FOR THAT GUARANTEE AT ALL
-- ---------------------------------------------------------------------------
-- "This column may not change" is not a predicate over one row. A policy sees the row that would
-- result and never the row that was, so column immutability is inexpressible in RLS; it needs a
-- BEFORE UPDATE trigger, and THIS REPOSITORY HAS NO TRIGGERS — `grep` finds not one
-- `create trigger` in fifty-seven migrations, and inventing the first for this would be a new
-- mechanism to maintain for a guarantee that is already held elsewhere.
--
-- WHERE IT IS ACTUALLY HELD, and this is the house pattern rather than a workaround:
--   * `updateActivityLogSchema` (lib/validation/youth.ts) has no `loggedBy` field, so a body
--     naming one is a 400 rather than a silent write.
--   * `updateActivityLog()` (lib/youth/activityLogs.ts) writes its patch out field by field and
--     never assigns `logged_by`.
-- `visit_logs.recorded_by` is protected the same way and by nothing else: `visit_logs_update`'s
-- USING and WITH CHECK are IDENTICAL (migration 019), and no policy anywhere in this schema pins
-- an author column.
--
-- So this policy becomes the same shape `visit_logs_update` has — one predicate, on both halves —
-- and the author guarantee is the route's, stated in both files that hold it.
--
-- WHAT THIS DOES NOT CHANGE: the INSERT policy still carries `logged_by = auth.uid()` with NO
-- bishopric exemption, so a follow-up can never be CREATED under somebody else's name. That is
-- the half of 057c's intent that a policy genuinely can express, and it is untouched.

drop policy activity_logs_update on activity_logs;

-- USING says WHICH ROWS YOU MAY TOUCH; WITH CHECK says WHAT YOU MAY LEAVE BEHIND. Here they are
-- deliberately the SAME: the bishopric and the author may edit a follow-up, and editing it does
-- not move it anywhere, so there is nothing for the two clauses to disagree about.
--
-- An organization is NOT a way in, and that is the difference from `visit_logs_update`. A visit
-- belongs to an organization and any of its leaders may edit it; a follow-up is one person's
-- account of an evening, and rewriting somebody else's account is not oversight. The org arm
-- appears on `activity_logs_select` and nowhere else.
create policy activity_logs_update on activity_logs
  for update to authenticated
  using      (ward_id = current_ward_id() and (is_bishopric() or logged_by = auth.uid()))
  with check (ward_id = current_ward_id() and (is_bishopric() or logged_by = auth.uid()));
