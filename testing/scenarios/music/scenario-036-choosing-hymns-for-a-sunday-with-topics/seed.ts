import {
  createAssignment,
  createHousehold,
  createHymnSelection,
  createMember,
  createSunday,
  createTestUser,
  createTopic,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// TWO SUNDAYS, ON PURPOSE, AND THEY DIFFER IN EXACTLY ONE WAY.
//
// Sunday A has two assigned topics and one hymn already chosen. Sunday B has neither. Everything
// else about them is identical, so anything the tester sees differ between the two cards is
// caused by the topics and the selection rather than by some other accident of the fixture.
//
// ---------------------------------------------------------------------------------------------
// WHY ONE HYMN IS SEEDED AND TWO ARE NOT
// ---------------------------------------------------------------------------------------------
// A card showing three empty slots proves nothing about whether the FILLED state renders, and a
// card showing three filled slots proves nothing about the empty one. The scenario needs both on
// screen at once, which means seeding exactly one.
//
// It is seeded with `aiSuggested: false`, which is the ordinary case. The tester then accepts an
// AI suggestion into another slot, so the "which of these came from the model" check has a real
// pair to compare rather than a single row to take on trust.
//
// ---------------------------------------------------------------------------------------------
// WHY TWO TOPICS RATHER THAN ONE
// ---------------------------------------------------------------------------------------------
// The card pluralises ("Two hymns still to choose") and the AI prompt pluralises ("the talks that
// Sunday are"). A one-item fixture hides a plural bug — which is precisely how "all 1 of its
// passages" survived into a walked scenario (plans/retros/ai-b-knowledge-and-retrieval.md).
// Sunday B's zero topics is the other end of the same check.
//
// ---------------------------------------------------------------------------------------------
// THE ASSIGNMENTS CARRY REAL SPEAKER NAMES, AND THAT IS THE POINT
// ---------------------------------------------------------------------------------------------
// The Music screen must show the TOPICS and never the speakers. Seeding assignments with no
// members attached would make that check unfalsifiable — the names have to exist in the data for
// their absence from the screen to mean anything.
//
// The hymns table itself is NOT seeded here. It has no ward_id (migration 006), it is loaded by
// supabase/seed/hymns.sql plus `npm run hymns:placeholders`, and a scenario that wrote to it
// would be editing every ward's hymnbook.

const SUNDAY_WITH_TOPICS = "2026-11-01";
const SUNDAY_WITHOUT_TOPICS = "2026-11-08";

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    firstName: "Mark",
    lastName: "Andersen",
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

  // Titles chosen so the tag matching in lib/music/hymnCandidates.ts has something real to bite
  // on: "gratitude" is a tag on hymns 19 and 241, and "burdens" is not a tag anywhere. One topic
  // that matches strongly and one that does not is a more honest fixture than two easy ones.
  const gratitude = await createTopic({
    title: "Gratitude in Every Season",
    source: "manual",
  });

  const burdens = await createTopic({
    title: "Bearing One Another's Burdens",
    source: "manual",
  });

  const sundayWithTopics = await createSunday({
    date: SUNDAY_WITH_TOPICS,
    type: "standard",
    speakingSlots: 2,
    conductingUserId: bishop.id,
  });

  await createAssignment({
    sundayId: sundayWithTopics,
    slotNumber: 1,
    memberId: sarah,
    topicId: gratitude,
    pipelineStage: "notify",
    notifySentAt: "2026-10-18T18:00:00.000Z",
  });

  await createAssignment({
    sundayId: sundayWithTopics,
    slotNumber: 2,
    memberId: david,
    topicId: burdens,
    pipelineStage: "notify",
    notifySentAt: "2026-10-18T18:05:00.000Z",
  });

  // Hymn 19 is one of the 42 hand-verified rows in supabase/seed/hymns.sql, so the tester can
  // check the title against a real hymnbook and expect it to be right.
  await createHymnSelection({
    sundayId: sundayWithTopics,
    hymnType: "opening",
    hymnNumber: 19,
    hymnTitle: "We Thank Thee, O God, for a Prophet",
    aiSuggested: false,
  });

  // No topics, no assignments and no hymns. A coordinator working ahead of the bishopric sees
  // this every week, and it must be usable rather than blocked.
  await createSunday({
    date: SUNDAY_WITHOUT_TOPICS,
    type: "standard",
    speakingSlots: 2,
    conductingUserId: bishop.id,
  });

  console.log(
    "  ward, 2 users, 1 household, 2 members, 2 topics, 2 Sundays, 2 assignments, 1 hymn (opening only, not AI-suggested)",
  );
}
