-- Visits D, migration 047: narrow the SET NULL on visit_appointments.visit_log_id to ONE column.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
-- Migration 046 wrote:
--
--   foreign key (visit_log_id, ward_id) references visit_logs (id, ward_id) on delete set null
--
-- On a COMPOSITE foreign key, a bare `on delete set null` sets EVERY referencing column to null —
-- `ward_id` as well as `visit_log_id`. `ward_id` is `not null`, so the cascade raises and the
-- DELETE is refused:
--
--   null value in column "ward_id" of relation "visit_appointments" violates not-null constraint
--
-- The effect was the exact opposite of the intent. 046's own comment says "deleting a visit must
-- not delete the record that an appointment was made"; what it actually did was make a visit with
-- an appointment pointing at it UNDELETABLE. Found by tests/rls/visit-participants.test.ts, which
-- deletes a visit and re-reads the appointment.
--
-- ---------------------------------------------------------------------------
-- THE FIX
-- ---------------------------------------------------------------------------
-- PostgreSQL 15 added a column list on SET NULL / SET DEFAULT, so the action can name the one
-- column that should be cleared and leave `ward_id` alone. `ward_id` never wanted to change: the
-- appointment stays in the same ward it was always in.
--
-- It is a new migration rather than an edit to 046 because 046 is already applied — an edited
-- migration is one that ran differently in two places, which is worse than a second file.

alter table visit_appointments
  drop constraint visit_appointments_visit_log_id_ward_id_fkey;

alter table visit_appointments
  add constraint visit_appointments_visit_log_id_ward_id_fkey
    foreign key (visit_log_id, ward_id) references visit_logs (id, ward_id)
    on delete set null (visit_log_id);
