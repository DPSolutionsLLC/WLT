import {
  addMemberToOrganization,
  createActivityEvent,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE READ/WRITE ASYMMETRY CANNOT BE SEEN FROM ONE ACCOUNT.
//
// Migration 054's whole decision is that reads are ward-wide and writes are org-scoped. From a
// single login that is invisible: whatever you can see, you can probably also edit, and the two
// rules look like one. It takes FOUR accounts, three differently-owned profiles, and a youth with
// two of them — which is exactly what seeding is for.
//
// ---------------------------------------------------------------------------------------------
// THE FOUR ACCOUNTS, AND WHAT EACH ONE IS FOR
// ---------------------------------------------------------------------------------------------
//   bishop            sees everything, edits everything, AND is the only account offered the
//                     "which organization" select.
//   ym-president      org_id set. Reads the Young Women's profile, cannot edit it.
//   yw-president      org_id set. The mirror image, so neither result is an accident of which
//                     organization happened to be seeded first.
//   council-member    org_id DELIBERATELY NULL. This is the talks-d hole seen from outside: they
//                     write a ward-wide profile and it has to appear in their OWN list. Without
//                     the `org_id is null` branch in policy 054d the INSERT succeeds and the list
//                     stays empty, which reads as a broken page rather than as a policy bug.
//
// ---------------------------------------------------------------------------------------------
// WHY ONE YOUTH HAS TWO PROFILES
// ---------------------------------------------------------------------------------------------
// Two things at once. The list GROUPS by youth, so a youth with two activities is the only row
// that can prove the grouping works rather than accidentally rendering one card per profile — and
// a fixture with exactly one of everything cannot catch a missing singular case
// (plans/retros/ai-b: "all 1 of its passages"). Malia carries two; Ethan carries one, so the
// singular has somewhere to be wrong.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  // A ward created outside supabase/seed/ward.sql has no notification_settings rows, and
  // `youth_activity_added` fires on every org-owned profile created through the UI.
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const youngMenPresident = await createTestUser({
    handle: "ym-president",
    role: "org_president",
    org: "youngMen",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const youngWomenPresident = await createTestUser({
    handle: "yw-president",
    role: "org_president",
    org: "youngWomen",
    firstName: "Rachel",
    lastName: "Whitfield",
  });

  // NO `org` KEY, AND THAT IS THE POINT. A ward council member is the role 08-youth-activities.md
  // calls the widest in the app, and it is the role most likely to have no organization at all.
  const councilMember = await createTestUser({
    handle: "council-member",
    role: "ward_council_member",
    firstName: "Dana",
    lastName: "Okonkwo",
  });

  const brooks = await createHousehold({
    familyName: "Brooks",
    address: "2201 Canyon Road",
  });

  const tuione = await createHousehold({
    familyName: "Tuione",
    address: "148 Larkspur Lane",
  });

  const ethan = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "male",
  });

  const malia = await createMember({
    firstName: "Malia",
    lastName: "Tuione",
    householdId: tuione,
    category: "youth",
    gender: "female",
  });

  const sela = await createMember({
    firstName: "Sela",
    lastName: "Tuione",
    householdId: tuione,
    category: "youth",
    gender: "female",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });
  await addMemberToOrganization({ memberId: malia, org: "youngWomen" });
  await addMemberToOrganization({ memberId: sela, org: "youngWomen" });

  // ---------------------------------------------------------------------------------------------
  // THREE PROFILES, ONE PER OWNERSHIP SHAPE
  // ---------------------------------------------------------------------------------------------
  // Every account must SEE all three. Only some accounts may EDIT each one. That gap is the
  // scenario.
  const youngMenProfile = await createYouthActivityProfile({
    memberId: ethan,
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  const youngWomenProfile = await createYouthActivityProfile({
    memberId: malia,
    activityName: "Chamber choir",
    activityType: "performance",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "All year",
    org: "youngWomen",
    enteredBy: youngWomenPresident.id,
  });

  // MALIA'S SECOND. Grouping and pluralisation both have something to be wrong about now.
  await createYouthActivityProfile({
    memberId: malia,
    activityName: "Debate team",
    activityType: "academic",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "September to March",
    org: "youngWomen",
    enteredBy: youngWomenPresident.id,
  });

  // NO `org`: a ward-wide profile, entered by the account with no organization. It is the only
  // row on the page that reads "Ward-wide", and the only one its own author may edit.
  const wardWideProfile = await createYouthActivityProfile({
    memberId: sela,
    activityName: "Community orchestra",
    activityType: "community",
    schoolOrg: "Valley Community Orchestra",
    seasonSchedule: "Rehearsals on Thursdays",
    enteredBy: councilMember.id,
  });

  // ---------------------------------------------------------------------------------------------
  // FOUR EVENTS: THREE AHEAD, ONE BEHIND
  // ---------------------------------------------------------------------------------------------
  // The past one is not decoration. The list DEFAULTS to upcoming, so an event that must NOT
  // appear until "Show past events" is pressed is the only way to see that the default is real.
  //
  // Every instant carries an explicit offset — the app's own validator refuses a floating time,
  // so a seed writing one would put the harness and the app on different clocks.
  await createActivityEvent({
    profileId: youngMenProfile,
    title: "Game against Roosevelt",
    eventDate: "2027-01-15T19:30:00-07:00",
    eventType: "home",
    location: "Lincoln High School gym",
  });

  await createActivityEvent({
    profileId: youngWomenProfile,
    title: "Winter concert",
    eventDate: "2027-02-06T18:00:00-07:00",
    eventType: "home",
    location: "Lincoln High School auditorium",
  });

  await createActivityEvent({
    profileId: wardWideProfile,
    title: "Spring performance",
    eventDate: "2027-03-20T15:00:00-06:00",
    eventType: "away",
    location: "Valley Arts Centre",
  });

  await createActivityEvent({
    profileId: youngMenProfile,
    title: "Game against Jefferson",
    eventDate: "2025-12-02T19:30:00-07:00",
    eventType: "away",
    location: "Jefferson High School gym",
    // A game two seasons ago. `completed` was removed by migration 056a on the argument that
    // removed `covered`: an event in the past is completed BY THE CLOCK, and this row's date is
    // what makes it past. Slice D records what actually happened, on activity_logs.
  });

  console.log(
    "  ward, 4 users (one with no organization), 2 households, 3 youth, 4 activity profiles " +
      "(3 org-owned + 1 ward-wide, one youth with two), 4 events (3 upcoming, 1 past)",
  );
}
