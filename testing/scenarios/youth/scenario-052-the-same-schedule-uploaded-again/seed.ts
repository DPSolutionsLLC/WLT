import {
  addMemberToOrganization,
  createActivityCalendar,
  createActivityEvent,
  createHousehold,
  createMember,
  createTestUser,
  createYouthActivityProfile,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE A RE-IMPORT'S GUARANTEES ARE ACTUALLY ABOUT: already imported once, and then edited
// by hand.
//
// Reaching it through the UI takes several minutes — import a file, cancel a game, correct
// another to Away, type in a third — and every one of those steps is a chance for the tester to
// do something slightly different from the last run. Seeding it is what makes the scenario cheap
// enough to run every time, and what makes the three guarantees below comparable run to run.
//
// ---------------------------------------------------------------------------------------------
// THE THREE THINGS A RE-IMPORT MUST NOT DO: DUPLICATE, REVIVE, OR DESTROY
// ---------------------------------------------------------------------------------------------
//   duplicate   the rows below carry the SAME source_uid and source_recurrence_id values the
//               January file produces, so the March file matches them rather than creating a
//               second copy. Migration 055's unique index is the thing enforcing it.
//   revive      `Roosevelt` is cancelled here BY HAND and appears unchanged in the March file.
//               applyImport.ts never writes `status`, so it must still read Cancelled afterwards.
//   destroy     `Madison` is in the app and ABSENT from the March file. The confirm performs no
//               deletes and no status changes, so it must survive untouched — a feed that briefly
//               publishes a short file cannot be allowed to cancel a season.
//
// `Jefferson` carries a hand-made `event_type = 'away'` AND is the game the March file moves.
// That pairing is deliberate: it is the one row where an update definitely happens, so it is the
// only row that can prove an update does not reset a correction somebody made.
//
// `Team dinner` is HAND-ENTERED — null calendar_id, null source_uid, exactly as
// createActivityEvent writes them — and sits inside the file's own window. It must never appear
// under "in the app, not in this file": it was never expected to be in a file.

// The stored instants the January file resolves to, written with explicit offsets. January and
// early February are MST (-07:00); nothing here crosses the March boundary, so every offset is
// the same and that is a fact about the dates rather than an assumption.
const PRACTICE_DATES = [
  { date: "2027-01-05", recurrenceId: "20270105T160000" },
  { date: "2027-01-12", recurrenceId: "20270112T160000" },
  // 19 January is the EXDATE — the school holiday. Absent here because it is absent from both
  // files; a row for it would be a row the import never created.
  { date: "2027-01-26", recurrenceId: "20270126T160000" },
  { date: "2027-02-02", recurrenceId: "20270202T160000" },
  { date: "2027-02-09", recurrenceId: "20270209T160000" },
  { date: "2027-02-16", recurrenceId: "20270216T160000" },
  { date: "2027-02-23", recurrenceId: "20270223T160000" },
] as const;

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  const president = await createTestUser({
    handle: "ym-president",
    role: "org_president",
    org: "youngMen",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const household = await createHousehold({
    familyName: "Brooks",
    address: "2201 Canyon Road",
  });

  const ethan = await createMember({
    firstName: "Ethan",
    lastName: "Brooks",
    householdId: household,
    category: "youth",
    gender: "male",
  });

  await addMemberToOrganization({ memberId: ethan, org: "youngMen" });

  const profileId = await createYouthActivityProfile({
    memberId: ethan,
    activityName: "Varsity basketball",
    activityType: "sport",
    schoolOrg: "Lincoln High School",
    seasonSchedule: "November to February",
    org: "youngMen",
    enteredBy: president.id,
  });

  // ONE calendar, `ics_upload`. A second row would make "re-import" ambiguous, which is the whole
  // reason slice B resolves one calendar per profile rather than asking.
  const calendarId = await createActivityCalendar({
    profileId,
    sourceType: "ics_upload",
    lastSyncedAt: "2027-01-02T18:00:00-07:00",
  });

  const imported = {
    profileId,
    calendarId,
    location: "Lincoln High School gym",
  };

  // CANCELLED BY HAND. Unchanged in the March file, so this is what proves an import cannot
  // revive a game somebody called off.
  await createActivityEvent({
    ...imported,
    title: "Varsity Basketball vs Roosevelt",
    eventDate: "2027-01-15T19:30:00-07:00",
    status: "cancelled",
    sourceUid: "lhs-bball-001@lincolnhigh.example",
  });

  // CORRECTED TO AWAY BY HAND, and the one game the March file moves. An update writes title,
  // location, event_date and all_day and nothing else, so `away` must survive.
  await createActivityEvent({
    ...imported,
    title: "Varsity Basketball at Jefferson",
    eventDate: "2027-01-22T19:30:00-07:00",
    eventType: "away",
    location: "Jefferson High School",
    sourceUid: "lhs-bball-002@lincolnhigh.example",
  });

  // ABSENT FROM THE MARCH FILE. Must survive, still `upcoming`, still on this date.
  await createActivityEvent({
    ...imported,
    title: "Varsity Basketball vs Madison",
    eventDate: "2027-01-29T18:00:00-07:00",
    sourceUid: "lhs-bball-003@lincolnhigh.example",
  });

  await createActivityEvent({
    ...imported,
    title: "District Tournament",
    eventDate: "2027-02-05T00:00:00-07:00",
    allDay: true,
    location: "Regional Sports Center",
    sourceUid: "lhs-bball-004@lincolnhigh.example",
  });

  for (const practice of PRACTICE_DATES) {
    await createActivityEvent({
      ...imported,
      title: "Varsity Basketball practice",
      eventDate: `${practice.date}T16:00:00-07:00`,
      sourceUid: "lhs-bball-005@lincolnhigh.example",
      sourceRecurrenceId: practice.recurrenceId,
    });
  }

  // HAND-ENTERED. Null on both source columns, inside the file's window, and it must never be
  // listed as "in the app, not in this file".
  await createActivityEvent({
    profileId,
    title: "Team dinner before the Madison game",
    eventDate: "2027-01-20T18:00:00-07:00",
    location: "The Brooks home",
  });

  console.log(
    "  ward, 1 user, 1 youth, 1 activity, 1 ics_upload calendar, 12 events " +
      "(11 imported + 1 hand-entered; 1 cancelled by hand, 1 corrected to away)",
  );
  console.log("  fixture: lincoln-basketball-march.ics, beside this seed");
}
