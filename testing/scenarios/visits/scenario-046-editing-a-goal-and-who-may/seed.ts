import {
  createHousehold,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE THIS SEEDS IS A GOAL WORTH EDITING, AND THREE PEOPLE WITH DIFFERENT RIGHTS OVER IT.
//
// ---------------------------------------------------------------------------------------------
// PART ONE: THERE HAS NEVER BEEN AN EDIT PATH
// ---------------------------------------------------------------------------------------------
// The PATCH route and updateVisitGoal() have both existed since visits-a; only the UI was
// missing. Scenario 040's step 8 worked around it by creating a SECOND goal whose period
// contained today — which was the only way to make the dashboard recompute, and which quietly
// taught wards to stack goals rather than change their minds. ITER-018 part 3 closes it, and that
// workaround is now cut.
//
// The four households below are placed so that changing the cadence from every 1 year to every
// 6 months moves AT LEAST TWO of them between bands. An edit that visibly changed nothing would
// prove the form saved, not that the dashboard recomputed.
//
// ---------------------------------------------------------------------------------------------
// PART TWO: THE PERMISSION SPLIT, WHICH NO UNIT TEST CAN SHOW AS A SCREEN
// ---------------------------------------------------------------------------------------------
// ITER-018 Decision 5 put the household cadence behind `visits.manage_goals` rather than
// `roster.manage`, on its own route. Two things follow, and both are things you have to LOOK at:
//
//   - An org SECRETARY holds `visits.view` and `visits.create` and NOT `visits.manage_goals`.
//     They must see the goal and the dashboard, and find no Edit button and no cadence control
//     on any row — and be TOLD it is a role boundary rather than left with an absent button.
//
//   - An org PRESIDENT holds `visits.manage_goals` and NOT `roster.manage`. They must be able to
//     set a household's cadence and still be refused the roster's own edit controls. If those two
//     permissions had been collapsed into one, this scenario would pass in one direction and fail
//     in the other.

const MS_PER_DAY = 86_400_000;

const TODAY = new Date();

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return dateOnly(new Date(TODAY.getTime() - days * MS_PER_DAY));
}

const HOUSEHOLD_IDS = {
  brooks: "40460001-0000-4000-8000-000000000001",
  okonkwo: "40460001-0000-4000-8000-000000000002",
  halvorsen: "40460001-0000-4000-8000-000000000003",
  nakamura: "40460001-0000-4000-8000-000000000004",
} as const;

// THE DISTANCES ARE CHOSEN AGAINST BOTH CADENCES, so the edit in step 5 moves the page.
//
//   every 1 year  (365 days), warning 2 months (~61 days, so warns from day ~304)
//   every 6 months (~181 days), warning 2 months (~61 days, so warns from day ~120)
//
// | household  | days ago | at 1 year        | at 6 months      |
// |------------|----------|------------------|------------------|
// | Brooks     |       20 | On track ~5%     | On track ~11%    |
// | Okonkwo    |      150 | On track ~41%    | APPROACHING ~83% |
// | Halvorsen  |      250 | On track ~68%    | OVERDUE ~138%    |
// | Nakamura   |     none | Never visited    | Never visited    |
//
// Two rows move on the cadence change, and one of them crosses two bands. Shortening the WARNING
// window to 1 month afterwards then pulls Okonkwo back out of Approaching, which is the second
// half of step 6.
const VISITED_20_DAYS_AGO = daysAgo(20);
const VISITED_150_DAYS_AGO = daysAgo(150);
const VISITED_250_DAYS_AGO = daysAgo(250);

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const eqPresident = await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  // `visits.view` and `visits.create`, NOT `visits.manage_goals`. Checked against the matrix in
  // lib/auth/permissions.ts rather than assumed — it is not always the intuitive answer, and this
  // account is the whole of part two.
  const eqSecretary = await createTestUser({
    handle: "eq-secretary",
    role: "org_secretary",
    org: "eldersQuorum",
    firstName: "Peter",
    lastName: "Nakamura",
  });

  // The Relief Society goal exists so the bishop has somebody ELSE's goal to edit. A bishopric
  // member editing their own organization's goal would not test the cross-organization path.
  const rsPresident = await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ruth",
    lastName: "Delacroix",
  });

  await Promise.all([
    createHousehold({
      id: HOUSEHOLD_IDS.brooks,
      familyName: "Brooks",
      address: "2201 Canyon Road",
    }),
    createHousehold({
      id: HOUSEHOLD_IDS.okonkwo,
      familyName: "Okonkwo",
      address: "14 Larkspur Lane",
    }),
    createHousehold({
      id: HOUSEHOLD_IDS.halvorsen,
      familyName: "Halvorsen",
      address: "902 Ridgeview Drive",
    }),
    createHousehold({
      id: HOUSEHOLD_IDS.nakamura,
      familyName: "Nakamura",
      address: "755 Aspen Way",
    }),
  ]);

  await Promise.all([
    createMember({ firstName: "David", lastName: "Brooks", householdId: HOUSEHOLD_IDS.brooks }),
    createMember({ firstName: "Emeka", lastName: "Okonkwo", householdId: HOUSEHOLD_IDS.okonkwo }),
    createMember({
      firstName: "Inge",
      lastName: "Halvorsen",
      householdId: HOUSEHOLD_IDS.halvorsen,
    }),
    createMember({ firstName: "Kenji", lastName: "Nakamura", householdId: HOUSEHOLD_IDS.nakamura }),
  ]);

  // ONE Elders Quorum goal. Exactly one, because the assertion in step 5 is that editing it
  // changes THIS goal in place rather than adding a second — and a list that already held two
  // would make "no second goal appeared" unreadable.
  await createVisitGoal({
    org: "eldersQuorum",
    title: "Visit every family",
    cadenceAmount: 1,
    cadenceUnit: "year",
    noticeAmount: 2,
    noticeUnit: "month",
    createdBy: eqPresident.id,
  });

  await createVisitGoal({
    org: "reliefSociety",
    title: "Visit every sister",
    cadenceAmount: 6,
    cadenceUnit: "month",
    noticeAmount: 1,
    noticeUnit: "month",
    createdBy: rsPresident.id,
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.brooks,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_20_DAYS_AGO,
    outcome: "completed",
    arrangement: "appointment",
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.okonkwo,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_150_DAYS_AGO,
    outcome: "completed",
    arrangement: "drop_in",
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.halvorsen,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_250_DAYS_AGO,
    outcome: "completed",
    arrangement: "drop_in",
  });

  // Nakamura gets no visit, so one row stays put across every edit below — a control against a
  // page that simply re-randomised on save.
}
