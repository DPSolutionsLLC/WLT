import {
  createHousehold,
  createMember,
  createMemberLink,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
  testEmail,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// ITER-058 slice cr4 (scenario 105): INVITE SOMEBODY THE WARD LIST GIVES A CALLING.
//
// Fake people only. The bishopric is linked. Three people on the list hold a mapped calling and no
// linked account, each in a different state:
// - Nora Diaz, Ward Clerk: no account at all → Invite;
// - Paul Grant, Elders Quorum President: an unlinked account with his roster email already exists →
//   "may be this person", no Invite;
// - Tom Reyes, Primary Teacher: a title the app does not recognise → not listed;
// - Lena Ortiz, Music Coordinator: no account → Invite. Her invite is the one answered "No, this
//   isn't me" (decided walking 105), so Nora's link stays usable for registering.
// Nora's roster email is a harness address, so the account she registers is removed by seed:clean.

const HOUSEHOLD = "Scenario, Household";
const member = (key: string): string => testUuid(`scenario-105:member:${key}`);

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  const bishop = await createTestUser({ handle: "bishop", role: "bishop", firstName: "Mark", lastName: "Andersen" });
  const aaron = await createTestUser({
    handle: "counselor-1",
    role: "counselor",
    counselorPosition: 1,
    firstName: "Aaron",
    lastName: "Pike",
  });
  // Unlinked on purpose (D1): an account made before the ward list decided callings.
  await createTestUser({ handle: "eq-president", role: "org_president", org: "eldersQuorum", firstName: "Paul", lastName: "Grant" });

  const householdId = await createHousehold({ familyName: HOUSEHOLD });

  const people = [
    { key: "andersen", firstName: "Mark", lastName: "Andersen", birthDate: "1971-03-14", callings: "Bishop", email: testEmail("bishop"), userId: bishop.id },
    { key: "pike", firstName: "Aaron", lastName: "Pike", birthDate: "1979-08-02", callings: "Bishopric First Counselor", email: testEmail("counselor-1"), userId: aaron.id },
    { key: "diaz", firstName: "Nora", lastName: "Diaz", birthDate: "1988-01-23", callings: "Ward Clerk", email: testEmail("nora-diaz"), userId: null },
    { key: "grant", firstName: "Paul", lastName: "Grant", birthDate: "1974-04-30", callings: "Elders Quorum President", email: testEmail("eq-president"), userId: null },
    { key: "reyes", firstName: "Tom", lastName: "Reyes", birthDate: "1968-09-05", callings: "Primary Teacher", email: null, userId: null },
    { key: "ortiz", firstName: "Lena", lastName: "Ortiz", birthDate: "1991-06-11", callings: "Music Coordinator", email: testEmail("lena-ortiz"), userId: null },
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
      email: person.email ?? undefined,
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
