import {
  createAssignment,
  createAssignmentHistory,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  createYouthAccount,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// Six members whose histories are built so that each one earns EXACTLY ONE flag, or none at all.
// One flag apiece is what makes the walkthrough legible: a member carrying three flags proves the
// same arithmetic and tells the tester nothing about which rule produced which badge.
//
// The four boundaries are 2 declines, 7 days' notice, 18 months and 24 months
// (lib/assignments/reliabilityFlags.ts). Nothing here is seeded ON a boundary — the exact-day
// behaviour is where tests/lib/reliabilityFlags.test.ts lives, and a scenario seeded on the
// boundary starts failing on the wrong day the week after it is written. Everything is seeded two
// months clear of its boundary instead.
//
// Every date is FIXED rather than an offset from "now", so a re-seed produces the same six
// profiles rather than ones that drift a day per run. They are chosen against the harness's
// 2026-08 timeframe.

const SUNDAYS = {
  // Miriam's last completed talk — 26 months before 2026-08, past the 24-month boundary.
  june2024: "2024-06-02",
  // David's last assignment of any kind — 20 months before, past the 18-month boundary.
  december2024: "2024-12-01",
  // Thomas's two declines, and Rachel's late cancellation.
  january2026: "2026-01-04",
  february2026: "2026-02-01",
  march2026: "2026-03-01",
  // Anna's clean recent talk, and Miriam's recent ACCEPTED assignment — the row that keeps her
  // out of "not asked in over a year" while leaving her in "has not spoken in two years".
  june2026: "2026-06-07",
  // The completed EXTERNAL speaker. It writes no history row, and must appear in no table.
  july2026: "2026-07-05",
  // A future Sunday with an open slot, so the assignment modal's picker can be opened and the
  // flags checked in the planning view they were built for.
  august2026: "2026-08-30",
} as const;

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  // --- The two bishopric seats ----------------------------------------------------------------
  // Both, because CLAUDE.md §7 makes bishopric authority shared and the checklist compares them
  // item for item. A scenario with only a bishop cannot catch a check that grants him something
  // a counselor lacks.
  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });

  // --- The three refused seats ------------------------------------------------------------------
  // The secretary is the important one: she HOLDS `talks.view`, so the module gate alone would
  // let her through. Only the bishopric check refuses her, and only the RLS policy makes that
  // refusal true rather than polite.
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Samuel",
    lastName: "Reyes",
  });

  await createYouthAccount({
    username: "jbenson",
    pin: "246813",
    firstName: "Joshua",
    lastName: "Benson",
  });

  // --- The Sundays every history row hangs off ---------------------------------------------------
  // A history row's DATE comes from the assignment's Sunday, not from the row itself — so the
  // "not asked / not spoken recently" flags cannot be seeded without real Sundays behind them.
  const sundayIds = {
    june2024: await createSunday({ date: SUNDAYS.june2024 }),
    december2024: await createSunday({ date: SUNDAYS.december2024 }),
    january2026: await createSunday({ date: SUNDAYS.january2026 }),
    february2026: await createSunday({ date: SUNDAYS.february2026 }),
    march2026: await createSunday({ date: SUNDAYS.march2026 }),
    june2026: await createSunday({ date: SUNDAYS.june2026 }),
    july2026: await createSunday({ date: SUNDAYS.july2026 }),
    august2026: await createSunday({ date: SUNDAYS.august2026 }),
  };

  const household = await createHousehold({ familyName: "Reliability Fixtures" });

  const member = (firstName: string, lastName: string) =>
    createMember({ firstName, lastName, householdId: household, category: "adult" });

  // --- Thomas Whitfield: DECLINED TWICE ----------------------------------------------------------
  // Two declines is the boundary itself — the flag names "2 or more", and one decline must not
  // fire it. Both are recent enough that neither "recently" flag can also fire, so his page shows
  // exactly one badge.
  const thomas = await member("Thomas", "Whitfield");

  const thomasJanuary = await createAssignment({
    sundayId: sundayIds.january2026,
    memberId: thomas,
    slotNumber: 1,
    pipelineStage: "plan",
  });

  const thomasMarch = await createAssignment({
    sundayId: sundayIds.march2026,
    memberId: thomas,
    slotNumber: 1,
    pipelineStage: "plan",
  });

  await createAssignmentHistory({
    memberId: thomas,
    assignmentId: thomasJanuary,
    outcome: "declined",
    notes: "Travelling that weekend.",
  });

  await createAssignmentHistory({
    memberId: thomas,
    assignmentId: thomasMarch,
    outcome: "declined",
    notes: "Asked to be considered later in the year.",
  });

  // --- Rachel Sandoval: CANCELLED WITH 3 DAYS' NOTICE --------------------------------------------
  // INSERTED DIRECTLY, and that is the point worth knowing: no code path in the app writes a
  // `cancelled` outcome or a `cancellation_days_notice` today — writeAssignmentHistory() writes
  // only `declined` and `completed`. The flag is implemented and boundary-tested because the phase
  // plan specifies it, but it is dormant on real data, and this row is the only way to see it.
  const rachel = await member("Rachel", "Sandoval");

  const rachelFebruary = await createAssignment({
    sundayId: sundayIds.february2026,
    memberId: rachel,
    slotNumber: 2,
    pipelineStage: "plan",
  });

  await createAssignmentHistory({
    memberId: rachel,
    assignmentId: rachelFebruary,
    outcome: "cancelled",
    cancellationDaysNotice: 3,
    notes: "Family illness.",
  });

  // --- David Ferreira: NOT ASKED IN 20 MONTHS -----------------------------------------------------
  // He COMPLETED that talk, which matters: the completion is 20 months old, well inside the
  // 24-month "has not spoken" boundary, so only the 18-month "not asked" flag fires. One member,
  // one badge.
  const david = await member("David", "Ferreira");

  const davidDecember = await createAssignment({
    sundayId: sundayIds.december2024,
    memberId: david,
    slotNumber: 1,
    pipelineStage: "complete",
  });

  await createAssignmentHistory({
    memberId: david,
    assignmentId: davidDecember,
    outcome: "completed",
  });

  // --- Miriam Hollis: HAS NOT SPOKEN IN 26 MONTHS -------------------------------------------------
  // The most interesting profile in the set. Her last COMPLETED talk is 26 months back, but she
  // was asked two months ago and accepted — so "not asked in over a year" must NOT fire while
  // "has not spoken in two years" must. The two flags measure different things, and this member
  // is what proves the implementation knows that.
  const miriam = await member("Miriam", "Hollis");

  const miriamJune2024 = await createAssignment({
    sundayId: sundayIds.june2024,
    memberId: miriam,
    slotNumber: 1,
    pipelineStage: "complete",
  });

  const miriamJune2026 = await createAssignment({
    sundayId: sundayIds.june2026,
    memberId: miriam,
    slotNumber: 2,
    pipelineStage: "confirm",
  });

  await createAssignmentHistory({
    memberId: miriam,
    assignmentId: miriamJune2024,
    outcome: "completed",
  });

  await createAssignmentHistory({
    memberId: miriam,
    assignmentId: miriamJune2026,
    outcome: "accepted",
    notes: "Happy to speak.",
  });

  // --- Anna Lindqvist: CLEAN ----------------------------------------------------------------------
  // The control. Without a member who has real history and no flags, "the flags fired" and "the
  // flags always fire" look identical on screen.
  const anna = await member("Anna", "Lindqvist");

  const annaJune = await createAssignment({
    sundayId: sundayIds.june2026,
    memberId: anna,
    slotNumber: 1,
    pipelineStage: "complete",
  });

  await createAssignmentHistory({
    memberId: anna,
    assignmentId: annaJune,
    outcome: "completed",
  });

  // --- Caleb Moreno: NO HISTORY AT ALL -------------------------------------------------------------
  // A member nobody has ever asked is NOT four flags. He is the empty state, and reading "not
  // asked in over a year" off an empty table would be inventing a pattern from an absence.
  await member("Caleb", "Moreno");

  // --- The external speaker -------------------------------------------------------------------------
  // Completed, on a past Sunday, with no member id. `assignment_history.member_id` is `not null`,
  // so this assignment wrote no history row and can appear in nobody's table (ITER-004 /
  // talks-a Decision 3). Seeded so the checklist can go looking for it and fail to find it.
  await createAssignment({
    sundayId: sundayIds.july2026,
    externalSpeakerName: "Alan Whitcombe",
    externalSpeakerTitle: "President",
    slotNumber: 1,
    pipelineStage: "complete",
    // Both waiver columns move together or neither does — assignments_waiver_pair, migration 025.
    // An external speaker crosses the contact stages by an explicit WAIVER with a name on it,
    // never by a silent skip (talks-a Decision 2).
    contactWaivedAt: "2026-06-28T18:00:00.000Z",
    contactWaivedBy: bishop.id,
  });

  // --- The open slot ---------------------------------------------------------------------------------
  // Nothing is assigned to 2026-08-30, so the planner shows three open slots and pressing one
  // opens the modal whose MemberPicker renders the flags. That picker is the second surface the
  // flags reach, and the only one where they sit beside a name a bishopric is about to choose.
}
