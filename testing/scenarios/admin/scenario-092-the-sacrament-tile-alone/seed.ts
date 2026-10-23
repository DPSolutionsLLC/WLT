import {
  TEST_WARD_ID,
  createAssignment,
  createConductingRotation,
  createHymnSelection,
  createProgram,
  createSunday,
  createTestUser,
  createUnitAssignment,
  ensureTestUnits,
  ensureTestWard,
  seedNotificationTriggers,
  setReleasedModules,
} from "../../../infrastructure/seedUtils.ts";

// THE SACRAMENT TILE ALONE (ITER-044, migration 092).
//
// Buffalo Ward's real list after this ships: Sacrament meeting and Tithing, nothing else. Topic
// history, Program, Music and Calendar used to ride on Sacrament meeting and are now separate.
//
// THE PROGRAMME, THE HYMN AND THE ROTATION ARE THE EVIDENCE. A refused read is an empty result,
// and an empty result is also what a ward with no data shows, so each exists: the bishop's client
// reads no programme and no rotation (refused), but does read the hymn (the music tables are
// shared with Sacrament), and the super admin reads all three.
//
// A WHOLE CALENDAR IS SEEDED. The hub generates Sundays only under `calendar.manage`, which this
// ward refuses, so without seeded Sundays the hub would be empty for a reason that is not the one
// under test. Relative to today: this month and next, first Sundays pinned Fast Sundays.

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function isFirstSundayOfMonth(date: string): boolean {
  return Number(date.slice(8, 10)) <= 7;
}

function firstSundayOfMonth(today: Date): string {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  date.setUTCDate(date.getUTCDate() + ((7 - date.getUTCDay()) % 7));
  return date.toISOString().slice(0, 10);
}

const FIRST_SUNDAY = firstSundayOfMonth(new Date());
const THIS_MONTH = FIRST_SUNDAY.slice(0, 7);
const CALENDAR = Array.from({ length: 10 }, (_, week) => addDays(FIRST_SUNDAY, week * 7)).filter(
  (date) => {
    const month = date.slice(0, 7);
    return month === THIS_MONTH || month === addDays(`${THIS_MONTH}-28`, 7).slice(0, 7);
  },
);

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  // A stake above the ward, so Stakes & Wards shows the ward's card and its release editor.
  await ensureTestUnits();
  await seedNotificationTriggers();
  await setReleasedModules(TEST_WARD_ID, ["sacrament", "tithing"]);

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // The user's own shape: an ordinary bishopric calling plus app-wide super admin authority.
  const admin = await createTestUser({
    handle: "admin",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Dana",
    lastName: "Whitmore",
  });
  await createUnitAssignment({ userId: admin.id, role: "super_admin", unitId: null });

  await createConductingRotation({
    effectiveFrom: CALENDAR[0],
    userIds: [admin.id, null, bishop.id],
  });

  const ordinary: string[] = [];
  for (const date of CALENDAR) {
    const fast = isFirstSundayOfMonth(date);
    const sundayId = await createSunday({
      date,
      type: fast ? "fast_sunday" : "standard",
      speakingSlots: fast ? 0 : 3,
      fastSundayPinned: fast,
    });
    if (!fast) ordinary.push(sundayId);
  }

  for (const [index, sundayId] of ordinary.slice(0, 3).entries()) {
    await createAssignment({
      sundayId,
      slotNumber: 1,
      externalSpeakerName: ["Ruth Hallam", "Owen Pryce", "Lena Moss"][index],
      topicTitle: ["Gratitude", "The Sabbath", "Ministering"][index],
    });
  }

  await createProgram({ sundayId: ordinary[0], createdBy: bishop.id });
  await createHymnSelection({
    sundayId: ordinary[0],
    hymnType: "opening",
    hymnNumber: 2,
    hymnTitle: "The Spirit of God",
  });
}
