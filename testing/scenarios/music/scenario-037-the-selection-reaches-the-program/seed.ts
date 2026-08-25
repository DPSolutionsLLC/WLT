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

// A SUNDAY WITH A PROGRAM ALREADY BUILT, AND EXACTLY ONE HYMN SLOT LEFT EMPTY.
//
// ---------------------------------------------------------------------------------------------
// THE STORED draft_data IS WRITTEN LITERALLY, NOT ASSEMBLED
// ---------------------------------------------------------------------------------------------
// A seed that called assembleDraft() would agree with a fresh assembly BY CONSTRUCTION, and the
// scenario would pass even if the app re-derived the draft on every read — which is the exact bug
// it exists to catch. So the snapshot below is written out by hand, and it is the tester's action
// on the Music screen that makes the two disagree (the same reasoning as scenario 029's seed).
//
// It deliberately carries `version: 1`. A stored draft with no version is a migration nobody can
// write safely later, and a seed that omitted it would be testing a shape the app never writes.
//
// ---------------------------------------------------------------------------------------------
// WHY THE SACRAMENT HYMN IS THE EMPTY ONE
// ---------------------------------------------------------------------------------------------
// One unambiguous gap means one line to look for in the refresh diff. Opening and closing are
// seeded to MATCH the stored draft exactly, so if either of them shows up as changed, the fixture
// has drifted rather than the app having a bug — and the scenario says so in its Notes.
//
// The hymns table itself is NOT seeded here. It has no ward_id (migration 006), it is loaded by
// supabase/seed/hymns.sql plus `npm run hymns:placeholders`, and a scenario that wrote to it
// would be editing every ward's hymnbook. Hymns 19, 152 and 173 are all among the 42 hand-verified
// rows, so the titles a tester reads on screen can be checked against a real book.

const SUNDAY_DATE = "2026-11-15";

export async function seed(): Promise<void> {
  await ensureTestWard({
    name: "Harness Test Ward",
    settings: {
      leadership_contacts: [
        { role: "Bishop", name: "Mark Andersen", phone: "555-0100" },
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

  const secretary = await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Delgado",
  });

  await createTestUser({
    handle: "music",
    role: "music_coordinator",
    firstName: "Ellen",
    lastName: "Cardoso",
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
    speakingSlots: 2,
    conductingUserId: bishop.id,
  });

  await createAssignment({
    sundayId: sunday,
    slotNumber: 1,
    memberId: sarah,
    topicId: topic,
    pipelineStage: "notify",
    notifySentAt: "2026-11-01T18:00:00.000Z",
  });

  await createAssignment({
    sundayId: sunday,
    slotNumber: 2,
    memberId: david,
    pipelineStage: "notify",
    notifySentAt: "2026-11-01T18:05:00.000Z",
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

  // NO SACRAMENT HYMN. This is the gap the tester fills from the Music screen.

  await createProgram({
    sundayId: sunday,
    status: "draft",
    createdBy: secretary.id,
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
      // The gap. After the tester chooses hymn 173 on the Music screen, this must STILL be null
      // until a refresh is applied — that is the snapshot rule, and it is the whole scenario.
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
          kind: "member",
          printedName: "David Brooks",
          publicName: "David Brooks",
          topic: null,
        },
      ],
      closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
      benediction: null,
      announcements: null,
      leadershipContacts: [
        { role: "Bishop", name: "Mark Andersen", phone: "555-0100" },
        { role: "Ward Secretary", name: "Ruth Delgado", phone: "555-0102" },
      ],
      missionaries: null,
      missing: [
        "organist",
        "chorister",
        "sacrament_hymn",
        "benediction",
        "announcements",
      ],
    },
  });

  console.log(
    "  ward, 3 users, 1 household, 2 members, 1 topic, 1 Sunday, 2 assignments, 1 prayer, 2 hymns (no sacrament hymn), 1 program at draft",
  );
}
