import {
  createHousehold,
  createHouseholdStewardship,
  createHouseholdVisitCadence,
  createMember,
  createTestUser,
  createVisitGoal,
  createVisitLog,
  createVisitParticipant,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE THIS SEEDS IS A RELATIONSHIP BETWEEN THREE ORGANIZATIONS AND ONE WARD, AT ONE INSTANT.
//
// Nothing here is about a single row. The whole content of the all-organizations view is what
// three stewardships that OVERLAP AND DISAGREE look like laid over twelve households — and none
// of that can be arranged by hand.
//
// ---------------------------------------------------------------------------------------------
// THE FOUR CLAIMING STATES, ONE HOUSEHOLD EACH
// ---------------------------------------------------------------------------------------------
//   Whitfield   claimed by ALL THREE     -> three chips
//   Okonkwo     claimed by TWO           -> two chips
//   Ferreira    claimed by ONE           -> one chip
//   Ravensworth claimed by NONE          -> "No organization has claimed this household",
//                                           sorted FIRST, in the danger tone
//
// Ravensworth is the reason this page exists. ITER-019 D3 makes a household outside an
// organization's stewardship VANISH from that organization's dashboard, which is right — and it
// creates a family that is invisible to everybody. This view is the only place that shows up, and
// it is what made D3 safe to take.
//
// ---------------------------------------------------------------------------------------------
// WHY THE ELDERS QUORUM IS NARROWED TO ELEVEN OF THE TWELVE
// ---------------------------------------------------------------------------------------------
// Zero rows means the WHOLE WARD (migration 052), so an un-narrowed Elders Quorum would claim
// every household automatically — and Ravensworth, the row this scenario is built around, could
// not be left unclaimed. So the EQ narrows to everything EXCEPT Ravensworth.
//
// The un-narrowed-organization-claims-everything rule itself is asserted in
// tests/lib/allOrgProgress.test.ts, where it costs nothing to arrange.
//
// ---------------------------------------------------------------------------------------------
// YOUNG MEN, YOUNG WOMEN AND SUNDAY SCHOOL NEED NO STEWARDSHIP HERE, AND THAT IS THE FIX
// ---------------------------------------------------------------------------------------------
// ensureTestWard() creates SEVEN organizations. The first version of this fixture had to narrow
// those three to a token household each, purely so they would stop claiming all twelve and let
// Ravensworth be unclaimed — a workaround the walk recorded as a finding rather than a detail.
//
// An organization now claims households only if it HAS A VISIT GOAL. None of those three has one,
// so none of them claims anything, and the workaround is gone. Brooks carried five chips in the
// walked version; it now carries two. Nothing in this seed narrows them, deliberately — their
// absence from the page IS the assertion.
//
// ---------------------------------------------------------------------------------------------
// THE READER'S TIER (ITER-019 D6) NEEDS THE SAME DATA READ BY TWO PEOPLE
// ---------------------------------------------------------------------------------------------
// The bishop sees every chip banded. The RS president sees only the Relief Society chip banded —
// the other two name the organization with an honest sentence instead. That is not a branch in the
// app; it is `visit_goals_select` refusing the goal, and it is only observable by signing in twice.
//
// ---------------------------------------------------------------------------------------------
// WHY THE DATES ARE RELATIVE AND NOT PINNED
// ---------------------------------------------------------------------------------------------
// A band is a window, not a threshold. Every date derives from ONE `TODAY`, read once at seed
// time, in UTC milliseconds — never setDate(), which lands a day off for anybody west of UTC.

const MS_PER_DAY = 86_400_000;

const TODAY = new Date();

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return dateOnly(new Date(TODAY.getTime() - days * MS_PER_DAY));
}

const HOUSEHOLD_IDS = {
  whitfield: "40480001-0000-4000-8000-000000000001",
  okonkwo: "40480001-0000-4000-8000-000000000002",
  ferreira: "40480001-0000-4000-8000-000000000003",
  ravensworth: "40480001-0000-4000-8000-000000000004",
  brooks: "40480001-0000-4000-8000-000000000005",
  halvorsen: "40480001-0000-4000-8000-000000000006",
  nakamura: "40480001-0000-4000-8000-000000000007",
  delgado: "40480001-0000-4000-8000-000000000008",
  sorensen: "40480001-0000-4000-8000-000000000009",
  kowalski: "40480001-0000-4000-8000-000000000010",
  mbeki: "40480001-0000-4000-8000-000000000011",
  lindqvist: "40480001-0000-4000-8000-000000000012",
} as const;

type HouseholdKey = keyof typeof HOUSEHOLD_IDS;

const FAMILY_NAMES: Record<HouseholdKey, string> = {
  whitfield: "Whitfield",
  okonkwo: "Okonkwo",
  ferreira: "Ferreira",
  ravensworth: "Ravensworth",
  brooks: "Brooks",
  halvorsen: "Halvorsen",
  nakamura: "Nakamura",
  delgado: "Delgado",
  sorensen: "Sorensen",
  kowalski: "Kowalski",
  mbeki: "Mbeki",
  lindqvist: "Lindqvist",
};

const ALL_KEYS = Object.keys(HOUSEHOLD_IDS) as HouseholdKey[];

// EVERY HOUSEHOLD EXCEPT RAVENSWORTH. The Elders Quorum is narrowed to eleven of the twelve, which
// is what lets Ravensworth be a fully visitable family that all three organizations have left out.
// An un-narrowed EQ would claim it automatically and the unclaimed row would be unreachable.
const EQ_STEWARDSHIP: HouseholdKey[] = ALL_KEYS.filter((key) => key !== "ravensworth");

// FOUR households, the Primary's implied set.
const PRIMARY_STEWARDSHIP: HouseholdKey[] = ["whitfield", "okonkwo", "brooks", "halvorsen"];

// SIX households.
const RS_STEWARDSHIP: HouseholdKey[] = [
  "whitfield",
  "okonkwo",
  "ferreira",
  "nakamura",
  "delgado",
  "sorensen",
];


// -------------------------------------------------------------------------------------------
// THE DATES BEHIND THE BANDS
// -------------------------------------------------------------------------------------------
// EQ goal: every 1 year, warning 2 months ahead.
// RS goal: every 3 months, warning 2 weeks ahead.
// Primary goal: every 6 months, warning 1 month ahead.

// WHITFIELD IS THE ROW THIS SCENARIO EXISTS FOR, and it needs three facts at once:
//
//   The RELIEF SOCIETY went 12 days ago     -> On track on their own 3-month goal
//   The ELDERS QUORUM went 300 days ago     -> and holds Whitfield to a 3-MONTH OVERRIDE, so
//                                              Overdue, where their yearly goal alone would not be
//   An ATTEMPT 3 days ago, by the Primary   -> MORE RECENT THAN EITHER, and must NOT win "last
//                                              seen". An attempt is not a visit.
//
// So the row's ward-wide "Last seen" names the RELIEF SOCIETY, 12 days ago — which is a different
// answer from what the Elders Quorum's own board says about the same family on the same day, and
// both are correct. That disagreement is the whole reason this view exists.
const WHITFIELD_RS_VISIT = daysAgo(12);
const WHITFIELD_EQ_VISIT = daysAgo(300);
const WHITFIELD_PRIMARY_ATTEMPT = daysAgo(3);

const OKONKWO_EQ_VISIT = daysAgo(340); // 93% of a year -> inside the 2-month notice, Approaching
const FERREIRA_EQ_VISIT = daysAgo(500); // 137% -> Overdue
const BROOKS_EQ_VISIT = daysAgo(30); //     8% -> On track
const SORENSEN_RS_VISIT = daysAgo(600); //  do-not-contact: history kept, no band

export async function seed(): Promise<void> {
  // ON. The whole page is gated on it for anybody who is not in the bishopric, and step 4 of the
  // walk turns it back off to prove the link disappears rather than leading to a refusal.
  await ensureTestWard({ name: "Harness Test Ward", crossOrgVisibility: true });
  await seedNotificationTriggers();

  const bishop = await createTestUser({
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

  const rsPresident = await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ruth",
    lastName: "Delacroix",
  });

  const primaryPresident = await createTestUser({
    handle: "primary-president",
    role: "org_president",
    org: "primary",
    firstName: "Rosa",
    lastName: "Villanueva",
  });

  // -------------------------------------------------------------------------------------------
  // Twelve households, each with one active adult
  // -------------------------------------------------------------------------------------------
  // SORENSEN is do-not-contact: shown, marked, and with no band from ANY organization. It is not
  // on the scale at all, and this page must not quietly invent one for it.
  for (const [index, key] of ALL_KEYS.entries()) {
    await createHousehold({
      id: HOUSEHOLD_IDS[key],
      familyName: FAMILY_NAMES[key],
      address: `${200 + index} Ridgeview Drive`,
      doNotContact: key === "sorensen",
    });

    await createMember({
      firstName: "Adult",
      lastName: FAMILY_NAMES[key],
      householdId: HOUSEHOLD_IDS[key],
      category: "adult",
    });
  }

  // -------------------------------------------------------------------------------------------
  // Goals — each organization on a different cadence
  // -------------------------------------------------------------------------------------------
  await createVisitGoal({
    org: "eldersQuorum",
    title: "Visit every family once a year",
    cadenceAmount: 1,
    cadenceUnit: "year",
    noticeAmount: 2,
    noticeUnit: "month",
    createdBy: eqPresident.id,
  });

  await createVisitGoal({
    org: "reliefSociety",
    title: "Visit every sister quarterly",
    cadenceAmount: 3,
    cadenceUnit: "month",
    noticeAmount: 2,
    noticeUnit: "week",
    createdBy: rsPresident.id,
  });

  await createVisitGoal({
    org: "primary",
    title: "Visit every Primary family twice a year",
    cadenceAmount: 6,
    cadenceUnit: "month",
    noticeAmount: 1,
    noticeUnit: "month",
    createdBy: primaryPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // The three stewardships, overlapping and disagreeing
  // -------------------------------------------------------------------------------------------
  for (const key of EQ_STEWARDSHIP) {
    await createHouseholdStewardship({
      householdId: HOUSEHOLD_IDS[key],
      org: "eldersQuorum",
      createdBy: eqPresident.id,
    });
  }

  for (const key of PRIMARY_STEWARDSHIP) {
    await createHouseholdStewardship({
      householdId: HOUSEHOLD_IDS[key],
      org: "primary",
      createdBy: primaryPresident.id,
    });
  }

  for (const key of RS_STEWARDSHIP) {
    await createHouseholdStewardship({
      householdId: HOUSEHOLD_IDS[key],
      org: "reliefSociety",
      createdBy: rsPresident.id,
    });
  }

  // NOTHING IS SEEDED FOR YOUNG MEN, YOUNG WOMEN OR SUNDAY SCHOOL, on purpose. They exist in the
  // ward, they have narrowed nothing, and they still claim no household — because none of them
  // has a visit goal. Their absence from every row on the page is an assertion, not an omission.

  // THE ELDERS QUORUM'S OVERRIDE ON WHITFIELD. Their goal is a year; this family is held to three
  // months. So the same household reads a different band for the Elders Quorum than the cadence in
  // their goal alone would produce — and a DIFFERENT band again for the Relief Society.
  //
  // household_visit_cadences is NOT widened by cross-org visibility (ITER-018, left standing by
  // ITER-019 D6), so the RS president cannot read this row at all. Its EFFECT is invisible to
  // them too: they see the EQ chip with no band.
  await createHouseholdVisitCadence({
    householdId: HOUSEHOLD_IDS.whitfield,
    org: "eldersQuorum",
    cadenceAmount: 3,
    cadenceUnit: "month",
    createdBy: eqPresident.id,
  });

  // -------------------------------------------------------------------------------------------
  // The visits behind the bands, and the attempt that must not win
  // -------------------------------------------------------------------------------------------
  const whitfieldRsLogId = await createVisitLog({
    org: "reliefSociety",
    householdId: HOUSEHOLD_IDS.whitfield,
    recordedBy: rsPresident.id,
    visitDate: WHITFIELD_RS_VISIT,
    outcome: "completed",
    arrangement: "appointment",
    sharedNotes: "Shared: sat down with Sister Whitfield, all is well.",
  });

  // WHO WENT, and it is deliberately NOT the person who typed it in. The recorder above is the RS
  // president; the participant is the BISHOP. A "Last seen" line that ever fell back to the
  // recorder would name the wrong person, and this fixture is what would say so.
  await createVisitParticipant({
    org: "reliefSociety",
    visitLogId: whitfieldRsLogId,
    userId: bishop.id,
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.whitfield,
    recordedBy: eqPresident.id,
    visitDate: WHITFIELD_EQ_VISIT,
    outcome: "completed",
    arrangement: "drop_in",
  });

  // THE ATTEMPT, more recent than either completed visit. It must NOT appear as "last seen" — a
  // ward being told it reached a family it never got past the door of is the untruth visits-d
  // exists to have removed.
  await createVisitLog({
    org: "primary",
    householdId: HOUSEHOLD_IDS.whitfield,
    recordedBy: primaryPresident.id,
    visitDate: WHITFIELD_PRIMARY_ATTEMPT,
    outcome: "attempted",
    arrangement: "drop_in",
    sharedNotes: "Shared: knocked, no answer.",
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.okonkwo,
    recordedBy: eqPresident.id,
    visitDate: OKONKWO_EQ_VISIT,
    outcome: "completed",
    arrangement: "appointment",
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.ferreira,
    recordedBy: eqPresident.id,
    visitDate: FERREIRA_EQ_VISIT,
    outcome: "completed",
    arrangement: "drop_in",
  });

  await createVisitLog({
    org: "eldersQuorum",
    householdId: HOUSEHOLD_IDS.brooks,
    recordedBy: eqPresident.id,
    visitDate: BROOKS_EQ_VISIT,
    outcome: "completed",
    arrangement: "appointment",
  });

  // The do-not-contact household's history, from before the decision was taken. Kept and shown on
  // purpose: it is exactly what the next presidency needs.
  await createVisitLog({
    org: "reliefSociety",
    householdId: HOUSEHOLD_IDS.sorensen,
    recordedBy: rsPresident.id,
    visitDate: SORENSEN_RS_VISIT,
    outcome: "completed",
    arrangement: "drop_in",
    sharedNotes: "Shared: a good visit, before they asked us not to call again.",
  });

  // Ravensworth gets NOTHING — no visit, no attempt, no claim from any organization. Never seen by
  // anybody, and nobody's responsibility. It is the row the page exists for.
}
