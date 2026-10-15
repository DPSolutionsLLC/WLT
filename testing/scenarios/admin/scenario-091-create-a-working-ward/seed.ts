import {
  createTestUser,
  createUnitAssignment,
  ensureTestUnits,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// CREATE A WORKING WARD FROM STAKES & WARDS (ITER-041 slice a).
//
// The stake is seeded and the second ward is NOT: creating that ward through the screen is the
// thing being walked, and a seeded one would make the provisioning path untested while looking
// like it had been walked (scenario 068's warning, for the same reason).
//
// THE WARD CREATED DURING THE WALK HAS A RANDOM ID. cleanUp.ts finds it by its unit hanging off
// the harness stake, which is the only place a walk-created ward can be found narrowly.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await ensureTestUnits();
  await seedNotificationTriggers();

  // A counselor in the harness ward PLUS app-wide super admin authority, the shape the user has
  // in the real app. One calling to start with, so the switcher appearing is the walk's evidence
  // that the second calling landed.
  const admin = await createTestUser({
    handle: "admin",
    role: "counselor",
    counselorPosition: 1,
    firstName: "Dana",
    lastName: "Whitmore",
  });

  await createUnitAssignment({ userId: admin.id, role: "super_admin", unitId: null });
}
