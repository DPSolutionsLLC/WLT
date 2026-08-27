import {
  addMemberToOrganization,
  createHousehold,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE THIS SEEDS IS A NUMBER THAT IS CURRENTLY ABSURD.
//
// The Primary is never going to visit twenty-four households; it will visit the eight families
// with a child in Primary. Today its dashboard reads "3 of 22" and will read that for ever, which
// is the bug ITER-019 exists to fix — and it is only absurd at SCALE. Two households would not
// demonstrate it, and twenty-four cannot be arranged by hand.
//
// ---------------------------------------------------------------------------------------------
// THE TWO DO-NOT-CONTACT HOUSEHOLDS ARE THE POINT OF THE FIXTURE, NOT DECORATION
// ---------------------------------------------------------------------------------------------
// One is INSIDE the Primary's implied set and one is OUTSIDE it, and that pairing is what makes
// the contrast visible on one screen:
//
//   Halvorsen  — Primary child, do-not-contact  -> SHOWN on the Primary's board, MARKED, counted
//                                                  in nothing. It stays.
//   Sorensen   — no Primary child, do-not-contact -> GONE from the Primary's board entirely, for
//                                                  a completely different reason.
//
// A household that is set aside and a household that was never ours look different on purpose,
// because they are different questions. Collapsing them loses information the presidency needs,
// and having both on screen at once is the only way to see that they did not get collapsed.
//
// ---------------------------------------------------------------------------------------------
// THE ELDERS QUORUM NARROWS NOTHING, AND THAT IS AN ASSERTION
// ---------------------------------------------------------------------------------------------
// It has a goal and no stewardship rows, so it is measured against every visitable household —
// exactly as it was before this slice shipped. Success criterion 2 is "the Elders Quorum's
// dashboard is unchanged on ship day", and the only way to see that is to have an organization
// on the same screen that did not narrow.
//
// ---------------------------------------------------------------------------------------------
// WHY THE DATES ARE RELATIVE AND NOT PINNED
// ---------------------------------------------------------------------------------------------
// A priority band is a WINDOW, not a threshold, so a household pinned into "approaching" today
// walks out of it in two months and the fixture quietly stops demonstrating what it was written
// for. Every date is derived from ONE `TODAY`, read once at seed time.
//
// ---------------------------------------------------------------------------------------------
// EXPLICIT HOUSEHOLD IDS
// ---------------------------------------------------------------------------------------------
// createHousehold keys its id on the family name plus address, so two households sharing both
// collide on the primary key (plans/retros/seed-household-id-collision.md). Every id is passed
// explicitly here because twenty-four of them is exactly where a derived collision would hide.

const MS_PER_DAY = 86_400_000;

const TODAY = new Date();

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// UTC milliseconds, never setDate() — a local-time write is how a fixture lands a day off for
// anybody west of UTC (lib/calendar/dates.ts opens on that bug).
function daysAgo(days: number): string {
  return dateOnly(new Date(TODAY.getTime() - days * MS_PER_DAY));
}

// THE PRIMARY'S GOAL is every 6 months, warning 1 month ahead:
//   due        = lastVisit + 6 months  (~182 days)
//   warns from = due - 1 month         (~30 days before due, so from about day 152)
const VISITED_RECENTLY = daysAgo(20); //    11% of the interval -> On track
const VISITED_INSIDE_NOTICE = daysAgo(160); // 88%, past day 152 -> Approaching
const VISITED_LONG_AGO = daysAgo(260); //   143%                 -> Overdue

const HOUSEHOLD_ID_PREFIX = "40470001-0000-4000-8000-0000000000";

function householdId(index: number): string {
  return `${HOUSEHOLD_ID_PREFIX}${String(index).padStart(2, "0")}`;
}

// THE EIGHT WITH A PRIMARY CHILD. Indices 1-8, so the derivation the app computes has an obvious
// counterpart here that a tester can check against the screen.
const PRIMARY_FAMILY_NAMES = [
  "Brooks",
  "Okonkwo",
  "Halvorsen",
  "Ferreira",
  "Nakamura",
  "Whitfield",
  "Ashworth",
  "Delacroix",
] as const;

// THE FOURTEEN WITHOUT ONE. Adults only, so nothing about them implies the Primary.
const NON_PRIMARY_FAMILY_NAMES = [
  "Sorensen",
  "Delgado",
  "Ravensworth",
  "Kowalski",
  "Mbeki",
  "Lindqvist",
  "Castellanos",
  "Thorpe",
  "Aguilar",
  "Novak",
  "Fitzgerald",
  "Yamamoto",
  "Petrov",
  "Osei",
] as const;

// Halvorsen is index 3 (a Primary family); Sorensen is index 9 (not one). The two do-not-contact
// households, deliberately one on each side of the Primary's implied set.
const HALVORSEN_INDEX = 3;
const SORENSEN_INDEX = 9;

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward", crossOrgVisibility: false });
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const primaryPresident = await createTestUser({
    handle: "primary-president",
    role: "org_president",
    org: "primary",
    firstName: "Rosa",
    lastName: "Villanueva",
  });

  // HOLDS `visits.view` AND `visits.create` BUT NOT `visits.manage_goals` — checked against
  // lib/auth/permissions.ts, where it is not the intuitive answer. This is the read-only state:
  // they see the sentence saying what the organization is measured against, and no controls.
  const primarySecretary = await createTestUser({
    handle: "primary-secretary",
    role: "org_secretary",
    org: "primary",
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

  await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ruth",
    lastName: "Delacroix",
  });

  // -------------------------------------------------------------------------------------------
  // Twenty-four households
  // -------------------------------------------------------------------------------------------
  const allNames = [...PRIMARY_FAMILY_NAMES, ...NON_PRIMARY_FAMILY_NAMES];

  for (const [offset, familyName] of allNames.entries()) {
    const index = offset + 1;

    await createHousehold({
      id: householdId(index),
      familyName,
      address: `${100 + index} Canyon Road`,
      // THE HOUSEHOLD-LEVEL FLAG, which is not the member status. These families stay on the
      // roster, stay VISIBLE and MARKED on the dashboard of any organization whose stewardship
      // they are in, and are counted in nothing (ITER-018 Decision 4).
      doNotContact: index === HALVORSEN_INDEX || index === SORENSEN_INDEX,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Members
  // -------------------------------------------------------------------------------------------
  // Every household gets an adult, so every one of the twenty-four is VISITABLE — the exclusions
  // in this scenario are the do-not-contact flag and the stewardship, never an empty house. A
  // household with no active members would vanish for a third reason and muddy the comparison.
  for (const [offset, familyName] of allNames.entries()) {
    const index = offset + 1;

    await createMember({
      firstName: "Adult",
      lastName: familyName,
      householdId: householdId(index),
      category: "adult",
    });
  }

  // THE PRIMARY-AGED CHILD IN EACH OF THE EIGHT, and the member_organizations row that makes the
  // derivation findable. `listHouseholds(wardId, { organizationId })` narrows the members it
  // ATTACHES, not the households it RETURNS — so a household whose `members` array is non-empty
  // under that filter is precisely a household where an active member of the Primary lives. That
  // is what "Match my organization's members" reads, and it is why no new query was needed.
  for (const [offset, familyName] of PRIMARY_FAMILY_NAMES.entries()) {
    const index = offset + 1;

    const childId = await createMember({
      firstName: "Child",
      lastName: familyName,
      householdId: householdId(index),
      category: "child",
    });

    await addMemberToOrganization({ memberId: childId, org: "primary" });
  }

  // -------------------------------------------------------------------------------------------
  // Goals
  // -------------------------------------------------------------------------------------------
  await createVisitGoal({
    org: "primary",
    title: "Visit every Primary family twice a year",
    cadenceAmount: 6,
    cadenceUnit: "month",
    noticeAmount: 1,
    noticeUnit: "month",
    createdBy: primaryPresident.id,
  });

  // THE CONTROL. A goal, and NO stewardship rows anywhere in this seed — so the Elders Quorum is
  // measured against all 22 visitable households before and after the Primary narrows, and its
  // board must be byte-identical at both readings.
  await createVisitGoal({
    org: "eldersQuorum",
    title: "Visit every family once a year",
    cadenceAmount: 1,
    cadenceUnit: "year",
    noticeAmount: 2,
    noticeUnit: "month",
    createdBy: eqPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // Three completed Primary visits, spread across the bands
  // -------------------------------------------------------------------------------------------
  // Enough for the "3 of 22" absurdity to be literally what the screen says before narrowing, and
  // for the bands to still have something to show after it.
  await createVisitLog({
    org: "primary",
    householdId: householdId(1), // Brooks
    recordedBy: primarySecretary.id,
    visitDate: VISITED_RECENTLY,
    outcome: "completed",
    arrangement: "appointment",
    sharedNotes: "Shared: the children are enjoying Primary.",
  });

  await createVisitLog({
    org: "primary",
    householdId: householdId(2), // Okonkwo
    recordedBy: primarySecretary.id,
    visitDate: VISITED_INSIDE_NOTICE,
    outcome: "completed",
    arrangement: "appointment",
  });

  await createVisitLog({
    org: "primary",
    householdId: householdId(4), // Ferreira
    recordedBy: primarySecretary.id,
    visitDate: VISITED_LONG_AGO,
    outcome: "completed",
    arrangement: "drop_in",
  });

  // The do-not-contact household INSIDE the Primary's set, with history from before the decision
  // was taken. It must read as present, marked, and with NO band despite being well past due —
  // the record of what happened before the decision is exactly what the next presidency needs.
  await createVisitLog({
    org: "primary",
    householdId: householdId(HALVORSEN_INDEX),
    recordedBy: primarySecretary.id,
    visitDate: daysAgo(400),
    outcome: "completed",
    arrangement: "drop_in",
    sharedNotes: "Shared: a good visit, before they asked us not to call again.",
  });

  // NO STEWARDSHIP ROWS ARE SEEDED, DELIBERATELY. The whole scenario is the tester pressing
  // "Choose which households are ours" and watching the denominator move — seeding the narrowed
  // state would skip the one interaction this exists to exercise.
}
