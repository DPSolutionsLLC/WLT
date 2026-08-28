import {
  addMemberToOrganization,
  createActivityAttendee,
  createActivityEvent,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// SIX EVENTS AT SPECIFIC DISTANCES FROM NOW, WHICH IS THE WHOLE REASON THIS IS SEEDED.
//
// Coverage is a function of the clock: `uncovered` means "a home event inside the next seven
// days with nobody going", and the difference between that and `unassigned` is three days versus
// twenty. A tester cannot place events at those distances by hand without doing arithmetic they
// will get wrong, and getting it wrong produces a scenario that passes for the wrong reason.
//
// So every date below is computed FROM THE SEED TIME rather than written out. The scenario is
// therefore runnable on any day, and the distances are the same every run.
//
// ---------------------------------------------------------------------------------------------
// ONE EVENT PER COVERAGE STATE, AND ONE THAT MUST HAVE NO STATE AT ALL
// ---------------------------------------------------------------------------------------------
//   +3 days,  home,  no attendee     → uncovered.    The loudest thing on the page.
//   +3 days,  home,  one attendee    → covered.      Proves the badge is derived from the count.
//   +20 days, home,  no attendee     → unassigned.   NOT uncovered — beyond the notice window.
//   +3 days,  away,  no attendee     → awareness.    Never a warning, at any distance, by design.
//   +3 days,  tbd,   no attendee     → needs_type.   Nobody can even be asked.
//   +3 days,  home,  CANCELLED       → nothing.      No badge — and still inside the "upcoming"
//                                                    count on /youth, because a cancelled game
//                                                    can be reinstated.
//
// The cancelled one is the row this scenario exists for. The tester is asked to move its date
// into the PAST in Supabase and reload: it must still show no warning. That is the user's rule
// from the planning conversation, and it is why coverage.ts tests `cancelled` BEFORE it consults
// the clock — an implementation that checked the clock first would pass every other line here.
//
// ---------------------------------------------------------------------------------------------
// FOUR USERS, BECAUSE THE TWO PERMISSION GATES ARE DIFFERENT
// ---------------------------------------------------------------------------------------------
// `ward-council` has NO organization and holds `youth_activities.view` and `.manage` — and still
// must not see an assign control, because assigning is bishopric-only. That pairing is what
// catches the youth-a-D1 / visits-d defect: a control offered where the API refuses.

const DAY_MS = 86_400_000;

// An offset-bearing instant, always. `activity_events.event_date` is a timestamptz and the app's
// own validator refuses a floating time — a seed writing one would put the harness and the app on
// different clocks (lib/validation/youth.ts).
function daysFromNow(days: number, hour: number): string {
  const instant = new Date(Date.now() + days * DAY_MS);
  instant.setHours(hour, 0, 0, 0);
  return instant.toISOString();
}

export async function seed(): Promise<void> {
  // CONFIGURED, unlike scenario 054. This scenario is about coverage rather than classification,
  // so the venue list is set out of the way and the events carry their types directly.
  await ensureTestWard({
    name: "Harness Test Ward",
    // Written as a person would type it. The classifier folds case at comparison time, so the
    // capitals here are the ward's own words rather than an implementation detail.
    homeVenues: ["Lincoln High School"],
  });
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Marcus",
    lastName: "Reyes",
  });

  const youngMenPresident = await createTestUser({
    handle: "ym-president",
    role: "org_president",
    org: "youngMen",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const reliefSocietyPresident = await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Nora",
    lastName: "Whitfield",
  });

  // NO ORGANIZATION, deliberately. The widest role in the app, and the one most likely to have no
  // org_id at all — which is the case migration 054d's `org_id is null` branch exists for.
  const wardCouncilMember = await createTestUser({
    handle: "ward-council",
    role: "ward_council_member",
    firstName: "Diane",
    lastName: "Okafor",
  });

  const brooks = await createHousehold({
    familyName: "Brooks",
    address: "2201 Canyon Road",
  });

  const chen = await createHousehold({
    familyName: "Chen",
    address: "418 Meadowlark Lane",
  });

  const ethan = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "male",
  });

  const ava = await createMember({
    firstName: "Ava",
    lastName: "Chen",
    householdId: chen,
    category: "youth",
    gender: "female",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });
  await addMemberToOrganization({ memberId: ava, org: "youngWomen" });

  const basketball = await createYouthActivityProfile({
    memberId: ethan,
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  const choir = await createYouthActivityProfile({
    memberId: ava,
    activityName: "Concert choir",
    activityType: "performance",
    schoolOrg: "Lincoln High School",
    org: "youngWomen",
    enteredBy: bishop.id,
  });

  // uncovered — the one that must be impossible to miss.
  await createActivityEvent({
    profileId: basketball,
    title: "Game against Roosevelt",
    eventDate: daysFromNow(3, 19),
    eventType: "home",
    location: "Lincoln High School gym",
  });

  // covered — same distance, same type, one attendee. The ONLY difference is the attendee row, so
  // a badge that ignored the count would show these two identically.
  const coveredEvent = await createActivityEvent({
    profileId: choir,
    title: "Winter concert",
    eventDate: daysFromNow(3, 18),
    eventType: "home",
    location: "Lincoln High School auditorium",
  });

  await createActivityAttendee({
    eventId: coveredEvent,
    userId: youngMenPresident.id,
  });

  // unassigned — home, nobody going, but beyond the seven-day notice window. It must NOT read
  // uncovered; a page that warns about everything warns about nothing.
  await createActivityEvent({
    profileId: basketball,
    title: "Game against Jefferson",
    eventDate: daysFromNow(20, 19),
    eventType: "home",
    location: "Lincoln High School gym",
  });

  // awareness — an away game with nobody going is the DESIGNED outcome
  // (08-youth-activities.md §Step 4), not a failure. No warning tone, at any distance.
  await createActivityEvent({
    profileId: basketball,
    title: "Game at Madison",
    eventDate: daysFromNow(3, 19),
    eventType: "away",
    location: "Madison High School gym",
  });

  // needs_type — nobody has said whether this is home or away, so nobody can even be asked. It
  // ranks second overall for that reason.
  await createActivityEvent({
    profileId: choir,
    title: "Regional choir festival",
    eventDate: daysFromNow(3, 15),
    eventType: "tbd",
    location: "Somewhere to be confirmed",
  });

  // THE ROW THIS SCENARIO EXISTS FOR. Cancelled, three days out, nobody going: no coverage badge
  // at all — and still counted in "upcoming events", because it can be reinstated. The tester
  // moves its date into the past and it must STILL show no warning.
  await createActivityEvent({
    profileId: basketball,
    title: "Game against Washington",
    eventDate: daysFromNow(3, 19),
    eventType: "home",
    location: "Lincoln High School gym",
    status: "cancelled",
  });

  console.log(
    "  ward (home_venues configured), 4 users, 2 households, 2 youth, 2 activity profiles, " +
      "6 events at fixed distances from now, 1 attendee",
  );
  console.log(
    `  bishop=${bishop.email} ym-president=${youngMenPresident.email} ` +
      `rs-president=${reliefSocietyPresident.email} ward-council=${wardCouncilMember.email}`,
  );
}
