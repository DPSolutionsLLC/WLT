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

// THE SEASON IS OVER — closing one out, and a Remove that cannot destroy an account.
//
// ---------------------------------------------------------------------------------------------
// WHAT THIS SEED HAS TO MAKE POSSIBLE
// ---------------------------------------------------------------------------------------------
// Two states, and neither can be reached by clicking.
//
// ITER-028 needs A SEASON WORTH CLOSING: twelve games already played, with a real support
// percentage attached, so a tester can watch that percentage LEAVE `/youth` and reappear on the
// history page. Playing out twelve games through the UI is an afternoon's work and wrong the
// moment the clock moves.
//
// ITER-031 needs A FOLLOW-UP THE DELETER CANNOT SEE. That is the whole point of the refusal: the
// server must refuse a delete over a pastoral note the person pressing Remove is not entitled to
// read. Building it by hand would mean signing in as a second leader, writing a note, signing back
// — and then the tester would KNOW it is there, which is exactly the knowledge the refusal has to
// work without.
//
// ---------------------------------------------------------------------------------------------
// THE ONE FIXTURE THAT LOOKS WRONG AND IS NOT: ETHAN'S BASKETBALL PROFILE
// ---------------------------------------------------------------------------------------------
// Its `org_id` is YOUNG WOMEN and its `entered_by` is the YOUNG MEN president. That is not a typo.
// It is the ONLY state in which the two policies diverge, and it is what makes the refusal
// necessary rather than decorative:
//
//   * migration 054d's DELETE admits `entered_by = auth.uid()`, so the Young Men president MAY
//     remove it;
//   * migration 057c's log SELECT admits `activity_event_is_in_caller_org(...)` — the EVENT's
//     organization, not the author's — and mentions `entered_by` nowhere, so the follow-up on it
//     is INVISIBLE to that same person.
//
// It is the shape a release and a recall leave behind: the profile keeps the organization it was
// created under and the leader's own organization moves. A route counting follow-ups through the
// caller's client would see zero here and destroy one.
//
// ---------------------------------------------------------------------------------------------
// EVERY DATE IS COMPUTED FROM THE SEED TIME
// ---------------------------------------------------------------------------------------------
// The support percentage is a function of the clock — every past home game plus the next one — so
// a fixed date would make the number drift and then stop meaning anything. A tester cannot place
// twelve games behind a moving `now` by hand without arithmetic they will get wrong, and getting
// it wrong produces a run that passes for the wrong reason.
//
// ---------------------------------------------------------------------------------------------
// THE READER IS THE YOUNG MEN PRESIDENT
// ---------------------------------------------------------------------------------------------
// They can manage all four of Ethan's and Josh's activities, so closing and removing are ordinary
// work — and they are the person the cross-organization refusal is aimed at. Maya's already-closed
// season is Young Women's, so it also proves the closed card renders for somebody whose seasons
// this reader cannot touch.

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
  // emitNotification() would warn and send nothing if the tester wanders into a follow-up.
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Marcus",
    lastName: "Reyes",
  });

  // THE ACCOUNT THE WALK SIGNS IN AS.
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

  // NO ORGANIZATION AT ALL — the role 08-youth-activities.md calls the widest in the app, and the
  // one 054d's explicit `org_id is null` branch exists for. They enter a ward-wide activity below
  // and must be able to close it.
  const wardCouncil = await createTestUser({
    handle: "ward-council",
    role: "ward_council_member",
    firstName: "Priya",
    lastName: "Nathan",
  });

  const brooks = await createHousehold({ familyName: "Brooks", address: "2201 Canyon Road" });
  const diaz = await createHousehold({ familyName: "Diaz", address: "915 Aspen Court" });
  const kim = await createHousehold({ familyName: "Kim", address: "418 Meadowlark Lane" });

  const ethan = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: brooks,
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

  const josh = await createMember({
    firstName: "Josh",
    lastName: "Kim",
    householdId: kim,
    category: "youth",
    gender: "male",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });
  await addMemberToOrganization({ memberId: maya, org: "youngWomen" });
  await addMemberToOrganization({ memberId: josh, org: "youngMen" });

  // ---------------------------------------------------------------------------------------------
  // FIVE PROFILES
  // ---------------------------------------------------------------------------------------------
  // EXPLICIT IDS on Ethan's two, because `createYouthActivityProfile` derives its default id from
  // the ACTIVITY NAME alone and two profiles sharing a name would collide on the primary key.

  // THE ONE TO CLOSE, and the one Remove must refuse. Twelve games played, one attended — a
  // percentage low enough to be obvious on the card, on a season that finished weeks ago.
  //
  // See the header: `org_id` is YOUNG WOMEN and `entered_by` is the YOUNG MEN president ON PURPOSE.
  // That is the only combination in which somebody may delete an activity whose follow-ups are
  // hidden from them, and it is what makes migration 060b's `security definer` counter load-bearing
  // rather than decorative.
  const ethanBasketball = await createYouthActivityProfile({
    id: testUuid("profile:ethan:varsity-basketball"),
    memberId: ethan,
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngWomen",
    enteredBy: youngMenPresident.id,
  });

  // STILL RUNNING, so Ethan's card keeps a pill after basketball is closed — the "one running, one
  // finished" case, where the history link must appear beside a live percentage rather than only
  // on a card with nothing left.
  const ethanTrack = await createYouthActivityProfile({
    id: testUuid("profile:ethan:track-and-field"),
    memberId: ethan,
    activityName: "Track and field",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "March to May",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  // ALREADY CLOSED — the fully-closed card, and the assertion ITER-028 exists for. Maya must STILL
  // APPEAR on /youth, with no pills, "Nothing running. 1 closed season." and a history link. If she
  // vanishes, the grouping has started filtering closed profiles and the whole item is undone.
  const mayaChoir = await createYouthActivityProfile({
    memberId: maya,
    activityName: "Concert choir",
    activityType: "performance",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "September to December",
    org: "youngWomen",
    enteredBy: youngWomenPresident.id,
    closedAt: new Date(Date.now() - 20 * DAY_MS).toISOString(),
  });

  // THE ONLY REMOVABLE ONE. No events at all, so `Remove` renders — and nothing else in this seed
  // should offer it.
  const joshDebate = await createYouthActivityProfile({
    memberId: josh,
    activityName: "Debate club",
    activityType: "academic",
    schoolOrg: "Lincoln High School",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  // WARD-WIDE (`org_id` null), entered by the ward council member. 054d's USING clause admits them
  // through `entered_by` and its WITH CHECK through the explicit null branch — the talks-d hole,
  // and the reason this row is here rather than a fourth ordinary profile.
  const joshService = await createYouthActivityProfile({
    memberId: josh,
    activityName: "Community service crew",
    activityType: "community",
    schoolOrg: "Lincoln High School",
    enteredBy: wardCouncil.id,
  });

  // ---------------------------------------------------------------------------------------------
  // ETHAN'S FINISHED BASKETBALL SEASON — 12 PLAYED, 1 ATTENDED
  // ---------------------------------------------------------------------------------------------
  // Weekly, from 96 days ago to 19 days ago, so the whole season is unambiguously PAST and nothing
  // is coming up. That makes the percentage on the card 1/12 — 8% — and, crucially, it does NOT
  // move while the tester works, because there is no next game to sign up for.
  const pastGames: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    pastGames.push(
      await createActivityEvent({
        title: `Basketball game ${index + 1}`,
        eventDate: daysFromNow(-96 + index * 7, 19),
        eventType: "home",
        location: "Lincoln High School",
        profileId: ethanBasketball,
      }),
    );
  }

  // THE ONE GAME SOMEBODY WENT TO, confirmed. `confirmedAttendance: true` is what the support
  // percentage counts — being DOWN for a game is a plan, not an attendance (youth-f).
  await createActivityAttendee({
    eventId: pastGames[3],
    userId: youngMenPresident.id,
    confirmedAttendance: true,
  });

  // THE FOLLOW-UP THAT BLOCKS THE DELETE, written by the YOUNG WOMEN president on the LAST game of
  // the season. The Young Men president may delete this activity and cannot read this note, which
  // is the entire reason the refusal is a `security definer` count rather than an ordinary query.
  await createActivityLog({
    eventId: pastGames[11],
    loggedBy: youngWomenPresident.id,
    sharedNotes:
      "He was quiet after the game and stayed behind to help pack up. Worth a word from somebody.",
  });

  // A SECOND ATTENDEE ROW WITH NO ANSWER — `confirmed_attendance` null, which means NOBODY HAS SAID
  // EITHER WAY. It must NOT count towards the percentage: three meanings live in that column and
  // only one of them is support.
  await createActivityAttendee({
    eventId: pastGames[7],
    userId: youngMenPresident.id,
  });

  // ---------------------------------------------------------------------------------------------
  // ETHAN'S RUNNING TRACK SEASON — two played, one attended, and one coming up
  // ---------------------------------------------------------------------------------------------
  // A LIVE percentage that must NOT move when basketball is closed. If it does, the partition is
  // reading the wrong set.
  const trackPast = await createActivityEvent({
    title: "Track meet against Roosevelt",
    eventDate: daysFromNow(-12, 16),
    eventType: "home",
    location: "Lincoln High School",
    profileId: ethanTrack,
  });

  await createActivityAttendee({
    eventId: trackPast,
    userId: youngMenPresident.id,
    confirmedAttendance: true,
  });

  await createActivityEvent({
    title: "Track meet against Jefferson",
    eventDate: daysFromNow(-5, 16),
    eventType: "home",
    location: "Lincoln High School",
    profileId: ethanTrack,
  });

  // NOBODY DOWN FOR IT, so Ethan keeps a live coverage badge and a real number a leader can move
  // today — the half of the metric that stays actionable.
  await createActivityEvent({
    title: "Track meet against Madison",
    eventDate: daysFromNow(4, 16),
    eventType: "home",
    location: "Lincoln High School",
    profileId: ethanTrack,
  });

  // ---------------------------------------------------------------------------------------------
  // MAYA'S ALREADY-CLOSED CHOIR SEASON
  // ---------------------------------------------------------------------------------------------
  // Four concerts, two attended — 50%, and it must appear on the HISTORY page and NOWHERE on
  // /youth. Every one of them is before `closedAt`, so the history page's recomputation against
  // that instant gives exactly this number.
  const concerts: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    concerts.push(
      await createActivityEvent({
        title: `Winter concert ${index + 1}`,
        eventDate: daysFromNow(-60 + index * 9, 19),
        eventType: "home",
        location: "Lincoln High School",
        profileId: mayaChoir,
      }),
    );
  }

  await createActivityAttendee({
    eventId: concerts[0],
    userId: youngWomenPresident.id,
    confirmedAttendance: true,
  });

  await createActivityAttendee({
    eventId: concerts[2],
    userId: youngWomenPresident.id,
    confirmedAttendance: true,
  });

  // ---------------------------------------------------------------------------------------------
  // JOSH'S WARD-WIDE SERVICE CREW — one past event and one follow-up ALREADY OWED
  // ---------------------------------------------------------------------------------------------
  // The Young Men president is DOWN for a past event and has written nothing, so "Waiting on your
  // follow-up" has a row in it before the walk begins. Closing that activity must NOT make the row
  // disappear: closing ends the ranking, not the obligation (decision 3).
  const servicePast = await createActivityEvent({
    title: "Food bank shift",
    eventDate: daysFromNow(-3, 10),
    eventType: "home",
    location: "Lincoln High School",
    profileId: joshService,
  });

  await createActivityAttendee({ eventId: servicePast, userId: youngMenPresident.id });

  void bishop;
  void joshDebate;

  console.log(
    "  ward (cross-org OFF, home venue Lincoln High School), 4 users, 3 households, 3 youth, " +
      "5 activities (1 already closed, 1 ward-wide, 1 empty and removable), 21 events, " +
      "5 attendee rows, 1 follow-up written by another organization's leader",
  );
}
