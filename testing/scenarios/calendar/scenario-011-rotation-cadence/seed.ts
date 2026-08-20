import {
  TEST_ORG_IDS,
  createConductingRotation,
  createSunday,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// May 2026 is chosen deliberately. It has FIVE Sundays and opens on a Friday, so the grid has
// leading blank cells and the monthly cadence has to hold across five Sundays rather than four —
// both cases scenario 010's March cannot show.
//
// The bishopric rotation is seeded WEEKLY and every May Sunday carries the conducting_user_id
// that cycle produces. That is not decoration: conducting_user_id is STORED, never computed at
// read time (03-calendar.md Step 3), and populateConducting() only fills rows that are still
// null. It is what makes "switching to monthly leaves May unchanged" an observable fact rather
// than an absence.
//
// The Elders Quorum rotation is seeded MONTHLY and its Sundays are left EMPTY — no
// sunday_org_conducting rows at all. Generating June is what creates them, which is the half of
// the feature a seeded row would hide.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  // The rotation edits fire admin_setting_changed and org_conducting_rotation_changed, and a
  // ward created outside supabase/seed/ward.sql has no notification_settings rows at all.
  await seedNotificationTriggers();

  // --- The bishopric ------------------------------------------------------------------
  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const counselorOne = await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });

  const counselorTwo = await createTestUser({
    handle: "counselor2",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 2,
    firstName: "Daniel",
    lastName: "Okafor",
  });

  // --- The Elders Quorum presidency — the org-scoped seats ----------------------------
  // eqpres holds calendar.manage_org_conducting and manages exactly one organization. Every
  // refused write in this scenario is attempted from this account.
  const eqPresident = await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tomas",
    lastName: "Ruiz",
  });

  // The notification recipient. eqpres makes the change; this account must receive it.
  const eqCounselor = await createTestUser({
    handle: "eqcounselor",
    role: "org_counselor",
    org: "eldersQuorum",
    firstName: "Andre",
    lastName: "Whitfield",
  });

  // --- The other-org seat -------------------------------------------------------------
  // Sees the Elders Quorum conductor read-only and has no Elders Quorum panel at all.
  await createTestUser({
    handle: "rspres",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Claire",
    lastName: "Bennett",
  });

  // --- The permission control ---------------------------------------------------------
  // Holds calendar.manage and NOT calendar.manage_org_conducting. Sees no organization rotation
  // panel at all, which is the check that proves the new permission is genuinely new rather
  // than riding along on calendar.manage.
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  // --- The bishopric rotation: WEEKLY, effective 2026-01-04 ---------------------------
  await createConductingRotation({
    effectiveFrom: "2026-01-04",
    cadence: "weekly",
    userIds: [bishop.id, counselorOne.id, counselorTwo.id],
  });

  // --- The Elders Quorum rotation: MONTHLY, effective 2026-01-04 ----------------------
  // A second, independent rotation on the SAME effective date. It shares nothing with the
  // bishopric's but the ward, which is exactly what migration 024's widened unique constraint
  // makes possible — and what a plain UNIQUE, treating every NULL as distinct, would have
  // broken instead.
  await createConductingRotation({
    effectiveFrom: "2026-01-04",
    cadence: "monthly",
    orgId: TEST_ORG_IDS.eldersQuorum,
    userIds: [eqPresident.id, eqCounselor.id, null],
  });

  // --- May 2026: five Sundays, opening on a Friday ------------------------------------
  // 2026-05-03 is the 18th Sunday from the 2026-01-04 anchor, so the weekly cycle has it at
  // position 1. These are the values that cycle produces, written out so the "May is unchanged"
  // check has something concrete to be unchanged against.
  const mayConductors = [
    { date: "2026-05-03", userId: bishop.id },
    { date: "2026-05-10", userId: counselorOne.id },
    { date: "2026-05-17", userId: counselorTwo.id },
    { date: "2026-05-24", userId: bishop.id },
    { date: "2026-05-31", userId: counselorOne.id },
  ];

  for (const sunday of mayConductors) {
    await createSunday({
      date: sunday.date,
      // 05-03 is the first Sunday of the month, so generation would type it fast_sunday anyway.
      type: sunday.date === "2026-05-03" ? "fast_sunday" : "standard",
      speakingSlots: sunday.date === "2026-05-03" ? 0 : 3,
      conductingUserId: sunday.userId,
    });
  }

  console.log(
    "  ward, 7 users, 2 rotations effective 2026-01-04 (bishopric weekly, Elders Quorum " +
      "monthly), 5 Sundays in May 2026 (05-03 fast with 0 slots), no sunday_org_conducting " +
      "rows, all notification triggers",
  );
}
