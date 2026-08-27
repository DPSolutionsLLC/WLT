-- ITER-019 follow-up, migration 053: cross-org visibility now widens PROGRESS, not just reports.
--
-- ADDITIVE ONLY in the expand-and-contract sense: it drops and recreates two SELECT policies and
-- touches no column and no data. Safe to apply before the deploy. HELD_BACK_UNTIL_DEPLOYED stays
-- empty; do not add an entry.
--
-- ---------------------------------------------------------------------------
-- THIS REVERSES A DECISION, DELIBERATELY, AND THE REASONING IS RECORDED HERE
-- ---------------------------------------------------------------------------
-- Migration 050 said, of household_visit_cadences_select:
--
--     "THE SELECT IS DELIBERATELY NOT WIDENED FOR CROSS-ORG VISIBILITY ... A cadence is a
--      CONFIGURATION, not a report — the Relief Society reading the Elders Quorum's private
--      judgement about a family is not what that setting offered."
--
-- Migration 052 drew the same line as "facts are shared, judgements are not", widening the
-- stewardship table and leaving goals and cadences narrow.
--
-- THAT LINE IS NOW MOVED, by a product decision on 2026-08-27, after walking scenario 048.
-- The all-organizations view exists so a ward can see every organization's standing on one row.
-- With goals and cadences narrow, an org leader saw the other organizations' CHIPS but no BANDS —
-- and the page had to explain, per chip, that the number was being withheld. The user's judgement
-- is that a ward turning on "cross-organization visibility" is asking for exactly that number:
--
--     "with the visibility of other organizations progress being turned on ... we should be able
--      to see how they think they are doing by the pills that show on that household's banner."
--
-- So the setting now means what its name says: it widens READS of an organization's PROGRESS —
-- its logs (already), its stewardship (052), and now the goal and the per-household cadence that
-- its bands are computed from.
--
-- WHY THE CADENCE HAD TO COME TOO, and not only the goal: a household band is computed against
-- the per-household override where one exists, falling back to the goal. Widening the goal alone
-- would have rendered a pill computed from the wrong interval — the Elders Quorum's 3-month
-- override on one family would read as their 1-year goal, and the pill would say "On track" about
-- a family they consider overdue. A number that is visible and wrong is worse than one withheld.
--
-- WHAT DOES NOT MOVE, AND MUST NOT:
--   * WRITES. No write policy on any of these tables mentions the setting, in either direction.
--     Reading another organization's judgement is not editing it.
--   * visit_private_notes. Four author-only policies, no bishopric branch, no ward-setting branch.
--     Wider reads on shared work do not widen a private note by one row (CLAUDE.md rule 5).
--   * Ward isolation. `ward_id = current_ward_id()` is unchanged on every policy below.
--
-- tests/rls/visit-cross-org.test.ts asserts the new shape on both sides of the setting, and its
-- previous assertions — that goals and cadences stayed narrow — are inverted there rather than
-- deleted, so the change is legible as a reversal rather than as a gap.

-- ---------------------------------------------------------------------------
-- 053a. visit_goals — the goal a band is measured against
-- ---------------------------------------------------------------------------
drop policy if exists visit_goals_select on visit_goals;

create policy visit_goals_select on visit_goals
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (
      is_bishopric()
      or org_id = current_org_id()
      or ward_allows_cross_org_visibility()
    )
  );

-- ---------------------------------------------------------------------------
-- 053b. household_visit_cadences — the per-household override a band prefers
-- ---------------------------------------------------------------------------
drop policy if exists household_visit_cadences_select on household_visit_cadences;

create policy household_visit_cadences_select on household_visit_cadences
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (
      is_bishopric()
      or org_id = current_org_id()
      or ward_allows_cross_org_visibility()
    )
  );

-- The four tables the setting now widens, in one place so the next reader does not have to grep:
--
--     visit_logs_select              (019) — what happened
--     household_stewardships_select  (052) — whose family it is
--     visit_goals_select             (053) — what interval they hold it to
--     household_visit_cadences_select(053) — the override on that interval
--
-- Everything else in the visits module stays `is_bishopric() or org_id = current_org_id()`.
