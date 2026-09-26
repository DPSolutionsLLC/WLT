import {
  createAssignment,
  createHousehold,
  createMember,
  createSunday,
  createTalkReference,
  createTestUser,
  createTopic,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// TWO SUNDAYS: ONE READY TO ASK, ONE LOCKED
// ---------------------------------------------------------------------------
//   A (+1 week)  conducted by the 1st counselor, References SKIPPED, three talks:
//                  slot 1  Maria Lopez    member WITH a phone, one reference
//                  slot 2  Tomas Reyes    member with NO phone
//                  slot 3  Brother Kent Walker   a VISITOR (not on the roster)
//   B (+2 weeks) References NOT decided, one speaker — the locked Talks check
//
// NO ASKS ARE SEEDED. Sending them is the first thing the walk does, and a seeded to-do would skip
// the one route this scenario exists to exercise.
//
// Ana Silva is on the roster with a phone and speaks nowhere: she is who the walker chooses when
// Tomas declines.
//
// RELATIVE TO TODAY, NOT FIXED DATES — scenario 073's walk found fixed dates drift out of the
// hub's month. Do not tidy these into fixed dates.

function sundayOnOrBefore(today: Date): Date {
  const date = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
}

function weeksFrom(anchor: Date, weeks: number): string {
  const date = new Date(anchor);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

const ANCHOR = sundayOnOrBefore(new Date());
const SUNDAY_A = weeksFrom(ANCHOR, 1);
const SUNDAY_B = weeksFrom(ANCHOR, 2);

const REFERENCES_SKIPPED_AT = "2026-09-20T17:30:00Z";

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

  await createTestUser({
    handle: "counselor2",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 2,
    firstName: "David",
    lastName: "Okafor",
  });

  const member = async (firstName: string, lastName: string, phone?: string) =>
    createMember({
      firstName,
      lastName,
      householdId: await createHousehold({ familyName: lastName }),
      category: "adult",
      status: "active",
      phone,
    });

  const maria = await member("Maria", "Lopez", "801-555-0142");
  const tomas = await member("Tomas", "Reyes");
  await member("Ana", "Silva", "801-555-0188");

  const faith = await createTopic({ title: "Faith in Jesus Christ" });
  const covenants = await createTopic({ title: "The Power of Covenants" });
  const gratitude = await createTopic({ title: "Gratitude" });

  // --- A — ready to ask ---------------------------------------------------------------------------
  const sundayA = await createSunday({
    date: SUNDAY_A,
    speakingSlots: 3,
    conductingUserId: counselor1.id,
    referencesSkippedAt: REFERENCES_SKIPPED_AT,
  });

  const mariaTalk = await createAssignment({
    sundayId: sundayA,
    slotNumber: 1,
    memberId: maria,
    topicId: faith,
    pipelineStage: "plan",
    plannedBy: counselor1.id,
  });
  await createAssignment({
    sundayId: sundayA,
    slotNumber: 2,
    memberId: tomas,
    topicId: covenants,
    pipelineStage: "plan",
    plannedBy: counselor1.id,
  });
  await createAssignment({
    sundayId: sundayA,
    slotNumber: 3,
    externalSpeakerName: "Brother Kent Walker",
    topicId: gratitude,
    pipelineStage: "plan",
    plannedBy: counselor1.id,
  });

  // A reference on a SKIPPED Sunday cannot be added through the app (the skip is refused while
  // references exist), but a reference seeded before the skip is a real state, and it is what
  // shows the ask carrying one.
  await createTalkReference({ assignmentId: mariaTalk, kind: "scripture", citation: "Alma 32:21" });

  // --- B — locked: References not decided ---------------------------------------------------------
  const sundayB = await createSunday({
    date: SUNDAY_B,
    speakingSlots: 2,
    conductingUserId: bishop.id,
  });
  await createAssignment({
    sundayId: sundayB,
    slotNumber: 1,
    memberId: maria,
    topicId: gratitude,
    pipelineStage: "plan",
    plannedBy: bishop.id,
  });

  console.log(
    "  ward, 3 users (bishop, counselor1 — conducts A, counselor2), 3 members (Maria Lopez with " +
      "a phone, Tomas Reyes without, Ana Silva spare), 3 topics, and two Sundays: " +
      `A ${SUNDAY_A} (References SKIPPED, 3 talks incl. visitor Brother Kent Walker), ` +
      `B ${SUNDAY_B} (References OPEN — the locked Talks check). No asks seeded.`,
  );
}
