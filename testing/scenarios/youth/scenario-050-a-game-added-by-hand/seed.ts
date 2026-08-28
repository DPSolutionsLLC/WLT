import {
  addMemberToOrganization,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// DELIBERATELY THE SMALLEST SEED IN THE HARNESS: one leader, one youth, one activity, AND NO
// EVENTS AT ALL.
//
// The thing being tested is the round trip through the FORM, so anything this file pre-creates is
// a row the tester did not type — and a pre-seeded event would let the checklist pass while the
// entry path was broken. The empty schedule is also the first thing anybody sees on the first day
// the module ships, so it gets looked at properly here rather than never.
//
// ---------------------------------------------------------------------------------------------
// WHAT THIS SCENARIO IS ACTUALLY FOR
// ---------------------------------------------------------------------------------------------
// 08-youth-activities.md: "A game showing at the wrong hour makes the whole feature useless." An
// `<input type="datetime-local">` yields a FLOATING time — half past seven in no particular place
// — and every obvious implementation of "convert it" converts once too often.
//
// The bug worth catching is THE DOUBLE CONVERSION, and it only ever appears on the SECOND write:
// save 7:30pm, reopen the row, save again, and the hour walks by the offset. A single save looks
// perfect, which is exactly how it ships. So the checklist edits and re-saves rather than only
// creating.
//
// Establishing the correct instant now, by hand, is also what gives slice B's ICS import
// something to be compared against.

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

  console.log("  ward, 1 user, 1 household, 1 youth, 1 activity profile, NO events");
}
