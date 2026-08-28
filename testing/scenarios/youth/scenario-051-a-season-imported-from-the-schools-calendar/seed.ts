import {
  addMemberToOrganization,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE SAME SEED AS SCENARIO 050, AND NO EVENTS AT ALL — deliberately.
//
// This scenario is the FIRST import into an activity that has nothing in it, so anything this
// file pre-creates is a row the tester did not import. A pre-seeded event would let the checklist
// pass while the create path was broken, and it would also make "the counts on the two screens
// match" trivially true.
//
// ---------------------------------------------------------------------------------------------
// WHAT SEEDING ACTUALLY BUYS HERE, AND IT IS NOT THE WARD
// ---------------------------------------------------------------------------------------------
// It is `lincoln-basketball.ics`, committed beside this file. Building an .ics by hand that
// exercises a TZID with its VTIMEZONE, a UTC time, a floating time, an all-day entry, an RRULE
// with an EXDATE, a VEVENT with no UID and a VEVENT with no DTSTART takes about twenty minutes
// and is exactly the kind of thing a tester quietly skips half of. Every one of those seven
// shapes is a distinct code path in lib/youth/ics/parseIcs.ts.
//
// EVERY VEVENT IN THAT FILE CARRIES ITS EXPECTED LOCAL TIME IN ITS OWN DESCRIPTION, so the
// checklist below can be answered by reading the file next to the screen rather than by trusting
// the screen.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS CANNOT BE A UNIT TEST
// ---------------------------------------------------------------------------------------------
// tests/lib/icsTimezone.test.ts already asserts every instant in that file to the millisecond.
// What no test can answer is whether THE HOUR A LEADER READS ON THE CARD is the hour the school
// published — the resolution, the storage, the read back and the rendering are four conversions,
// and a unit test only ever proves the first two.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  const president = await createTestUser({
    handle: "ym-president",
    role: "org_president",
    org: "youngMen",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const household = await createHousehold({
    familyName: "Brooks",
    address: "2201 Canyon Road",
  });

  const ethan = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: household,
    category: "youth",
    gender: "male",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });

  await createYouthActivityProfile({
    memberId: ethan,
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngMen",
    enteredBy: president.id,
  });

  console.log(
    "  ward, 1 user, 1 household, 1 youth, 1 activity profile, NO events, NO calendar",
  );
  console.log("  fixture: lincoln-basketball.ics, beside this seed");
}
