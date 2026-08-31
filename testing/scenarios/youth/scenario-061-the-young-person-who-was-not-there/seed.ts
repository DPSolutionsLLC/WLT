import {
  addMemberToOrganization,
  createActivityAttendee,
  createActivityEvent,
  createActivityLog,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// THE YOUNG PERSON WHO WAS NOT THERE — recording an absence, and watching a number move.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS NEEDS A SEED AT ALL
// ---------------------------------------------------------------------------------------------
// The thing to prove is that A NUMBER MOVES IN THE RIGHT DIRECTION FOR THE RIGHT REASON, and a
// support percentage cannot be judged from a screenshot — it is a fraction over a season. So the
// card has to open at a REAL, NON-TRIVIAL percentage before anything is marked, which means six
// games already played with two of them confirmed. Building that by hand is an afternoon of
// clicking and wrong the moment the clock moves.
//
// It also needs an upcoming game AND A SECOND ONE BEHIND IT, because half the feature is that the
// horizon moves: the metric counts every past home game plus THE NEXT ONE, so marking the next one
// must make the plan half point at the game after it (youth-f's horizon, untouched here).
//
// ---------------------------------------------------------------------------------------------
// THE THREE EXCLUSIONS THAT ALREADY EXIST ARE SEEDED TOO, AND THAT IS THE POINT
// ---------------------------------------------------------------------------------------------
// Migration 061 is a FOURTH LINE in carriesCoverageExpectation(), joining `away`, `cancelled` and
// `tbd` — all four saying one sentence: this game could not have been a chance to support them. So
// Ethan's season carries one past `away` game and one `cancelled` game, and NOAH'S WHOLE PROFILE is
// nothing but excluded events. Noah's pill reads an EM DASH before anybody touches anything, which
// gives the walk a REFERENCE for what the new exclusion must produce rather than a description of
// one. If marking every one of Ethan's home games leaves a `0%` where Noah has a dash, the two
// exclusions disagree and the number is reporting neglect that did not happen (visits-f, youth-f).
//
// ---------------------------------------------------------------------------------------------
// TWO FOLLOW-UPS, AND WHOSE THEY ARE IS LOAD-BEARING
// ---------------------------------------------------------------------------------------------
// followUpState()'s `hasLog` is about THE READER'S OWN log — somebody else's answers nothing about
// what this reader owes. So proving "the record survives the mark" needs a follow-up the SIGNED-IN
// LEADER wrote: theirs stays reading `logged` after the game is marked, which is the branch order
// (`hasLog` first, then the absence) doing its job.
//
// The second is the BISHOP'S, on a different game. It proves the same guarantee from the outside —
// a note somebody else wrote stays readable on /youth/feed after the game leaves the prompt. It is
// the bishop's rather than the Young Women president's DELIBERATELY: migration 057c's INSERT admits
// the bishopric or the EVENT's organization, so a Young Women president could not have written on a
// Young Men profile's game through the app, and a seed writing one would describe a state the app
// cannot produce.
//
// ---------------------------------------------------------------------------------------------
// A WARD-WIDE EVENT, SO THE REFUSAL IS REACHABLE FROM THE UI
// ---------------------------------------------------------------------------------------------
// `profile_id` null means the event belongs to no young person, so "are they taking part?" has no
// referent. Migration 061's CHECK makes such a row a database error and the route refuses it with a
// sentence first; the control must be ABSENT on that card. Without a ward-wide event in the seed
// there is nothing to point the walk at.
//
// ---------------------------------------------------------------------------------------------
// EVERY DATE IS COMPUTED FROM THE SEED TIME
// ---------------------------------------------------------------------------------------------
// The percentage is a function of the clock, so a fixed date would make it drift and then stop
// meaning anything — the rule scenario 060's seed states and this one inherits.

const DAY_MS = 86_400_000;

// An offset-bearing instant, always. `activity_events.event_date` is a timestamptz and the app's
// own validator refuses a floating time — a seed writing one would put the harness and the app on
// different clocks (lib/validation/youth.ts).
function daysFromNow(days: number, hour: number, minute = 0): string {
  const instant = new Date(Date.now() + days * DAY_MS);
  instant.setHours(hour, minute, 0, 0);
  return instant.toISOString();
}

export async function seed(): Promise<void> {
  // `home_venues` holds Lincoln High School so every seeded game classifies `home` and therefore
  // CARRIES A COVERAGE EXPECTATION. An `away` or `tbd` game counts towards nothing, which would
  // silently empty the support percentage this whole scenario is about (youth-c, youth-f).
  await ensureTestWard({
    name: "Harness Test Ward",
    crossOrgVisibility: false,
    homeVenues: ["Lincoln High School"],
  });

  // A ward created outside supabase/seed/ward.sql has no notification_settings rows, so
  // emitNotification() would warn and send nothing if the tester writes a follow-up.
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Marcus",
    lastName: "Reyes",
  });

  // THE ACCOUNT THE WALK SIGNS IN AS. They hold `youth_activities.manage`, which is the whole gate
  // on this control — ward-wide, exactly as `Cancel` is (migration 061).
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

  // NO ORGANIZATION AT ALL — the widest role in the app, and the one that enters the ward-wide
  // event below. There is nobody to record as taking part on it, so the control must be absent.
  const wardCouncil = await createTestUser({
    handle: "ward-council",
    role: "ward_council_member",
    firstName: "Priya",
    lastName: "Nathan",
  });

  const brooks = await createHousehold({ familyName: "Brooks", address: "2201 Canyon Road" });
  const kim = await createHousehold({ familyName: "Kim", address: "418 Meadowlark Lane" });
  const diaz = await createHousehold({ familyName: "Diaz", address: "915 Aspen Court" });

  const ethan = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: brooks,
    category: "youth",
    gender: "male",
  });

  const noah = await createMember({
    firstName: "Noah",
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
    lastName: "Diaz",
    householdId: diaz,
    category: "youth",
    gender: "female",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });
  await addMemberToOrganization({ memberId: noah, org: "youngMen" });
  await addMemberToOrganization({ memberId: josh, org: "youngMen" });
  await addMemberToOrganization({ memberId: maya, org: "youngWomen" });

  // ---------------------------------------------------------------------------------------------
  // FIVE PROFILES
  // ---------------------------------------------------------------------------------------------
  // EXPLICIT IDS where two profiles could share a name, because createYouthActivityProfile derives
  // its default id from the ACTIVITY NAME alone and two rows sharing one would collide.

  // THE SUBJECT. Six past home games with two confirmed, one past `away`, one `cancelled`, and TWO
  // upcoming home games — so the card opens at 2 of 7 (29%) and both halves of the metric are
  // visible before anything is marked.
  const ethanBasketball = await createYouthActivityProfile({
    id: testUuid("profile:ethan:varsity-basketball"),
    memberId: ethan,
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  // ALREADY CLOSED, so the ITER-028 interaction is ON SCREEN rather than described. Its frozen
  // number is recomputed against `closedAt`, and carriesCoverageExpectation() now excludes absences
  // from that pass too — nothing on this card may move while the walk marks Ethan's basketball
  // games, and the history page must go on reading exactly what it read at the start.
  const ethanCrossCountry = await createYouthActivityProfile({
    id: testUuid("profile:ethan:cross-country"),
    memberId: ethan,
    activityName: "Cross country",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "August to October",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
    closedAt: new Date(Date.now() - 20 * DAY_MS).toISOString(),
  });

  // A SECOND RUNNING SEASON ON A DIFFERENT YOUNG PERSON. Its number must NOT move while Ethan's is
  // being marked — if it does, the exclusion is reading the wrong set of events.
  const joshTrack = await createYouthActivityProfile({
    memberId: josh,
    activityName: "Track and field",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "March to May",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  // NOTHING BUT ALREADY-EXCLUDED EVENTS — two `away` games and one `cancelled` home game. Noah's
  // pill reads an EM DASH from the first paint, which is the REFERENCE the walk compares the new
  // exclusion against: a fully-marked Ethan must render the same way, never `0%`.
  const noahBasketball = await createYouthActivityProfile({
    id: testUuid("profile:noah:junior-basketball"),
    memberId: noah,
    activityName: "Junior basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  // ANOTHER ORGANIZATION'S ACTIVITY. The gate on this control is the PERMISSION ALONE and it is
  // ward-wide, so the Yes/No buttons MUST appear here too — hiding a control the API would allow is
  // the mirror of youth-a-D1, and this card is what makes that assertion reachable.
  const mayaChoir = await createYouthActivityProfile({
    memberId: maya,
    activityName: "Concert choir",
    activityType: "performance",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "September to December",
    org: "youngWomen",
    enteredBy: youngWomenPresident.id,
  });

  // ---------------------------------------------------------------------------------------------
  // ETHAN'S RUNNING BASKETBALL SEASON — 6 PLAYED, 2 ATTENDED, 2 STILL TO COME
  // ---------------------------------------------------------------------------------------------
  // 2 of 7 with the next game counted and nobody down for it, which reads 29% on the card. Marking
  // three of the past games leaves 2 of 4 — 50% — a change nobody can miss.
  const pastGames: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    pastGames.push(
      await createActivityEvent({
        title: `Basketball game ${index + 1}`,
        eventDate: daysFromNow(-60 + index * 7, 19),
        eventType: "home",
        location: "Lincoln High School",
        profileId: ethanBasketball,
      }),
    );
  }

  // THE TWO SOMEBODY WENT TO, CONFIRMED. `confirmedAttendance: true` is what the history half
  // counts — being DOWN for a game is a plan, not an attendance (youth-f).
  await createActivityAttendee({
    eventId: pastGames[1],
    userId: youngMenPresident.id,
    confirmedAttendance: true,
  });

  await createActivityAttendee({
    eventId: pastGames[4],
    userId: bishop.id,
    confirmedAttendance: true,
  });

  // THE READER'S OWN FOLLOW-UP, and it is theirs on purpose. `hasLog` is about the READER's log, so
  // this is the only shape in which "the record survives the mark" is visible on the card: after
  // game 2 is marked, its badge must still read `logged` rather than dropping to nothing.
  await createActivityLog({
    eventId: pastGames[1],
    loggedBy: youngMenPresident.id,
    sharedNotes: "Good game. He played the whole second half and his parents were both there.",
  });

  // SOMEBODY ELSE'S FOLLOW-UP, on a different game. The bishopric may write on any event (057c), so
  // this is a state the app can produce — and it proves the same guarantee from the outside: the
  // note stays readable on /youth/feed after the game leaves the prompt.
  await createActivityLog({
    eventId: pastGames[4],
    loggedBy: bishop.id,
    sharedNotes: "Quiet afterwards. Worth somebody sitting with him before the next one.",
  });

  // AN UNANSWERED SIGN-UP ON A PAST GAME, which is what puts a row in "Waiting on your follow-up"
  // before the walk begins. Marking that game must take the row OUT and drop the heading's count
  // with it — the panel filters on `state === "awaiting"` and needs no logic change for that.
  await createActivityAttendee({
    eventId: pastGames[2],
    userId: youngMenPresident.id,
  });

  // ONE PAST `away` GAME AND ONE `cancelled` HOME GAME — already excluded, so the walk can check
  // the new exclusion reads the same as the two that exist beside it on the same card.
  await createActivityEvent({
    title: "Basketball at Roosevelt",
    eventDate: daysFromNow(-18, 19),
    eventType: "away",
    location: "Roosevelt High School",
    profileId: ethanBasketball,
  });

  await createActivityEvent({
    title: "Basketball game 7 (called off)",
    eventDate: daysFromNow(-11, 19),
    eventType: "home",
    location: "Lincoln High School",
    status: "cancelled",
    profileId: ethanBasketball,
  });

  // THE NEXT GAME, WITH NOBODY DOWN FOR IT. The plan half reads "nobody is down for the next one",
  // and marking it must move the horizon to the game behind it rather than to nothing.
  await createActivityEvent({
    title: "Basketball game 8",
    eventDate: daysFromNow(4, 19),
    eventType: "home",
    location: "Lincoln High School",
    profileId: ethanBasketball,
  });

  // THE GAME BEHIND IT — where the horizon has to move to. Without this row, marking the next game
  // would give `nextEvent: null` and the check could not tell "moved" from "ran out".
  await createActivityEvent({
    title: "Basketball game 9",
    eventDate: daysFromNow(11, 19),
    eventType: "home",
    location: "Lincoln High School",
    profileId: ethanBasketball,
  });

  // ---------------------------------------------------------------------------------------------
  // ETHAN'S CLOSED CROSS-COUNTRY SEASON — 4 MEETS, 2 ATTENDED, ALL BEFORE `closedAt`
  // ---------------------------------------------------------------------------------------------
  // 50% frozen against the closing instant, and NOTHING the walk does to basketball may move it.
  const meets: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    meets.push(
      await createActivityEvent({
        title: `Cross country meet ${index + 1}`,
        eventDate: daysFromNow(-80 + index * 9, 16),
        eventType: "home",
        location: "Lincoln High School",
        profileId: ethanCrossCountry,
      }),
    );
  }

  await createActivityAttendee({
    eventId: meets[0],
    userId: youngMenPresident.id,
    confirmedAttendance: true,
  });

  await createActivityAttendee({
    eventId: meets[2],
    userId: youngMenPresident.id,
    confirmedAttendance: true,
  });

  // ---------------------------------------------------------------------------------------------
  // JOSH'S RUNNING TRACK SEASON — the number that must not move
  // ---------------------------------------------------------------------------------------------
  // 1 of 3 — one played and attended, one played and not, one coming up with nobody down: 33%.
  const trackAttended = await createActivityEvent({
    title: "Track meet against Roosevelt",
    eventDate: daysFromNow(-14, 16),
    eventType: "home",
    location: "Lincoln High School",
    profileId: joshTrack,
  });

  await createActivityAttendee({
    eventId: trackAttended,
    userId: youngMenPresident.id,
    confirmedAttendance: true,
  });

  await createActivityEvent({
    title: "Track meet against Jefferson",
    eventDate: daysFromNow(-7, 16),
    eventType: "home",
    location: "Lincoln High School",
    profileId: joshTrack,
  });

  await createActivityEvent({
    title: "Track meet against Madison",
    eventDate: daysFromNow(6, 16),
    eventType: "home",
    location: "Lincoln High School",
    profileId: joshTrack,
  });

  // ---------------------------------------------------------------------------------------------
  // NOAH'S PROFILE — NOTHING BUT ALREADY-EXCLUDED EVENTS
  // ---------------------------------------------------------------------------------------------
  // Two away games and one cancelled home game, so his pill reads an EM DASH from the first paint.
  // This is the reference a fully-marked Ethan has to match.
  await createActivityEvent({
    title: "Junior basketball at Jefferson",
    eventDate: daysFromNow(-21, 17),
    eventType: "away",
    location: "Jefferson Middle School",
    profileId: noahBasketball,
  });

  await createActivityEvent({
    title: "Junior basketball at Madison",
    eventDate: daysFromNow(-9, 17),
    eventType: "away",
    location: "Madison Middle School",
    profileId: noahBasketball,
  });

  await createActivityEvent({
    title: "Junior basketball home game (called off)",
    eventDate: daysFromNow(-4, 17),
    eventType: "home",
    location: "Lincoln High School",
    status: "cancelled",
    profileId: noahBasketball,
  });

  // ---------------------------------------------------------------------------------------------
  // MAYA'S CHOIR — another organization's activity, where the control must still render
  // ---------------------------------------------------------------------------------------------
  const concert = await createActivityEvent({
    title: "Winter concert",
    eventDate: daysFromNow(-6, 19),
    eventType: "home",
    location: "Lincoln High School",
    profileId: mayaChoir,
  });

  await createActivityAttendee({
    eventId: concert,
    userId: youngWomenPresident.id,
    confirmedAttendance: true,
  });

  await createActivityEvent({
    title: "Spring concert",
    eventDate: daysFromNow(9, 19),
    eventType: "home",
    location: "Lincoln High School",
    profileId: mayaChoir,
  });

  // ---------------------------------------------------------------------------------------------
  // THE WARD-WIDE EVENT — `profile_id` NULL, so there is nobody to record as taking part
  // ---------------------------------------------------------------------------------------------
  // Migration 061's CHECK makes a non-null `youth_attended` on this row a database error, and the
  // route refuses it with a sentence before it gets there. The control must be ABSENT on this card,
  // and a direct PATCH must answer 400.
  await createActivityEvent({
    title: "Ward youth service evening",
    eventDate: daysFromNow(13, 18),
    eventType: "home",
    location: "Lincoln High School",
  });

  void wardCouncil;

  console.log(
    "  ward (cross-org OFF, home venue Lincoln High School), 4 users, 3 households, 4 youth, " +
      "5 activities (1 already closed, 1 another organization's, 1 with nothing but excluded " +
      "events), 23 events (1 ward-wide, 3 away, 2 cancelled), 7 attendee rows, 2 follow-ups",
  );
}
