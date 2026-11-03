import {
  createHousehold,
  createHouseholdVisitCadence,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  createVisitOrgSharing,
  createVisitPrivateNote,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// ITER-055 slice bv1: EACH ORGANIZATION'S VISITS ARE ITS OWN UNTIL THE BISHOPRIC SHARES THEM.
//
// The state this needs cannot be made by hand: visits from three organizations, one of them the
// BISHOPRIC (stored with no organization, exactly as the app writes it), private notes on each, and
// the day-one grants migration 099 gives a ward whose old switch was on — every organization
// shares with every other, EXCEPT the Bishopric, which shares with nobody.
//
// The ward switch is left ON on purpose. It no longer reaches visits, and the walk proves that:
// the Elders Quorum president sees the Relief Society's visits because of a GRANT, and does not
// see the Bishopric's even though the switch is on.

const HOUSEHOLD_IDS = {
  ashby: "40990001-0000-4000-8000-000000000001",
  brennan: "40990001-0000-4000-8000-000000000002",
  castillo: "40990001-0000-4000-8000-000000000003",
  dawson: "40990001-0000-4000-8000-000000000004",
  ellery: "40990001-0000-4000-8000-000000000005",
  fontaine: "40990001-0000-4000-8000-000000000006",
} as const;

type HouseholdKey = keyof typeof HOUSEHOLD_IDS;

const FAMILY_NAMES: Record<HouseholdKey, string> = {
  ashby: "Ashby",
  brennan: "Brennan",
  castillo: "Castillo",
  dawson: "Dawson",
  ellery: "Ellery",
  fontaine: "Fontaine",
};

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward", crossOrgVisibility: true });
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "counselor1",
    role: "counselor",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });

  const eqPresident = await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const rsPresident = await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ruth",
    lastName: "Delacroix",
  });

  for (const [index, key] of (Object.keys(HOUSEHOLD_IDS) as HouseholdKey[]).entries()) {
    await createHousehold({
      id: HOUSEHOLD_IDS[key],
      familyName: FAMILY_NAMES[key],
      address: `${300 + index} Ridgeview Drive`,
    });
    await createMember({
      firstName: "Adult",
      lastName: FAMILY_NAMES[key],
      householdId: HOUSEHOLD_IDS[key],
      category: "adult",
    });
  }

  // Two BISHOPRIC visits, stored with no organization.
  const bishopricVisits = [
    { key: "ashby", date: "2026-10-04", note: "Bishopric: talked about the new baby." },
    { key: "brennan", date: "2026-10-11", note: "Bishopric: helped plan a ward service project." },
  ] as const;
  for (const visit of bishopricVisits) {
    const id = await createVisitLog({
      org: "bishopric",
      bishopricWithNoOrg: true,
      householdId: HOUSEHOLD_IDS[visit.key],
      recordedBy: bishop.id,
      visitDate: visit.date,
      sharedNotes: visit.note,
    });
    await createVisitPrivateNote({
      visitLogId: id,
      userId: bishop.id,
      notes: "BISHOP PRIVATE — must never appear for anybody else.",
    });
  }

  const eqVisits = [
    { key: "castillo", date: "2026-10-05", note: "EQ: fixed the fence together." },
    { key: "dawson", date: "2026-10-12", note: "EQ: brought the sacrament to the home." },
  ] as const;
  for (const visit of eqVisits) {
    const id = await createVisitLog({
      org: "eldersQuorum",
      householdId: HOUSEHOLD_IDS[visit.key],
      recordedBy: eqPresident.id,
      visitDate: visit.date,
      sharedNotes: visit.note,
    });
    await createVisitPrivateNote({
      visitLogId: id,
      userId: eqPresident.id,
      notes: "EQ PRIVATE — must never appear for anybody else.",
    });
  }

  const rsVisits = [
    { key: "ellery", date: "2026-10-06", note: "RS: dropped off a meal." },
    { key: "fontaine", date: "2026-10-13", note: "RS: sister is settling in well." },
  ] as const;
  for (const visit of rsVisits) {
    const id = await createVisitLog({
      org: "reliefSociety",
      householdId: HOUSEHOLD_IDS[visit.key],
      recordedBy: rsPresident.id,
      visitDate: visit.date,
      sharedNotes: visit.note,
    });
    await createVisitPrivateNote({
      visitLogId: id,
      userId: rsPresident.id,
      notes: "RS PRIVATE — must never appear for anybody else.",
    });
  }

  // bv2 (the re-skin) is walked on this data, so the household cards need bands to show: a goal
  // for each of the two organizations, one household on its own cadence, and one knock nobody
  // answered.
  await createVisitGoal({
    org: "eldersQuorum",
    title: "Every household twice a year",
    cadenceAmount: 6,
    cadenceUnit: "month",
    noticeAmount: 1,
    noticeUnit: "month",
    createdBy: eqPresident.id,
  });
  await createVisitGoal({
    org: "reliefSociety",
    title: "Every household once a year",
    createdBy: rsPresident.id,
  });
  await createHouseholdVisitCadence({
    householdId: HOUSEHOLD_IDS.castillo,
    org: "eldersQuorum",
    cadenceAmount: 3,
    cadenceUnit: "month",
    createdBy: eqPresident.id,
  });
  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.ellery,
    recordedBy: eqPresident.id,
    visitDate: "2026-10-20",
    outcome: "attempted",
  });

  // The day-one grants for a ward whose switch was on: every organization with every other,
  // the Bishopric left out on both sides. Only the two that have visits are needed here.
  await createVisitOrgSharing({ owner: "eldersQuorum", viewer: "reliefSociety" });
  await createVisitOrgSharing({ owner: "reliefSociety", viewer: "eldersQuorum" });
}
