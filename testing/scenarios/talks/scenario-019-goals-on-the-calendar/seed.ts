import {
  createAssignment,
  createGoal,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  createTopic,
  deleteHousehold,
  ensureTestWard,
  seedNotificationTriggers,
  TEST_ORG_IDS,
  testUuid,
} from "../../../infrastructure/seedUtils.ts";

// Eight goals spread across every status bucket, plus the two states no schema can prevent: a
// target that no longer exists, and a `group` target with no table behind it at all.
//
// ---------------------------------------------------------------------------------------------
// THE 80% PAIR, AND WHY IT HAS A WALK WINDOW
// ---------------------------------------------------------------------------------------------
// `due_soon` starts at 80% of the interval elapsed (lib/goals/goalStatus.ts). Two goals that
// straddle that line are the interesting cases, and status is computed against TODAY — so a fixed
// fulfilment date drifts across the boundary as the calendar moves. Seeding exactly on 80% would
// give the scenario a one-day life.
//
// The pair below is placed ~10% clear on each side instead, which is worth roughly three weeks:
//
//   "Youth speaker twice a quarter"  fulfilled 2026-03-15, 6 months -> 87% on 2026-08-22
//                                    reads Due soon from 2026-08-09 until 2026-09-14
//   "Ward council reviews…"          fulfilled 2026-04-09, 6 months -> 74% on 2026-08-22
//                                    reads On track until 2026-09-02
//
// So the pair is honest between 2026-08-09 and 2026-09-02. Walked outside that window, adjust the
// two dates rather than the assertion — the exact-day behaviour lives in
// tests/lib/goalStatus.test.ts, which builds its boundary as a whole number of days.
//
// ---------------------------------------------------------------------------------------------
// OWNERSHIP, AND WHY TWO GOALS BELONG TO THE ELDERS QUORUM
// ---------------------------------------------------------------------------------------------
// Migration 030 scopes goals to the organization that owns them: `org_id` null is a ward-level
// goal the bishopric alone sees, and a set `org_id` is that org's leadership plus the bishopric.
// Two of the eight are given to the Elders Quorum so `eqpres` has something to see and six things
// NOT to see — a scenario where every goal is ward-level would prove only that the board renders.
//
// ---------------------------------------------------------------------------------------------
// THE CACHED `status` COLUMN IS SEEDED WRONG ON PURPOSE
// ---------------------------------------------------------------------------------------------
// Every goal below writes a `status` that does NOT match what goalStatus() computes. The UI never
// reads that column — lib/goals/queries.ts does not even select it — so if the board ever agrees
// with the dashboard, something is reading the cache and the compute-on-read rule is broken
// (04-talks-pipeline.md §Step 9).

const JULY_SUNDAYS = ["2026-07-05", "2026-07-12", "2026-07-19", "2026-07-26"] as const;
const AUGUST_SUNDAYS = ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30"] as const;

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  // --- Three seats, three different answers to "can I see the goals board" ---------------------
  await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // Holds goals.view AND goals.manage through the org-leadership grant, and owns two of the eight
  // goals below. Since migration 030 the POLICY agrees with the permission matrix rather than
  // being wider than it: this account reads its own organization's goals and nothing else, and
  // the ward-level ones are invisible to it. That is what the checklist checks.
  await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Samuel",
    lastName: "Reyes",
  });

  // Holds no goals permission at all, so this account must reach a "Not permitted" page rather
  // than an empty board — an empty board is a different and misleading claim.
  await createTestUser({
    handle: "music",
    role: "music_coordinator",
    firstName: "Elena",
    lastName: "Duarte",
  });

  // --- Two months of Sundays, with speakers on July ---------------------------------------------
  // The July assignments give the Sunday planning page something to plan, which is where the goal
  // alert banner now lives. They also keep the calendar's two remaining reserved regions populated
  // (speakers and pipeline status), so the walk can confirm the goal alerts really are gone from
  // the month grid rather than merely absent because there was nothing to show.
  const julyIds: string[] = [];
  for (const date of JULY_SUNDAYS) {
    julyIds.push(await createSunday({ date }));
  }
  for (const date of AUGUST_SUNDAYS) {
    await createSunday({ date });
  }

  const speakerHousehold = await createHousehold({ familyName: "Goalboard Speakers" });

  const topic = await createTopic({
    title: "Ministering as the Savior Would",
    category: "doctrinal",
    description: "What a covenant people owe each other week to week.",
  });

  const speakers = await Promise.all([
    createMember({
      firstName: "Naomi",
      lastName: "Bettencourt",
      householdId: speakerHousehold,
      category: "adult",
    }),
    createMember({
      firstName: "Isaac",
      lastName: "Petrov",
      householdId: speakerHousehold,
      category: "adult",
    }),
    createMember({
      firstName: "Grace",
      lastName: "Oyelaran",
      householdId: speakerHousehold,
      category: "adult",
    }),
  ]);

  // A spread of stages, so the pipeline summary on a cell has more than one thing to say and the
  // goal alerts have to share the region with it.
  const stages = ["plan", "review", "confirm", "complete"] as const;

  for (const [index, sundayId] of julyIds.entries()) {
    await createAssignment({
      sundayId,
      memberId: speakers[index % speakers.length],
      topicId: topic,
      slotNumber: 1,
      pipelineStage: stages[index % stages.length],
    });

    await createAssignment({
      sundayId,
      memberId: speakers[(index + 1) % speakers.length],
      topicId: topic,
      slotNumber: 2,
      pipelineStage: "plan",
    });
    // Slot 3 is deliberately left open on every Sunday, so the speakers region renders
    // "Slot 3 — open" and the planner has an unfilled slot to work on.
  }

  // --- The goal targets ---------------------------------------------------------------------------
  const goalMembers = await Promise.all([
    createMember({
      firstName: "Ruth",
      lastName: "Callahan",
      householdId: speakerHousehold,
      category: "adult",
    }),
    createMember({
      firstName: "Ezra",
      lastName: "Nakashima",
      householdId: speakerHousehold,
      category: "youth",
    }),
  ]);

  const liveHousehold = await createHousehold({ familyName: "Abernathy" });

  // Written now, deleted at the end of this function. See the note there.
  const doomedHousehold = await createHousehold({ familyName: "Vandermeer" });

  // --- OVERDUE ------------------------------------------------------------------------------------
  // OWNED BY the Elders Quorum, and also ABOUT it. The two are independent — this one happens to
  // be both, which is exactly the case worth having in the fixture so the board's owner chip and
  // its target line can be told apart on screen.
  await createGoal({
    title: "Every quorum presidency speaks once a year",
    orgId: TEST_ORG_IDS.eldersQuorum,
    targetType: "org",
    targetId: TEST_ORG_IDS.eldersQuorum,
    desiredFrequencyMonths: 12,
    lastFulfilledAt: "2025-02-01T12:00:00.000Z",
    notes: "Rotate through the three quorum presidencies over the year.",
    status: "on_track",
  });

  await createGoal({
    title: "Visit every widow each quarter",
    targetType: "household",
    targetId: doomedHousehold,
    desiredFrequencyMonths: 3,
    lastFulfilledAt: "2026-01-10T12:00:00.000Z",
    status: "on_track",
  });

  // Never fulfilled, and the interval has passed since creation. This is the case that needs
  // `createdAt` — with only a null fulfilment date, a goal created this morning and one created
  // three years ago are the same value.
  // OWNED BY the Elders Quorum but ABOUT a household — the case that proves the owner chip is not
  // just re-rendering the target. It is also overdue, so it is what `eqpres` should land on.
  await createGoal({
    title: "Ask every adult to pray each year",
    orgId: TEST_ORG_IDS.eldersQuorum,
    targetType: "household",
    targetId: liveHousehold,
    desiredFrequencyMonths: 12,
    createdAt: "2025-01-15T12:00:00.000Z",
    status: "on_track",
  });

  // --- DUE SOON — just over 80% ---------------------------------------------------------------------
  await createGoal({
    title: "Youth speaker twice a quarter",
    targetType: "member",
    targetId: goalMembers[1],
    desiredFrequencyMonths: 6,
    lastFulfilledAt: "2026-03-15T12:00:00.000Z",
    status: "overdue",
  });

  // --- ON TRACK — just under 80% ---------------------------------------------------------------------
  await createGoal({
    title: "Ward council reviews the ministering list",
    desiredFrequencyMonths: 6,
    lastFulfilledAt: "2026-04-09T12:00:00.000Z",
    notes: "No single target — this one belongs to the whole ward.",
    status: "overdue",
  });

  // --- ON TRACK — comfortably --------------------------------------------------------------------------
  await createGoal({
    title: "New members speak within six months",
    targetType: "member",
    targetId: goalMembers[0],
    desiredFrequencyMonths: 12,
    lastFulfilledAt: "2026-06-01T12:00:00.000Z",
    status: "overdue",
  });

  // A `group` target. There is no `groups` table, so nothing can resolve this id — which is why
  // `group` is readable but NOT creatable through the app (lib/validation/goal.ts). Seeded
  // directly so the board can be checked for degrading honestly rather than crashing.
  await createGoal({
    title: "Elders Quorum presidency message",
    targetType: "group",
    targetId: testUuid("group:eq-presidency"),
    desiredFrequencyMonths: 24,
    lastFulfilledAt: "2026-05-01T12:00:00.000Z",
    status: "due_soon",
  });

  // Never fulfilled and still INSIDE its interval — the pair to "Ask every adult to pray each
  // year". Same null fulfilment date, opposite answer, and only `createdAt` separates them.
  await createGoal({
    title: "Interview every youth twice a year",
    desiredFrequencyMonths: 6,
    createdAt: "2026-07-01T12:00:00.000Z",
    status: "overdue",
  });

  // --- The dead target -----------------------------------------------------------------------------
  // Deleted LAST, after the goal pointing at it is written. `goals.target_id` is polymorphic and
  // carries no foreign key (migration 010's comment is explicit), so this leaves a goal pointing
  // at an id no table answers to — a state the route refuses to create but the database will
  // happily arrive at on its own the first time a household is removed.
  await deleteHousehold(doomedHousehold);
}
