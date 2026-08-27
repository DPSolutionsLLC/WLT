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

// THE STATE THIS SEEDS IS A MISSED APPOINTMENT.
//
// It cannot be produced by clicking. "Missed" is not a value anything writes — it is a scheduled
// appointment whose time has passed, computed on read, because a stored status that time
// invalidates goes stale the moment nobody writes to it and this project has no pg_cron and no
// triggers to refresh one. So the only way a tester ever sees a missed appointment is if a
// fixture puts a past `scheduled_for` on a row that is still `scheduled`.
//
// ---------------------------------------------------------------------------------------------
// WHY ALL FOUR APPOINTMENT STATES
// ---------------------------------------------------------------------------------------------
// Upcoming, missed, kept and cancelled sit on one screen together, because the check that
// matters is that they read as four DIFFERENT things. Three of them are stored values and the
// fourth is not, and a screen that renders the computed one identically to `scheduled` has
// failed in a way no query can catch.
//
// The cancelled one also proves cancelling does not DELETE. That a ward arranged something and
// then called it off is part of the record of how it has tried to reach a household; a deleted
// row would leave that household looking simply unvisited.
//
// ---------------------------------------------------------------------------------------------
// WHY AN ATTEMPT AND A COMPLETED VISIT ON THE SAME HOUSEHOLD
// ---------------------------------------------------------------------------------------------
// Same household, two rows, one of each. That is the pair that makes "an attempt is shown and
// never counted" checkable: both are visible, and only one is progress. On one household alone
// you cannot tell whether a count is right or whether nothing is being counted at all.

// PINNED, not computed from today. A fixture whose "past" is relative to the clock changes
// meaning as it ages, and the whole point here is a specific relationship to now.
const MISSED = "2026-03-03T19:00:00.000Z";
const KEPT = "2026-02-10T19:00:00.000Z";
const CANCELLED = "2026-02-24T18:30:00.000Z";
const UPCOMING = "2099-06-02T19:00:00.000Z";

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

  await createTestUser({
    handle: "eq-secretary",
    role: "org_secretary",
    org: "eldersQuorum",
    firstName: "Peter",
    lastName: "Nakamura",
  });

  const households = await Promise.all(
    [
      { familyName: "Brooks", address: "2201 Canyon Road" },
      { familyName: "Whitfield", address: "88 Elm Street" },
      { familyName: "Okonkwo", address: "14 Larkspur Lane" },
      { familyName: "Halvorsen", address: "902 Ridgeview Drive" },
    ].map((household) => createHousehold(household)),
  );

  await Promise.all(
    [
      { firstName: "David", lastName: "Brooks", householdId: households[0] },
      { firstName: "Sarah", lastName: "Whitfield", householdId: households[1] },
      { firstName: "Emeka", lastName: "Okonkwo", householdId: households[2] },
      { firstName: "Inge", lastName: "Halvorsen", householdId: households[3] },
    ].map((member) =>
      createMember({ ...member, category: "adult", status: "active" }),
    ),
  );

  await createVisitGoal({
    org: "eldersQuorum",
    title: "Visit every household this year",
    cadenceAmount: 1,
    cadenceUnit: "year",
    noticeAmount: 2,
    noticeUnit: "month",
    createdBy: eqPresident.id,
  });

  // ---------------------------------------------------------------------------
  // The pair on ONE household: an attempt and a completed visit
  // ---------------------------------------------------------------------------
  const completed = await createVisitLog({
    org: "eldersQuorum",
    householdId: households[0],
    recordedBy: eqPresident.id,
    visitDate: "2026-02-10",
    outcome: "completed",
    arrangement: "appointment",
    sharedNotes: "Shared: good long conversation, they are doing well.",
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: completed,
    userId: eqPresident.id,
  });

  const attempted = await createVisitLog({
    org: "eldersQuorum",
    householdId: households[0],
    recordedBy: eqPresident.id,
    visitDate: "2026-03-14",
    outcome: "attempted",
    arrangement: "drop_in",
    sharedNotes: "Shared: knocked twice on the way past, car on the drive, no answer.",
  });

  await createVisitParticipant({
    org: "eldersQuorum",
    visitLogId: attempted,
    userId: eqPresident.id,
  });

  // ---------------------------------------------------------------------------
  // Four appointments, four states
  // ---------------------------------------------------------------------------

  // KEPT — and it points at the completed visit above, which is what "keeping" an appointment
  // writes: a status and a link, in one action.
  await createVisitAppointment({
    org: "eldersQuorum",
    householdId: households[0],
    scheduledFor: KEPT,
    status: "kept",
    visitLogId: completed,
    madeBy: eqPresident.id,
    notes: "Arranged at church on the Sunday.",
  });

  // MISSED — past, and STILL `scheduled`. The row nothing wrote and the clock made.
  await createVisitAppointment({
    org: "eldersQuorum",
    householdId: households[1],
    scheduledFor: MISSED,
    madeBy: eqPresident.id,
    notes: "They said Tuesday evening would suit.",
  });

  // CANCELLED — the row survives. Called off, not erased.
  await createVisitAppointment({
    org: "eldersQuorum",
    householdId: households[2],
    scheduledFor: CANCELLED,
    status: "cancelled",
    madeBy: eqPresident.id,
    notes: "They rang to say they would be away.",
  });

  // UPCOMING — far enough ahead that this scenario does not expire.
  await createVisitAppointment({
    org: "eldersQuorum",
    householdId: households[3],
    scheduledFor: UPCOMING,
    madeBy: eqPresident.id,
    notes: "Confirmed by text.",
  });
}
