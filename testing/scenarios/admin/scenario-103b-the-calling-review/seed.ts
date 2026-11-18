import {
  createMember,
  createMemberLink,
  createTestUser,
  createUnitAssignment,
  createZoomRemoteLink,
  ensureTestWard,
  seedNotificationTriggers,
  testEmail,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// ITER-058 slice cr2 (scenario 103, Part 2): THE CALLING REVIEW.
//
// Reaching "linked, and the ward list disagrees with the app" by hand needs a pasted roster, several
// accounts and wrong callings. This seeds all of it:
// - the bishop is linked and agrees with the ward list (no row);
// - the two counselors are the wrong way round in the app. Aaron Pike is 1st here and 2nd on the
//   ward list, is NOT linked, and his ward list email is his login (he gets "Is this you?"). Lena
//   Ortiz is 2nd here and 1st on the list, not linked, with no email match (she must ask);
// - the ward clerk is linked and agrees (no row, until the super admin overrides it);
// - the Elders Quorum president is linked, but the app says counselor; his record also holds Ward
//   Mission Leader, which no title maps to (set aside / not recognised);
// - the music coordinator is linked to somebody who has MOVED OUT (a release);
// - the executive secretary is linked to somebody whose only calling is one the app does not
//   recognise (a release that lists the title);
// - a super admin, for the override;
// - a stream remote link on the 1st counselor's position, which the swap must turn off.

const member = (key: string): string => testUuid(`scenario-103b:member:${key}`);

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
  await createTestUser({
    handle: "counselor-2",
    role: "counselor",
    counselorPosition: 2,
    firstName: "Lena",
    lastName: "Ortiz",
  });
  const clerk = await createTestUser({ handle: "ward-clerk", role: "ward_secretary", firstName: "Ruth", lastName: "Kim" });
  const eqPresident = await createTestUser({
    handle: "eq-president",
    role: "org_counselor",
    org: "eldersQuorum",
    firstName: "Tom",
    lastName: "Reyes",
  });
  const music = await createTestUser({
    handle: "music-coordinator",
    role: "music_coordinator",
    firstName: "Paul",
    lastName: "Grant",
  });
  const execSecretary = await createTestUser({
    handle: "exec-secretary",
    role: "executive_secretary",
    firstName: "Sam",
    lastName: "Lee",
  });
  const superAdmin = await createTestUser({
    handle: "super-admin",
    role: "super_admin",
    firstName: "Dana",
    lastName: "Whitlock",
  });
  await createUnitAssignment({ userId: superAdmin.id, role: "super_admin" });

  const people = [
    { key: "andersen", firstName: "Mark", lastName: "Andersen", birthDate: "1971-03-14", email: testEmail("bishop"), callings: "Bishop" },
    { key: "pike", firstName: "Aaron", lastName: "Pike", birthDate: "1979-08-02", email: testEmail("counselor-1"), callings: "Bishopric Second Counselor" },
    { key: "ortiz", firstName: "Lena", lastName: "Ortiz", birthDate: "1983-11-20", email: "ortiz.family@example.test", callings: "Bishopric First Counselor" },
    { key: "kim", firstName: "Ruth", lastName: "Kim", birthDate: "1975-06-09", email: testEmail("ward-clerk"), callings: "Ward Clerk" },
    { key: "reyes", firstName: "Tom", lastName: "Reyes", birthDate: "1968-09-05", email: "tom.reyes@example.test", callings: "Elders Quorum President\nWard Mission Leader" },
    { key: "grant", firstName: "Paul", lastName: "Grant", birthDate: "1988-04-17", email: undefined, callings: "Music Coordinator", status: "moved_out" as const },
    { key: "lee", firstName: "Sam", lastName: "Lee", birthDate: "1981-12-01", email: undefined, callings: "Ward Assistant Clerk" },
  ];

  for (const person of people) {
    await createMember({
      id: member(person.key),
      firstName: person.firstName,
      lastName: person.lastName,
      birthDate: person.birthDate,
      email: person.email,
      callings: person.callings,
      status: person.status,
    });
  }

  const links: Array<{ userId: string; key: string }> = [
    { userId: bishop.id, key: "andersen" },
    { userId: clerk.id, key: "kim" },
    { userId: eqPresident.id, key: "reyes" },
    { userId: music.id, key: "grant" },
    { userId: execSecretary.id, key: "lee" },
  ];
  for (const link of links) {
    await createMemberLink({
      userId: link.userId,
      memberId: member(link.key),
      status: "active",
      method: "admin",
      linkedBy: aaron.id,
    });
  }

  await createZoomRemoteLink({
    position: "counselor_1",
    holderUserId: aaron.id,
    setBy: bishop.id,
    url: "https://example.org/?remote=scenario-103b",
  });
}
