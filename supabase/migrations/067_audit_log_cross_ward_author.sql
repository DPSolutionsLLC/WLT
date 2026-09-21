-- Phase 2 slice proto-c, migration 067: AN AUDIT ROW'S WARD IS WHERE THE ACTION HAPPENED,
-- NOT WHERE ITS AUTHOR LIVES.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, FOUND BY tests/routes/session-active-ward.test.ts ON ITS FIRST RUN
-- ---------------------------------------------------------------------------
-- Migration 015 gave `audit_log` a COMPOSITE foreign key:
--
--   foreign key (user_id, ward_id) references users (id, ward_id) on delete set null
--
-- That is migration 002's "child ward_id equals parent ward_id" idiom, and it was exactly right
-- while every action a person could take happened in the ward they belong to. THE WARD SWITCH
-- ENDS THAT. A stake president whose users.ward_id is ward A, acting in ward B, produces an
-- audit row with `ward_id = B` and `user_id = <a ward A user>` — and the composite key refuses
-- it with SQLSTATE 23503.
--
-- ⚠️ AND IT REFUSES IT SILENTLY. writeAuditLog() never throws: an audit failure must not fail
-- the user's action, which is one of exactly two sanctioned exceptions to CLAUDE.md rule 7. So
-- the row is simply never written, a line goes to the server log, and the action completes. THE
-- RESULT IS THAT EVERY MUTATION A VISITING OFFICER MAKES IS UNAUDITED, which is CLAUDE.md rule 6
-- broken for precisely the sessions that most need the record — somebody acting inside a ward
-- that is not their own.
--
-- ---------------------------------------------------------------------------
-- WHY THE CONSTRAINT IS WRONG NOW, RATHER THAN INCONVENIENT
-- ---------------------------------------------------------------------------
-- The composite key asserts that an audit row's ward is ITS AUTHOR'S HOME WARD. After migration
-- 066 those are two different facts: `users.ward_id` is where a person belongs, and
-- `audit_log.ward_id` is where the thing they did happened. A constraint that conflates them can
-- only be satisfied by filing the row under the wrong ward — which would put "a stake president
-- entered ward B" in ward A's log, where ward B's bishopric cannot read it (audit_log_select is
-- `ward_id = current_ward_id() and is_bishopric()`). The row would exist and be useless.
--
-- So the reference is narrowed to the author alone. WHAT IS KEPT: `user_id` still references a
-- real `users` row, so authorship cannot be invented. WHAT IS GIVEN UP: the database no longer
-- proves an author belonged to the ward they acted in — which is a thing that is now legitimately
-- false, and `can_act_in_ward()` is what governs it instead.
--
-- NOTHING ELSE MOVES. `audit_log_insert` (019) already carries
-- `ward_id = current_ward_id() and (user_id = auth.uid() or user_id is null)`, and that predicate
-- is ALREADY CORRECT across a switch — current_ward_id() returns the ward being acted in, so the
-- policy admits exactly the row the FK was rejecting. The boundary did not need a change; only
-- the constraint behind it did.
--
-- Rejected alternative: writing `user_id = null` and putting the id in `detail`. The policy
-- permits it and it would have needed no migration — but it makes an audit log that cannot say
-- who did anything from a column, only from a JSON blob no index and no policy can use, and it
-- would have applied to every future cross-ward write rather than to this one route.
--
-- APPLIES IMMEDIATELY and is purely a RELAXATION: every row that satisfied the composite key
-- satisfies the single-column one, so there is no existing row it can fail on. No entry in
-- HELD_BACK_UNTIL_DEPLOYED, and none should be added.
--
-- A side effect worth recording rather than discovering: the old key's `on delete set null`
-- would have tried to null BOTH columns, and `ward_id` is NOT NULL — so deleting a `users` row
-- with audit rows under it could only ever have raised. It never fired in practice because
-- `audit_log.ward_id` cascades from `wards` and fixtures delete the ward first. The replacement
-- nulls one nullable column, which is what the clause was always meant to do.

alter table audit_log drop constraint audit_log_user_id_ward_id_fkey;

alter table audit_log
  add constraint audit_log_user_id_fkey
  foreign key (user_id) references users (id) on delete set null;

comment on column audit_log.ward_id is
  'The ward the action happened in, which after migration 066 is NOT necessarily the author''s home ward.';
