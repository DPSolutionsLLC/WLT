import {
  addMemberToOrganization,
  createActivityAttendee,
  createActivityCalendar,
  createActivityEvent,
  createActivityOccasion,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// ONE REAL GAME, HELD AS TWO ROWS THAT DO NOT KNOW ABOUT EACH OTHER.
//
// ---------------------------------------------------------------------------------------------
// WHAT THIS SEED HAS TO MAKE POSSIBLE
// ---------------------------------------------------------------------------------------------
// `activity_events.profile_id` is a single foreign key, so an event belongs to exactly ONE young
// person. Ethan Brooks and Josh Kim on the same basketball team, at the same game on Friday, are
// TWO ROWS, two calendar cards, and — before this slice — nothing anywhere recorded that they are
// the same evening in the same gym.
//
// THE HONEST STARTING STATE IS TWO ROWS A SCHOOL FEED PRODUCED WEEKS APART, in two different
// organizations. That is twenty minutes of clicking to build by hand, and wrong the moment the
// clock moves, which is why it is seeded rather than described.
//
// ---------------------------------------------------------------------------------------------
// THE TWO ROOSEVELT ROWS ARE DELIBERATELY ASYMMETRIC
// ---------------------------------------------------------------------------------------------
// Josh has somebody down for his; Ethan has NOBODY. Once the two are joined, the occasion badge
// must read as an ALERT even though one of its two rows is covered — worst-of across the rows,
// reduced with coverageRank(), which is ITER-020 item 4. If it ever reads "Covered", the reduction
// has started answering a different question.
//
// The titles differ on purpose — "Game against Roosevelt" and "Game vs Roosevelt" — because two
// school feeds write the same fixture two ways. THAT IS WHY THE LINK IS EXPLICIT AND STORED rather
// than inferred from a matching title and date, and it is why every option in the join picker has
// to name the YOUNG PERSON rather than the title alone.
//
// ---------------------------------------------------------------------------------------------
// EVERY DATE IS COMPUTED FROM THE SEED TIME
// ---------------------------------------------------------------------------------------------
// Coverage is a function of the clock, and the past occasion below must stay past. A tester cannot
// place events either side of a seven-day notice window by hand without arithmetic they will get
// wrong, and getting it wrong produces a run that passes for the wrong reason.
//
// ---------------------------------------------------------------------------------------------
// THE READER IS THE YOUNG MEN PRESIDENT, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------------------------
// They own both Roosevelt rows, so joining them is ordinary work. Adding AVA — a Young Women
// youth — to the same game is the CROSS-ORGANIZATION CASE, and it must simply work: migration
// 059c gives `activity_occasions` ward-wide policies on all four verbs precisely so that an
// occasion can hold a Young Men row and a Young Women row. If that add is refused, the policy has
// been narrowed and the feature is gone.

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
  // `home_venues` holds Lincoln High School, so a row whose location matches reads `Home` and one
  // that does not reads `Home or away?` — never `Away`. AVA's added row is classified from its own
  // location, and that is the youth-c rule this scenario re-checks in a new place.
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

  const brooks = await createHousehold({ familyName: "Brooks", address: "2201 Canyon Road" });
  const kim = await createHousehold({ familyName: "Kim", address: "418 Meadowlark Lane" });
  const reyes = await createHousehold({ familyName: "Reyes", address: "77 Bridger Street" });

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

  const ava = await createMember({
    firstName: "Ava",
    lastName: "Reyes",
    householdId: reyes,
    category: "youth",
    gender: "female",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });
  await addMemberToOrganization({ memberId: josh, org: "youngMen" });
  await addMemberToOrganization({ memberId: ava, org: "youngWomen" });

  // ---------------------------------------------------------------------------------------------
  // THREE PROFILES, ONE OF THEM IN A DIFFERENT ORGANIZATION
  // ---------------------------------------------------------------------------------------------
  // Ethan and Josh are Young Men; AVA IS YOUNG WOMEN, and hers is the one the tester adds by hand.
  // Same activity name on all three, because they are on teams at the same school — which is
  // exactly why the join picker must name the young person and not the activity alone.
  //
  // EXPLICIT IDS, AND THEY ARE REQUIRED HERE RATHER THAN TIDY. `createYouthActivityProfile`
  // derives its default id from the ACTIVITY NAME alone, so three profiles called "Varsity
  // basketball" would collide on the primary key and the seed would fail on the second one. That
  // is the right failure — but the collision is the whole point of this scenario, so the ids are
  // keyed on the young person as well.
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

  const joshBasketball = await createYouthActivityProfile({
    id: testUuid("profile:josh:varsity-basketball"),
    memberId: josh,
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  const avaBasketball = await createYouthActivityProfile({
    id: testUuid("profile:ava:varsity-basketball"),
    memberId: ava,
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngWomen",
    enteredBy: youngWomenPresident.id,
  });

  // Two feeds, one per Young Men profile, so both Roosevelt rows carry a `source_uid` and render
  // the "From a schedule feed" chip. AVA'S ROW MUST NOT — a hand-entered event belongs to no
  // calendar, and the contrast is visible on screen.
  const ethanCalendar = await createActivityCalendar({
    profileId: ethanBasketball,
    sourceType: "ics_upload",
    lastSyncedAt: daysFromNow(-14, 9),
  });

  const joshCalendar = await createActivityCalendar({
    profileId: joshBasketball,
    sourceType: "ics_upload",
    lastSyncedAt: daysFromNow(-9, 9),
  });

  // ---------------------------------------------------------------------------------------------
  // THE TWO ROSEVELT ROWS — ONE REAL GAME, NO OCCASION, DIFFERENT TITLES
  // ---------------------------------------------------------------------------------------------
  // Both at 7:00pm, +3 days, at Lincoln High School. NEITHER has an `occasionId`: this is the
  // state the slice exists to fix, and the first checklist line reads the calendar BEFORE the
  // join so a tester sees it.
  const ethanRoosevelt = await createActivityEvent({
    title: "Game against Roosevelt",
    eventDate: daysFromNow(3, 19),
    eventType: "home",
    location: "Lincoln High School",
    profileId: ethanBasketball,
    calendarId: ethanCalendar,
    sourceUid: "roosevelt-home@lincoln-boys",
  });

  const joshRoosevelt = await createActivityEvent({
    // DELIBERATELY A DIFFERENT WORDING. Two feeds, one fixture — the case that makes an inferred
    // match unsafe and an explicit link necessary.
    title: "Game vs Roosevelt",
    eventDate: daysFromNow(3, 19),
    eventType: "home",
    location: "Lincoln High School",
    profileId: joshBasketball,
    calendarId: joshCalendar,
    sourceUid: "rooseveltgame@lincolnathletics",
  });

  // JOSH HAS SOMEBODY GOING; ETHAN HAS NOBODY. That asymmetry is the whole point of step 6: the
  // occasion must read as an ALERT with one covered row beside one uncovered one.
  await createActivityAttendee({ eventId: joshRoosevelt, userId: youngMenPresident.id });

  // ---------------------------------------------------------------------------------------------
  // TWO PLAUSIBLE WRONG ANSWERS ON THE SAME DAY
  // ---------------------------------------------------------------------------------------------
  // The join picker offers everything on the event's own day, so these two are in it. A tester who
  // reads only the title could pick either — which is why the picker labels every option with the
  // TIME, the YOUNG PERSON and the ACTIVITY.
  await createActivityEvent({
    title: "Track time trial",
    eventDate: daysFromNow(3, 16),
    eventType: "home",
    location: "Lincoln High School track",
    profileId: ethanBasketball,
  });

  await createActivityEvent({
    title: "Choir rehearsal",
    eventDate: daysFromNow(3, 17, 30),
    eventType: "home",
    location: "Lincoln High School",
    profileId: avaBasketball,
  });

  // ONE GAME THE FOLLOWING WEEK, so the picker's same-day bound is visible AS A BOUND. If this
  // ever appears in the picker, the bound is not being applied.
  await createActivityEvent({
    title: "Game against Jefferson",
    eventDate: daysFromNow(10, 19),
    eventType: "home",
    location: "Lincoln High School",
    profileId: ethanBasketball,
    calendarId: ethanCalendar,
    sourceUid: "jefferson-home@lincoln-boys",
  });

  // ---------------------------------------------------------------------------------------------
  // A PAST GAME ALREADY IN A TWO-ROW OCCASION
  // ---------------------------------------------------------------------------------------------
  // So the detail view is proved to work on a game that HAS ALREADY HAPPENED. The page always
  // reads `includePast: true`, and if the occasion's rows vanish once the game is over then the
  // one screen a leader opens to ask "who was there?" empties out at exactly the wrong moment.
  //
  // Seeded ALREADY JOINED, which is a state that takes several minutes to build through the UI.
  const pastOccasion = await createActivityOccasion({ createdBy: youngMenPresident.id });

  await createActivityEvent({
    title: "Game against Madison",
    eventDate: daysFromNow(-6, 19),
    eventType: "home",
    location: "Lincoln High School",
    profileId: ethanBasketball,
    occasionId: pastOccasion,
  });

  await createActivityEvent({
    title: "Madison game",
    eventDate: daysFromNow(-6, 19),
    eventType: "home",
    location: "Lincoln High School",
    profileId: joshBasketball,
    occasionId: pastOccasion,
  });

  void bishop;
  void ethanRoosevelt;

  console.log(
    "  ward (cross-org OFF, home venue Lincoln High School), 3 users, 3 households, 3 youth, " +
      "3 activities (2 Young Men, 1 Young Women), 2 schedule feeds, 6 events, 2 attendee rows",
  );
  console.log(
    "  TWO Roosevelt rows at +3d 7:00pm with NO occasion — Ethan's has nobody down, " +
      "Josh's has ym-president. One past occasion (Madison, -6d) already holding two rows.",
  );
  console.log(
    `  bishop=${bishop.email} ym-president=${youngMenPresident.email} ` +
      `yw-president=${youngWomenPresident.email}`,
  );
}
