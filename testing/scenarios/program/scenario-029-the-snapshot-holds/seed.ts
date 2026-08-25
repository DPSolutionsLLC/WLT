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

// SCENARIO 028'S SUNDAY, PLUS A PROGRAM ALREADY STORED AND ALREADY SUBMITTED FOR APPROVAL.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS IS SEEDED RATHER THAN BUILT BY HAND
// ---------------------------------------------------------------------------------------------
// The claim under test is that the stored draft does NOT follow its sources. Proving it needs a
// draft that was written at one moment and an upstream row that changed at a later one — which,
// walked by hand, means building a program, remembering exactly what it said, going to another
// screen, changing a speaker, and coming back. Seeding the "before" state removes every step
// except the one that matters.
//
// ---------------------------------------------------------------------------------------------
// THE STORED draft_data IS WRITTEN LITERALLY, NOT ASSEMBLED
// ---------------------------------------------------------------------------------------------
// A seed that called assembleDraft() would agree with a fresh assembly by construction, and the
// scenario would pass even if the app re-derived the draft on every read — the exact bug it
// exists to catch. So the snapshot below is written out by hand, and it names SARAH while the
// assignment rows are the ones the tester will change.
//
// It deliberately carries `version: 1`. A stored draft with no version is a migration nobody can
// write safely later, and a seed that omitted it would be testing a shape the app never writes.

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

  // The member the tester will switch slot 1 to. Seeded so the change is two taps rather than a
  // detour through creating somebody.
  await createMember({
    firstName: "Ruth",
    lastName: "Okonkwo",
    householdId: household,
    category: "adult",
    gender: "female",
  });

  const topic = await createTopic({ title: "Charity Never Faileth", source: "manual" });

  const sunday = await createSunday({
    date: SUNDAY_DATE,
    type: "standard",
    speakingSlots: 3,
    conductingUserId: bishop.id,
  });

  await createAssignment({
    sundayId: sunday,
    slotNumber: 1,
    memberId: sarah,
    topicId: topic,
    pipelineStage: "notify",
    notifySentAt: "2026-09-06T18:00:00.000Z",
  });

  await createAssignment({
    sundayId: sunday,
    slotNumber: 2,
    externalSpeakerName: "Mark Andersen",
    externalSpeakerTitle: "President",
    pipelineStage: "notify",
    contactWaivedAt: "2026-09-05T18:00:00.000Z",
    contactWaivedBy: bishop.id,
  });

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
    status: "pending_approval",
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
      wardBusiness: null,
      sacramentHymn: null,
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
    "  ward, 2 users, 1 household, 3 members, 1 topic, 1 Sunday, 2 assignments, 1 prayer, 2 hymns, 1 program at pending_approval",
  );
}
