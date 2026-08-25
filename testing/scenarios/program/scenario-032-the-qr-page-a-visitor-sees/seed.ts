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

// SCENARIO 028'S SUNDAY, PUBLISHED — the state a congregation actually meets the app in.
//
// ---------------------------------------------------------------------------------------------
// THE SEED'S JOB IS TO GIVE A LEAK SOMETHING TO LEAK
// ---------------------------------------------------------------------------------------------
// A scenario that seeds no phone number cannot fail its "no phone number appears" check. So this
// ward is fully furnished with exactly the data the public page must not show:
//
//   - the speaker's household carries a STREET ADDRESS
//   - the speaker carries a PHONE NUMBER
//   - wards.settings.leadership_contacts carries three names WITH PHONE NUMBERS
//   - the stored draft_data carries all of the above plus MISSIONARY information
//
// Every one of those is in draft_data, one column away from public_data, and none of it may reach
// the screen. That is the whole scenario.
//
// ---------------------------------------------------------------------------------------------
// A MEMBER AND A VISITOR, SIDE BY SIDE (ITER-004)
// ---------------------------------------------------------------------------------------------
// Slot 1 is a ward member reading "Sarah Whitfield". Slot 2 is a visiting stake leader reading
// "President Mark Andersen". They are now named the SAME way — in full — which is what the walk of
// this scenario on 2026-08-24 decided: shortening only the member read as a bug sitting next to
// the visitor's full name.
//
// Both kinds are still seeded, for two reasons. A fixture with only one lets the other path break
// silently (plans/retros/ai-b-knowledge-and-retrieval.md), and this pair is where a regression
// that reintroduced shortening would show up first.
//
// The surname is "Whitfield" on purpose: long, distinctive, and in no other string here, so its
// treatment is unmistakable rather than something a tester has to squint at.
//
// AN EMPTY THIRD SLOT is seeded on purpose too. It must RENDER as an open slot rather than
// vanishing — a slot that disappears looks like a meeting with two speakers, and nobody would ever
// know to correct the Sunday's slot count.
//
// ---------------------------------------------------------------------------------------------
// public_data IS WRITTEN OUT BY HAND, LIKE draft_data
// ---------------------------------------------------------------------------------------------
// It is NOT built by calling toPublicProgram(): that module imports through the `@/` alias and
// `npm run seed` does not load a resolver for it. Keep this object in step with
// lib/program/publicProjection.ts. Note what is absent — no leadershipContacts, no missionaries,
// no missing, no sundayType, no printedName anywhere.
//
// THREE THINGS MUST MOVE TOGETHER or the page 404s: status `distributed`, a non-null public_data,
// and an ACTIVE public_pages row. The view requires all three (migration 039).

const SUNDAY_DATE = "2026-09-20";

// Printed on the seed's last line so the tester does not have to go looking for it.
const PUBLIC_SLUG = "harness-ward-program";

export async function seed(): Promise<void> {
  await ensureTestWard({
    name: "Harness Test Ward",
    settings: {
      // Three names AND three phone numbers. They belong on the paper program's contacts panel
      // and must never reach /public/[slug].
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

  // The address a leak would put on a public page.
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

  await createProgram({
    sundayId: sunday,
    status: "distributed",
    createdBy: bishop.id,
    approvedBy: bishop.id,
    approvedAt: "2026-09-17T18:00:00.000Z",
    distributedAt: "2026-09-18T18:00:00.000Z",
    // Everything the ward knows. NONE of the last three keys may appear on the public page.
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
    // What a stranger may read. Compare it against the draft above line by line — that difference
    // IS the privacy boundary, and it is the thing this scenario asks a person to look at.
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
      // The internal note ("Sound check at 8:30…", with a phone number in it) is gone. The
      // musical number itself is public; only its staging note is not.
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

  // Without this row — or with is_active false — the slug is a 404 however good the projection is.
  await createPublicPage({ pageType: "program", slug: PUBLIC_SLUG, isActive: true });

  console.log(
    `  ward, 2 users, 1 household, 2 members, 1 topic, 1 Sunday, 2 assignments, 1 prayer, 3 hymns, 1 distributed program, public page /public/${PUBLIC_SLUG}`,
  );
}
