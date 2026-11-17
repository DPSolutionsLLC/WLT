import {
  createMember,
  createMemberLink,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
  testEmail,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// ITER-058 slice cr1: LINKING A LOGIN TO ITS PERSON ON THE WARD LIST.
//
// Five leaders, each in a different linking state, so every path is one sign-in away:
// - the bishop is ALREADY linked (by the 1st counselor), so Admin → Users shows "Linked to";
// - the 1st counselor's roster email IS their login email, so they get "Is this you?";
// - the 2nd counselor's roster email is a family address, so they must ask;
// - the ward clerk shares a roster email with their spouse, so there is no single match and they
//   must ask too — guessing between two people is exactly what the match refuses;
// - the Elders Quorum president has ALREADY asked, so their request waits at the top of Admin → Users.
//
// The callings text is the real LCR wording. It does nothing in cr1; cr2 (Part 2) reads it, and the
// counselors are deliberately the wrong way round in the app — Aaron is 1st here, 2nd on the roster.

const member = (key: string): string => testUuid(`scenario-103:member:${key}`);

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  const bishop = await createTestUser({ handle: "bishop", role: "bishop", firstName: "Mark", lastName: "Andersen" });
  const firstCounselor = await createTestUser({
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
  await createTestUser({ handle: "ward-clerk", role: "ward_secretary", firstName: "Ruth", lastName: "Kim" });
  const eqPresident = await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tom",
    lastName: "Reyes",
  });

  await createMember({
    id: member("andersen"),
    firstName: "Mark",
    lastName: "Andersen",
    birthDate: "1971-03-14",
    email: testEmail("bishop"),
    callings: "Bishop",
  });
  await createMember({
    id: member("pike"),
    firstName: "Aaron",
    lastName: "Pike",
    birthDate: "1979-08-02",
    email: testEmail("counselor-1"),
    callings: "Bishopric Second Counselor",
  });
  await createMember({
    id: member("ortiz"),
    firstName: "Lena",
    lastName: "Ortiz",
    birthDate: "1983-11-20",
    email: "ortiz.family@example.test",
    callings: "Bishopric First Counselor",
  });
  await createMember({
    id: member("ruth-kim"),
    firstName: "Ruth",
    lastName: "Kim",
    birthDate: "1975-06-09",
    email: testEmail("ward-clerk"),
    callings: "Ward Clerk",
  });
  await createMember({
    id: member("daniel-kim"),
    firstName: "Daniel",
    lastName: "Kim",
    birthDate: "1974-01-30",
    email: testEmail("ward-clerk"),
    callings: "Sunday School Teacher",
  });
  await createMember({
    id: member("reyes"),
    firstName: "Tom",
    lastName: "Reyes",
    birthDate: "1968-09-05",
    email: "tom.reyes@example.test",
    callings: "Elders Quorum President\nWard Mission Leader",
  });
  await createMember({
    id: member("baker"),
    firstName: "Hannah",
    lastName: "Baker",
    birthDate: "1990-02-11",
    callings: "Primary Teacher",
  });

  await createMemberLink({
    userId: bishop.id,
    memberId: member("andersen"),
    status: "active",
    method: "admin",
    linkedBy: firstCounselor.id,
  });
  await createMemberLink({ userId: eqPresident.id, status: "pending" });
}
