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

// A CALENDAR WITH THREE MONTHS ON IT AND EXACTLY ONE EVENT TO ACT ON.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS SCENARIO EXISTS
// ---------------------------------------------------------------------------------------------
// /youth/calendar moved from static server props onto the shared TanStack cache in youth-e, and
// that is precisely where defect youth-a-D2 lives: a Server Component prop NEVER REFETCHES, so an
// attendance control added to the old shape would have succeeded, invalidated two cache keys the
// page did not read, and changed nothing at all on screen. The request goes out, the database is
// written, and the badge, the edge stripe and the banner all stay exactly as they were.
//
// A green suite cannot see that. Nor can a unit test — the arithmetic is already pinned by
// tests/lib/youthCoverage.test.ts and the policies by tests/rls/activity-attendees.test.ts. The
// only way to find it is to press the button and watch.
//
// ---------------------------------------------------------------------------------------------
// EVERY EVENT IS UPCOMING, AND THAT IS NOT AN OVERSIGHT
// ---------------------------------------------------------------------------------------------
// The calendar reads `includePast: false` — a calendar that opens on last season is a calendar
// nobody opens twice. So a past event seeded here would simply be invisible, and the scenario
// spans three months FORWARD rather than around today.
//
// ---------------------------------------------------------------------------------------------
// ONE UNCOVERED EVENT, DELIBERATELY
// ---------------------------------------------------------------------------------------------
// The banner names the uncovered events rather than counting them (youth-c). With exactly one, the
// banner must DISAPPEAR ENTIRELY when the tester signs up — not drop from 2 to 1 — which is the
// clearest possible evidence that the page is reading the cache the mutation invalidated.
//
// The away, tbd and cancelled events exist so the tester can see that widening the coverage model
// did not quietly change what those three do: an away game carries no coverage expectation by
// design, a tbd game is loud for a different reason, and a cancelled one stays visible and marked.

const DAY_MS = 86_400_000;

// An offset-bearing instant, always. `activity_events.event_date` is a timestamptz and the app's
// own validator refuses a floating time (lib/validation/youth.ts).
function daysFromNow(days: number, hour: number): string {
  const instant = new Date(Date.now() + days * DAY_MS);
  instant.setHours(hour, 0, 0, 0);
  return instant.toISOString();
}

export async function seed(): Promise<void> {
  await ensureTestWard({
    name: "Harness Test Ward",
    crossOrgVisibility: false,
    homeVenues: ["Lincoln High School"],
  });

  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Marcus",
    lastName: "Reyes",
  });

  // THE ACCOUNT THE WALK SIGNS IN AS. An org president is NOT bishopric, so "Ask someone to go"
  // must be ABSENT for them rather than present-and-refusing — which is half of what this walk
  // checks, and the half youth-a-D1 got wrong.
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
    firstName: "Renata",
    lastName: "Alvarez",
  });

  const brooks = await createHousehold({ familyName: "Brooks", address: "2201 Canyon Road" });
  const chen = await createHousehold({ familyName: "Chen", address: "418 Meadowlark Lane" });

  const ethan = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "male",
  });

  const maya = await createMember({
    firstName: "Maya",
    lastName: "Chen",
    householdId: chen,
    category: "youth",
    gender: "female",
  });

  const sofia = await createMember({
    firstName: "Sofia",
    lastName: "Chen",
    householdId: chen,
    category: "youth",
    gender: "female",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });
  await addMemberToOrganization({ memberId: maya, org: "youngWomen" });
  await addMemberToOrganization({ memberId: sofia, org: "youngWomen" });

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
    memberId: maya,
    activityName: "Concert choir",
    activityType: "performance",
    schoolOrg: "Lincoln High School",
    org: "youngWomen",
    enteredBy: youngWomenPresident.id,
  });

  const swim = await createYouthActivityProfile({
    memberId: sofia,
    activityName: "Swim team",
    activityType: "sport",
    schoolOrg: "Valley Aquatic Centre",
    org: "youngWomen",
    enteredBy: youngWomenPresident.id,
  });

  // ---------------------------------------------------------------------------------------------
  // THE EVENT THIS SCENARIO IS ABOUT.
  // ---------------------------------------------------------------------------------------------
  // Home, inside the seven-day notice window, and nobody down for it — the only `uncovered` event
  // on the page. It carries the red edge stripe, the "Nobody going" badge and its own name in the
  // banner at the top, and all three must clear together when the tester presses "I'll go".
  await createActivityEvent({
    title: "Game against Roosevelt",
    eventDate: daysFromNow(4, 19),
    eventType: "home",
    location: "Lincoln High School gym",
    profileId: basketball,
  });

  // Inside the window and ALREADY COVERED, so the badge has something to be compared against and
  // the banner is not simply "every home game this week".
  const covered = await createActivityEvent({
    title: "Game against Jefferson",
    eventDate: daysFromNow(6, 19),
    eventType: "home",
    location: "Lincoln High School gym",
    profileId: basketball,
  });

  await createActivityAttendee({ eventId: covered, userId: bishop.id });

  // AWAY — no coverage expectation, by design. It must stay visible and marked, and it must NOT
  // appear in the banner however close it is (08-youth-activities.md §Step 4).
  await createActivityEvent({
    title: "Away fixture at Riverton",
    eventDate: daysFromNow(5, 17),
    eventType: "away",
    location: "Riverton Sports Park",
    profileId: basketball,
  });

  // TBD — loud for a DIFFERENT reason. Nobody can even be asked to go to a game whose location
  // nobody has settled, which is why `needs_type` outranks `unassigned`.
  await createActivityEvent({
    title: "Tournament, venue to be confirmed",
    eventDate: daysFromNow(9, 9),
    eventType: "tbd",
    location: "To be confirmed",
    profileId: basketball,
    allDay: true,
  });

  // CANCELLED, and INSIDE the window. It must never register as uncovered at any distance — the
  // rule lib/youth/coverage.ts tests before it consults the clock — and it must stay visible and
  // marked rather than disappearing.
  await createActivityEvent({
    title: "Game against Washington",
    eventDate: daysFromNow(3, 19),
    eventType: "home",
    location: "Lincoln High School gym",
    profileId: basketball,
    status: "cancelled",
  });

  // BEYOND THE WINDOW, so they read `unassigned` rather than `uncovered` — the quieter mark, and
  // the ordinary state of a schedule. They also fill out the second and third months so the sort
  // has something to reorder and the month grids have something to show.
  const laterBasketball: Array<[string, number]> = [
    ["Game against Madison", 16],
    ["Game against Adams", 24],
    ["Game against Monroe", 38],
    ["Game against Jackson", 52],
    ["Game against Harrison", 66],
  ];

  for (const [title, days] of laterBasketball) {
    await createActivityEvent({
      title,
      eventDate: daysFromNow(days, 19),
      eventType: "home",
      location: "Lincoln High School gym",
      profileId: basketball,
    });
  }

  // A SECOND ORGANIZATION'S ACTIVITY, so the organization filter has two answers and the reader
  // can see that the calendar is genuinely ward-wide (migration 054's untouched SELECT policy).
  const concert = await createActivityEvent({
    title: "Spring concert",
    eventDate: daysFromNow(19, 19),
    eventType: "home",
    location: "Lincoln High School auditorium",
    profileId: choir,
  });

  await createActivityAttendee({ eventId: concert, userId: youngWomenPresident.id });

  await createActivityEvent({
    title: "Choir festival",
    eventDate: daysFromNow(45, 18),
    eventType: "home",
    location: "Lincoln High School auditorium",
    profileId: choir,
  });

  // A THIRD ACTIVITY, so "Kind of activity" and "Young person" both narrow to something real.
  await createActivityEvent({
    title: "Regional swim meet",
    eventDate: daysFromNow(28, 8),
    eventType: "away",
    location: "Valley Aquatic Centre",
    profileId: swim,
  });

  await createActivityEvent({
    title: "Invitational relay",
    eventDate: daysFromNow(60, 8),
    eventType: "home",
    location: "Lincoln High School pool",
    profileId: swim,
  });

  console.log(
    "  ward (cross-org OFF), 3 users, 2 households, 3 youth, 3 activities, 14 upcoming " +
      "events across three months (1 uncovered, 1 away, 1 tbd, 1 cancelled), 2 attendee rows",
  );
  console.log(
    `  bishop=${bishop.email} ym-president=${youngMenPresident.email} ` +
      `yw-president=${youngWomenPresident.email}`,
  );
}
