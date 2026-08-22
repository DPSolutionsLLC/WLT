import {
  createAssignment,
  createAssignmentApproval,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  createTopic,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// March 2026 opens on a SUNDAY, so the month grid has no leading blank cells and 03-01 is the
// fast Sunday. That matters here for one reason: 03-01 carries speaking_slots = 0, and the
// planner must key off the SLOT COUNT rather than the Sunday type when it decides whether to
// offer an add control (talks-a Decision 6).
//
// The two counselors are the ones who have already approved, and the BISHOP is the one still to
// decide. That is deliberate: CLAUDE.md §7 says bishopric admin authority is shared, so if any
// code path treats the bishop as special, an indicator that has to name him by name is where it
// shows.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  // The approval and invalidation paths fire plan_approved and plan_change_requested, and a ward
  // created outside supabase/seed/ward.sql has no notification_settings rows at all.
  await seedNotificationTriggers();

  // --- The bishopric: three DIFFERENT accounts ---------------------------------------
  // assignment_approvals_one_per_user (UNIQUE on assignment_id, user_id) is what stops one
  // counselor filling a three-person gate alone, so a 2-of-3 state genuinely needs two people.
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

  // --- The read-only seat -------------------------------------------------------------
  // Holds talks.view and NOT talks.plan. The likelier wiring mistake is not a missing page but a
  // read-only viewer who still gets an Edit button, which looks entirely normal until pressed.
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  // --- The refused seat ---------------------------------------------------------------
  // Holds no talks permission at all and must reach a "Not permitted" page, never an empty
  // planner — an empty month reads as "nothing is planned", which is a different claim.
  await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Tomas",
    lastName: "Ruiz",
  });

  // --- Speakers ------------------------------------------------------------------------
  // With phone numbers, so the NOTIFY stage has something to build an sms: link from later in
  // the pipeline.
  const whitfield = await createHousehold({ familyName: "Whitfield" });
  const bell = await createHousehold({ familyName: "Bell" });
  const bennett = await createHousehold({ familyName: "Bennett" });

  const sarah = await createMember({
    firstName: "Sarah",
    lastName: "Whitfield",
    householdId: whitfield,
    category: "adult",
    phone: "(801) 555-0134",
  });

  const andre = await createMember({
    firstName: "Andre",
    lastName: "Bell",
    householdId: bell,
    category: "adult",
    phone: "(801) 555-0192",
  });

  const claire = await createMember({
    firstName: "Claire",
    lastName: "Bennett",
    householdId: bennett,
    category: "adult",
    phone: "(801) 555-0177",
  });

  // --- Topics ---------------------------------------------------------------------------
  // plan -> review refuses without a topic_id, so a month with no topics has nothing that can
  // move off the first stage at all.
  const faith = await createTopic({ title: "Faith in Jesus Christ" });
  const burdens = await createTopic({ title: "Bearing One Another's Burdens" });
  const sabbath = await createTopic({ title: "The Sabbath Day" });

  // --- March 2026 -------------------------------------------------------------------------
  const sundays: Record<string, string> = {};

  for (const date of [
    "2026-03-01",
    "2026-03-08",
    "2026-03-15",
    "2026-03-22",
    "2026-03-29",
  ]) {
    sundays[date] = await createSunday({
      date,
      // 03-01 is the first Sunday of the month, so generation would type it fast_sunday anyway.
      // Zero speaking slots is the whole point of including it.
      type: date === "2026-03-01" ? "fast_sunday" : "standard",
      speakingSlots: date === "2026-03-01" ? 0 : 3,
      conductingUserId: bishop.id,
    });
  }

  // --- 03-08: fully planned, at review, waiting on ONE approval --------------------------
  const slotOne = await createAssignment({
    sundayId: sundays["2026-03-08"],
    memberId: sarah,
    topicId: faith,
    slotNumber: 1,
    slotLengthMinutes: 12,
    pipelineStage: "review",
    plannedBy: counselorOne.id,
  });

  await createAssignment({
    sundayId: sundays["2026-03-08"],
    memberId: andre,
    topicId: burdens,
    slotNumber: 2,
    slotLengthMinutes: 10,
    pipelineStage: "review",
    plannedBy: counselorOne.id,
  });

  await createAssignment({
    sundayId: sundays["2026-03-08"],
    memberId: claire,
    topicId: sabbath,
    slotNumber: 3,
    slotLengthMinutes: 15,
    pipelineStage: "review",
    plannedBy: counselorOne.id,
  });

  // TWO of the three, from two different people. The bishop is deliberately absent — the
  // indicator has to name him.
  await createAssignmentApproval({
    assignmentId: slotOne,
    userId: counselorOne.id,
    approved: true,
  });

  await createAssignmentApproval({
    assignmentId: slotOne,
    userId: counselorTwo.id,
    approved: true,
    comment: "Sarah will do well with this one.",
  });

  // --- 03-15: half planned ----------------------------------------------------------------
  // One speaker, no topic. It cannot reach review, and the refusal must name the topic as what
  // is missing rather than failing silently.
  await createAssignment({
    sundayId: sundays["2026-03-15"],
    memberId: claire,
    slotNumber: 1,
    slotLengthMinutes: 10,
    pipelineStage: "plan",
    plannedBy: counselorOne.id,
  });

  // --- 03-22: deliberately EMPTY -----------------------------------------------------------
  // Three slots, no assignments. Every one must read "Slot N — open" rather than as a blank
  // line: an unfilled slot is information, and a blank reads as a rendering fault.

  console.log(
    "  ward, 5 users, 3 households, 3 members with phones, 3 topics, 5 Sundays in March 2026 " +
      "(03-01 fast with 0 slots), 4 assignments (03-08 fully planned at review with 2 of 3 " +
      "approvals; 03-15 half planned; 03-22 empty), all notification triggers",
  );
}
