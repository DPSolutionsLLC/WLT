import { agendaTemplate } from "../../../../lib/agendas/sections.ts";
import {
  createAgenda,
  createHousehold,
  createMember,
  createTestUser,
  createVisitLog,
  ensureTestWard,
  seedNotificationTriggers,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// ITER-055 slice bv7: FOLLOW-UPS AND "DISCUSS IN BISHOPRIC MEETING".
//
// Three recorded visits the bishopric can see:
//   Ellis  — a Bishopric visit with a shared report, nothing asked yet. The walk adds a follow-up and
//            asks to discuss it.
//   Foster — an Elders Quorum visit (the bishopric reads every organization's visits), nothing asked.
//   Garcia — a Bishopric visit ALREADY DISCUSSED: asked for, and stamped by a bishopric agenda
//            published ten days ago, so the card reads "Discussed" and offers "Discuss again".
//
// Two DRAFT agendas, both dated six days from now: a bishopric meeting and a ward council. Asking to
// discuss Ellis must put one line on the first and nothing on the second.
//
// DATES ARE RELATIVE TO THE DAY OF SEEDING.

const DAY_MS = 86_400_000;

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

const HOUSEHOLDS = [
  { key: "ellis", familyName: "Ellis" },
  { key: "foster", familyName: "Foster" },
  { key: "garcia", familyName: "Garcia" },
] as const;

type HouseholdKey = (typeof HOUSEHOLDS)[number]["key"];

const householdId = (key: HouseholdKey): string => testUuid(`scenario-106:household:${key}`);

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

  await createTestUser({
    handle: "counselor-2",
    role: "counselor",
    counselorPosition: 2,
    firstName: "Lena",
    lastName: "Ortiz",
  });

  await createTestUser({
    handle: "exec-secretary",
    role: "executive_secretary",
    firstName: "Sam",
    lastName: "Lee",
  });

  const eqPresident = await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tom",
    lastName: "Reyes",
  });

  for (const household of HOUSEHOLDS) {
    await createHousehold({ id: householdId(household.key), familyName: household.familyName });
    await createMember({
      firstName: "Pat",
      lastName: household.familyName,
      householdId: householdId(household.key),
      category: "adult",
      phone: "555-0100",
    });
  }

  await createVisitLog({
    id: testUuid("scenario-106:visit:ellis"),
    org: "bishopric",
    bishopricWithNoOrg: true,
    householdId: householdId("ellis"),
    recordedBy: bishop.id,
    visitDate: daysFromNow(-3),
    sharedNotes: "Brother Ellis is between jobs and asked about the youth temple trip.",
  });

  await createVisitLog({
    id: testUuid("scenario-106:visit:foster"),
    org: "eldersQuorum",
    householdId: householdId("foster"),
    recordedBy: eqPresident.id,
    visitDate: daysFromNow(-2),
    sharedNotes: "The Fosters would like help moving next month.",
  });

  await createVisitLog({
    id: testUuid("scenario-106:visit:garcia"),
    org: "bishopric",
    bishopricWithNoOrg: true,
    householdId: householdId("garcia"),
    recordedBy: bishop.id,
    visitDate: daysFromNow(-14),
    sharedNotes: "Sister Garcia asked for a blessing before her surgery.",
    discussInBishopric: true,
    bishopricDiscussedAt: new Date(Date.now() - 10 * DAY_MS).toISOString(),
  });

  await createAgenda({
    id: testUuid("scenario-106:agenda:bishopric"),
    meetingType: "bishopric",
    meetingDate: daysFromNow(6),
    sections: agendaTemplate(),
  });

  await createAgenda({
    id: testUuid("scenario-106:agenda:ward-council"),
    meetingType: "ward_council",
    meetingDate: daysFromNow(6),
    sections: agendaTemplate(),
  });
}
