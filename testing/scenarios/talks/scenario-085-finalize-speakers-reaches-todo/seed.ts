import {
  createAssignment,
  createConductingRotation,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// FINALIZE SPEAKERS AND THEY REACH TO DO — ITER-036 (plans/sacrament-finalize-hands-off-asks.md)
// ---------------------------------------------------------------------------
// The exact path the user expected and found broken: topics and speakers chosen, References NOT
// decided (D5), and nothing on To Do until somebody FINALIZES the speakers.
//
//   A  the first ordinary Sunday at least a week out — conducted by the 1st counselor (Peter
//      Nakamura). Three talks:
//        slot 1  Maria Lopez          member with a phone
//        slot 2  Tomas Reyes          member with no phone
//        slot 3  Brother Kent Walker  a VISITOR
//   B  the next ordinary Sunday — conducted by the 2nd counselor (David Okafor). Two talks:
//        slot 1  Ana Silva, slot 2  Rosa Diaz
//   Lucas Moreno speaks nowhere: he replaces whichever speaker the walker scheduled.
//
// NOTHING IS FINALIZED AND NO ASKS ARE SEEDED. Finalizing is what the walk exercises; a seeded
// stamp or to-do would skip the one route this scenario exists for.
//
// RELATIVE TO TODAY (scenario 073's lesson), with a whole calendar from this month through the
// month after next — every Sunday, first Sundays pinned Fast Sundays (scenario 079's lesson).

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function sundayOnOrBefore(today: Date): string {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
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
const THIS_SUNDAY = sundayOnOrBefore(new Date());
const LAST_MONTH = monthAfter(monthAfter(TODAY.slice(0, 7)));
const FIRST_SUNDAY_OF_MONTH = (() => {
  let date = THIS_SUNDAY;
  while (!isFirstSundayOfMonth(date)) date = addDays(date, -7);
  return date;
})();
const CALENDAR = Array.from({ length: 15 }, (_, week) =>
  addDays(FIRST_SUNDAY_OF_MONTH, week * 7),
).filter((date) => date.slice(0, 7) <= LAST_MONTH);

const ORDINARY_AHEAD = CALENDAR.filter(
  (date) => date >= addDays(THIS_SUNDAY, 7) && !isFirstSundayOfMonth(date),
);
export const SUNDAY_A = ORDINARY_AHEAD[0] as string;
export const SUNDAY_B = ORDINARY_AHEAD[1] as string;

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

  await createConductingRotation({
    effectiveFrom: CALENDAR[0],
    userIds: [counselor1.id, counselor2.id, bishop.id],
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
  const ana = await member("Ana", "Silva", "801-555-0188");
  const rosa = await member("Rosa", "Diaz", "801-555-0177");
  await member("Lucas", "Moreno", "801-555-0166");

  const sundayIds = new Map<string, string>();
  for (const date of CALENDAR) {
    const fast = isFirstSundayOfMonth(date);
    const conductor =
      date === SUNDAY_A ? counselor1.id : date === SUNDAY_B ? counselor2.id : undefined;
    sundayIds.set(
      date,
      await createSunday({
        date,
        type: fast ? "fast_sunday" : "standard",
        speakingSlots: fast ? 0 : date === SUNDAY_B ? 2 : 3,
        fastSundayPinned: fast,
        ...(conductor === undefined ? {} : { conductingUserId: conductor }),
      }),
    );
  }
  const sundayA = sundayIds.get(SUNDAY_A) as string;
  const sundayB = sundayIds.get(SUNDAY_B) as string;

  // --- A — References deliberately NOT decided (D5) -------------------------------------------
  await createAssignment({
    sundayId: sundayA,
    slotNumber: 1,
    memberId: maria,
    topicTitle: "Faith in Jesus Christ",
    pipelineStage: "plan",
    plannedBy: counselor1.id,
  });
  await createAssignment({
    sundayId: sundayA,
    slotNumber: 2,
    memberId: tomas,
    topicTitle: "The Power of Covenants",
    pipelineStage: "plan",
    plannedBy: counselor1.id,
  });
  await createAssignment({
    sundayId: sundayA,
    slotNumber: 3,
    externalSpeakerName: "Brother Kent Walker",
    topicTitle: "Gratitude",
    pipelineStage: "plan",
    plannedBy: counselor1.id,
  });

  // --- B -----------------------------------------------------------------------------------------
  await createAssignment({
    sundayId: sundayB,
    slotNumber: 1,
    memberId: ana,
    topicTitle: "Ministering",
    pipelineStage: "plan",
    plannedBy: counselor2.id,
  });
  await createAssignment({
    sundayId: sundayB,
    slotNumber: 2,
    memberId: rosa,
    topicTitle: "The Sabbath",
    pipelineStage: "plan",
    plannedBy: counselor2.id,
  });

  console.log(
    "  ward (America/Denver), 3 users (bishop Mark Andersen, counselor1 Peter Nakamura, " +
      "counselor2 David Okafor), 5 members, a whole calendar, and two Sundays:\n" +
      `  A ${SUNDAY_A} — Peter conducts; Maria Lopez, Tomas Reyes, visitor Brother Kent Walker; ` +
      "References NOT decided.\n" +
      `  B ${SUNDAY_B} — David conducts; Ana Silva, Rosa Diaz.\n` +
      "  Lucas Moreno speaks nowhere. Nothing finalized, no asks seeded.",
  );
}
