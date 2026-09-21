import {
  addMemberToOrganization,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  createVisitLog,
  ensureTestWard,
  ensureWardUnit,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE ZERO-BEHAVIOUR-CHANGE GUARANTEE, MADE WALKABLE.
//
// One ward, with ONE `units` row above it and NO PARENT — which is exactly what migration 065's
// backfill produces for every ward that already existed. Every real ward is in this state today
// and will stay in it until somebody creates a stake in proto-d.
//
// So this scenario proves a NEGATIVE, and the negative is the whole phase's promise: anybody who
// belongs to one ward never sees the unit layer at all. `ensureWardUnit()` rather than
// `ensureTestUnits()` is the single line that makes it so — no stake, therefore nobody can be
// assigned over this ward, therefore `listSwitchableWards()` returns [] for all four accounts and
// the control never renders.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await ensureWardUnit();
  await seedNotificationTriggers();

  const bishop = await createTestUser({
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

  await createTestUser({
    handle: "ward-council-member",
    role: "ward_council_member",
    firstName: "Priya",
    lastName: "Raman",
  });

  await createTestUser({
    handle: "music-coordinator",
    role: "music_coordinator",
    firstName: "Helen",
    lastName: "Vasquez",
  });

  // An ordinary ward, so "every page renders exactly as it did before migration 065" is a
  // statement about pages with something on them rather than about four empty states.

  const brooks = await createHousehold({
    familyName: "Brooks",
    address: "2201 Canyon Road",
  });

  const youth = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "male",
  });

  await addMemberToOrganization({ memberId: youth, org: "youngMen" });

  await createMember({
    firstName: "Janet",
    lastName: "Brooks",
    householdId: brooks,
    category: "adult",
    gender: "female",
  });

  const calloway = await createHousehold({
    familyName: "Calloway",
    address: "118 Mill Street",
  });

  await createMember({
    firstName: "Trevor",
    lastName: "Calloway",
    householdId: calloway,
    category: "adult",
    gender: "male",
  });

  await createVisitLog({
    householdId: brooks,
    org: "eldersQuorum",
    visitDate: "2026-09-06",
    sharedNotes: "Good visit. Ethan is enjoying the season.",
    recordedBy: eqPresident.id,
  });

  await createSunday({ date: "2026-09-06", conductingUserId: bishop.id });
  await createSunday({ date: "2026-09-13", conductingUserId: bishop.id });

  console.log(
    "  1 ward with 1 parentless ward unit, 4 users, 2 households, 3 members,\n" +
      "  1 visit log, 2 Sundays — and no stake anywhere",
  );
}
