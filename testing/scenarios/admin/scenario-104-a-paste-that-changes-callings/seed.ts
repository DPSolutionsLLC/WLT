import {
  createHousehold,
  createMember,
  createMemberLink,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// ITER-058 slice cr3 (scenario 104): A ROSTER PASTE THAT CHANGES CALLINGS.
//
// The ward list and the app agree when this seed finishes. fixtures/paste-swap.txt then disagrees
// in three ways, all fake people:
// - the two counselors are the other way round;
// - the ward clerk is left off the list;
// - Tom Reyes's phone changes, an ordinary roster change that has nothing to do with callings.
//
// The executive secretary is granted `roster.import` for this ward, so one account can import and
// cannot decide callings.

const HOUSEHOLD = "Scenario, Household";
const member = (key: string): string => testUuid(`scenario-104:member:${key}`);

export async function seed(): Promise<void> {
  await ensureTestWard({
    name: "Harness Test Ward",
    roleAccess: { executive_secretary: { add: ["roster.import"] } },
  });
  await seedNotificationTriggers();

  const bishop = await createTestUser({ handle: "bishop", role: "bishop", firstName: "Mark", lastName: "Andersen" });
  const aaron = await createTestUser({
    handle: "counselor-1",
    role: "counselor",
    counselorPosition: 1,
    firstName: "Aaron",
    lastName: "Pike",
  });
  const lena = await createTestUser({
    handle: "counselor-2",
    role: "counselor",
    counselorPosition: 2,
    firstName: "Lena",
    lastName: "Ortiz",
  });
  const clerk = await createTestUser({ handle: "ward-clerk", role: "ward_secretary", firstName: "Ruth", lastName: "Kim" });
  await createTestUser({ handle: "exec-secretary", role: "executive_secretary", firstName: "Sam", lastName: "Lee" });

  const householdId = await createHousehold({ familyName: HOUSEHOLD });

  const people = [
    { key: "andersen", firstName: "Mark", lastName: "Andersen", birthDate: "1971-03-14", callings: "Bishop", userId: bishop.id },
    { key: "pike", firstName: "Aaron", lastName: "Pike", birthDate: "1979-08-02", callings: "Bishopric First Counselor", userId: aaron.id },
    { key: "ortiz", firstName: "Lena", lastName: "Ortiz", birthDate: "1983-11-20", callings: "Bishopric Second Counselor", userId: lena.id },
    { key: "kim", firstName: "Ruth", lastName: "Kim", birthDate: "1975-06-09", callings: "Ward Clerk", userId: clerk.id },
    { key: "reyes", firstName: "Tom", lastName: "Reyes", birthDate: "1968-09-05", callings: "Primary Teacher", userId: null },
  ];

  for (const person of people) {
    await createMember({
      id: member(person.key),
      firstName: person.firstName,
      lastName: person.lastName,
      fullName: `${person.lastName}, ${person.firstName}`,
      preferredName: `${person.lastName}, ${person.firstName}`,
      birthDate: person.birthDate,
      householdId,
      phone: person.key === "reyes" ? "555-0100" : undefined,
      callings: person.callings,
    });

    if (person.userId !== null) {
      await createMemberLink({
        userId: person.userId,
        memberId: member(person.key),
        status: "active",
        method: "admin",
        linkedBy: bishop.id,
      });
    }
  }
}
