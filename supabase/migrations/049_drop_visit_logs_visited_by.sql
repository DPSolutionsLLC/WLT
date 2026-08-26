-- Visits D, migration 047: retire `visit_logs.visited_by`.
--
-- THE CONTRACT HALF. Migration 046 added `recorded_by` and backfilled it from this column; the
-- application now reads and writes `recorded_by` and nothing reads `visited_by`. Only then does
-- the column go.
--
-- APPLY THIS AFTER THE CODE FROM VISITS-D HAS DEPLOYED. Expand and contract. Applying 046 and
-- 047 together before the deploy would leave the running app selecting a column that no longer
-- exists, and every visit query would 500 until the deploy landed.
--
-- Do not skip it either. Two columns meaning "who" is the two-sources-of-truth problem this
-- codebase keeps refusing everywhere else, and a column nobody reads is the next person's trap:
-- the honest reading of `visited_by` after this slice is "who recorded it, back when those were
-- the same thing", which is not a sentence any future reader will reconstruct.
--
-- Who WENT now lives in `visit_participants`, which can name a leader, a member, or somebody
-- this ward has no row for at all — none of which a single uuid column could hold.

alter table visit_logs drop column visited_by;
