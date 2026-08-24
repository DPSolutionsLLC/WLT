import {
  createAiSettings,
  createAssignment,
  createAssignmentComment,
  createHousehold,
  createMember,
  createSunday,
  createTestUser,
  createTopic,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// Four assignments on one Sunday, each staged to make a different thing visible. The point of the
// scenario is that the drafting route WRITES NOTHING, and that is only legible in a browser:
// generate a draft, walk away, come back, and see that nothing was kept.
//
// THE THREE COMMENTS ON SLOT 2 ARE THE POINT OF THIS SEED. `buildThankYouMessage` has taken a
// `comments` parameter since talks-b and ContactStagePanel passed `[]` hard-coded, so every
// thank-you in this app has been generic for want of an input nobody had wired. `ai-c` connects
// the assignment's comment thread to it. A seeded thread is the only way to walk that connection
// — it cannot be created by pressing anything.
//
// The three comments are deliberately SPECIFIC and deliberately from DIFFERENT people. A generic
// comment ("good talk") would be indistinguishable from what a model invents on its own, which
// would make the whole check unjudgeable.

const AUGUST = "2026-08-12T15:00:00.000Z";
const SUNDAY = "2026-09-13";

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  // --- The bishopric ---------------------------------------------------------------------------
  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  const counselor = await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });

  // --- Holds talks.view and NOTHING else here ---------------------------------------------------
  // CLAUDE.md §8 names this fixture as the one whose permissions are not the intuitive answer: a
  // music coordinator can open the Sunday and read it, and holds neither `talks.plan` nor
  // `talks.confirm`. So they must see the assignments and NO draft buttons.
  await createTestUser({
    handle: "music",
    role: "music_coordinator",
    firstName: "Elena",
    lastName: "Marsh",
  });

  // --- A distinctive tone -----------------------------------------------------------------------
  // "Warm and brief, never formal" has to be audible in the output or the tone setting is not
  // reaching the prompt. A bland tone makes that check impossible to fail.
  await createAiSettings({
    createdAt: AUGUST,
    savedBy: bishop.id,
    toneVoice:
      "Warm and brief, never formal. Short sentences. Write the way you would text a friend " +
      "from church, not the way a letter opens.",
    doctrinalEmphasis: "Christ-centred and practical.",
    canonPriority: ["book_of_mormon"],
    maxScriptureReferences: 2,
    maxYearsOld: null,
    maxConferenceTalks: 1,
    preferKnowledgeBase: true,
    thankYouPreferences:
      "Say something specific about what they actually spoke about. Never a form letter.",
  });

  // --- The Sunday and the speakers --------------------------------------------------------------
  const sundayId = await createSunday({
    date: SUNDAY,
    type: "standard",
    speakingSlots: 4,
    conductingUserId: counselor.id,
  });

  const whitfield = await createHousehold({ familyName: "Whitfield" });
  const okonkwo = await createHousehold({ familyName: "Okonkwo" });
  const reyes = await createHousehold({ familyName: "Reyes" });

  const sarah = await createMember({
    firstName: "Sarah",
    lastName: "Whitfield",
    householdId: whitfield,
    category: "adult",
    phone: "(801) 555-0134",
  });

  const daniel = await createMember({
    firstName: "Daniel",
    lastName: "Okonkwo",
    householdId: okonkwo,
    category: "adult",
    phone: "(801) 555-0177",
  });

  const maria = await createMember({
    firstName: "Maria",
    lastName: "Reyes",
    householdId: reyes,
    category: "adult",
    phone: "(801) 555-0192",
  });

  const burdens = await createTopic({
    title: "Bearing One Another's Burdens",
    category: "doctrinal",
    description: "Mosiah 18 and what a covenant people owe each other.",
    suggestedScriptures: ["Mosiah 18:8-10", "Galatians 6:2"],
  });

  // --- Slot 1: at CONFIRM, with a topic and scriptures ------------------------------------------
  // The confirmation draft's inputs are all here — a name, a date, a topic, a length and two
  // scripture references — so a draft missing any of them is a visible defect rather than an
  // absence somebody has to reason about.
  await createAssignment({
    sundayId,
    memberId: sarah,
    topicId: burdens,
    slotNumber: 1,
    slotLengthMinutes: 12,
    pipelineStage: "confirm",
    plannedBy: counselor.id,
    requestOutcome: "accepted",
  });

  // --- Slot 2: at APPRECIATE, with THREE comments from different people --------------------------
  const commented = await createAssignment({
    sundayId,
    memberId: daniel,
    topicId: burdens,
    slotNumber: 2,
    slotLengthMinutes: 12,
    pipelineStage: "appreciate",
    plannedBy: counselor.id,
    requestOutcome: "accepted",
    notifySentAt: "2026-09-08T18:00:00.000Z",
    sundayConfirmedAt: "2026-09-13T19:00:00.000Z",
  });

  await createAssignmentComment({
    assignmentId: commented,
    userId: bishop.id,
    level: "assignment",
    comment:
      "He talked about carrying his neighbour's groceries up three flights for a year and " +
      "never mentioning it. The room went completely quiet.",
  });

  await createAssignmentComment({
    assignmentId: commented,
    userId: counselor.id,
    level: "assignment",
    comment:
      "The bit about his grandmother's letters landed with the youth — I watched them stop " +
      "looking at their phones.",
  });

  await createAssignmentComment({
    assignmentId: commented,
    userId: bishop.id,
    level: "assignment",
    comment: "Ran about four minutes long and nobody minded in the slightest.",
  });

  // --- Slot 3: at APPRECIATE, with NO comments --------------------------------------------------
  // The other half of the same check. A thank-you with nothing observed must still be a usable
  // message — not a broken one with a gap where a sentence should be, and not one that invents a
  // talk that was never given.
  await createAssignment({
    sundayId,
    memberId: maria,
    topicId: burdens,
    slotNumber: 3,
    slotLengthMinutes: 10,
    pipelineStage: "appreciate",
    plannedBy: counselor.id,
    requestOutcome: "accepted",
    notifySentAt: "2026-09-08T18:00:00.000Z",
    sundayConfirmedAt: "2026-09-13T19:00:00.000Z",
  });

  // --- Slot 4: an external speaker with contact WAIVED (ITER-004) --------------------------------
  // The waived stages read "Not applicable" with no controls at all, and the AI button must not
  // reappear there — not even disabled. A disabled button reads as "this is coming", and the whole
  // point of the waiver is that it is not (talks-b).
  await createAssignment({
    sundayId,
    externalSpeakerName: "Thomas Bridger",
    externalSpeakerTitle: "President",
    slotNumber: 4,
    slotLengthMinutes: 15,
    pipelineStage: "confirm",
    plannedBy: counselor.id,
    contactWaivedAt: "2026-09-01T16:00:00.000Z",
    contactWaivedBy: bishop.id,
  });

  console.log(
    "  ward, 3 users (bishop, counselor1, music), 1 AI settings version with a distinctive " +
      "tone, 1 Sunday (2026-09-13) with 4 assignments: slot 1 at CONFIRM with a topic, slot 2 " +
      "at APPRECIATE with 3 bishopric comments, slot 3 at APPRECIATE with none, slot 4 an " +
      "external speaker with contact waived",
  );
}
