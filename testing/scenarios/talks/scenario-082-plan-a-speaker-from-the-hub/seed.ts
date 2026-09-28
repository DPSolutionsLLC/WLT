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
// ONE SUNDAY WITH ONE TALK PLANNED AND TWO SLOTS OPEN, AND A MONTH NOBODY HAS CREATED
// ---------------------------------------------------------------------------
// Every Sunday from the first of this month through the end of NEXT month, each month's first
// Sunday a PINNED Fast Sunday (scenario 079's lesson: a partial calendar moves Fast Sunday). The
// month after next has NO Sundays at all — that is the month the hub must now create, and only for
// somebody holding `calendar.manage`.
//
//   A  the first ordinary Sunday at least a week out. Three speaking slots:
//        slot 1  Maria Lopez   planned
//        slot 2  open          the walker plans Ana Silva here, starting from the hub
//        slot 3  open
//
// `music` is a music_coordinator: holds talks.view, not calendar.manage, so opening the empty month
// FIRST must leave it empty.
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
const THIS_MONTH = TODAY.slice(0, 7);
const NEXT_MONTH = monthAfter(THIS_MONTH);
export const EMPTY_MONTH = monthAfter(NEXT_MONTH);

const THIS_SUNDAY = sundayOnOrBefore(new Date());
const FIRST_SUNDAY_OF_MONTH = (() => {
  let date = THIS_SUNDAY;
  while (!isFirstSundayOfMonth(date)) date = addDays(date, -7);
  return date;
})();
const ALL_SUNDAYS = Array.from({ length: 12 }, (_, week) =>
  addDays(FIRST_SUNDAY_OF_MONTH, week * 7),
).filter((date) => date.slice(0, 7) <= NEXT_MONTH);

const [SUNDAY_A] = ALL_SUNDAYS.filter(
  (date) => date >= addDays(THIS_SUNDAY, 7) && !isFirstSundayOfMonth(date),
);

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
  await member("Ana", "Silva");

  const faith = await createTopic({ title: "Faith in Jesus Christ" });
  await createTopic({ title: "The Power of Covenants" });

  let sundayA = "";
  for (const date of ALL_SUNDAYS) {
    const fast = isFirstSundayOfMonth(date);
    const id = await createSunday({
      date,
      type: fast ? "fast_sunday" : "standard",
      speakingSlots: fast ? 0 : 3,
      fastSundayPinned: fast,
    });
    if (date === SUNDAY_A) sundayA = id;
  }

  await createAssignment({
    sundayId: sundayA,
    slotNumber: 1,
    memberId: maria,
    topicId: faith,
    pipelineStage: "plan",
    plannedBy: counselor1.id,
  });

  console.log(
    `  ward, 4 users (bishop, counselor1, counselor2, music), every Sunday ${ALL_SUNDAYS[0]} to ` +
      `${ALL_SUNDAYS[ALL_SUNDAYS.length - 1]}.\n` +
      `  A ${SUNDAY_A}: slot 1 Maria Lopez, slots 2 and 3 open.\n` +
      `  ${EMPTY_MONTH} has NO Sundays — the hub must create them for counselor1, not for music.`,
  );
}
