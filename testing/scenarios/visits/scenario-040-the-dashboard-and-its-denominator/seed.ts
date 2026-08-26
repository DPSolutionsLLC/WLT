import {
  createHousehold,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  createVisitParticipant,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE THIS SEEDS IS A DENOMINATOR THAT IS SMALLER THAN THE WARD.
//
// Eight households, six of which this organization can visit. The other two are the whole point:
// listHouseholds() filters the members it ATTACHES, not the households it RETURNS, so a household
// whose people have all moved out comes back present with an empty member list. Counting it holds
// a ward's progress down forever — 07-visits.md §Pitfalls: "Counting moved-out households makes
// every org look behind and erodes trust in the number."
//
// Both shapes of that bug are here: one household emptied by `moved_out` and one by
// `do_not_contact`. DEFAULT_MEMBER_STATUSES is ["active"], so both attach nothing.
//
// ---------------------------------------------------------------------------------------------
// WHY THE DATES ARE RELATIVE AND NOT PINNED
// ---------------------------------------------------------------------------------------------
// Scenario 044 pins every timestamp, and was right to: "missed" is a MONOTONE property — a date
// that is past stays past, so a pinned fixture keeps its meaning as it ages.
//
// A visit status is a WINDOW, not a threshold. "Due soon" means between 80% and 100% of the way
// through a cadence, and a household pinned into that window in August walks out of it by
// November. Pinning here would produce a scenario that quietly stops demonstrating the thing it
// was written for, which is worse than one whose dates move.
//
// So every date below is derived from ONE `TODAY`, read once at seed time, and each household is
// placed at a precise distance from it. The checklist names statuses rather than dates for the
// same reason.
//
// ---------------------------------------------------------------------------------------------
// ALL FIVE STATUSES, ON ONE SCREEN
// ---------------------------------------------------------------------------------------------
// The plan's household list predates the fifth state. `attempted_never_reached` is the state
// visits-d's `attempted` outcome exists to make visible — a household somebody keeps failing to
// catch at home — so a dashboard scenario that could not show it would be walking past the newest
// thing on the page. It gets its own household here, which is why the banner reads 3 of 6 rather
// than the 3 of 5 the plan wrote. The assertion is unchanged in substance: SIX, not eight.

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

// The goal period started ten months ago and runs a further two, so "this period" is a window
// today sits near the end of.
const PERIOD_START = daysAgo(304);
const PERIOD_END = dateOnly(new Date(TODAY.getTime() + 61 * MS_PER_DAY));

// An annual cadence is 365 days (lib/validation/visit.ts §CADENCE_MONTHS), so:
const VISITED_RECENTLY = daysAgo(30); //  8% of the cadence  -> Visited
const VISITED_EARLIER = daysAgo(95); //  26% of the cadence  -> Visited
const VISITED_AT_82_PERCENT = daysAgo(300); //  82%          -> Due soon, and still in the period
const VISITED_13_MONTHS_AGO = daysAgo(396); // 108%          -> Overdue, and BEFORE the period

const ATTEMPTED_EARLY = daysAgo(120);
const ATTEMPTED_RECENTLY = daysAgo(12);

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const eqPresident = await createTestUser({
    handle: "eq-president",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  // The RECORDER on every visit below, and never a participant. A "Conducted by" column that fell
  // back to whoever typed a visit up would name this person on all four, which is exactly the
  // ambiguity visits-d split `recorded_by` out to remove.
  const eqSecretary = await createTestUser({
    handle: "eq-secretary",
    role: "org_secretary",
    org: "eldersQuorum",
    firstName: "Peter",
    lastName: "Nakamura",
  });

  // The Relief Society has NO GOAL. Switching to it is how a bishopric member sees "no goal set"
  // rather than a zero denominator — a made-up number is worse than an absent one.
  await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ruth",
    lastName: "Delacroix",
  });

  const [brooks, whitfield, okonkwo, halvorsen, ferreira, nakamura, departed, quiet] =
    await Promise.all(
      [
        { familyName: "Brooks", address: "2201 Canyon Road" },
        { familyName: "Whitfield", address: "88 Elm Street" },
        { familyName: "Okonkwo", address: "14 Larkspur Lane" },
        { familyName: "Halvorsen", address: "902 Ridgeview Drive" },
        { familyName: "Ferreira", address: "31 Willow Court" },
        { familyName: "Nakamura", address: "755 Aspen Way" },
        { familyName: "Delgado", address: "410 Sunset Boulevard" },
        { familyName: "Sorensen", address: "6 Chapel Close" },
      ].map((household) => createHousehold(household)),
    );

  await Promise.all([
    createMember({ firstName: "David", lastName: "Brooks", householdId: brooks }),
    createMember({ firstName: "Sarah", lastName: "Whitfield", householdId: whitfield }),
    createMember({ firstName: "Emeka", lastName: "Okonkwo", householdId: okonkwo }),
    createMember({ firstName: "Inge", lastName: "Halvorsen", householdId: halvorsen }),
    createMember({ firstName: "Ana", lastName: "Ferreira", householdId: ferreira }),
    createMember({ firstName: "Kenji", lastName: "Nakamura", householdId: nakamura }),

    // BOTH ITS MEMBERS HAVE MOVED OUT. The household row survives — a ward keeps the address —
    // and listHouseholds() returns it with `members: []`.
    createMember({
      firstName: "Rosa",
      lastName: "Delgado",
      householdId: departed,
      status: "moved_out",
    }),
    createMember({
      firstName: "Tomas",
      lastName: "Delgado",
      householdId: departed,
      status: "moved_out",
    }),

    // The other shape of the same bug. A do-not-contact household is still in the ward and still
    // on the roster browse page; it is not a household this organization can be measured against.
    createMember({
      firstName: "Greta",
      lastName: "Sorensen",
      householdId: quiet,
      status: "do_not_contact",
    }),
  ]);

  await createVisitGoal({
    org: "eldersQuorum",
    title: "Visit every household this year",
    cadence: "annual",
    goalPeriodStart: PERIOD_START,
    goalPeriodEnd: PERIOD_END,
    createdBy: eqPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // VISITED — two of them, well inside the cadence
  // -------------------------------------------------------------------------------------------
  const brooksVisit = await createVisitLog({
    org: "eldersQuorum",
    householdId: brooks,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_RECENTLY,
    outcome: "completed",
    arrangement: "appointment",
    sharedNotes: "Shared: good long conversation, they are doing well.",
  });

  // TWO people went, and neither of them is the recorder. This is the row that proves "Conducted
  // by" names who WENT.
  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: brooksVisit,
    userId: eqPresident.id,
  });
  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: brooksVisit,
    label: "Sister Alvarez, ministering",
  });

  // NOBODY IS RECORDED as having gone on this one — a legitimate state, not missing data: the
  // secretary typed up a visit and did not know who from the presidency was there. It must read
  // "Nobody recorded" rather than crediting the secretary.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: whitfield,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_EARLIER,
    outcome: "completed",
    arrangement: "drop_in",
  });

  // -------------------------------------------------------------------------------------------
  // DUE SOON — 82% of the way through the cadence, and still inside the goal period
  // -------------------------------------------------------------------------------------------
  // It counts towards the banner, because it HAS been visited this period. That is the difference
  // between "how many have we reached" and "how many are settled", and the banner answers the
  // first one.
  const okonkwoVisit = await createVisitLog({
    org: "eldersQuorum",
    householdId: okonkwo,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_AT_82_PERCENT,
    outcome: "completed",
    arrangement: "appointment",
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: okonkwoVisit,
    userId: eqPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // OVERDUE — thirteen months ago, which is BEFORE the period started
  // -------------------------------------------------------------------------------------------
  // The row that proves the "Last visited" column shows a year: this date is in a different
  // calendar year from every other visit here, and without a year it reads like last month's.
  const halvorsenVisit = await createVisitLog({
    org: "eldersQuorum",
    householdId: halvorsen,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_13_MONTHS_AGO,
    outcome: "completed",
    arrangement: "drop_in",
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: halvorsenVisit,
    label: "Brother Whitmore",
  });

  // -------------------------------------------------------------------------------------------
  // ATTEMPTED, NEVER REACHED — two knocks, nobody home, no completed visit ever
  // -------------------------------------------------------------------------------------------
  // The state visits-d's `attempted` outcome exists to make visible. It counts towards NOTHING —
  // this household is part of the "remaining" — and it must still be plainly on the page, or
  // recording an attempt would have bought the ward nothing.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: ferreira,
    recordedBy: eqSecretary.id,
    visitDate: ATTEMPTED_EARLY,
    outcome: "attempted",
    arrangement: "drop_in",
    sharedNotes: "Shared: knocked on the way past, no answer.",
  });

  const secondAttempt = await createVisitLog({
    org: "eldersQuorum",
    householdId: ferreira,
    recordedBy: eqSecretary.id,
    visitDate: ATTEMPTED_RECENTLY,
    outcome: "attempted",
    arrangement: "appointment",
    sharedNotes: "Shared: they had agreed to Tuesday, car on the drive, still no answer.",
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: secondAttempt,
    userId: eqPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // NOT YET VISITED — the Nakamura household gets no log at all, deliberately.
  // -------------------------------------------------------------------------------------------
}
