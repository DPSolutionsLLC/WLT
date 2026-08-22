import {
  createAssignment,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  createTopic,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// ITER-004, set up so the two cases sit side by side on one Sunday: slot 1 a ward member with a
// phone number and real contact stages, slot 2 somebody invited from outside the ward with
// neither. Reading them next to each other is the only way to judge whether the waived stages
// look like work nobody needs to do, or like work nobody has done.
//
// The external speaker is seeded WITHOUT a waiver on purpose. The waiver being offered, read and
// pressed is half of what this scenario tests — seeding it already set would skip the half that
// can go wrong.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

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

  // --- The member with a phone: the contrast case ------------------------------------
  const whitfield = await createHousehold({ familyName: "Whitfield" });
  const sarah = await createMember({
    firstName: "Sarah",
    lastName: "Whitfield",
    householdId: whitfield,
    category: "adult",
    phone: "(801) 555-0134",
  });

  // --- The member with NO phone: the third case --------------------------------------
  // A null phone must render as no link at all, never as a dead or disabled anchor. That is a
  // different case from the external speaker, and the two are easy to conflate in code.
  const bell = await createHousehold({ familyName: "Bell" });
  const andre = await createMember({
    firstName: "Andre",
    lastName: "Bell",
    householdId: bell,
    category: "adult",
  });

  const faith = await createTopic({ title: "Faith in Jesus Christ" });
  const sabbath = await createTopic({ title: "The Sabbath Day" });

  // --- April 2026 ---------------------------------------------------------------------
  const sundays: Record<string, string> = {};

  for (const date of ["2026-04-05", "2026-04-12", "2026-04-19", "2026-04-26"]) {
    sundays[date] = await createSunday({
      date,
      type: date === "2026-04-05" ? "fast_sunday" : "standard",
      speakingSlots:
        date === "2026-04-05" ? 0 : date === "2026-04-12" ? 2 : 3,
      conductingUserId: bishop.id,
    });
  }

  // --- 04-12 slot 1: an ordinary member, well into the pipeline -----------------------
  // At `notify` with the message already approved, so the sms: handoff and its copy fallback are
  // both reachable in one click from the seed.
  await createAssignment({
    sundayId: sundays["2026-04-12"],
    memberId: sarah,
    topicId: faith,
    slotNumber: 1,
    slotLengthMinutes: 12,
    pipelineStage: "notify",
    plannedBy: bishop.id,
    requestOutcome: "accepted",
    notifyMessage:
      "Hello Sarah,\n\nThank you for agreeing to speak in sacrament meeting on Sunday, " +
      'April 12.\n\nYour topic is "Faith in Jesus Christ".\n\nPlease plan for about 12 minutes.',
  });

  // --- 04-12 slot 2: the visiting speaker, no waiver yet ------------------------------
  // No member_id at all. assignment_history.member_id is `not null`, so reaching `complete`
  // writes no history row for them — ITER-004's "speaker history is not distorted" is true by
  // construction rather than by a check somebody has to remember (talks-a).
  //
  // The name matches the bishop's on purpose. An external speaker is plain text with no account
  // behind it, and anything that quietly linked the two would be a real bug.
  await createAssignment({
    sundayId: sundays["2026-04-12"],
    externalSpeakerName: "Mark Andersen",
    externalSpeakerTitle: "President",
    topicId: sabbath,
    slotNumber: 2,
    slotLengthMinutes: 15,
    pipelineStage: "approve",
    assignmentType: "high_council",
    plannedBy: bishop.id,
  });

  // --- 04-19 slot 1: a member with no phone number ------------------------------------
  await createAssignment({
    sundayId: sundays["2026-04-19"],
    memberId: andre,
    topicId: faith,
    slotNumber: 1,
    slotLengthMinutes: 10,
    pipelineStage: "notify",
    plannedBy: bishop.id,
    requestOutcome: "accepted",
    notifyMessage:
      "Hello Andre,\n\nThank you for agreeing to speak in sacrament meeting on Sunday, April 19.",
  });

  console.log(
    "  ward, 2 users, 2 households, 2 members (Sarah with a phone, Andre without), 2 topics, " +
      "4 Sundays in April 2026 (04-12 with 2 slots), 3 assignments (04-12 slot 1 a member at " +
      "notify, slot 2 an EXTERNAL speaker at approve with no waiver; 04-19 a member with no " +
      "phone at notify), all notification triggers",
  );
}
