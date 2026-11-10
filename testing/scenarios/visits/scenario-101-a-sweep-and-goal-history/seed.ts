import {
  createHousehold,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  ensureTestWard,
  seedNotificationTriggers,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// ITER-055 slice bv4: A SWEEP, PARTLY REACHED, AND GOAL HISTORY.
//
// The state this needs cannot be made by hand: a Bishopric sweep already a month in, with
// households in every position — done, partly reached for two different reasons, an attempt, and
// a done visit dated BEFORE the sweep started — plus an earlier goal that was set aside, so Past
// goals has something to show.
//
// DATES ARE RELATIVE TO THE DAY OF SEEDING, so the sweep is always "started 30 days ago":
//   ended cadence goal: started 200 days ago, set aside 40 days ago
//   active sweep:       started 30 days ago
//   Ivers' done visit:  45 days ago — before the sweep, inside the ended goal
//
// Bishopric visits are stored with no organization (ITER-055 P1), which is what the Bishopric's
// progress now reads. Addresses sit on three streets plus one blank, for bv8's street grouping.

const DAY_MS = 86_400_000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

const HOUSEHOLDS = [
  { key: "abbott", familyName: "Abbott", address: "11 Maple Street" },
  { key: "brooks", familyName: "Brooks", address: "15 Maple St" },
  { key: "carver", familyName: "Carver", address: "22 Maple Street Apt 3" },
  { key: "dalton", familyName: "Dalton", address: "4 Ridge Road" },
  { key: "ellis", familyName: "Ellis", address: "8 Ridge Rd" },
  { key: "foster", familyName: "Foster", address: "12 Ridge Road" },
  { key: "garcia", familyName: "Garcia", address: "301 Cedar Lane" },
  { key: "hughes", familyName: "Hughes", address: "305 Cedar Ln" },
  { key: "ivers", familyName: "Ivers", address: "309 Cedar Lane" },
  { key: "jensen", familyName: "Jensen", address: "" },
] as const;

type HouseholdKey = (typeof HOUSEHOLDS)[number]["key"];

const householdId = (key: HouseholdKey): string => testUuid(`scenario-101:household:${key}`);

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "counselor-1",
    role: "counselor",
    counselorPosition: 1,
    firstName: "Aaron",
    lastName: "Pike",
  });

  for (const household of HOUSEHOLDS) {
    await createHousehold({
      id: householdId(household.key),
      familyName: household.familyName,
      address: household.address === "" ? undefined : household.address,
    });
    await createMember({
      firstName: "Pat",
      lastName: household.familyName,
      householdId: householdId(household.key),
      category: "adult",
    });
  }

  await createVisitGoal({
    org: "bishopric",
    title: "Every household every year",
    kind: "cadence",
    cadenceAmount: 1,
    cadenceUnit: "year",
    startedOn: daysAgo(200),
    endedAt: new Date(Date.now() - 40 * DAY_MS).toISOString(),
    endReason: "set_aside",
    createdBy: bishop.id,
  });

  await createVisitGoal({
    org: "bishopric",
    title: "See every family by spring",
    kind: "sweep",
    startedOn: daysAgo(30),
    createdBy: bishop.id,
  });

  const visit = async (
    key: HouseholdKey,
    days: number,
    extra: Partial<Parameters<typeof createVisitLog>[0]> = {},
  ) =>
    createVisitLog({
      id: testUuid(`scenario-101:visit:${key}:${days}:${extra.outcome ?? "completed"}`),
      org: "bishopric",
      bishopricWithNoOrg: true,
      householdId: householdId(key),
      recordedBy: bishop.id,
      visitDate: daysAgo(days),
      ...extra,
    });

  // Four done in the sweep.
  await visit("abbott", 25, { sharedNotes: "Bishopric: a good visit with the whole family." });
  await visit("brooks", 20);
  await visit("carver", 15);
  await visit("dalton", 10);

  // Abbott again, later, partly reached — Abbott stays DONE for this sweep (decided at bv4 start).
  await visit("abbott", 5, { needsAnotherReason: "asked_to_return" });

  // Two partly reached.
  await visit("ellis", 12, { needsAnotherReason: "spouse_absent" });
  await visit("foster", 8, { needsAnotherReason: "not_home" });

  // An attempt reaches nobody.
  await visit("garcia", 6, { outcome: "attempted" });

  // Done BEFORE the sweep started: not yet, for this sweep.
  await visit("ivers", 45);

  // Hughes and Jensen: nothing at all.
}
