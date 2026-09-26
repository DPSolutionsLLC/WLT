import {
  createAssignment,
  createConductingRotation,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  createTopic,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// ONE SUNDAY WITH THREE ASKED SPEAKERS, ON A GENERATED-LOOKING CALENDAR
// ---------------------------------------------------------------------------
// Every Sunday from the first of this month through ten weeks out, each month's first Sunday a
// PINNED Fast Sunday, so no save can move Fast Sunday onto A (the defect walking scenario 079
// found). A weekly rotation counselor1 → counselor2 → bishop starts on A, so when A holds a
// meeting again the rotation gives it its conductor back.
//
//   A  the first ordinary Sunday at least a week out. counselor1 conducts. References SKIPPED,
//      three speaking slots:
//        slot 1  Maria Lopez           member with a phone
//        slot 2  Ana Silva             member with a phone — the walker has her ACCEPT
//        slot 3  Brother Kent Walker   a VISITOR
//
// NO ASKS ARE SEEDED. The walker sends them and records Ana's acceptance, so every to-do the walk
// sees came through the app.
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

const THIS_SUNDAY = sundayOnOrBefore(new Date());
const FIRST_SUNDAY_OF_MONTH = (() => {
  let date = THIS_SUNDAY;
  while (!isFirstSundayOfMonth(date)) date = addDays(date, -7);
  return date;
})();
const ALL_SUNDAYS = Array.from({ length: 16 }, (_, week) =>
  addDays(FIRST_SUNDAY_OF_MONTH, week * 7),
).filter((date) => date <= addDays(THIS_SUNDAY, 70));

const ORDINARY_AHEAD = ALL_SUNDAYS.filter(
  (date) => date >= addDays(THIS_SUNDAY, 7) && !isFirstSundayOfMonth(date),
);
const [SUNDAY_A] = ORDINARY_AHEAD;

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

  const counselor2 = await createTestUser({
    handle: "counselor2",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 2,
    firstName: "David",
    lastName: "Okafor",
  });

  const rotation = [counselor1, counselor2, bishop];
  await createConductingRotation({
    effectiveFrom: SUNDAY_A,
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
  const ana = await member("Ana", "Silva", "801-555-0188");

  const faith = await createTopic({ title: "Faith in Jesus Christ" });
  const covenants = await createTopic({ title: "The Power of Covenants" });
  const gratitude = await createTopic({ title: "Gratitude" });

  // Every Sunday holds a sacrament meeting, Fast Sundays included, so each one from A on takes
  // the next position in the rotation.
  const sundayIds = new Map<string, string>();
  let position = 0;
  for (const date of ALL_SUNDAYS) {
    const conductor = date >= SUNDAY_A ? rotation[position++ % rotation.length] : null;
    const fast = isFirstSundayOfMonth(date);
    sundayIds.set(
      date,
      await createSunday({
        date,
        type: fast ? "fast_sunday" : "standard",
        speakingSlots: fast ? 0 : 3,
        fastSundayPinned: fast,
        conductingUserId: conductor?.id,
        referencesSkippedAt: date === SUNDAY_A ? REFERENCES_SKIPPED_AT : undefined,
      }),
    );
  }

  const talk = async (
    slotNumber: number,
    speaker: { memberId: string } | { externalSpeakerName: string },
    topicId: string,
  ) =>
    createAssignment({
      sundayId: sundayIds.get(SUNDAY_A)!,
      slotNumber,
      ...speaker,
      topicId,
      pipelineStage: "plan",
      plannedBy: counselor1.id,
    });
  await talk(1, { memberId: maria }, faith);
  await talk(2, { memberId: ana }, covenants);
  await talk(3, { externalSpeakerName: "Brother Kent Walker" }, gratitude);

  console.log(
    `  ward, 3 users (bishop, counselor1, counselor2), a weekly rotation from A, every Sunday ` +
      `${ALL_SUNDAYS[0]} to ${ALL_SUNDAYS[ALL_SUNDAYS.length - 1]}.
` +
      `  A ${SUNDAY_A}: counselor1 conducts. Maria Lopez, Ana Silva and visitor Brother Kent ` +
      `Walker. No asks seeded.`,
  );
}
