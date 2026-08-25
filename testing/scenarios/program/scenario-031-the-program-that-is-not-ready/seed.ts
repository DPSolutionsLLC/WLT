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

// SCENARIO 028'S SUNDAY AND ITS SIX GAPS, WITH THE PROGRAM ALREADY BUILT AND SITTING AT `draft`.
//
// ---------------------------------------------------------------------------------------------
// MISSING IS NOT AN ERROR STATE — THAT IS THE WHOLE SUBJECT
// ---------------------------------------------------------------------------------------------
// A Thursday program with six gaps is the NORMAL case, not the broken one (06-program-music.md
// §Step 2). No test can judge whether the screen reads as *work remaining* or as *something went
// wrong*, so this seed exists to put a person in front of exactly that screen.
//
// ---------------------------------------------------------------------------------------------
// TWO OPEN SPEAKING SLOTS, NOT ONE
// ---------------------------------------------------------------------------------------------
// This is the difference from 028, and it is deliberate. `speaker_slot` is the ONE key that can
// stand for more than one thing, and the panel collapses it into a single counted line. With one
// open slot the plural path is unreachable and a broken pluraliser reads as passing — the "all 1
// of its passages" bug, whose whole cause was a fixture with exactly one of everything
// (plans/retros/ai-b-knowledge-and-retrieval.md).
//
// So slot 2's external speaker is gone and slots 2 AND 3 are empty: "2 speaking slots are still
// open."
//
// ---------------------------------------------------------------------------------------------
// SIX GAPS, ALL AT ONCE
// ---------------------------------------------------------------------------------------------
// Sacrament hymn, benediction, announcements, organist, chorister and the speaking slots. Enough
// that "is this overwhelming?" is a real question with a real answer in front of the tester.

const SUNDAY_DATE = "2026-09-20";

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

  // Slots 2 AND 3 — no assignment rows at all. TWO open slots, so the missing panel has to
  // pluralise. See the note at the top of this file.

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
      presiding: { printedName: "Mark Andersen", publicName: "Mark Andersen" },
      conducting: { printedName: "Mark Andersen", publicName: "Mark Andersen" },
      organist: null,
      chorister: null,
      openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
      invocation: { printedName: "David Brooks", publicName: "David Brooks" },
      wardBusiness: null,
      sacramentHymn: null,
      specialNotes: null,
      musicalNumber: null,
      speakers: [
        {
          slotNumber: 1,
          kind: "member",
          printedName: "Sarah Whitfield",
          publicName: "Sarah Whitfield",
          topic: "Charity Never Faileth",
        },
        {
          slotNumber: 2,
          kind: "empty",
          printedName: null,
          publicName: null,
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
      // Six keys, one of which — speaker_slot — stands for TWO open slots. The panel counts that
      // from the speakers, not from this array, because assembleDraft emits the key once however
      // many slots are open.
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
    "  ward, 3 users, 1 household, 2 members, 1 topic, 1 Sunday, 1 assignment, 1 prayer, 2 hymns, 1 program at draft with 6 gaps",
  );
}
