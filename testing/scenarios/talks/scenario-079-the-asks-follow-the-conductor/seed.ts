import {
  createAssignment,
  createConductingRotation,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  createTopic,
  ensureTestWard,
  type TestUser,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// A GENERATED-LOOKING CALENDAR: EVERY SUNDAY, EACH MONTH'S FIRST ONE ITS FAST SUNDAY
// ---------------------------------------------------------------------------
// Every Sunday from the first of this month through ten weeks out, like a generated calendar.
// The first Sunday of each month is its Fast Sunday, PINNED. A month with missing Sunday rows is
// NOT a harmless shortcut: the first walk of this scenario seeded only four Sundays, and saving
// A in the Sunday editor moved September's Fast Sunday onto A — the month resolution picks the
// first Sunday that EXISTS — and silently zeroed its speaking slots.
//
// A weekly rotation counselor1 → counselor2 → bishop starts on A, and every stored conductor
// from A on MATCHES it, so the only thing that moves a conductor is the walker.
//
//   A  the first ordinary (non-fast) Sunday at least a week out. References SKIPPED, two talks:
//        slot 1  Maria Lopez           member WITH a phone
//        slot 2  Brother Kent Walker   a VISITOR
//   B  the next ordinary Sunday after A, no talks. The walker makes it a stake conference, which
//      re-shifts who conducts on every later Sunday.
//   C  the next ordinary Sunday after B. References SKIPPED, one talk: Tomas Reyes, no phone.
//
// The seed PRINTS the dates and who conducts C before and after the re-shift.
//
// NO ASKS ARE SEEDED. The walker sends them, so the asks being handed over are real ones.
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
const [SUNDAY_A, SUNDAY_B, SUNDAY_C] = ORDINARY_AHEAD;

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
  const tomas = await member("Tomas", "Reyes");

  const faith = await createTopic({ title: "Faith in Jesus Christ" });
  const gratitude = await createTopic({ title: "Gratitude" });

  // Every Sunday holds a sacrament meeting, Fast Sundays included, so each one from A on takes
  // the next position in the rotation.
  const sundayIds = new Map<string, string>();
  const conductorOn = new Map<string, TestUser | null>();
  let position = 0;
  for (const date of ALL_SUNDAYS) {
    const conductor = date >= SUNDAY_A ? rotation[position++ % rotation.length] : null;
    conductorOn.set(date, conductor);
    const fast = isFirstSundayOfMonth(date);
    sundayIds.set(
      date,
      await createSunday({
        date,
        type: fast ? "fast_sunday" : "standard",
        speakingSlots: fast ? 0 : 2,
        fastSundayPinned: fast,
        conductingUserId: conductor?.id,
        referencesSkippedAt:
          date === SUNDAY_A || date === SUNDAY_C ? REFERENCES_SKIPPED_AT : undefined,
      }),
    );
  }

  await createAssignment({
    sundayId: sundayIds.get(SUNDAY_A)!,
    slotNumber: 1,
    memberId: maria,
    topicId: faith,
    pipelineStage: "plan",
    plannedBy: counselor1.id,
  });
  await createAssignment({
    sundayId: sundayIds.get(SUNDAY_A)!,
    slotNumber: 2,
    externalSpeakerName: "Brother Kent Walker",
    topicId: gratitude,
    pipelineStage: "plan",
    plannedBy: counselor1.id,
  });
  await createAssignment({
    sundayId: sundayIds.get(SUNDAY_C)!,
    slotNumber: 1,
    memberId: tomas,
    topicId: faith,
    pipelineStage: "plan",
    plannedBy: bishop.id,
  });

  // With B no longer holding a meeting, C takes the position B had.
  const names = new Map([
    [bishop.id, "Mark Andersen (bishop)"],
    [counselor1.id, "Peter Nakamura (counselor1)"],
    [counselor2.id, "David Okafor (counselor2)"],
  ]);
  const nameOf = (user: TestUser | null | undefined) =>
    user ? (names.get(user.id) ?? user.handle) : "nobody";

  console.log(
    `  ward, 3 users, a weekly rotation counselor1 → counselor2 → bishop from A, every Sunday ` +
      `${ALL_SUNDAYS[0]} → ${ALL_SUNDAYS[ALL_SUNDAYS.length - 1]} (first of each month a pinned ` +
      `Fast Sunday).
` +
      `  A ${SUNDAY_A}: ${nameOf(conductorOn.get(SUNDAY_A))} conducts — Maria Lopez + visitor.
` +
      `  B ${SUNDAY_B}: ${nameOf(conductorOn.get(SUNDAY_B))} conducts — no talks; make it a stake conference.
` +
      `  C ${SUNDAY_C}: ${nameOf(conductorOn.get(SUNDAY_C))} conducts — Tomas Reyes. After B's change: ` +
      `${nameOf(conductorOn.get(SUNDAY_B))}.
  No asks seeded.`,
  );
}
