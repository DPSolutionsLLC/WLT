import {
  createHousehold,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// ITER-055 slice bv3: "VISITED, BUT STILL NEEDS A VISIT", AND A CALL THAT DID NOT CONNECT.
//
// The state this needs cannot be made by hand quickly: households already sitting in each
// position — done, done-then-partly-reached, partly reached and never done, a call attempt, and a
// household with nobody's number on file — so the walk reads every mark on first open and then
// adds one of each kind itself.
//
// The Elders Quorum goal is every six months with a month's notice. Dates are fixed in the past
// so the bands do not move between seeding and walking within a few weeks.

const HOUSEHOLD_IDS = {
  abernathy: "41000001-0000-4000-8000-000000000001",
  bellamy: "41000001-0000-4000-8000-000000000002",
  carver: "41000001-0000-4000-8000-000000000003",
  dunmore: "41000001-0000-4000-8000-000000000004",
  eastwood: "41000001-0000-4000-8000-000000000005",
} as const;

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

  await createHousehold({ id: HOUSEHOLD_IDS.abernathy, familyName: "Abernathy", address: "101 Ridgeview Drive" });
  await createMember({ firstName: "Grace", lastName: "Abernathy", householdId: HOUSEHOLD_IDS.abernathy, category: "adult", phone: "(801) 555-0101" });

  await createHousehold({ id: HOUSEHOLD_IDS.bellamy, familyName: "Bellamy", address: "102 Ridgeview Drive" });
  await createMember({ firstName: "Owen", lastName: "Bellamy", householdId: HOUSEHOLD_IDS.bellamy, category: "adult", phone: "801-555-0102" });

  await createHousehold({ id: HOUSEHOLD_IDS.carver, familyName: "Carver", address: "103 Ridgeview Drive" });
  await createMember({ firstName: "Lena", lastName: "Carver", householdId: HOUSEHOLD_IDS.carver, category: "adult", phone: "801.555.0103" });

  // Two numbers, so the window lists one link per person.
  await createHousehold({ id: HOUSEHOLD_IDS.dunmore, familyName: "Dunmore", address: "104 Ridgeview Drive" });
  await createMember({ firstName: "Paul", lastName: "Dunmore", householdId: HOUSEHOLD_IDS.dunmore, category: "adult", phone: "(801) 555-0104" });
  await createMember({ firstName: "Ivy", lastName: "Dunmore", householdId: HOUSEHOLD_IDS.dunmore, category: "adult", phone: "+1 801 555 0114" });

  // Nobody's number on file.
  await createHousehold({ id: HOUSEHOLD_IDS.eastwood, familyName: "Eastwood", address: "105 Ridgeview Drive" });
  await createMember({ firstName: "Ruth", lastName: "Eastwood", householdId: HOUSEHOLD_IDS.eastwood, category: "adult" });

  await createVisitGoal({
    org: "eldersQuorum",
    title: "Every household twice a year",
    cadenceAmount: 6,
    cadenceUnit: "month",
    noticeAmount: 1,
    noticeUnit: "month",
    createdBy: eqPresident.id,
  });

  // Abernathy: done, recently. The walk records "still needs a visit" here and the date must not move.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.abernathy,
    recordedBy: eqPresident.id,
    visitDate: "2026-09-01",
    sharedNotes: "EQ: a good visit, talked about the new job.",
  });

  // Bellamy: done in June, then partly reached in October. The clock still runs from June.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.bellamy,
    recordedBy: eqPresident.id,
    visitDate: "2026-05-15",
  });
  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.bellamy,
    recordedBy: eqPresident.id,
    visitDate: "2026-10-25",
    needsAnotherReason: "spouse_absent",
    sharedNotes: "EQ: Owen was home; his wife was at work. Come back on a weekend.",
  });

  // Carver: never done, partly reached once.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.carver,
    recordedBy: eqPresident.id,
    visitDate: "2026-10-28",
    needsAnotherReason: "not_home",
  });

  // Dunmore: a call that nobody answered.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.dunmore,
    recordedBy: eqPresident.id,
    visitDate: "2026-10-30",
    visitType: "phone",
    outcome: "attempted",
    attemptDetail: "no_answer",
  });
}
