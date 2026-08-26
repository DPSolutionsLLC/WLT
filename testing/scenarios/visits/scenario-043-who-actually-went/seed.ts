import {
  createHousehold,
  createMember,
  createTestUser,
  createVisitAppointment,
  createVisitGoal,
  createVisitLog,
  createVisitParticipant,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE STATE THIS SEEDS IS A VISIT THE RECORDER DID NOT ATTEND.
//
// That is why this is a seeded fixture rather than a unit test. A tester can log their own visit
// in thirty seconds; what they cannot do alone is be TWO people at once. "The secretary typed it
// up and the president went" is only a real check if the two are different rows, written by
// somebody other than whoever is looking at the screen.
//
// ---------------------------------------------------------------------------------------------
// WHY A VISIT WITH NO PARTICIPANTS AT ALL
// ---------------------------------------------------------------------------------------------
// It is the state the whole slice exists to make expressible: somebody recorded a visit and does
// not know, or has not said, who made it. It must read "Nobody recorded as visiting" IN WORDS —
// not a blank, and not the recorder's name. A blank reads as a page that failed to load, and the
// recorder's name would be an invention. Neither failure is visible without looking.
//
// ---------------------------------------------------------------------------------------------
// WHY ALL THREE KINDS OF PARTICIPANT
// ---------------------------------------------------------------------------------------------
// `users` and `members` are unlinked in this schema, so a leader, a spouse and a neighbour are
// three genuinely different rows: a user id, a member id, and a typed name with no row anywhere.
// A screen that renders two of the three correctly and the third as a blank or a raw uuid is a
// bug nothing below the rendering layer can catch.
//
// ---------------------------------------------------------------------------------------------
// WHY A MISSED APPOINTMENT IS HERE TOO
// ---------------------------------------------------------------------------------------------
// It costs one row and it puts the computed state on the same screen as the participants, so a
// tester who is here anyway sees it. Scenario 044 is where it is checked properly.
//
// ---------------------------------------------------------------------------------------------
// WHY A HOUSEHOLD WITH NO ACTIVE MEMBERS
// ---------------------------------------------------------------------------------------------
// Carried forward from scenario 038 deliberately. DEFAULT_MEMBER_STATUSES is ["active"], and a
// household whose people have all moved out must not be offered as somewhere to visit — by the
// household picker OR by the new participants field's member picker. Dropping it here would let
// the rule rot in the one place this slice added.

// Long past and still `scheduled`. The MISSED state cannot be produced by clicking — nothing
// writes it, it is computed on read — so seeding is the only way a tester ever sees one.
const MISSED_APPOINTMENT = "2026-03-03T19:00:00.000Z";

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

  // The second counselor exists so the "add a leader" picker has more than one name in it and
  // the cap can be reached without inventing people mid-walk.
  await createTestUser({
    handle: "eq-counselor",
    role: "org_counselor",
    org: "eldersQuorum",
    firstName: "Tomas",
    lastName: "Reyes",
  });

  const rsPresident = await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Ana",
    lastName: "Delgado",
  });

  const households = await Promise.all(
    [
      { familyName: "Brooks", address: "2201 Canyon Road" },
      { familyName: "Whitfield", address: "88 Elm Street" },
      { familyName: "Okonkwo", address: "14 Larkspur Lane" },
      { familyName: "Halvorsen", address: "902 Ridgeview Drive" },
      { familyName: "Tuiasosopo", address: "35 Maple Court" },
    ].map((household) => createHousehold(household)),
  );

  const members = await Promise.all(
    [
      { firstName: "David", lastName: "Brooks", householdId: households[0] },
      { firstName: "Ruth", lastName: "Brooks", householdId: households[0] },
      { firstName: "Sarah", lastName: "Whitfield", householdId: households[1] },
      { firstName: "Emeka", lastName: "Okonkwo", householdId: households[2] },
      { firstName: "Inge", lastName: "Halvorsen", householdId: households[3] },
      { firstName: "Lani", lastName: "Tuiasosopo", householdId: households[4] },
    ].map((member) =>
      createMember({ ...member, category: "adult", status: "active" }),
    ),
  );

  // The sixth household: everybody moved out, so it is not somewhere to visit and its member is
  // not somebody to take along.
  const ferreira = await createHousehold({
    familyName: "Ferreira",
    address: "410 Sycamore Way",
  });

  await createMember({
    firstName: "Joana",
    lastName: "Ferreira",
    householdId: ferreira,
    category: "adult",
    status: "moved_out",
  });

  await createVisitGoal({
    org: "eldersQuorum",
    title: "Visit every household this year",
    cadence: "annual",
    goalPeriodStart: "2026-01-01",
    goalPeriodEnd: "2026-12-31",
    createdBy: eqPresident.id,
  });

  // ---------------------------------------------------------------------------
  // Visit 1 — THE ONE THIS SCENARIO IS FOR
  // ---------------------------------------------------------------------------
  // The SECRETARY recorded it. The PRESIDENT went, with a member of the household's family as a
  // companion. The recorder is NOT a participant, which is the state visits-a could not express
  // at all: one column meant both things, so this visit would have credited Peter with a visit
  // he did not make.
  const secretaryRecorded = await createVisitLog({
    org: "eldersQuorum",
    householdId: households[0],
    recordedBy: eqSecretary.id,
    visitDate: "2026-02-08",
    sharedNotes: "Shared: brought a meal round after the surgery.",
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: secretaryRecorded,
    userId: eqPresident.id,
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: secretaryRecorded,
    memberId: members[1],
  });

  // ---------------------------------------------------------------------------
  // Visit 2 — NOBODY RECORDED AS VISITING
  // ---------------------------------------------------------------------------
  // No participants at all. Not a mistake in the fixture: it is the honest record of a visit
  // somebody typed up without knowing who went, and the page must say so in words.
  await createVisitLog({
    org: "eldersQuorum",
    householdId: households[1],
    recordedBy: eqSecretary.id,
    visitDate: "2026-02-15",
    sharedNotes: "Shared: caught them on the way out, agreed to call back next month.",
  });

  // ---------------------------------------------------------------------------
  // Visit 3 — A TYPED NAME
  // ---------------------------------------------------------------------------
  // A person this ward has no row for in either table. Neither a user id nor a member id could
  // hold this, which is the reason visit_participants carries three columns and a CHECK.
  const withNeighbour = await createVisitLog({
    org: "eldersQuorum",
    householdId: households[2],
    recordedBy: eqPresident.id,
    visitDate: "2026-03-01",
    sharedNotes: "Shared: their neighbour came along and knows the family well.",
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: withNeighbour,
    userId: eqPresident.id,
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: withNeighbour,
    label: "Bill from next door",
  });

  // A Relief Society visit, so the org boundary is visible on the same screen as everything
  // else. The harness ward has cross_org_visibility off, so the EQ president should NOT see it.
  const rsVisit = await createVisitLog({
    org: "reliefSociety",
    householdId: households[3],
    recordedBy: rsPresident.id,
    visitDate: "2026-03-08",
    sharedNotes: "Shared: sister is recovering well.",
  });

  await createVisitParticipant({
    org: "reliefSociety",
    visitLogId: rsVisit,
    userId: rsPresident.id,
  });

  await createVisitAppointment({
    org: "eldersQuorum",
    householdId: households[4],
    scheduledFor: MISSED_APPOINTMENT,
    madeBy: eqPresident.id,
    notes: "Arranged after church. Nobody was in.",
  });
}
