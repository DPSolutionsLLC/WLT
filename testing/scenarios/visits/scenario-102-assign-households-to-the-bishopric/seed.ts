import {
  createHousehold,
  createMember,
  createTestUser,
  createTodo,
  createVisitAppointment,
  createVisitAssignment,
  createVisitGoal,
  ensureTestWard,
  seedNotificationTriggers,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// ITER-055 slice bv5: DIVIDING THE BISHOPRIC'S HOUSEHOLDS.
//
// A Bishopric sweep a month in, eight households, and the three members of the bishopric. ONE
// household is already held, so a reassignment can be walked without first making one: Ellis is
// the 2nd counselor's, with its "Visit the Ellis family" to-do open and a visit the 2nd counselor
// has already SCHEDULED for three days from now — which is what the Assign window must warn about
// before moving it (D8). Everything else is unassigned.
//
// bv6 extends this scenario with companions and invites (plans/bishopric-visits.md, scenario 102).
//
// DATES ARE RELATIVE TO THE DAY OF SEEDING: the sweep started 30 days ago.

const DAY_MS = 86_400_000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

const HOUSEHOLDS = [
  { key: "abbott", familyName: "Abbott" },
  { key: "brooks", familyName: "Brooks" },
  { key: "carver", familyName: "Carver" },
  { key: "dalton", familyName: "Dalton" },
  { key: "ellis", familyName: "Ellis" },
  { key: "foster", familyName: "Foster" },
  { key: "garcia", familyName: "Garcia" },
  { key: "hughes", familyName: "Hughes" },
] as const;

type HouseholdKey = (typeof HOUSEHOLDS)[number]["key"];

const householdId = (key: HouseholdKey): string => testUuid(`scenario-102:household:${key}`);

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "counselor-1",
    role: "counselor",
    counselorPosition: 1,
    firstName: "Aaron",
    lastName: "Pike",
  });

  const secondCounselor = await createTestUser({
    handle: "counselor-2",
    role: "counselor",
    counselorPosition: 2,
    firstName: "Lena",
    lastName: "Ortiz",
  });

  // An org president, to see that the Assign button and My visits are the bishopric's alone.
  await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tom",
    lastName: "Reyes",
  });

  for (const household of HOUSEHOLDS) {
    await createHousehold({ id: householdId(household.key), familyName: household.familyName });
    await createMember({
      firstName: "Pat",
      lastName: household.familyName,
      householdId: householdId(household.key),
      category: "adult",
      phone: "555-0100",
    });
  }

  const goalId = await createVisitGoal({
    org: "bishopric",
    title: "See every family by spring",
    kind: "sweep",
    startedOn: daysAgo(30),
    createdBy: bishop.id,
  });

  const ellisAssignment = await createVisitAssignment({
    org: "bishopric",
    householdId: householdId("ellis"),
    goalId,
    assignedTo: secondCounselor.id,
    assignedBy: bishop.id,
  });

  await createTodo({
    userId: secondCounselor.id,
    title: "Visit the Ellis family",
    tag: "Visits",
    assignedBy: bishop.id,
    visitAssignmentId: ellisAssignment,
  });

  await createVisitAppointment({
    org: "bishopric",
    householdId: householdId("ellis"),
    scheduledFor: new Date(Date.now() + 3 * DAY_MS).toISOString(),
    madeBy: secondCounselor.id,
  });
}
