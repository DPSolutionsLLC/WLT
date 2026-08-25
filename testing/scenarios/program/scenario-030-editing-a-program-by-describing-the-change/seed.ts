import {
  createAssignment,
  createHousehold,
  createHymnSelection,
  createMember,
  createPrayerAssignment,
  createProgram,
  createSunday,
  createTestUser,
  createTopic,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// SCENARIO 028'S SUNDAY, WITH ITS PROGRAM ALREADY BUILT AND SITTING AT `draft`.
//
// ---------------------------------------------------------------------------------------------
// WHY THE PROGRAM IS SEEDED RATHER THAN BUILT DURING THE WALK
// ---------------------------------------------------------------------------------------------
// The subject here is the AI EDITOR, not the assembler — 028 already walks the build. Starting at
// a stored draft means the tester's first action is the one under test, and it means the "before"
// text is known exactly, which is what makes "only the two described fields moved" a real check
// rather than an impression.
//
// ---------------------------------------------------------------------------------------------
// THE DRAFT IS WRITTEN OUT LITERALLY
// ---------------------------------------------------------------------------------------------
// Same reasoning as scenario 029: a seed that called assembleDraft() would agree with a fresh
// assembly by construction. Written by hand, it is a snapshot with a known text in every field
// the instruction touches.
//
// ---------------------------------------------------------------------------------------------
// BOTH FIELDS THE INSTRUCTION NAMES ALREADY HOLD TEXT
// ---------------------------------------------------------------------------------------------
// `wardBusiness` carries a real sentence and `specialNotes` is null. The instruction asks for one
// ADDITION and one CHANGE, so the diff has to show a null → text row and a text → text row. A
// fixture where both were null would let a diff that cannot render a "before" pass unnoticed
// (plans/retros/ai-b-knowledge-and-retrieval.md: a fixture whose own design hides a bug is worse
// than no fixture).
//
// The five gaps from 028 are kept exactly as they were, so the missing panel is on screen
// throughout and an AI edit that quietly rewrote `missing` would be visible.

const SUNDAY_DATE = "2026-09-20";

const WARD_BUSINESS =
  "Sustaining Brother Alvarez as the new Elders Quorum secretary, and releasing Brother Whitfield.";

export async function seed(): Promise<void> {
  await ensureTestWard({
    name: "Harness Test Ward",
    settings: {
      leadership_contacts: [
        { role: "Bishop", name: "Mark Andersen", phone: "555-0100" },
        { role: "First Counselor", name: "Peter Lindqvist", phone: "555-0101" },
        { role: "Ward Secretary", name: "Ruth Delgado", phone: "555-0102" },
      ],
      missionaries: null,
      program_template: {
        ward_name: "Harness Test Ward",
        church_name: "The Church of Jesus Christ of Latter-day Saints",
      },
    },
  });

  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "counselor",
    role: "counselor",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Lindqvist",
  });

  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Delgado",
  });

  const household = await createHousehold({
    familyName: "Whitfield",
    address: "2201 Canyon Road",
  });

  const sarah = await createMember({
    firstName: "Sarah",
    lastName: "Whitfield",
    householdId: household,
    category: "adult",
    gender: "female",
  });

  const david = await createMember({
    firstName: "David",
    lastName: "Brooks",
    householdId: household,
    category: "adult",
    gender: "male",
  });

  const topic = await createTopic({ title: "Charity Never Faileth", source: "manual" });

  const sunday = await createSunday({
    date: SUNDAY_DATE,
    type: "standard",
    speakingSlots: 3,
    conductingUserId: bishop.id,
  });

  // Slot 1 — a ward member, notified.
  await createAssignment({
    sundayId: sunday,
    slotNumber: 1,
    memberId: sarah,
    topicId: topic,
    pipelineStage: "notify",
    notifySentAt: "2026-09-06T18:00:00.000Z",
  });

  // Slot 2 — ITER-004. A visiting stake leader with the contact waiver set, printed in FULL.
  await createAssignment({
    sundayId: sunday,
    slotNumber: 2,
    externalSpeakerName: "Mark Andersen",
    externalSpeakerTitle: "President",
    pipelineStage: "notify",
    contactWaivedAt: "2026-09-05T18:00:00.000Z",
    contactWaivedBy: bishop.id,
  });

  // Slot 3 — no assignment row at all.

  await createPrayerAssignment({
    sundayId: sunday,
    prayerType: "invocation",
    memberId: david,
    stage: "done",
    askedBy: bishop.id,
  });

  await createHymnSelection({
    sundayId: sunday,
    hymnType: "opening",
    hymnNumber: 19,
    hymnTitle: "We Thank Thee, O God, for a Prophet",
  });

  await createHymnSelection({
    sundayId: sunday,
    hymnType: "closing",
    hymnNumber: 152,
    hymnTitle: "God Be with You Till We Meet Again",
  });

  await createProgram({
    sundayId: sunday,
    status: "draft",
    createdBy: bishop.id,
    draftData: {
      version: 1,
      heading: null,
      date: SUNDAY_DATE,
      sundayType: "standard",
      presiding: { printedName: "Mark Andersen", publicName: "Mark A." },
      conducting: { printedName: "Mark Andersen", publicName: "Mark A." },
      organist: null,
      chorister: null,
      openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
      invocation: { printedName: "David Brooks", publicName: "David B." },
      // Holds real text, so the diff has a "before" to render on one of the two changed rows.
      wardBusiness: WARD_BUSINESS,
      sacramentHymn: null,
      // Null, so the other changed row is an addition. Two different shapes, one instruction.
      specialNotes: null,
      musicalNumber: null,
      speakers: [
        {
          slotNumber: 1,
          kind: "member",
          printedName: "Sarah Whitfield",
          publicName: "Sarah W.",
          topic: "Charity Never Faileth",
        },
        {
          slotNumber: 2,
          kind: "external",
          printedName: "President Mark Andersen",
          publicName: "President Mark Andersen",
          topic: null,
        },
        {
          slotNumber: 3,
          kind: "empty",
          printedName: null,
          publicName: null,
          topic: null,
        },
      ],
      closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
      benediction: null,
      announcements: null,
      leadershipContacts: [
        { role: "Bishop", name: "Mark Andersen", phone: "555-0100" },
        { role: "First Counselor", name: "Peter Lindqvist", phone: "555-0101" },
        { role: "Ward Secretary", name: "Ruth Delgado", phone: "555-0102" },
      ],
      missionaries: null,
      // 028's five gaps, unchanged. They stay on screen throughout the walk, so an AI edit that
      // quietly rewrote this array would be visible rather than silent.
      missing: [
        "organist",
        "chorister",
        "sacrament_hymn",
        "speaker_slot",
        "benediction",
        "announcements",
      ],
    },
  });

  console.log(
    "  ward, 3 users, 1 household, 2 members, 1 topic, 1 Sunday, 2 assignments, 1 prayer, 2 hymns, 1 program at draft",
  );
}
