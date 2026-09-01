import {
  addMemberToOrganization,
  createActivityAttendee,
  createActivityCalendar,
  createActivityEvent,
  createActivityParticipation,
  createActivityRoster,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// ONE SCHEDULE, FOUR PLAYERS — the whole youth-j model in one seed.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS NEEDS A SEED AT ALL
// ---------------------------------------------------------------------------------------------
// Every fact this scenario proves is a FRACTION OVER A SEASON, and none of them can be judged from
// a screenshot of a fresh ward. Four young people have to open at four DIFFERENT, non-trivial
// percentages, computed from ONE set of thirteen event rows, before anybody touches anything —
// and two of the four have to have windows that are already partly closed.
//
// Building that by hand is an afternoon of clicking: thirteen games, six sign-ups, four roster
// rows with dates, one recorded absence. Worse, several of the states are unreachable through the
// UI in a sensible order — you cannot record that Maya left in February without first playing out
// a season she was on.
//
// ---------------------------------------------------------------------------------------------
// THE ONE THING TO LOOK AT: **THIRTEEN** CARDS, NOT FIFTY-TWO
// ---------------------------------------------------------------------------------------------
// Before youth-j, four players on a thirteen-game season meant FOUR PROFILES, FOUR IMPORTS OF THE
// SAME FILE and 52 event rows for 13 real games. This seed writes ONE profile, ONE calendar and
// THIRTEEN events, and /youth/profiles must show thirteen cards with past events shown. That
// number is the headline check and it is the one a screenshot answers instantly.
//
// NOT ON /youth/calendar, which is UPCOMING-ONLY by design and shows the four still to come —
// the first walk's checklist asked for thirteen there and could not get them.
//
// ---------------------------------------------------------------------------------------------
// THE FOUR WINDOWS, AND WHY EACH ONE IS THERE
// ---------------------------------------------------------------------------------------------
//   ETHAN  — no dates. The control case: he is measured on the whole schedule.
//   JOSH   — no dates. A SECOND control, and he is the one the walk MOVES: marking him absent for
//            an upcoming game must move his pill and NOBODY ELSE'S. One control youth would not
//            prove that, because a lone unchanged number could be unchanged by accident.
//   MAYA   — `ended_on` mid-season. Her denominator stops there, and THE GAME ON HER LEAVING DATE
//            IS COUNTED — the inclusive boundary, which is the case a `slice(0, 10)` comparison
//            gets wrong (tests/lib/youthRoster.test.ts asserts it; this proves it on a screen).
//   TYLER  — `started_on` mid-season. The mirror. His denominator excludes everything before, and
//            the game ON his joining date IS counted.
//
// ---------------------------------------------------------------------------------------------
// THE SCHEDULE IS SHAPED SO THE FOUR PERCENTAGES DIFFER AND NONE IS 0 OR 100
// ---------------------------------------------------------------------------------------------
// A percentage of 0 or 100 is indistinguishable from a bug that zeroed or filled a denominator, and
// four identical percentages would not show that the windows are being applied at all. The
// attendee spread below is chosen so all four differ — that is the check, and it is why the
// sign-ups are not simply "one per game".
//
// ---------------------------------------------------------------------------------------------
// EVERY DATE IS COMPUTED FROM THE SEED TIME
// ---------------------------------------------------------------------------------------------
// The percentages are functions of the clock, so fixed dates would drift and then stop meaning
// anything — the rule scenarios 060 and 061 state and this one inherits.
//
// THE ROSTER DATES ARE `date` COLUMNS, so they are derived as DAYS in the ward's zone rather than
// as instants. `daysFromNow()` builds the games; `dayFromNow()` builds the boundaries, and the two
// are deliberately different functions because they are different kinds of value.

const DAY_MS = 86_400_000;

// An offset-bearing instant, always. `activity_events.event_date` is a timestamptz and the app's
// own validator refuses a floating time — a seed writing one would put the harness and the app on
// different clocks (lib/validation/youth.ts).
function daysFromNow(days: number, hour: number, minute = 0): string {
  const instant = new Date(Date.now() + days * DAY_MS);
  instant.setHours(hour, minute, 0, 0);
  return instant.toISOString();
}

// A DAY, not an instant — `activity_roster.started_on` and `ended_on` are `date` columns, and
// "she left on the 15th" is a day a person named. Built from the LOCAL calendar day so it lines up
// with the games above, which are also built from local hours.
function dayFromNow(days: number): string {
  const instant = new Date(Date.now() + days * DAY_MS);
  const year = instant.getFullYear();
  const month = String(instant.getMonth() + 1).padStart(2, "0");
  const day = String(instant.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function seed(): Promise<void> {
  // `home_venues` holds Lincoln High School so every seeded game classifies `home` and therefore
  // CARRIES A COVERAGE EXPECTATION. An `away` or `tbd` game counts towards nothing, which would
  // silently empty the percentages this whole scenario is about (youth-c, youth-f).
  await ensureTestWard({
    name: "Harness Test Ward",
    crossOrgVisibility: false,
    homeVenues: ["Lincoln High School"],
  });

  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Marcus",
    lastName: "Reyes",
  });

  // THE ACCOUNT THE WALK SIGNS IN AS. `youth_activities.manage` is the whole gate on the roster
  // and participation controls — ward-wide on both tables (migration 062f).
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

  // THE ACCOUNT THAT PROVES THE GATE IS A GATE. `org_secretary` holds `youth_activities.view` and
  // `.log` and NOT `.manage` (lib/auth/permissions.ts), so the roster controls and the "Somebody
  // wasn't there?" link must be ABSENT for them — not present and failing, which is the
  // youth-a-D1 shape.
  //
  // Added 2026-08-31 after the first walk: the checklist asked for this sign-in and no such
  // account existed, so the only check on the read-but-not-write half could not be walked at all.
  await createTestUser({
    handle: "ym-secretary",
    role: "org_secretary",
    org: "youngMen",
    firstName: "Dale",
    lastName: "Whitmore",
  });

  const brooks = await createHousehold({ familyName: "Brooks", address: "2201 Canyon Road" });
  const kim = await createHousehold({ familyName: "Kim", address: "418 Meadowlark Lane" });
  const alvarez = await createHousehold({ familyName: "Alvarez", address: "915 Aspen Court" });
  const nash = await createHousehold({ familyName: "Nash", address: "77 Bridger Street" });

  const ethan = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "male",
  });

  const josh = await createMember({
    firstName: "Josh",
    lastName: "Kim",
    householdId: kim,
    category: "youth",
    gender: "male",
  });

  const maya = await createMember({
    firstName: "Maya",
    lastName: "Alvarez",
    householdId: alvarez,
    category: "youth",
    gender: "female",
  });

  const tyler = await createMember({
    firstName: "Tyler",
    lastName: "Nash",
    householdId: nash,
    category: "youth",
    gender: "male",
  });

  for (const memberId of [ethan, josh, tyler]) {
    await addMemberToOrganization({ memberId, org: "youngMen" });
  }
  await addMemberToOrganization({ memberId: maya, org: "youngWomen" });

  // ---------------------------------------------------------------------------
  // ONE TEAM. NO `memberId` — a profile names no young person any more.
  // ---------------------------------------------------------------------------
  // Owned by the Young Men, which is what makes the signed-in president able to edit and close it.
  // The ROSTER is ward-wide on all four verbs regardless (migration 062f), which is a separate
  // thing the walk can check by signing in as the Young Women president.
  const basketball = await createYouthActivityProfile({
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  // ONE CALENDAR, so every event reads as IMPORTED — "From a schedule feed" on each card. That
  // marker is the visible half of "import once": one file, one activity, four young people.
  const calendar = await createActivityCalendar({
    profileId: basketball,
    sourceType: "ics_upload",
    lastSyncedAt: daysFromNow(-40, 9),
  });

  // ---------------------------------------------------------------------------
  // THE ROSTER — FOUR PLAYERS, FOUR WINDOWS
  // ---------------------------------------------------------------------------
  // Maya's leaving day and Tyler's joining day are both DELIBERATELY A GAME DAY. The inclusive
  // boundary is the thing to prove on a screen: the game ON the leaving day counts, and the game
  // ON the joining day counts.
  const MAYA_LEFT_ON = dayFromNow(-24);
  const TYLER_JOINED_ON = dayFromNow(-24);

  await createActivityRoster({ profileId: basketball, memberId: ethan });
  await createActivityRoster({ profileId: basketball, memberId: josh });
  await createActivityRoster({
    profileId: basketball,
    memberId: maya,
    endedOn: MAYA_LEFT_ON,
  });
  await createActivityRoster({
    profileId: basketball,
    memberId: tyler,
    startedOn: TYLER_JOINED_ON,
  });

  // ---------------------------------------------------------------------------
  // THIRTEEN GAMES, ONE SCHEDULE
  // ---------------------------------------------------------------------------
  // 9 past, 4 upcoming. 10 home, 3 away. One cancelled. `sourceUid` is set on every one so a
  // re-import of the same file would MATCH rather than duplicate — which is what makes the
  // "thirteen cards, not fifty-two" check about the model rather than about this seed.
  const games: { id: string; day: number; type: "home" | "away"; cancelled?: boolean }[] = [
    { id: "g01", day: -38, type: "home" },
    { id: "g02", day: -34, type: "away" },
    { id: "g03", day: -31, type: "home" },
    { id: "g04", day: -28, type: "home" },
    // THE BOUNDARY GAME. Maya's last day and Tyler's first day, both. It must count for BOTH of
    // them, which is the one check that catches a UTC comparison.
    { id: "g05", day: -24, type: "home" },
    { id: "g06", day: -20, type: "home" },
    // ---------------------------------------------------------------------------
    // THE GAME THAT SEPARATES MAYA FROM TYLER. Added 2026-08-31 after the first walk.
    // ---------------------------------------------------------------------------
    // Without it they BOTH read 75% — 3/4 each, by different routes — and the checklist line
    // "the four percentages differ from one another" failed against correct arithmetic. The
    // seed's original spread reasoned about the HISTORY half only ("three supported", "two
    // supported") and did not account for the next-event half of the metric, which Maya has none
    // of because her window has closed. Two different fractions reduced to one percentage.
    //
    // It is HOME, PAST, and has NO ATTENDEE, which is the only shape that separates them without
    // pushing anybody to 0% or 100% — the same line forbids those, and a confirmed attendee here
    // would put Maya or Tyler on 100%. It falls inside Tyler's window and after Maya's, so it
    // lengthens his denominator alone: Ethan 71%, Josh 63%, Maya 75%, Tyler 60%.
    { id: "g06b", day: -17, type: "home" },
    { id: "g07", day: -14, type: "away" },
    { id: "g08", day: -7, type: "home" },
    { id: "g09", day: 3, type: "home" },
    { id: "g10", day: 9, type: "home", cancelled: true },
    { id: "g11", day: 16, type: "away" },
    { id: "g12", day: 23, type: "home" },
  ];

  const eventIds: Record<string, string> = {};

  for (const game of games) {
    eventIds[game.id] = await createActivityEvent({
      profileId: basketball,
      calendarId: calendar,
      title: `Basketball ${game.id.toUpperCase()}`,
      eventDate: daysFromNow(game.day, 19, 30),
      eventType: game.type,
      location: game.type === "home" ? "Lincoln High School" : "Roosevelt High School",
      status: game.cancelled ? "cancelled" : "upcoming",
      sourceUid: `wlt-seed-${game.id}@harness`,
    });
  }

  // ---------------------------------------------------------------------------
  // WHO WENT — SPREAD SO THE FOUR PERCENTAGES DIFFER
  // ---------------------------------------------------------------------------
  // `confirmedAttendance: true` is what makes a past home game count as SUPPORTED. A signed-up
  // leader who never answered does NOT count, so the flag is explicit on each.
  //
  // The past HOME games are g01, g03, g04, g05, g06, g06b and g08 — SEVEN of them.
  //
  // THE PILL IS NOT THE HISTORY HALF ALONE, and reading this list as though it were is what made
  // the first walk's percentages tie. `activitySupport()` adds the NEXT expected event to both
  // sides of the fraction — supported +1 if somebody is signed up for it, counted +1 either way —
  // so a youth whose window has closed has NO next event and a shorter fraction than the counts
  // below suggest. The four resolve to:
  //
  //   Ethan — 6 counted (g08 is excluded: he is marked not taking part), 4 supported,
  //           + next g09 planned  →  5/7  →  71%
  //   Josh  — 7 counted, 4 supported, + next g09 planned  →  5/8  →  63%
  //           (until the walk marks him absent for g09, which moves him to 4/8 → 50%)
  //   Maya  — only g01…g05 are in her window: 4 home games, 3 supported, and NO next event
  //           because she left  →  3/4  →  75%
  //   Tyler — only g05 onward: 4 home games (g05, g06, g06b, g08), 2 supported,
  //           + next g09 planned  →  3/5  →  60%
  //
  // All four differ and none is 0% or 100%, which is the check. Change any attendee below and
  // recompute all four before believing the result.
  const supported = ["g01", "g03", "g05", "g06"];

  for (const gameId of supported) {
    await createActivityAttendee({
      eventId: eventIds[gameId],
      userId: youngMenPresident.id,
      confirmedAttendance: true,
    });
  }

  // Down for it and never answered — NOT counted as supported, which is the third state
  // `confirmed_attendance` carries and the reason the flag above is written out.
  await createActivityAttendee({
    eventId: eventIds.g04,
    userId: youngWomenPresident.id,
  });

  // Somebody is down for the NEXT home game (g09), so the plan half of the metric is non-trivial
  // before the walk touches anything — that is what makes Josh's pill MOVE when he is marked
  // absent for it rather than staying where it was for an unrelated reason.
  await createActivityAttendee({
    eventId: eventIds.g09,
    userId: youngMenPresident.id,
  });

  // ---------------------------------------------------------------------------
  // ONE RECORDED ABSENCE, ALREADY IN PLACE
  // ---------------------------------------------------------------------------
  // Ethan missed g08 — a PAST HOME game that was otherwise in his denominator. It must be excluded
  // from HIS number and from NOBODY ELSE'S, which is the fact migration 062d exists for and the
  // one a column on `activity_events` could never express.
  //
  // Seeded rather than clicked so the walk opens on a card where it has ALREADY happened, and can
  // compare it against Josh, whose denominator still contains g08.
  await createActivityParticipation({
    eventId: eventIds.g08,
    memberId: ethan,
    takingPart: false,
    recordedBy: youngMenPresident.id,
  });

  console.log(
    "  ward, 4 users, 4 households, 4 youth, 1 team, 1 calendar, 13 events, " +
      "4 roster rows (2 with windows), 6 attendees, 1 recorded absence",
  );
}
