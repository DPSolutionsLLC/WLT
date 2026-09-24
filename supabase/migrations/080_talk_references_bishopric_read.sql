-- P4 module 1 (Sacrament), slice c, migration 080: ONLY THE BISHOPRIC READS TALK REFERENCES.
--
-- APPLIES IMMEDIATELY. It narrows one SELECT policy and touches no data, no column and no other
-- policy. The code that shipped with 079 never showed references to anyone outside the bishopric
-- once this change deploys, and before then the only other reader (a music coordinator) loses a
-- read the product decided they should never have had.
--
-- ---------------------------------------------------------------------------
-- REVERSING 079's READ, DECIDED BY THE USER 2026-09-23 (walking scenario 074, defect 074-D2)
-- ---------------------------------------------------------------------------
-- 079 let anyone holding `talks.view` read references, on the reasoning that a music coordinator
-- might want to see what a talk is built on. The user's answer: "there should be no reason a music
-- coordinator sees the references". References are the bishopric's planning material, and the
-- bishop and both counselors all have it — never gated on who is conducting a given Sunday.
--
-- So the read now matches the write, and `.insert().select()` still works because RETURNING runs
-- the SELECT policy and every writer is a reader (plans/retros/p3-shell-and-tile-dashboard.md).
-- The route asserts `talks.plan` for the read too, so the two layers agree (rule 2).

drop policy talk_references_select on talk_references;

create policy talk_references_select on talk_references
  for select to authenticated
  using (ward_id = current_ward_id() and is_bishopric());
