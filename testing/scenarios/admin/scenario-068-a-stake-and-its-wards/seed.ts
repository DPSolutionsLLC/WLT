import {
  createTestUser,
  createUnitAssignment,
  ensureSecondTestWard,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// A STAKE AND ITS WARDS — the first time scenario 066's state is reachable by hand.
//
// ⚠️ NO UNITS ARE SEEDED, AND THAT IS THE POINT OF THE FILE. Every ward starts with
// `unit_id: null`, which is exactly what migration 065's backfill produces for a real ward. The
// scenario CREATES the hierarchy through the screen, so if anything on that screen only works
// against units that already exist, this is where it shows.
//
// `ensureTestUnits()` is therefore deliberately NOT called. Its own header warns that calling it
// "changes what the app does", and a stake seeded here would make the create path untested while
// looking like it had been walked.
//
// ⚠️ NOBODY STARTS WITH TWO CALLINGS. Scenario 066 seeds a second calling because no UI could
// create one; this scenario exists because one now can, so seeding it would remove the thing
// being walked. The EQ president is the person who gains one during the walk.
//
// THE SUPER ADMIN IS STILL SEEDED, because that genuinely cannot be created through any screen:
// `super_admin` is out of INVITABLE_ROLES and out of updateUserSchema's role enum (CLAUDE.md §7),
// and `unit_assignments` has no INSERT policy. Granting app-wide authority deserves more friction
// than an ordinary role, and "there is no button for it" is that friction.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await ensureSecondTestWard({ name: "Harness Second Ward" });
  await seedNotificationTriggers();

  // THE PERSON WHO DECIDES THE STRUCTURE. Their account lives in ward 1 and holds an ordinary
  // calling there; `unit_id: null` is what makes the assignment app-wide rather than scoped to
  // one stake, and the `unit_assignments_scope` CHECK permits that only for this role.
  const superAdmin = await createTestUser({
    handle: "super-admin",
    // BOTH GRANTS, matching the `superAdmin` fixture in tests/helpers/seed.ts. The ward calling is
    // `super_admin` and the app-wide authority is the `unit_assignments` row below.
    //
    // The walk of scenario 067 found this seeded only the second, and the person was refused the
    // whole /admin section. The LAYOUT was fixed to admit a structural super admin either way —
    // so this is no longer load-bearing — but the two fixtures should describe one kind of person.
    role: "super_admin",
    firstName: "Dana",
    lastName: "Whitmore",
  });

  await createUnitAssignment({
    userId: superAdmin.id,
    role: "super_admin",
    unitId: null,
  });

  // WARD 1'S BISHOP — the negative case. A full ward admin, who must see no trace of the unit
  // layer anywhere even once a stake genuinely sits above his ward.
  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // THE PERSON WHO GAINS A SECOND CALLING during the walk. An org president rather than a bishop,
  // so the two callings disagree about what they can reach and the difference is visible in the
  // navigation rather than only in a row.
  await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  // WARD 2'S BISHOP. Two things need him: the second ward must have a real leader for a calling
  // assigned into it to be meaningful, and the last-bishop guard needs somebody to be the last
  // bishop OF that ward.
  await createTestUser({
    handle: "second-ward-bishop",
    role: "bishop",
    ward: "second",
    firstName: "Alan",
    lastName: "Reyes",
  });
}
