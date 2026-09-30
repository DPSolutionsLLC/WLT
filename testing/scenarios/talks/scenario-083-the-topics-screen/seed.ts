import {
  createAssignment,
  createAssignmentApproval,
  createAssignmentHistory,
  createConductingRotation,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  createTodo,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// ONE SUNDAY WITH A TALK IN EVERY STATE THE TOPICS SCREEN CAN SHOW
// ---------------------------------------------------------------------------
// Every Sunday from the first of this month through the end of the month after next, each
// month's first Sunday a PINNED Fast Sunday (scenario 079's lesson: a partial calendar moves Fast
// Sunday).
//
//   A  the first ordinary Sunday at least three weeks out. Four speaking slots, counselor1
//      conducting, topics FINALIZED (so Delete's un-finalize is visible) and References skipped:
//        talk 1  Maria Lopez    ACCEPTED, topic "Faith in Jesus Christ",
//                               approved by the bishop and counselor1 (2 of 3)
//        talk 2  Ana Silva      ASK OPEN (counselor1 holds it), no topic
//        talk 3  (nobody)       DECLINED by Tomas Reyes, topic "Gratitude"
//        talk 4  open
//
// `music` is a music_coordinator: holds talks.view and nothing that edits a talk.
//
// RELATIVE TO TODAY, NOT FIXED DATES — scenario 073's walk found fixed dates drift out of the
// hub's month. Do not tidy these into fixed dates.

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function sundayOnOrBefore(today: Date): string {
  const date = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function isFirstSundayOfMonth(date: string): boolean {
  return Number(date.slice(8, 10)) <= 7;
}

function monthAfter(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
}

const TODAY = new Date().toISOString().slice(0, 10);
const LAST_MONTH = monthAfter(monthAfter(TODAY.slice(0, 7)));

const THIS_SUNDAY = sundayOnOrBefore(new Date());
const FIRST_SUNDAY_OF_MONTH = (() => {
  let date = THIS_SUNDAY;
  while (!isFirstSundayOfMonth(date)) date = addDays(date, -7);
  return date;
})();
const ALL_SUNDAYS = Array.from({ length: 15 }, (_, week) =>
  addDays(FIRST_SUNDAY_OF_MONTH, week * 7),
).filter((date) => date.slice(0, 7) <= LAST_MONTH);

export const SUNDAY_A = ALL_SUNDAYS.find(
  (date) => date >= addDays(THIS_SUNDAY, 21) && !isFirstSundayOfMonth(date),
) as string;

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const counselor1 = await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });

  const counselor2 = await createTestUser({
    handle: "counselor2",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 2,
    firstName: "David",
    lastName: "Okafor",
  });

  await createTestUser({
    handle: "music",
    role: "music_coordinator",
    firstName: "Hannah",
    lastName: "Price",
  });

  await createConductingRotation({
    effectiveFrom: ALL_SUNDAYS[0],
    userIds: [counselor1.id, counselor2.id, bishop.id],
  });

  const member = async (firstName: string, lastName: string) =>
    createMember({
      firstName,
      lastName,
      householdId: await createHousehold({ familyName: lastName }),
      category: "adult",
      status: "active",
    });

  const maria = await member("Maria", "Lopez");
  const ana = await member("Ana", "Silva");
  const tomas = await member("Tomas", "Reyes");
  await member("Luis", "Ortega");

  const now = new Date().toISOString();
  let sundayA = "";
  for (const date of ALL_SUNDAYS) {
    const fast = isFirstSundayOfMonth(date);
    const isA = date === SUNDAY_A;
    const id = await createSunday({
      date,
      type: fast ? "fast_sunday" : "standard",
      speakingSlots: fast ? 0 : isA ? 4 : 3,
      fastSundayPinned: fast,
      ...(isA
        ? { conductingUserId: counselor1.id, topicsFinalizedAt: now, referencesSkippedAt: now }
        : {}),
    });
    if (isA) sundayA = id;
  }

  const talk1 = await createAssignment({
    sundayId: sundayA,
    slotNumber: 1,
    memberId: maria,
    topicTitle: "Faith in Jesus Christ",
    pipelineStage: "confirm",
    requestOutcome: "accepted",
    plannedBy: counselor1.id,
  });
  await createAssignmentApproval({ assignmentId: talk1, userId: bishop.id, approved: true });
  await createAssignmentApproval({ assignmentId: talk1, userId: counselor1.id, approved: true });

  const talk2 = await createAssignment({
    sundayId: sundayA,
    slotNumber: 2,
    memberId: ana,
    pipelineStage: "request",
    plannedBy: counselor1.id,
  });
  await createTodo({
    userId: counselor1.id,
    title: "Ask Ana Silva to speak",
    askAssignmentId: talk2,
  });

  // A decline CLEARS the speaker (lib/assignments/requestOutcome.ts); the history row keeps who.
  const talk3 = await createAssignment({
    sundayId: sundayA,
    slotNumber: 3,
    topicTitle: "Gratitude",
    pipelineStage: "plan",
    requestOutcome: "declined",
    plannedBy: counselor1.id,
  });
  await createAssignmentHistory({ memberId: tomas, assignmentId: talk3, outcome: "declined" });

  console.log(
    `  ward, 4 users (bishop, counselor1, counselor2, music), every Sunday ${ALL_SUNDAYS[0]} to ` +
      `${ALL_SUNDAYS[ALL_SUNDAYS.length - 1]}.\n` +
      `  A ${SUNDAY_A}: 4 slots, topics finalized, counselor1 conducting.\n` +
      `    talk 1 Maria Lopez accepted, "Faith in Jesus Christ", 2 of 3 approvals\n` +
      `    talk 2 Ana Silva, ask open, no topic\n` +
      `    talk 3 declined (Tomas Reyes), "Gratitude"\n` +
      `    talk 4 open`,
  );
}
