import {
  createHousehold,
  createHouseholdVisitCadence,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE THIS SEEDS IS ONE FAMILY ON TWO DIFFERENT CADENCES AT THE SAME TIME.
//
// Whitfield is the single most important row in this scenario. The Elders Quorum has overridden it
// to every 3 months and last went 100 days ago; the Relief Society is on its own 3-month goal and
// last went 20 days ago. So the same household reads **Overdue** on one dashboard and **On track**
// on the other, at the same moment — and clearing the Elders Quorum override flips it to On track
// there too, which is the override proving it was doing the work.
//
// That is what ITER-018 Decision 2 was reversed for. A `households.visit_cadence` column could
// not have expressed it at all: one column, one answer, and the second organization would have
// been silently overwritten by the first. The join table is the model, and this is what it looks
// like on a screen.
//
// Everything else here is a band boundary. Each household sits at a computed distance from a
// computed cadence, so the page can be read against what it should say.
//
// ---------------------------------------------------------------------------------------------
// WHY THE DATES ARE RELATIVE AND NOT PINNED
// ---------------------------------------------------------------------------------------------
// A priority band is a WINDOW, not a threshold: "approaching" means inside the warning window and
// not yet due, and a household pinned into that window today walks out of it in two months. A
// pinned fixture would quietly stop demonstrating the thing it was written for.
//
// So every date is derived from ONE `TODAY`, read once at seed time, and the checklist names
// bands rather than dates.
//
// ---------------------------------------------------------------------------------------------
// EXPLICIT HOUSEHOLD IDS
// ---------------------------------------------------------------------------------------------
// createHousehold keys its id on the family name plus address, so two households sharing both
// collide on the primary key (plans/retros/seed-household-id-collision.md). Every id below is
// passed explicitly, because the override rows have to name a household id and a fixture that
// derived it twice would derive it differently the moment somebody edited an address.

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

const HOUSEHOLD_IDS = {
  brooks: "40450001-0000-4000-8000-000000000001",
  okonkwo: "40450001-0000-4000-8000-000000000002",
  halvorsen: "40450001-0000-4000-8000-000000000003",
  ferreira: "40450001-0000-4000-8000-000000000004",
  nakamura: "40450001-0000-4000-8000-000000000005",
  whitfield: "40450001-0000-4000-8000-000000000006",
  delgado: "40450001-0000-4000-8000-000000000007",
  sorensen: "40450001-0000-4000-8000-000000000008",
} as const;

// THE ELDERS QUORUM GOAL: every 1 year, warning 2 months ahead, NO DATES AT ALL.
//
//   due        = lastVisit + 1 year   (365 days)
//   warns from = due - 2 months       (~61 days before due, so from about day 304)
//
const VISITED_RECENTLY = daysAgo(30); //   8% of the interval   -> On track
const VISITED_INSIDE_NOTICE = daysAgo(320); // 88%, past day 304 -> Approaching
const VISITED_13_MONTHS_AGO = daysAgo(400); // 110%              -> Overdue

// WHITFIELD — THE ROW THIS SCENARIO EXISTS FOR, and it needs TWO dates rather than one.
//
// The Elders Quorum last went 100 days ago. That is 27% of their one-year goal — comfortably On
// track — and 109% of the 3-month override they have put on this family, which is Overdue. The
// override is doing all of the work, and clearing it flips the row back to On track.
//
// The RELIEF SOCIETY last went 20 days ago, which is 22% of their own 3-month goal: On track.
// Each organization logs its OWN visits and each dashboard reads only its own, so this is the
// ordinary situation of two organizations ministering to one family at different rhythms.
//
// A FIRST VERSION GAVE BOTH ORGANIZATIONS THE SAME 100-DAY-OLD VISIT, and the scenario claimed
// the two dashboards would disagree. They did not: 100 days is past due on the Relief Society's
// 3-month goal too, so both read Overdue and the walk had nothing to show. Found by walking it.
// The two dates are the fix, and they are what makes "the same family, two answers, at the same
// moment" an actual observation rather than an assertion.
const WHITFIELD_EQ_VISIT = daysAgo(100);
const WHITFIELD_RS_VISIT = daysAgo(20);

// Sorensen is do-not-contact and was visited long before that decision was taken. The history is
// kept and shown on purpose: it is exactly what the next presidency needs.
const SORENSEN_VISIT = daysAgo(500);

const ATTEMPTED_EARLY = daysAgo(120);
const ATTEMPTED_MIDDLE = daysAgo(60);
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

  const eqSecretary = await createTestUser({
    handle: "eq-secretary",
    role: "org_secretary",
    org: "eldersQuorum",
    firstName: "Peter",
    lastName: "Nakamura",
  });

  const rsPresident = await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ruth",
    lastName: "Delacroix",
  });

  await Promise.all([
    createHousehold({
      id: HOUSEHOLD_IDS.brooks,
      familyName: "Brooks",
      address: "2201 Canyon Road",
    }),
    createHousehold({
      id: HOUSEHOLD_IDS.okonkwo,
      familyName: "Okonkwo",
      address: "14 Larkspur Lane",
    }),
    createHousehold({
      id: HOUSEHOLD_IDS.halvorsen,
      familyName: "Halvorsen",
      address: "902 Ridgeview Drive",
    }),
    createHousehold({
      id: HOUSEHOLD_IDS.ferreira,
      familyName: "Ferreira",
      address: "31 Willow Court",
    }),
    createHousehold({
      id: HOUSEHOLD_IDS.nakamura,
      familyName: "Nakamura",
      address: "755 Aspen Way",
    }),
    createHousehold({
      id: HOUSEHOLD_IDS.whitfield,
      familyName: "Whitfield",
      address: "88 Elm Street",
    }),
    createHousehold({
      id: HOUSEHOLD_IDS.delgado,
      familyName: "Delgado",
      address: "410 Sunset Boulevard",
    }),

    // THE HOUSEHOLD-LEVEL FLAG, which is not the member status. This family stays on the roster,
    // stays VISIBLE on the dashboard, is MARKED, and is counted in nothing (ITER-018 Decision 4).
    // Contrast scenario 040's Sorensen, whose only member carries `status: do_not_contact` and
    // which therefore disappears from the page entirely — two different mechanisms with opposite
    // visible behaviour, deliberately.
    createHousehold({
      id: HOUSEHOLD_IDS.sorensen,
      familyName: "Sorensen",
      address: "6 Chapel Close",
      doNotContact: true,
    }),
  ]);

  await Promise.all([
    createMember({ firstName: "David", lastName: "Brooks", householdId: HOUSEHOLD_IDS.brooks }),
    createMember({ firstName: "Emeka", lastName: "Okonkwo", householdId: HOUSEHOLD_IDS.okonkwo }),
    createMember({
      firstName: "Inge",
      lastName: "Halvorsen",
      householdId: HOUSEHOLD_IDS.halvorsen,
    }),
    createMember({ firstName: "Ana", lastName: "Ferreira", householdId: HOUSEHOLD_IDS.ferreira }),
    createMember({ firstName: "Kenji", lastName: "Nakamura", householdId: HOUSEHOLD_IDS.nakamura }),
    createMember({
      firstName: "Sarah",
      lastName: "Whitfield",
      householdId: HOUSEHOLD_IDS.whitfield,
    }),

    // ONE ACTIVE MEMBER, so the household is visitable — the exclusion below is the household
    // flag doing the work, not an empty member list. If this member were `do_not_contact` the
    // household would vanish and the scenario would prove nothing.
    createMember({
      firstName: "Greta",
      lastName: "Sorensen",
      householdId: HOUSEHOLD_IDS.sorensen,
    }),

    // Both moved out. Absent from the page entirely — the denominator rule scenario 040 owns,
    // kept here so the two exclusions can be compared side by side.
    createMember({
      firstName: "Rosa",
      lastName: "Delgado",
      householdId: HOUSEHOLD_IDS.delgado,
      status: "moved_out",
    }),
    createMember({
      firstName: "Tomas",
      lastName: "Delgado",
      householdId: HOUSEHOLD_IDS.delgado,
      status: "moved_out",
    }),
  ]);

  // NO DATES AT ALL. A goal is a rolling cadence now; the success criterion is that an
  // organization can save one with no dates and still see every household ranked.
  await createVisitGoal({
    org: "eldersQuorum",
    title: "Visit every family",
    cadenceAmount: 1,
    cadenceUnit: "year",
    noticeAmount: 2,
    noticeUnit: "month",
    createdBy: eqPresident.id,
  });

  // A SHORT CADENCE, to prove one renders sensibly. Three months with a two-week warning — the
  // percentages move fast and the due dates are close together, which is where a layout built
  // around a year-long interval tends to fall over.
  await createVisitGoal({
    org: "reliefSociety",
    title: "Visit every sister quarterly",
    cadenceAmount: 3,
    cadenceUnit: "month",
    noticeAmount: 2,
    noticeUnit: "week",
    createdBy: rsPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // THE OVERRIDE THIS SCENARIO EXISTS FOR
  // -------------------------------------------------------------------------------------------
  // The Elders Quorum only. The Relief Society has NO override for Whitfield, so it falls back to
  // their own 3-month goal — and both organizations end up judging this family every 3 months by
  // two entirely different routes, which is worth seeing.
  await createHouseholdVisitCadence({
    householdId: HOUSEHOLD_IDS.whitfield,
    org: "eldersQuorum",
    cadenceAmount: 3,
    cadenceUnit: "month",
    createdBy: eqPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // The visits behind the bands
  // -------------------------------------------------------------------------------------------
  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.brooks,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_RECENTLY,
    outcome: "completed",
    arrangement: "appointment",
    sharedNotes: "Shared: good long conversation, they are doing well.",
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.okonkwo,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_INSIDE_NOTICE,
    outcome: "completed",
    arrangement: "appointment",
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.halvorsen,
    recordedBy: eqSecretary.id,
    visitDate: VISITED_13_MONTHS_AGO,
    outcome: "completed",
    arrangement: "drop_in",
  });

  // Logged by BOTH organizations, on DIFFERENT dates. Each dashboard only sees its own org's
  // visits — a household's last visit for the Elders Quorum is not the Relief Society's last
  // visit — and without the second row Whitfield would read "Never visited" on the Relief
  // Society's page, which is a third thing again.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.whitfield,
    recordedBy: eqSecretary.id,
    visitDate: WHITFIELD_EQ_VISIT,
    outcome: "completed",
    arrangement: "drop_in",
    sharedNotes: "Shared: caught them briefly on the doorstep.",
  });

  await createVisitLog({
    org: "reliefSociety",
    householdId: HOUSEHOLD_IDS.whitfield,
    recordedBy: rsPresident.id,
    visitDate: WHITFIELD_RS_VISIT,
    outcome: "completed",
    arrangement: "appointment",
    sharedNotes: "Shared: sat down with Sister Whitfield, all is well.",
  });

  // -------------------------------------------------------------------------------------------
  // NEVER VISITED, WITH AND WITHOUT AN ATTEMPTS MARK
  // -------------------------------------------------------------------------------------------
  // Ferreira and Nakamura are in the SAME band and are different problems. The attempt count is a
  // MARK beside the badge rather than a band of its own — that split is ITER-018 part 5, and
  // three attempts against none is the clearest way to see it.
  for (const attemptDate of [ATTEMPTED_EARLY, ATTEMPTED_MIDDLE, ATTEMPTED_RECENTLY]) {
    await createVisitLog({
      org: "eldersQuorum",
      householdId: HOUSEHOLD_IDS.ferreira,
      recordedBy: eqSecretary.id,
      visitDate: attemptDate,
      outcome: "attempted",
      arrangement: "drop_in",
      sharedNotes: "Shared: knocked, no answer.",
    });
  }

  // Nakamura gets nothing at all, deliberately.

  // -------------------------------------------------------------------------------------------
  // The do-not-contact household's history
  // -------------------------------------------------------------------------------------------
  // 500 days ago against a one-year cadence is well past due, and the row must STILL show no
  // band: it is not on the scale at all. A page that quietly computed "Overdue" here and then
  // left it out of the count would be the same contradiction ITER-018 removed, relocated.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.sorensen,
    recordedBy: eqSecretary.id,
    visitDate: SORENSEN_VISIT,
    outcome: "completed",
    arrangement: "drop_in",
    sharedNotes: "Shared: a good visit, before they asked us not to call again.",
  });
}
