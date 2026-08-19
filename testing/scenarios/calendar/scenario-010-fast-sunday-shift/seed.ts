import {
  createAssignment,
  createConductingRotation,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// March 2026 is chosen deliberately. It contains the 2026-03-08 US daylight-saving transition, so
// a timezone bug in the grid shows up as a visibly wrong date — "March 7" in a Sunday cell — rather
// than as a subtle off-by-one somewhere nobody looks.
//
// The month is seeded ROW BY ROW rather than generated, so the collision is deterministic: March 1
// is already Fast Sunday with no speakers, and March 8 already carries the three approved speakers
// that Fast Sunday will land on. Generation would have produced the same shape, but not the
// assignments, and the assignments are the whole point.
//
// conducting_user_id is written explicitly on every Sunday. The rotation cycles bishop →
// counselor1 → counselor2 anchored on 2026-01-04, and these values are what that cycle produces
// for March — March 1 is the 8th Sunday from the anchor, so it lands on position 3.
//
// That is not decoration. conducting_user_id is STORED, never computed at read time
// (03-calendar.md Step 3), and populateConducting() only fills rows that are still null. A Sunday
// seeded without a conductor stays without one forever, which is what the rotation checks below
// are actually observing.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  // The rotation edit fires admin_setting_changed, and a ward created outside
  // supabase/seed/ward.sql has no notification_settings rows at all.
  await seedNotificationTriggers();

  // --- Four permission seats, one per row of the matrix this phase turns on ----------
  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // calendar.manage but NOT admin.manage_ward (calendar-a Decision 5). May edit any Sunday; must
  // not see the rotation panel or be able to change the ward's default speaker count.
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  // calendar.view only. The read-only seat.
  await createTestUser({
    handle: "music",
    role: "music_coordinator",
    firstName: "Elena",
    lastName: "Vasquez",
  });

  // No calendar permission at all. The 403 check on PATCH /api/sundays/[id] is the one that
  // matters here, because migration 019 grants the underlying UPDATE to every ward member — a
  // route that forgot assertCan() would let this account rewrite the calendar.
  await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tomas",
    lastName: "Ruiz",
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

  // --- The rotation ------------------------------------------------------------------
  // One set of three rows at one effective_from. Reordering in the app INSERTS a second set at a
  // later date rather than editing these, which is what makes "applies forward only" true by
  // construction (migration 023, Part 2).
  await createConductingRotation({
    effectiveFrom: "2026-01-04",
    userIds: [bishop.id, counselorOne.id, counselorTwo.id],
  });

  // --- March 2026 --------------------------------------------------------------------
  await createSunday({
    date: "2026-03-01",
    type: "fast_sunday",
    speakingSlots: 0,
    conductingUserId: counselorTwo.id,
  });

  // The collision. Fast Sunday moves here the moment March 1 becomes a Stake Conference.
  const marchEighth = await createSunday({
    date: "2026-03-08",
    speakingSlots: 3,
    conductingUserId: bishop.id,
    notes: "High Council visit — the notes line is here to check the two-line clamp in the grid.",
  });

  await createSunday({
    date: "2026-03-15",
    speakingSlots: 3,
    conductingUserId: counselorOne.id,
  });

  await createSunday({
    date: "2026-03-22",
    speakingSlots: 3,
    conductingUserId: counselorTwo.id,
  });

  await createSunday({
    date: "2026-03-29",
    speakingSlots: 3,
    conductingUserId: bishop.id,
  });

  // --- The three speakers whose work is at risk ---------------------------------------
  const household = await createHousehold({
    familyName: "Brooks",
    address: "48 Willow Lane",
  });

  const speakers = [
    { firstName: "Sarah", lastName: "Brooks" },
    { firstName: "David", lastName: "Nguyen" },
    { firstName: "Julia", lastName: "Andersen" },
  ];

  for (const [index, speaker] of speakers.entries()) {
    const memberId = await createMember({
      firstName: speaker.firstName,
      lastName: speaker.lastName,
      householdId: household,
      category: "adult",
    });

    // 'approve', not 'plan'. A reverted assignment is set to 'plan', so seeding them at 'plan'
    // would make the revert invisible — the rows would look identical before and after and the
    // scenario would pass whether or not the code did anything.
    await createAssignment({
      sundayId: marchEighth,
      memberId,
      pipelineStage: "approve",
      slotNumber: index + 1,
      plannedBy: bishop.id,
    });
  }

  console.log(
    "  ward, 6 users, 1 rotation (effective 2026-01-04), 5 Sundays in March 2026 " +
      "(03-01 fast with 0 slots), 1 household, 3 members, 3 approved assignments on 03-08, " +
      "all notification triggers",
  );
}
