import {
  createConductingRotation,
  createHousehold,
  createMember,
  createPrayerAssignment,
  createSunday,
  createTestUser,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// FINALIZE PRAYERS — ITER-036 fb (plans/sacrament-finalize-hands-off-asks.md)
// ---------------------------------------------------------------------------
// Prayer asks are new end to end. One Sunday with both prayers chosen and nothing asked, conducted
// by the 1st counselor, so the bishop finalizing it sends the asks to somebody else's To Do.
//
//   A  the first ordinary Sunday at least a week out — conducted by Peter Nakamura.
//        invocation   Maria Lopez (phone)   stage assign
//        benediction  Tomas Reyes (no phone) stage assign
//   Ana Silva prays nowhere: she replaces whoever declines.
//
// NOTHING IS FINALIZED AND NO ASKS ARE SEEDED. Finalizing is what the walk exercises.
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
  await member("Ana", "Silva", "801-555-0188");

  const sundayIds = new Map<string, string>();
  for (const date of CALENDAR) {
    const fast = isFirstSundayOfMonth(date);
    sundayIds.set(
      date,
      await createSunday({
        date,
        type: fast ? "fast_sunday" : "standard",
        speakingSlots: fast ? 0 : 3,
        fastSundayPinned: fast,
        ...(date === SUNDAY_A ? { conductingUserId: counselor1.id } : {}),
      }),
    );
  }
  const sundayA = sundayIds.get(SUNDAY_A) as string;

  await createPrayerAssignment({ sundayId: sundayA, prayerType: "invocation", memberId: maria });
  await createPrayerAssignment({ sundayId: sundayA, prayerType: "benediction", memberId: tomas });

  console.log(
    "  ward (America/Denver), 3 users (bishop Mark Andersen, counselor1 Peter Nakamura, " +
      "counselor2 David Okafor), 3 members, a whole calendar, and one Sunday:\n" +
      `  A ${SUNDAY_A} — Peter conducts; invocation Maria Lopez, benediction Tomas Reyes, both ` +
      "at Assigned.\n  Ana Silva prays nowhere. Nothing finalized, no asks seeded.",
  );
}
