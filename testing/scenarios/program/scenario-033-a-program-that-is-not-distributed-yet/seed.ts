import {
  createAssignment,
  createHousehold,
  createHymnSelection,
  createMember,
  createPrayerAssignment,
  createProgram,
  createPublicPage,
  createSunday,
  createTestUser,
  createTopic,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// SCENARIO 032'S WARD, ONE STATUS EARLIER — approved, signed off, and NOT YET PUBLIC.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS IS ITS OWN SCENARIO
// ---------------------------------------------------------------------------------------------
// The gate is the whole product decision, and it is the one state that is genuinely awkward to
// reach by hand: a person would have to build a program, submit it, approve it, and then stop
// exactly there without pressing distribute. Seeding it takes one word.
//
// FEATURES.md says the public page "always reflects the most current APPROVED version", which
// reads as though approval were the gate. It is not, deliberately: DISTRIBUTION IS THE ACT OF
// PUBLISHING. A program the bishopric has signed off and not yet handed to anybody is not yet the
// congregation's. If that turns out to be the wrong call it is a one-word change in migration 039
// — but it is a product decision, not a refactor, and this scenario is where a person sees it.
//
// ---------------------------------------------------------------------------------------------
// public_data IS WRITTEN, AND THE PAGE STILL 404s
// ---------------------------------------------------------------------------------------------
// That is not a mistake in this seed. The approve route writes the projection, so an approved
// program legitimately HAS one — the status is what withholds it. Seeding public_data as null
// would make the scenario pass for the wrong reason: it would prove the `is not null` guard works
// and prove nothing at all about the status gate.
//
// The public_pages row is ACTIVE for the same reason. Every ingredient is present except the one
// under test.

const SUNDAY_DATE = "2026-09-20";

const PUBLIC_SLUG = "harness-ward-program";

export async function seed(): Promise<void> {
  await ensureTestWard({
    name: "Harness Test Ward",
    settings: {
      leadership_contacts: [
        { role: "Bishop", name: "Mark Andersen", phone: "555-0100" },
        { role: "First Counselor", name: "Peter Lindqvist", phone: "555-0101" },
        { role: "Ward Secretary", name: "Ruth Delgado", phone: "555-0102" },
      ],
      missionaries: "Elder Kim and Elder Osei — 555-0188, apartment 4B, 1140 Meadow Lane",
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
    phone: "555-0142",
  });

  const david = await createMember({
    firstName: "David",
    lastName: "Brooks",
    householdId: household,
    category: "adult",
    gender: "male",
    phone: "555-0143",
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
    hymnType: "sacrament",
    hymnNumber: 193,
    hymnTitle: "I Stand All Amazed",
  });

  await createHymnSelection({
    sundayId: sunday,
    hymnType: "closing",
    hymnNumber: 152,
    hymnTitle: "God Be with You Till We Meet Again",
  });

  // APPROVED, with both stamps, and distributed_at deliberately left null. The ONE difference
  // from scenario 032.
  await createProgram({
    sundayId: sunday,
    status: "approved",
    createdBy: bishop.id,
    approvedBy: bishop.id,
    approvedAt: "2026-09-17T18:00:00.000Z",
    draftData: {
      version: 1,
      heading: null,
      date: SUNDAY_DATE,
      sundayType: "standard",
      presiding: { printedName: "Mark Andersen", publicName: "Mark Andersen" },
      conducting: { printedName: "Mark Andersen", publicName: "Mark Andersen" },
      organist: { printedName: "Ruth Delgado", publicName: "Ruth Delgado" },
      chorister: { printedName: "Anna Whitfield", publicName: "Anna Whitfield" },
      openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
      invocation: { printedName: "David Brooks", publicName: "David Brooks" },
      wardBusiness: "Sustaining of a new Primary president.",
      sacramentHymn: { number: 193, title: "I Stand All Amazed" },
      specialNotes: null,
      musicalNumber: {
        performer: {
          printedName: "The Primary children",
          publicName: "The Primary children",
        },
        pieceTitle: "I Am a Child of God",
        notes: "Sound check at 8:30. Reach the chorister on 555-0142.",
      },
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
          kind: "external",
          printedName: "President Mark Andersen",
          publicName: "President Mark Andersen",
          topic: null,
        },
        { slotNumber: 3, kind: "empty", printedName: null, publicName: null, topic: null },
      ],
      closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
      benediction: { printedName: "Sarah Whitfield", publicName: "Sarah Whitfield" },
      announcements: "Ward temple night is on the 14th. Bring a friend.",
      leadershipContacts: [
        { role: "Bishop", name: "Mark Andersen", phone: "555-0100" },
        { role: "First Counselor", name: "Peter Lindqvist", phone: "555-0101" },
        { role: "Ward Secretary", name: "Ruth Delgado", phone: "555-0102" },
      ],
      missionaries: "Elder Kim and Elder Osei — 555-0188, apartment 4B, 1140 Meadow Lane",
      missing: [],
    },
    // Written, exactly as the approve route would write it. The status is what withholds it.
    publicData: {
      version: 1,
      heading: null,
      date: SUNDAY_DATE,
      presiding: "Mark Andersen",
      conducting: "Mark Andersen",
      organist: "Ruth Delgado",
      chorister: "Anna Whitfield",
      openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
      invocation: "David Brooks",
      wardBusiness: "Sustaining of a new Primary president.",
      sacramentHymn: { number: 193, title: "I Stand All Amazed" },
      specialNotes: null,
      musicalNumber: {
        performer: "The Primary children",
        pieceTitle: "I Am a Child of God",
      },
      speakers: [
        { slotNumber: 1, name: "Sarah Whitfield", topic: "Charity Never Faileth" },
        { slotNumber: 2, name: "President Mark Andersen", topic: null },
        { slotNumber: 3, name: null, topic: null },
      ],
      closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
      benediction: "Sarah Whitfield",
      announcements: "Ward temple night is on the 14th. Bring a friend.",
    },
  });

  // Active. Every ingredient is present except the status.
  await createPublicPage({ pageType: "program", slug: PUBLIC_SLUG, isActive: true });

  console.log(
    `  ward, 2 users, 1 household, 2 members, 1 topic, 1 Sunday, 2 assignments, 1 prayer, 3 hymns, 1 APPROVED (not distributed) program, active public page /public/${PUBLIC_SLUG}`,
  );
}
