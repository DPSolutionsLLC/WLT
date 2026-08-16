import {
  addMemberToOrganization,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// Every row this creates lives in the harness test ward, which `npm run seed:clean` deletes
// whole. Do not write to any other ward.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  // A ward created outside supabase/seed/ward.sql has no notification_settings rows, so
  // emitNotification() would warn and send nothing. Call this if the scenario expects a
  // notification to arrive.
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const household = await createHousehold({
    familyName: "Brooks",
    address: "2201 Canyon Road",
  });

  const youth = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: household,
    category: "youth",
    gender: "male",
  });

  await addMemberToOrganization({ memberId: youth, org: "youngMen" });

  await createSunday({ date: "2026-09-06", conductingUserId: bishop.id });

  console.log("  ward, 2 users, 1 household, 1 member, 1 Sunday");
}
