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

// SCENARIO 028'S SUNDAY WITH EVERY GAP FILLED — the programme that is ready to print.
//
// ---------------------------------------------------------------------------------------------
// WHY THIS SEED IS DELIBERATELY FULL
// ---------------------------------------------------------------------------------------------
// Every other programme scenario is about an absence: a gap (028), a snapshot that has drifted
// (029), a programme that is not ready (031), one that is not published yet (033). This one has
// NOTHING missing, because the thing under test is physical. A sheet of paper cannot be checked
// for a fold, a margin, or a QR code that scans unless there is something printed on all four
// panels.
//
// `missing` is [] and it is honest: every field genuinely has a value.
//
// ---------------------------------------------------------------------------------------------
// APPROVED, NOT DISTRIBUTED, AND WITH NO pdf_url
// ---------------------------------------------------------------------------------------------
// The tester presses Generate themselves. Seeding a pdf_url would skip the render — which is the
// step being tested — and would point at an object that does not exist in the bucket.
//
// The public_pages row is seeded ACTIVE so the QR encodes a slug that already exists and the URL
// on the paper is predictable. The generate route would create one if it were absent; seeding it
// means the tester knows in advance which URL to expect on the back panel, and can tell "the QR
// is wrong" apart from "the QR points somewhere I did not anticipate".
//
// The page itself stays dark until distribution (migration 039 requires status = 'distributed'),
// so the QR in THIS scenario scans to a 404. That is correct and it is what scenario 035 then
// resolves — checked there, not here.

const SUNDAY_DATE = "2026-09-20";

const PUBLIC_SLUG = "harness-ward-program";

export async function seed(): Promise<void> {
  await ensureTestWard({
    name: "Harness Test Ward",
    settings: {
      leadership_contacts: [
        { role: "Bishop", name: "Mark Andersen", phone: "555-0100" },
        { role: "First Counselor", name: "Peter Lindqvist", phone: "555-0101" },
        { role: "Second Counselor", name: "Ana Ferreira", phone: "555-0104" },
        { role: "Ward Secretary", name: "Ruth Delgado", phone: "555-0102" },
      ],
      missionaries: "Elder Kim and Elder Osei — 555-0188, apartment 4B, 1140 Meadow Lane",
      program_template: {
        ward_name: "Harness Test Ward",
        church_name: "The Church of Jesus Christ of Latter-day Saints",
        // A serif family and a dark red. BOTH are checked on the printed sheet: the colour has to
        // clear 4.5:1 against white paper or lib/pdf/theme.ts replaces it and reports why, and
        // this value clears it comfortably. A tester who wants to see the guard fire should set
        // this to "#ffee88" and generate again.
        font_family: "serif",
        primary_color: "#7b1d1d",
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

  const ellen = await createMember({
    firstName: "Ellen",
    lastName: "Moretti",
    householdId: household,
    category: "adult",
    gender: "female",
    phone: "555-0144",
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

  // ITER-004. The name and title a bishopric member typed IN ORDER TO HAVE THEM PRINTED, which is
  // the whole reason the printed/public name pair exists. The check on the paper is that this
  // prints as "President Mark Andersen" — not "Mark A.", not "Mark Andersen".
  await createAssignment({
    sundayId: sunday,
    slotNumber: 2,
    externalSpeakerName: "Mark Andersen",
    externalSpeakerTitle: "President",
    pipelineStage: "notify",
    contactWaivedAt: "2026-09-05T18:00:00.000Z",
    contactWaivedBy: bishop.id,
  });

  await createAssignment({
    sundayId: sunday,
    slotNumber: 3,
    memberId: ellen,
    pipelineStage: "notify",
    notifySentAt: "2026-09-06T18:00:00.000Z",
  });

  await createPrayerAssignment({
    sundayId: sunday,
    prayerType: "invocation",
    memberId: david,
    stage: "done",
    askedBy: bishop.id,
  });

  await createPrayerAssignment({
    sundayId: sunday,
    prayerType: "benediction",
    memberId: sarah,
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

  // APPROVED and with NO pdf_url. The tester presses Generate — that is the step under test.
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
      conducting: { printedName: "Peter Lindqvist", publicName: "Peter Lindqvist" },
      organist: { printedName: "Ruth Delgado", publicName: "Ruth Delgado" },
      chorister: { printedName: "Anna Whitfield", publicName: "Anna Whitfield" },
      openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
      invocation: { printedName: "David Brooks", publicName: "David Brooks" },
      wardBusiness: "Sustaining of a new Primary president.",
      sacramentHymn: { number: 193, title: "I Stand All Amazed" },
      specialNotes: "The choir will remain after the meeting for a short rehearsal.",
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
        {
          slotNumber: 3,
          kind: "member",
          printedName: "Ellen Moretti",
          publicName: "Ellen Moretti",
          topic: null,
        },
      ],
      closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
      benediction: { printedName: "Sarah Whitfield", publicName: "Sarah Whitfield" },
      announcements:
        "Ward temple night is on the 14th. Bring a friend. The Elders Quorum service project is on Saturday at 9am — meet at the church.",
      leadershipContacts: [
        { role: "Bishop", name: "Mark Andersen", phone: "555-0100" },
        { role: "First Counselor", name: "Peter Lindqvist", phone: "555-0101" },
        { role: "Second Counselor", name: "Ana Ferreira", phone: "555-0104" },
        { role: "Ward Secretary", name: "Ruth Delgado", phone: "555-0102" },
      ],
      missionaries: "Elder Kim and Elder Osei — 555-0188, apartment 4B, 1140 Meadow Lane",
      // NOTHING is missing. That is the point of this seed.
      missing: [],
    },
    // Written, as the approve route writes it. Not read by anything in this scenario — the public
    // page needs status 'distributed' — and present so that scenario 035 can distribute from here
    // without the projection having to appear from nowhere.
    publicData: {
      version: 1,
      heading: null,
      date: SUNDAY_DATE,
      presiding: "Mark Andersen",
      conducting: "Peter Lindqvist",
      organist: "Ruth Delgado",
      chorister: "Anna Whitfield",
      openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
      invocation: "David Brooks",
      wardBusiness: "Sustaining of a new Primary president.",
      sacramentHymn: { number: 193, title: "I Stand All Amazed" },
      specialNotes: "The choir will remain after the meeting for a short rehearsal.",
      musicalNumber: {
        performer: "The Primary children",
        pieceTitle: "I Am a Child of God",
      },
      speakers: [
        { slotNumber: 1, name: "Sarah Whitfield", topic: "Charity Never Faileth" },
        { slotNumber: 2, name: "President Mark Andersen", topic: null },
        { slotNumber: 3, name: "Ellen Moretti", topic: null },
      ],
      closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
      benediction: "Sarah Whitfield",
      announcements:
        "Ward temple night is on the 14th. Bring a friend. The Elders Quorum service project is on Saturday at 9am — meet at the church.",
    },
  });

  // Seeded so the URL printed on the back panel is predictable. The generate route creates one if
  // it is absent (ensureProgramPublicPage), and a random slug would leave the tester unable to say
  // whether the QR pointed at the right place.
  await createPublicPage({ pageType: "program", slug: PUBLIC_SLUG, isActive: true });

  console.log(
    `  ward, 2 users, 1 household, 3 members, 1 topic, 1 Sunday, 3 assignments (one EXTERNAL), 2 prayers, 3 hymns, 1 APPROVED program with no PDF, active public page /public/${PUBLIC_SLUG}`,
  );
}
