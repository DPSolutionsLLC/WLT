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
} from "../../../infrastructure/seedUtils.ts";

// FIVE YOUNG PEOPLE, SIX ACTIVITIES, AND EVERY PERCENTAGE CHECKABLE BY HAND.
//
// ---------------------------------------------------------------------------------------------
// WHAT THIS SEED HAS TO MAKE POSSIBLE, AND WHAT THE OLD ONE COULD NOT
// ---------------------------------------------------------------------------------------------
// The version before 2026-08-29 gave every young person EXACTLY ONE activity, which is precisely
// the arrangement that HID the card-per-profile problem during the youth-e walk: `/youth` was
// rendering one card per (member, activity) row and it looked correct because no member had two.
// So Ethan now has two activities, and his card must appear ONCE with TWO pills.
//
// ---------------------------------------------------------------------------------------------
// THE ARITHMETIC, WHICH A TESTER MUST BE ABLE TO CHECK RATHER THAN TRUST
// ---------------------------------------------------------------------------------------------
// The support percentage is CONFIRMED attendance over PAST HOME games that were not cancelled.
// Every number below is small and deliberate:
//
//   ETHAN  Varsity basketball  1 of 8 →  13%   (Math.round(12.5))
//          Track and field     3 of 4 →  75%
//            → lowest support 0.125, so he leads "Least supported first".
//   MAYA   Concert choir       2 of 5 →  40%
//            → second under priority, and FIRST when the direction is reversed.
//   JOSH   Club soccer         nothing played (all away)      → pill reads "—"
//   SOFIA  Debate club         nothing played (tbd, cancelled) → pill reads "—"
//   LIAM   Cross country       no events at all                → pill reads "—"
//
// THE THREE NO-DATA YOUNG PEOPLE ARE THE POINT. A missing percentage sorts LAST IN BOTH
// DIRECTIONS, which is the DELIBERATE OPPOSITE of the sort this replaced — `nobody_all_season`
// sorted its null FIRST, because there null meant "nobody has ever been". Here null means NO HOME
// GAMES HAVE BEEN PLAYED, which is no data at all. If any of the three ever renders `0%` or leads
// either direction, that is visits-f arriving in this module.
//
// ---------------------------------------------------------------------------------------------
// THREE MEANINGS OF `confirmed_attendance`, ALL THREE ON THE SCREEN AT ONCE
// ---------------------------------------------------------------------------------------------
// The column is `boolean | null` and only ONE of its values is support:
//
//   true   somebody said "I went"                 → COUNTS
//   null   down for it, never answered            → does not count
//   false  said "I did not go"                    → does not count
//
// Maya's five choir events carry all three, so a tester can see that being DOWN for a game is a
// plan rather than an attendance. If her pill ever reads 60% or 80%, one of the two non-counting
// meanings has started counting.
//
// ---------------------------------------------------------------------------------------------
// EVERY DATE IS COMPUTED FROM THE SEED TIME
// ---------------------------------------------------------------------------------------------
// Coverage is a function of the clock. A tester cannot place two dozen events either side of a
// seven-day notice window by hand without arithmetic they will get wrong, and getting it wrong
// produces a run that passes for the wrong reason. So the scenario is runnable on any day and the
// distances are the same every run.
//
// ---------------------------------------------------------------------------------------------
// THE READER IS THE YOUNG WOMEN PRESIDENT, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------------------------
// The follow-up panel at the top of /youth lists only events waiting on the reader PERSONALLY and
// writable by their organization (migration 057c, ITER-021). The panel has to be non-empty for
// this walk, and the only way to get a writable waiting row without turning up to one of Ethan's
// games — which would destroy his percentage — is to read the page as the leader whose
// organization owns Maya's choir.
//
// It also gives the walk its LIVE case: one of Maya's past rehearsals has nobody at it at all, so
// this reader can file a follow-up saying "I went" on an event she never signed up for and watch
// the choir pill move from 40% to 60% in the same interaction (youth-f, Task 5).

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
  // CROSS-ORG VISIBILITY OFF, the ward's default. This scenario is about ranking, not about the
  // setting; scenario 056 walks the setting.
  await ensureTestWard({
    name: "Harness Test Ward",
    crossOrgVisibility: false,
    homeVenues: ["Lincoln High School"],
  });

  // A ward created outside supabase/seed/ward.sql has no notification_settings rows, so
  // emitNotification() would warn and send nothing when the tester saves a follow-up.
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

  // THE ACCOUNT THE WALK SIGNS IN AS. See the header: her organization owns the choir, which is
  // what makes the follow-up panel non-empty without touching Ethan's percentages.
  const youngWomenPresident = await createTestUser({
    handle: "yw-president",
    role: "org_president",
    org: "youngWomen",
    firstName: "Renata",
    lastName: "Alvarez",
  });

  const brooks = await createHousehold({ familyName: "Brooks", address: "2201 Canyon Road" });
  const chen = await createHousehold({ familyName: "Chen", address: "418 Meadowlark Lane" });
  const okafor = await createHousehold({ familyName: "Okafor", address: "77 Bridger Street" });
  const nielsen = await createHousehold({ familyName: "Nielsen", address: "930 Aspen Way" });

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

  const josh = await createMember({
    firstName: "Josh",
    lastName: "Okafor",
    householdId: okafor,
    category: "youth",
    gender: "male",
  });

  const sofia = await createMember({
    firstName: "Sofia",
    lastName: "Nielsen",
    householdId: nielsen,
    category: "youth",
    gender: "female",
  });

  const liam = await createMember({
    firstName: "Liam",
    lastName: "Nielsen",
    householdId: nielsen,
    category: "youth",
    gender: "male",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });
  await addMemberToOrganization({ memberId: maya, org: "youngWomen" });
  await addMemberToOrganization({ memberId: josh, org: "youngMen" });
  await addMemberToOrganization({ memberId: sofia, org: "youngWomen" });
  await addMemberToOrganization({ memberId: liam, org: "youngMen" });

  // ---------------------------------------------------------------------------------------------
  // TWO PROFILES FOR ONE YOUNG PERSON — THE CASE THE OLD SEED COULD NOT MAKE.
  // ---------------------------------------------------------------------------------------------
  // `youth_activity_profiles` has NO uniqueness on `member_id`, so these are two ordinary rows.
  // Ethan must render as ONE card with TWO pills, and the pills must be in ACTIVITY-NAME order:
  // "Track and field" before "Varsity basketball".
  const basketball = await createYouthActivityProfile({
    memberId: ethan,
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  const ethanTrack = await createYouthActivityProfile({
    memberId: ethan,
    activityName: "Track and field",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "March to May",
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

  const soccer = await createYouthActivityProfile({
    memberId: josh,
    activityName: "Club soccer",
    activityType: "sport",
    schoolOrg: "Valley United",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  // ORG NULL — WARD-WIDE, which migration 054d says means "everybody", not a sentinel row meaning
  // it. One profile is seeded this way so the page is walked with the absent-means-default case
  // present rather than only with owned rows.
  const debate = await createYouthActivityProfile({
    memberId: sofia,
    activityName: "Debate club",
    activityType: "academic",
    schoolOrg: "Lincoln High School",
    enteredBy: bishop.id,
  });

  const crossCountry = await createYouthActivityProfile({
    memberId: liam,
    activityName: "Cross country",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  // ---------------------------------------------------------------------------------------------
  // ETHAN, BASKETBALL — EIGHT PAST HOME GAMES, SOMEBODY WENT TO EXACTLY ONE.  1 of 8 = 13%
  // ---------------------------------------------------------------------------------------------
  // The lowest percentage in the ward, so Ethan leads "Least supported first" and is LAST when the
  // direction is reversed. Not zero on purpose: a zero and a null must be visibly different
  // things on this page, and the three no-data young people below are the null.
  const basketballGames: string[] = [];

  for (const weeksAgo of [1, 2, 3, 4, 5, 6, 7, 8]) {
    basketballGames.push(
      await createActivityEvent({
        title: `Game against ${
          [
            "Roosevelt",
            "Jefferson",
            "Washington",
            "Madison",
            "Adams",
            "Monroe",
            "Jackson",
            "Harrison",
          ][weeksAgo - 1]
        }`,
        eventDate: daysFromNow(-7 * weeksAgo, 19),
        eventType: "home",
        location: "Lincoln High School gym",
        profileId: basketball,
      }),
    );
  }

  // THE ONE GAME SOMEBODY WENT TO — the eight-weeks-ago one, the OLDEST, so the pill cannot be
  // confused with anything about recency. `confirmed_attendance: true` is what makes it count.
  await createActivityAttendee({
    eventId: basketballGames[7]!,
    userId: youngMenPresident.id,
    confirmedAttendance: true,
  });

  // AND ONE UPCOMING GAME SOMEBODY IS GOING TO, so Ethan's card carries a `Covered · 1` badge.
  // The NUMBER on that badge is what the youth-e walk found wrong (every card read "Covered · 0"),
  // so it must be checked against this one attendee row rather than merely being present.
  const ethanUpcoming = await createActivityEvent({
    title: "Game against Lincoln",
    eventDate: daysFromNow(3, 19),
    eventType: "home",
    location: "Lincoln High School gym",
    profileId: basketball,
  });

  await createActivityAttendee({ eventId: ethanUpcoming, userId: bishop.id });

  // ---------------------------------------------------------------------------------------------
  // ETHAN, TRACK — FOUR PAST HOME MEETS, THREE OF THEM ATTENDED.  3 of 4 = 75%
  // ---------------------------------------------------------------------------------------------
  // His SECOND pill, and it must read very differently from his first. It also proves the priority
  // sort reads the LOWEST of a young person's activities rather than an average: an average would
  // put Ethan at 44% and behind Maya, which is the wrong answer — the basketball season is the one
  // nobody is turning up to.
  const trackMeets: string[] = [];

  for (const [index, daysAgo] of [10, 17, 24, 31].entries()) {
    trackMeets.push(
      await createActivityEvent({
        title: `Track meet, week ${["one", "two", "three", "four"][index]}`,
        eventDate: daysFromNow(-daysAgo, 16),
        eventType: "home",
        location: "Lincoln High School track",
        profileId: ethanTrack,
      }),
    );
  }

  for (const meet of [trackMeets[0]!, trackMeets[1]!, trackMeets[2]!]) {
    await createActivityAttendee({
      eventId: meet,
      userId: youngMenPresident.id,
      confirmedAttendance: true,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // MAYA, CHOIR — FIVE PAST HOME EVENTS, AND ALL THREE MEANINGS OF `confirmed_attendance`.
  // ---------------------------------------------------------------------------------------------
  // 2 of 5 = 40%. If her pill reads 60% a `null` has started counting; if it reads 80%, a `false`
  // has too. Both are the same defect at different depths.

  // (1) SIGNED UP, NEVER ANSWERED — `confirmed_attendance` null. DOES NOT COUNT.
  //     Also THE ROW THE FOLLOW-UP PANEL MUST SHOW: past, not cancelled, the reader is down for it
  //     and has written nothing, and her organization owns the choir (ITER-021).
  const mayaRecent = await createActivityEvent({
    title: "Winter concert",
    eventDate: daysFromNow(-6, 19),
    eventType: "home",
    location: "Lincoln High School auditorium",
    profileId: choir,
  });

  await createActivityAttendee({ eventId: mayaRecent, userId: youngWomenPresident.id });

  // (2) SAID "I WENT" — COUNTS. Already written up, so the panel must NOT list it, which proves
  //     the panel is "waiting on you" rather than "every past event".
  const mayaLogged = await createActivityEvent({
    title: "Regional choir festival",
    eventDate: daysFromNow(-13, 18),
    eventType: "home",
    location: "Lincoln High School auditorium",
    profileId: choir,
  });

  await createActivityAttendee({
    eventId: mayaLogged,
    userId: youngWomenPresident.id,
    confirmedAttendance: true,
  });

  await createActivityLog({
    eventId: mayaLogged,
    loggedBy: youngWomenPresident.id,
    sharedNotes:
      "Maya sang in the small ensemble and the hall was full. Her parents came, and several " +
      "ward members stayed afterwards to say so.",
  });

  // (3) SAID "I WENT" — COUNTS. The second of her two.
  const mayaOlder = await createActivityEvent({
    title: "Autumn showcase",
    eventDate: daysFromNow(-20, 18),
    eventType: "home",
    location: "Lincoln High School auditorium",
    profileId: choir,
  });

  await createActivityAttendee({
    eventId: mayaOlder,
    userId: bishop.id,
    confirmedAttendance: true,
  });

  // (4) NOBODY AT ALL. DOES NOT COUNT — and it is THE EVENT THE WALK'S LIVE CASE USES: the reader
  //     never signed up for it, so filing a follow-up saying "I went" must CREATE her attendee row
  //     and move the choir pill from 40% to 60% in the same interaction (youth-f, Task 5).
  await createActivityEvent({
    title: "Choir rehearsal showcase, week four",
    eventDate: daysFromNow(-27, 18),
    eventType: "home",
    location: "Lincoln High School auditorium",
    profileId: choir,
  });

  // (5) SAID "I DID NOT GO" — `confirmed_attendance` false. DOES NOT COUNT, and it is a DIFFERENT
  //     reason from (1): somebody stated a fact here, and nobody stated anything there. Both are
  //     excluded and the page must not treat them as one.
  const mayaDeclined = await createActivityEvent({
    title: "Choir rehearsal showcase, week five",
    eventDate: daysFromNow(-34, 18),
    eventType: "home",
    location: "Lincoln High School auditorium",
    profileId: choir,
  });

  await createActivityAttendee({
    eventId: mayaDeclined,
    userId: youngMenPresident.id,
    confirmedAttendance: false,
  });

  // THE ROW THE COVERAGE BADGE EXISTS FOR: a home event INSIDE the seven-day notice window with
  // nobody down for it. `uncovered` is the worst coverage state there is, so Maya's card carries
  // "Nobody going" — which the PRIORITY sort deliberately ignores. A leader wanting that question
  // has the calendar; this page ranks on support.
  await createActivityEvent({
    title: "Spring concert",
    eventDate: daysFromNow(2, 19),
    eventType: "home",
    location: "Lincoln High School auditorium",
    profileId: choir,
  });

  // ---------------------------------------------------------------------------------------------
  // JOSH — EVERY PAST GAME AWAY. NO DATA, NOT ZERO.
  // ---------------------------------------------------------------------------------------------
  // An away event carries no coverage expectation by design, which is why eventCoverage() returns
  // `awareness` rather than `uncovered` for one. His pill must read "—", never "0%": if these
  // counted, Josh would LEAD "Least supported first" — the page shouting about a rule working
  // exactly as designed.
  for (const daysAgo of [5, 12, 19, 26]) {
    await createActivityEvent({
      title: `Away fixture, ${daysAgo} days ago`,
      eventDate: daysFromNow(-daysAgo, 17),
      eventType: "away",
      location: "Riverton Sports Park",
      profileId: soccer,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // SOFIA — ONE `tbd` AND ONE CANCELLED. NO DATA, FOR TWO MORE DIFFERENT REASONS.
  // ---------------------------------------------------------------------------------------------
  // Nobody classified the first, so nobody could have been asked to go to it; blaming a leader for
  // a classification nobody made is the mirror of youth-c's "an unmatched location is `tbd`, never
  // `away`". The second was called off, and a game called off is not a game nobody went to.
  //
  // Seeded as SEPARATE rows rather than one, so deleting either exclusion from
  // lib/youth/profileNeed.ts changes what this page shows.
  await createActivityEvent({
    title: "Debate meet",
    eventDate: daysFromNow(-8, 16),
    eventType: "tbd",
    location: "Somewhere on the east side",
    profileId: debate,
  });

  await createActivityEvent({
    title: "Regional debate final",
    eventDate: daysFromNow(-15, 16),
    eventType: "home",
    location: "Lincoln High School",
    profileId: debate,
    status: "cancelled",
  });

  // ---------------------------------------------------------------------------------------------
  // LIAM — NOTHING AT ALL.
  // ---------------------------------------------------------------------------------------------
  // The empty case. His card must render, must show "—" on its pill and "0 events coming up", must
  // sort in the last group in BOTH directions, and must not divide by zero anywhere.
  void crossCountry;

  console.log(
    "  ward (cross-org OFF), 3 users, 4 households, 5 youth, 6 activities " +
      "(1 ward-wide, 2 for Ethan), 25 events, 9 attendee rows, 1 existing follow-up",
  );
  console.log(
    "  support (played + next): Ethan basketball 2/9 22%, Ethan track 3/4 75%, " +
      "Maya choir 2/6 33%, Josh / Sofia / Liam nothing to count",
  );
  console.log(
    `  bishop=${bishop.email} ym-president=${youngMenPresident.email} ` +
      `yw-president=${youngWomenPresident.email}`,
  );
}
