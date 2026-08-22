import {
  TEST_ORG_IDS,
  createAssignment,
  createConductingRotation,
  createSunday,
  createSundayOrgConducting,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// The whole of GROUP-01 on one calendar: a Sunday that holds NO MEETING sitting in the same month
// as a WARD CONFERENCE, which cannot be Fast Sunday and yet meets perfectly normally. One
// scenario rather than two, because the two items are one body of work and only a month holding
// both shows that the two lists really did come apart.
//
// September through December 2027 are seeded, and every month is load-bearing:
//
//   September  the rotation's anchor month, so the cycle is already running by November and the
//              skip reads as a SHIFT rather than as a no-op
//   October    holds the general conference the app PREDICTS (first Sunday of April and October),
//              which is the one cancellation that exists without anyone setting it
//   November   the month under test: ward conference on the 1st Sunday, stake conference on the 3rd
//   December   exists so that cancelling a November Sunday has later Sundays to re-shift, and so
//              the tester can watch the shift cross a month boundary
//
// November 2027 has FOUR Sundays and opens on a Monday. (The plan said five; the calendar
// disagrees, and the calendar wins — every check below is written against four.)
//
// Conductors are seeded EXPLICITLY rather than left for the app to fill. conducting_user_id is
// STORED, never computed at read time (03-calendar.md Step 3), and populateConducting() only
// fills rows that are still null — so writing the values out is what makes "nobody's turn was
// spent" an observable fact rather than an absence.
//
// The weekly cycle from the 2027-09-05 anchor, with the two cancelled Sundays costing nobody a
// turn:
//
//   09-05 bishop      09-12 counselor1  09-19 counselor2  09-26 bishop
//   10-03 NO MEETING  10-10 counselor1  10-17 counselor2  10-24 bishop   10-31 counselor1
//   11-07 counselor2  11-14 bishop      11-21 NO MEETING  11-28 counselor1
//   12-05 counselor2  12-12 bishop      12-19 counselor1  12-26 counselor2
//
// Read 11-21 and 11-28 together: without the skip, 11-28 would have been counselor2. It holds
// counselor1 — the name the cancelled Sunday would have had.

const ANCHOR = "2027-09-01";

type SeededSunday = {
  date: string;
  type?: "standard" | "fast_sunday" | "general_conference" | "stake_conference" | "ward_conference";
  // Index into the bishopric rotation, or null for a Sunday that holds no meeting.
  position: 1 | 2 | 3 | null;
  speakingSlots?: number;
};

// Position 3 of the Elders Quorum rotation is deliberately EMPTY. That puts "Not set" on screen
// beside "No meeting", which is the exact pair ITER-002 exists to tell apart — a blank conductor
// used to be indistinguishable from an unfilled rotation position, and that ambiguity cost a
// debugging session.
const SUNDAYS: SeededSunday[] = [
  { date: "2027-09-05", type: "fast_sunday", position: 1, speakingSlots: 0 },
  { date: "2027-09-12", position: 2 },
  { date: "2027-09-19", position: 3 },
  { date: "2027-09-26", position: 1 },

  { date: "2027-10-03", type: "general_conference", position: null, speakingSlots: 0 },
  { date: "2027-10-10", type: "fast_sunday", position: 2, speakingSlots: 0 },
  { date: "2027-10-17", position: 3 },
  { date: "2027-10-24", position: 1 },
  { date: "2027-10-31", position: 2 },

  // The 1st Sunday of the month is a WARD CONFERENCE. It displaces Fast Sunday onto the 2nd and
  // keeps everything an ordinary Sunday has: a conductor, three speaking slots, and an
  // organization meeting.
  { date: "2027-11-07", type: "ward_conference", position: 3 },
  { date: "2027-11-14", type: "fast_sunday", position: 1, speakingSlots: 0 },
  { date: "2027-11-21", type: "stake_conference", position: null, speakingSlots: 0 },
  { date: "2027-11-28", position: 2 },

  { date: "2027-12-05", type: "fast_sunday", position: 3, speakingSlots: 0 },
  { date: "2027-12-12", position: 1 },
  { date: "2027-12-19", position: 2 },
  { date: "2027-12-26", position: 3 },
];

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  // The Sunday edits fire calendar notifications, and a ward created outside supabase/seed/ward.sql
  // has no notification_settings rows at all.
  await seedNotificationTriggers();

  // --- The bishopric ------------------------------------------------------------------
  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const counselorOne = await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });

  const counselorTwo = await createTestUser({
    handle: "counselor2",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 2,
    firstName: "Daniel",
    lastName: "Okafor",
  });

  // --- The Elders Quorum, so the organization skip can be seen independently -----------
  const eqPresident = await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tomas",
    lastName: "Ruiz",
  });

  const eqCounselor = await createTestUser({
    handle: "eqcounselor",
    role: "org_counselor",
    org: "eldersQuorum",
    firstName: "Andre",
    lastName: "Whitfield",
  });

  // Holds calendar.manage but NO org rotation rights. The control that proves the organization
  // rows are scoped separately from the sacrament meeting.
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  // --- Two rotations on the same anchor, both WEEKLY -----------------------------------
  // Weekly on purpose: under a monthly cadence one person already holds the whole month, so a
  // single cancelled Sunday would correctly change nothing and there would be nothing to see.
  // Step 9 of the walkthrough flips the ward to monthly to check exactly that.
  const bishopricRotation: [string, string, string] = [
    bishop.id,
    counselorOne.id,
    counselorTwo.id,
  ];

  await createConductingRotation({
    effectiveFrom: ANCHOR,
    cadence: "weekly",
    userIds: bishopricRotation,
  });

  const eqRotation: [string, string, null] = [eqPresident.id, eqCounselor.id, null];

  await createConductingRotation({
    effectiveFrom: ANCHOR,
    cadence: "weekly",
    orgId: TEST_ORG_IDS.eldersQuorum,
    userIds: eqRotation,
  });

  // --- The Sundays --------------------------------------------------------------------
  const idByDate = new Map<string, string>();

  for (const sunday of SUNDAYS) {
    const sundayId = await createSunday({
      date: sunday.date,
      type: sunday.type ?? "standard",
      speakingSlots: sunday.speakingSlots ?? 3,
      // Omitted entirely for a Sunday that holds no meeting. Migration 027's CHECK refuses a
      // conductor there, so seeding one would fail the insert rather than produce a bad row —
      // which is the constraint doing its job.
      ...(sunday.position === null
        ? {}
        : { conductingUserId: bishopricRotation[sunday.position - 1]! }),
    });

    idByDate.set(sunday.date, sundayId);

    // No sunday_org_conducting row AT ALL on a Sunday with no meeting. The absence is the fact: a
    // null user_id already means "this organization's rotation reaches this Sunday but the
    // position is unfilled" (migration 024, Part 4), which is a different thing entirely.
    if (sunday.position === null) continue;

    const eqUserId = eqRotation[sunday.position - 1];

    await createSundayOrgConducting({
      sundayId,
      orgId: TEST_ORG_IDS.eldersQuorum,
      ...(eqUserId === null ? {} : { userId: eqUserId }),
    });
  }

  // --- Two speakers on the Sunday the tester is going to cancel ------------------------
  // On 11-28, the only remaining `standard` Sunday in November, at stage `request` — far enough
  // along the pipeline that returning them to `plan` is a visible loss and the 409 has something
  // real to count. Cancelling it also leaves FOUR later Sundays (all of December) whose conductor
  // changes, so the dialog names both consequences at once.
  const cancelTarget = idByDate.get("2027-11-28")!;

  await createAssignment({
    sundayId: cancelTarget,
    slotNumber: 1,
    pipelineStage: "request",
    externalSpeakerName: "Brother Elliot Vance",
    plannedBy: bishop.id,
  });

  await createAssignment({
    sundayId: cancelTarget,
    slotNumber: 2,
    pipelineStage: "request",
    externalSpeakerName: "Sister Marta Ilundain",
    plannedBy: bishop.id,
  });

  // --- Speakers on the ward conference, so "it keeps its speakers" is checkable ---------
  const wardConference = idByDate.get("2027-11-07")!;

  await createAssignment({
    sundayId: wardConference,
    slotNumber: 1,
    pipelineStage: "confirm",
    externalSpeakerName: "President Alma Reyes",
    plannedBy: bishop.id,
  });

  console.log(
    "  ward, 6 users, 2 weekly rotations effective 2027-09-01 (bishopric + Elders Quorum), " +
      "17 Sundays across 2027-09 to 2027-12 (10-03 general conference and 11-21 stake " +
      "conference hold NO meeting: no conductor, no org row), 11-07 ward conference with a " +
      "confirmed speaker, 2 speakers at stage request on 11-28",
  );
}
