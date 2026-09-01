import {
  addMemberToOrganization,
  createActivityCalendar,
  createActivityEvent,
  createActivityRoster,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// A SCHEDULE WITH NOBODY ON IT YET — and a closed season beside it, for contrast.
//
// ---------------------------------------------------------------------------------------------
// THE TWO SILENCES THAT MUST NOT LOOK ALIKE
// ---------------------------------------------------------------------------------------------
// Both teams here produce "zero young people expected at this game", and THEY MUST BE ANSWERED
// DIFFERENTLY:
//
//   CONCERT CHOIR — imported, nobody assigned yet. Its games must stay LOUD: ordinary uncovered
//   coverage, badges, a place in the count strip. This is the state ITER-033's own flow passes
//   through — import once, then assign — so every ward reaches it on every schedule they import.
//   Answering it "no expectation" would silently remove a whole season from the coverage model
//   with no badge anywhere saying so and nobody asked to attend any of it.
//
//   CROSS COUNTRY — one youth on it, season CLOSED, two games after the closing instant. Those two
//   must go QUIET. That is the ITER-033 leak: `ActivityCalendar.tsx` and `calendar/page.tsx`
//   contained no reference to `closedAt` at all, so a closed team's future games went on raising
//   "Nobody going" for ever.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS NEEDS A SEED, AND WHY A GREEN SUITE CANNOT REPLACE IT
// ---------------------------------------------------------------------------------------------
// Reaching the empty-roster state deterministically means importing a schedule and then NOT
// assigning anybody — which nobody does on purpose, so it is not a state a tester stumbles into.
//
// And the failure mode is a DISAPPEARANCE. If lib/youth/roster.ts's branch 5 is ever "tidied up"
// to answer an empty roster with `no_expectation`, every unit test still passes except the one
// that names it, the screen shows FEWER warnings, and it looks like an improvement. A person
// looking at the coverage strip is the only thing that catches that, which is what this scenario
// buys.
//
// ---------------------------------------------------------------------------------------------
// EVERY DATE IS COMPUTED FROM THE SEED TIME
// ---------------------------------------------------------------------------------------------
// Whether a game is before or after the closing instant is the whole point, so fixed dates would
// drift and then stop meaning anything.

const DAY_MS = 86_400_000;

function daysFromNow(days: number, hour: number, minute = 0): string {
  const instant = new Date(Date.now() + days * DAY_MS);
  instant.setHours(hour, minute, 0, 0);
  return instant.toISOString();
}

export async function seed(): Promise<void> {
  // Both venues are the ward's own, so every seeded game classifies `home` and CARRIES A COVERAGE
  // EXPECTATION. An `away` or `tbd` game carries none by design, which would make the Concert
  // Choir's silence prove nothing at all (youth-c).
  await ensureTestWard({
    name: "Harness Test Ward",
    crossOrgVisibility: false,
    homeVenues: ["Lincoln High School", "Ward cultural hall"],
  });

  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Marcus",
    lastName: "Reyes",
  });

  // THE ACCOUNT THE WALK SIGNS IN AS. They hold `youth_activities.manage`, so the roster panel's
  // controls are present and the empty choir can actually be fixed from the screen — which is half
  // of what "loud" has to mean: a warning nobody can act on is just noise.
  const youngWomenPresident = await createTestUser({
    handle: "yw-president",
    role: "org_president",
    org: "youngWomen",
    firstName: "Renata",
    lastName: "Alvarez",
  });

  const nash = await createHousehold({ familyName: "Nash", address: "77 Bridger Street" });
  const brooks = await createHousehold({ familyName: "Brooks", address: "2201 Canyon Road" });

  const sofia = await createMember({
    firstName: "Sofia",
    lastName: "Nash",
    householdId: nash,
    category: "youth",
    gender: "female",
  });

  // ON NO TEAM AT ALL. She is who the walk ADDS to the Concert Choir, which is the check that the
  // empty state is fixable in one action and that the fix reaches /youth immediately.
  const clara = await createMember({
    firstName: "Clara",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "female",
  });

  await addMemberToOrganization({ memberId: sofia, org: "youngWomen" });
  await addMemberToOrganization({ memberId: clara, org: "youngWomen" });

  // ---------------------------------------------------------------------------
  // THE CONCERT CHOIR — IMPORTED, AND NOBODY ON IT
  // ---------------------------------------------------------------------------
  // No roster rows at all. This is a legitimate, normal state (createActivityProfileSchema allows
  // an empty `memberIds` on purpose), and it must be LOUD rather than quiet.
  const choir = await createYouthActivityProfile({
    activityName: "Concert choir",
    activityType: "performance",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "January to May",
    org: "youngWomen",
    enteredBy: youngWomenPresident.id,
  });

  // A CALENDAR, so the games read as IMPORTED — the whole point is that somebody has just done the
  // first half of "import once, then assign" and has not yet done the second.
  const choirCalendar = await createActivityCalendar({
    profileId: choir,
    sourceType: "ics_upload",
    lastSyncedAt: daysFromNow(-1, 9),
  });

  // FOUR UPCOMING, and two of them INSIDE the seven-day notice window so they read `uncovered`
  // rather than the quieter `unassigned`. Without one inside the window the "loud" check would
  // rest on the weakest state the badge has.
  const choirGames = [2, 5, 12, 20];

  for (const [index, day] of choirGames.entries()) {
    await createActivityEvent({
      profileId: choir,
      calendarId: choirCalendar,
      title: `Choir concert ${index + 1}`,
      eventDate: daysFromNow(day, 19, 0),
      eventType: "home",
      location: "Lincoln High School",
      sourceUid: `wlt-seed-choir-${index + 1}@harness`,
    });
  }

  // ---------------------------------------------------------------------------
  // CROSS COUNTRY — ONE YOUTH, SEASON CLOSED, TWO GAMES AFTER THE CLOSING INSTANT
  // ---------------------------------------------------------------------------
  // The closing instant sits BETWEEN the second and third meets, so the same team carries both
  // answers and the contrast is on one card rather than across two wards.
  const CLOSED_AT = daysFromNow(-5, 12);

  const crossCountry = await createYouthActivityProfile({
    activityName: "Cross country",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "September to November",
    org: "youngWomen",
    enteredBy: youngWomenPresident.id,
    closedAt: CLOSED_AT,
  });

  await createActivityRoster({ profileId: crossCountry, memberId: sofia });

  // TWO BEFORE THE CLOSE — ordinary coverage, and both in the past so they read `not_expected`
  // from the clock alone. They are here so the closed season is not empty: a team with no events
  // at all would prove nothing about which of its events go quiet.
  for (const [index, day] of [-20, -12].entries()) {
    await createActivityEvent({
      profileId: crossCountry,
      title: `Cross country meet ${index + 1}`,
      eventDate: daysFromNow(day, 16, 0),
      eventType: "home",
      location: "Ward cultural hall",
    });
  }

  // TWO AFTER THE CLOSE, AND BOTH UPCOMING. THIS IS THE LEAK. Before youth-j these raised
  // "Nobody going" on a season somebody had deliberately ended, for ever, and no screen offered a
  // way to stop it short of deleting the games.
  for (const [index, day] of [4, 11].entries()) {
    await createActivityEvent({
      profileId: crossCountry,
      title: `Cross country meet ${index + 3}`,
      eventDate: daysFromNow(day, 16, 0),
      eventType: "home",
      location: "Ward cultural hall",
    });
  }

  console.log(
    "  ward, 2 users, 2 households, 2 youth, 2 teams (1 with an EMPTY roster, " +
      "1 closed), 1 calendar, 8 events, 1 roster row",
  );
}
