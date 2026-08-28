import {
  addMemberToOrganization,
  createActivityAttendee,
  createActivityEvent,
  createActivityLog,
  createActivityPrivateNote,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// FIVE EVENTS AT SPECIFIC DISTANCES FROM NOW, AND FOUR OF THEM ARE IN THE PAST.
//
// A follow-up is a function of the clock in exactly the way coverage is: `awaiting` means "past,
// not cancelled, you were down for it, and you have written nothing". A tester cannot place events
// either side of that boundary by hand without arithmetic they will get wrong, and getting it
// wrong produces a run that passes for the wrong reason.
//
// So every date below is computed FROM THE SEED TIME rather than written out. The scenario is
// runnable on any day and the distances are the same every run.
//
// ---------------------------------------------------------------------------------------------
// ONE EVENT PER FOLLOW-UP STATE, PLUS THE ONE THAT MUST HAVE NO STATE AT ALL
// ---------------------------------------------------------------------------------------------
//   −3 days,  attendee, NO log        → awaiting.      The only row the panel shows.
//   −5 days,  attendee, log exists    → logged.        Proves the panel is not just "past events".
//   −4 days,  attendee, CANCELLED     → nothing.       The row this scenario exists for.
//   −6 days,  NOT an attendee         → nothing.       Nobody is waiting on somebody who never
//                                                      said they were going.
//   +5 days,  attendee                → nothing.       So "past" is doing work rather than being
//                                                      every row.
//
// The CANCELLED one is the assertion `lib/youth/followUp.ts` tests `cancelled` before the clock
// for. An implementation that consulted the clock first would pass every other line here and fail
// only for somebody reading the same screen next week.
//
// ---------------------------------------------------------------------------------------------
// A SECOND LEADER'S FOLLOW-UP, WITH A PRIVATE NOTE ON IT, SEEDED RATHER THAN TYPED
// ---------------------------------------------------------------------------------------------
// The bishop's inability to read somebody else's private note has to be testable WITHOUT anybody
// typing one first — otherwise the only run that checks it is the run where the tester happened to
// use the private box. The org secretary's follow-up and its note exist from the first paint, and
// the checklist asks the bishop to go looking for it.
//
// The secretary is in the SAME organization as the president, so the bishop and the president can
// both READ the shared note. That is what makes the private half a real assertion rather than an
// artefact of the whole follow-up being hidden.

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
  // CROSS-ORG VISIBILITY OFF, which is the ward's default and the mode the shared-note label has
  // to read correctly in. Scenario 056 walks the other side.
  await ensureTestWard({
    name: "Harness Test Ward",
    crossOrgVisibility: false,
    homeVenues: ["Lincoln High School"],
  });

  // A ward created outside supabase/seed/ward.sql has no notification_settings rows, so
  // emitNotification() would warn and send nothing. `youth_followup_submitted` fires when the
  // president saves, and the checklist reads it from the table.
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

  // SAME ORGANIZATION as the president, so the follow-up they wrote is one he can read. An org
  // secretary holds `youth_activities.view` and `.log` and NOT `.manage`, which is also the role
  // that proves filing a follow-up does not need `.manage`.
  const youngMenSecretary = await createTestUser({
    handle: "ym-secretary",
    role: "org_secretary",
    org: "youngMen",
    firstName: "Dale",
    lastName: "Whitfield",
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

  // BOTH OWNED BY THE YOUNG MEN, so everything in this scenario is inside one organization and the
  // only thing being tested is the follow-up loop. Cross-organization boundaries are scenario 056.
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
    org: "youngMen",
    enteredBy: youngMenPresident.id,
  });

  // 1. THE ROW THE PANEL MUST SHOW, and the only one.
  const waitingEvent = await createActivityEvent({
    title: "Game against Roosevelt",
    eventDate: daysFromNow(-3, 19),
    eventType: "home",
    location: "Lincoln High School gym",
    profileId: basketball,
  });

  await createActivityAttendee({
    eventId: waitingEvent,
    userId: youngMenPresident.id,
  });

  // 2. ALREADY LOGGED by the president. The panel must not list it; the event card must say so.
  const loggedEvent = await createActivityEvent({
    title: "Game against Jefferson",
    eventDate: daysFromNow(-5, 19),
    eventType: "home",
    location: "Lincoln High School gym",
    profileId: basketball,
  });

  await createActivityAttendee({
    eventId: loggedEvent,
    userId: youngMenPresident.id,
    // ALREADY CONFIRMED, so "Change what you wrote" opens with the answer already selected and the
    // tester can see the difference between an answered and an unanswered question.
    confirmedAttendance: true,
  });

  await createActivityLog({
    eventId: loggedEvent,
    loggedBy: youngMenPresident.id,
    sharedNotes: "A close game. Ethan played the whole second half.",
  });

  // 3. CANCELLED AND PAST. Must never appear as waiting, at any distance from the clock.
  const cancelledEvent = await createActivityEvent({
    title: "Game against Washington",
    eventDate: daysFromNow(-4, 19),
    eventType: "home",
    location: "Lincoln High School gym",
    profileId: basketball,
    status: "cancelled",
  });

  await createActivityAttendee({
    eventId: cancelledEvent,
    userId: youngMenPresident.id,
  });

  // 4. PAST, AND THE PRESIDENT WAS NEVER DOWN FOR IT. The SECRETARY was, and wrote a follow-up
  // with a private note on it — which is the pair the bishop is sent looking for.
  const secretaryEvent = await createActivityEvent({
    title: "Winter concert",
    eventDate: daysFromNow(-6, 19),
    eventType: "home",
    location: "Lincoln High School auditorium",
    profileId: choir,
  });

  await createActivityAttendee({
    eventId: secretaryEvent,
    userId: youngMenSecretary.id,
    confirmedAttendance: true,
  });

  const secretaryLog = await createActivityLog({
    eventId: secretaryEvent,
    loggedBy: youngMenSecretary.id,
    sharedNotes:
      "Ava sang the solo and the hall was full. Her grandparents came down for it, which " +
      "meant a great deal to the family, and several ward members stayed afterwards to say so.",
  });

  // THE ROW THE BISHOP MUST NOT BE ABLE TO REACH BY ANY ROUTE. Seeded so that assertion does not
  // depend on the tester having typed one.
  await createActivityPrivateNote({
    activityLogId: secretaryLog,
    userId: youngMenSecretary.id,
    notes: "Privately: Ava's father has not been at church since August. Worth a quiet visit.",
  });

  // 5. UPCOMING, so "past" is doing work rather than being every row.
  const upcomingEvent = await createActivityEvent({
    title: "Game against Madison",
    eventDate: daysFromNow(5, 19),
    eventType: "home",
    location: "Lincoln High School gym",
    profileId: basketball,
  });

  await createActivityAttendee({
    eventId: upcomingEvent,
    userId: youngMenPresident.id,
  });

  console.log(
    "  ward (cross-org OFF), 3 users, 2 households, 2 youth, 2 activities, 5 events " +
      "(4 past), 5 attendee rows, 1 existing follow-up + 1 private note on it",
  );
  console.log(
    `  bishop=${bishop.email} ym-president=${youngMenPresident.email} ` +
      `ym-secretary=${youngMenSecretary.email}`,
  );
}
