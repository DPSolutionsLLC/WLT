import {
  createAssignment,
  createHousehold,
  createHymnSelection,
  createMember,
  createPrayerAssignment,
  createSunday,
  createTestUser,
  createTopic,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// THE THURSDAY CASE — a program that is half built, which is the state the builder is actually
// used in and the one that is tedious to construct by hand.
//
// ---------------------------------------------------------------------------------------------
// THE THREE SPEAKER KINDS ARE ALL PRESENT ON PURPOSE
// ---------------------------------------------------------------------------------------------
// plans/retros/ai-b-knowledge-and-retrieval.md: a fixture whose own design hides a bug is worse
// than no fixture — a plural bug survived because every fixture had exactly one of everything.
//
// So this Sunday holds a MEMBER speaker, an EXTERNAL speaker and an EMPTY slot at once. With one
// member speaker, the ITER-004 external path and the placeholder path could both be broken and
// the scenario would still read as passing.
//
// ---------------------------------------------------------------------------------------------
// SLOT 3 IS ABSENT, NOT PLANNED
// ---------------------------------------------------------------------------------------------
// There is no assignment row for it at all. A row sitting at `plan` would ALSO read as empty on
// the program (a speaker who has not been notified is not yet a speaker), and mixing the two
// states would make it impossible to tell which rule the screen was following.
//
// ---------------------------------------------------------------------------------------------
// WHAT IS DELIBERATELY MISSING
// ---------------------------------------------------------------------------------------------
// The sacrament hymn, the benediction, the announcements, the organist and the chorister. Five
// gaps, so "the app tells me what is still needed" has something to say — and so a checklist item
// about the missing list cannot pass by accident on a program with one gap in it.
//
// `missionaries` is empty and `leadership_contacts` is populated, which is the shape a real ward
// is in most of the year.

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

  // Two weeks out, three speaking slots, conducted by the first counselor's Sunday in the
  // rotation — an ordinary Sunday in every respect except how much of it is still blank.
  const sunday = await createSunday({
    date: SUNDAY_DATE,
    type: "standard",
    speakingSlots: 3,
    conductingUserId: bishop.id,
  });

  // Slot 1 — a ward member, notified. Prints as "Sarah Whitfield"; the public page will read
  // "Sarah W." once program-c exists.
  await createAssignment({
    sundayId: sunday,
    slotNumber: 1,
    memberId: sarah,
    topicId: topic,
    pipelineStage: "notify",
    notifySentAt: "2026-09-06T18:00:00.000Z",
  });

  // Slot 2 — ITER-004. A visiting stake leader, invited outside the ward, with the contact
  // waiver set. Prints as "President Mark Andersen" in FULL on both the paper and the public
  // page: the name was typed in order to be printed and there is no member record to protect.
  //
  // Both waiver columns move together or neither does (assignments_waiver_pair, migration 025).
  await createAssignment({
    sundayId: sunday,
    slotNumber: 2,
    externalSpeakerName: "Mark Andersen",
    externalSpeakerTitle: "President",
    pipelineStage: "notify",
    contactWaivedAt: "2026-09-05T18:00:00.000Z",
    contactWaivedBy: bishop.id,
  });

  // Slot 3 — nothing at all. Not a row at `plan`; no row.

  // The invocation is settled; the benediction is not.
  await createPrayerAssignment({
    sundayId: sunday,
    prayerType: "invocation",
    memberId: david,
    stage: "done",
    askedBy: bishop.id,
  });

  // Two of three hymns. THE SACRAMENT HYMN IS ABSENT — the gap most likely to be noticed by a
  // congregation, and the one a builder must name rather than quietly print blank.
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

  console.log(
    "  ward, 3 users, 1 household, 2 members, 1 topic, 1 Sunday, 2 assignments (1 member, 1 external), 1 prayer, 2 hymns",
  );
}
