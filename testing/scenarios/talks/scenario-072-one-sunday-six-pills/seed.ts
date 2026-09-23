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
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// FIVE SUNDAYS IN FIVE DELIBERATELY DIFFERENT STATES OF COMPLETENESS
// ---------------------------------------------------------------------------
// The Sacrament hub's whole value is that a pill's count matches the page behind it. That is the
// mismatch ITER-022 shipped — every card read `Covered · 0` above an event card reading
// `Covered · 1` — and no green suite can see it, because both numbers are correct in isolation
// and only disagree once they are on screen together.
//
// August 2027 opens on a SUNDAY and has exactly five, which is why it was chosen: one month, one
// screen, every state side by side.
//
//   08-01  fast_sunday, speaking_slots = 0   COMPLETE on both talk pills, with nothing to do
//   08-08  standard, untouched               0/3 EVERYWHERE, and "Conducting: open"
//   08-15  standard, partial                 Topics 2/3 and Talks 1/3 — the two DISAGREE
//   08-22  standard, complete                every pill full, including an approved programme
//   08-29  stake_conference                  NO sacrament meeting: a sentence, and no pills
//
// 08-15 IS THE ONE THE SLICE TURNS ON. Two topics are laid out and only one of them has a
// speaker, which is this ward's stated workflow (lay out a month of topics first, then find
// people for them). A build that folds topics and talks into one "planned" count reports that
// Sunday as 1/3 twice and silently loses half the work somebody did.

const FAST = "2027-08-01";
const UNTOUCHED = "2027-08-08";
const PARTIAL = "2027-08-15";
const COMPLETE = "2027-08-22";
const NO_MEETING = "2027-08-29";

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

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

  // HOLDS NO `talks.view`, AND THAT IS NOT THE INTUITIVE ANSWER. An org president runs an
  // organization and still has no part in planning the sacrament meeting; a music_coordinator,
  // who sounds further away, DOES hold it. lib/auth/permissions.ts is the source of truth here
  // (CLAUDE.md §8), and this account exists to prove /sacrament refuses them with a sentence
  // rather than with a 500 or — worse — an empty grid, which is a different claim.
  await createTestUser({
    handle: "rs-president",
    role: "org_president",
    org: "reliefSociety",
    firstName: "Deborah",
    lastName: "Whitfield",
  });

  // --- Members --------------------------------------------------------------------------------
  const NAMES: ReadonlyArray<readonly [string, string]> = [
    ["Sarah", "Whitfield"],
    ["Andre", "Bell"],
    ["Claire", "Bennett"],
    ["Tomas", "Ruiz"],
    ["Miriam", "Okonkwo"],
    ["David", "Lindqvist"],
  ];

  const memberIds: string[] = [];

  for (const [firstName, lastName] of NAMES) {
    const householdId = await createHousehold({ familyName: lastName });
    memberIds.push(
      await createMember({
        firstName,
        lastName,
        householdId,
        category: "adult",
        status: "active",
      }),
    );
  }

  // --- Topics ---------------------------------------------------------------------------------
  // Five, because the complete Sunday needs three and the partial Sunday needs two more. They
  // live in the ward TOPIC LIBRARY at /talks/topics, which is a different page from the hub's
  // Topics pill — that one is the per-Sunday editor at /assignments/[id]
  // (plans/prototype/module-map.md §2.1, correction c). Walking both is how the near-collision in
  // those two names is checked.
  const topicTitles = [
    "The Atonement of Jesus Christ",
    "Ministering as the Savior Did",
    "Temple Covenants",
    "Faith in Times of Uncertainty",
    "Gratitude",
  ] as const;

  const topicIds: string[] = [];

  for (const title of topicTitles) {
    topicIds.push(await createTopic({ title }));
  }

  // --- 08-01 — fast Sunday, no speakers -------------------------------------------------------
  // speaking_slots = 0, so Topics and Talks must read COMPLETE and not EMPTY: there is no work
  // anybody has failed to do. This is the case a reader gets backwards, and it is why it is
  // seeded rather than only unit-tested. BOTH PRAYERS SURVIVE — a fast Sunday still has an
  // invocation and a benediction — so the Prayer pill must NOT be gated on the slot count.
  const fastSundayId = await createSunday({
    date: FAST,
    type: "fast_sunday",
    speakingSlots: 0,
    conductingUserId: bishop.id,
  });

  await createPrayerAssignment({
    sundayId: fastSundayId,
    memberId: memberIds[4],
    prayerType: "invocation",
    stage: "done",
    askedBy: bishop.id,
  });

  // --- 08-08 — untouched ----------------------------------------------------------------------
  // NOTHING on it, and NO CONDUCTOR. Every pill reads 0/3 or 0/2 and every one of them must be
  // VISIBLE. An omitted empty slot reads as "failed to load", which looks correct enough that
  // nobody reports it (program-c's reversal). The conducting line must read "Conducting: open" —
  // never blank, and never a name guessed from the rotation (decisions.md §1.11).
  await createSunday({
    date: UNTOUCHED,
    type: "standard",
    speakingSlots: 3,
  });

  // --- 08-15 — partial, and the two talk pills DISAGREE ---------------------------------------
  const partialSundayId = await createSunday({
    date: PARTIAL,
    type: "standard",
    speakingSlots: 3,
    conductingUserId: counselor.id,
  });

  // Slot 1: a topic AND a speaker  → counts toward topics AND talks.
  await createAssignment({
    sundayId: partialSundayId,
    slotNumber: 1,
    memberId: memberIds[0],
    topicId: topicIds[3],
    pipelineStage: "approve",
    plannedBy: bishop.id,
  });

  // Slot 2: a topic and NOBODY     → counts toward topics ONLY. This single row is what makes
  // the Sunday read `Topics 2/3` above `Talks 1/3`.
  await createAssignment({
    sundayId: partialSundayId,
    slotNumber: 2,
    topicId: topicIds[4],
    pipelineStage: "plan",
    plannedBy: bishop.id,
  });

  // Slot 3 is deliberately absent — three slots, two rows. The pill's denominator comes from
  // `sundays.speaking_slots` and never from `assignments.length`, so this must read out of 3.

  // One prayer of two.
  await createPrayerAssignment({
    sundayId: partialSundayId,
    memberId: memberIds[1],
    prayerType: "invocation",
    stage: "ask",
    askedBy: bishop.id,
  });

  // Two hymns of three, and NO programme row at all — so Music reads 2/3 and Program reads 0/2.
  // A missing programme is a different state from a draft waiting on the bishopric, and the two
  // are side by side on this month.
  await createHymnSelection({
    sundayId: partialSundayId,
    hymnType: "opening",
    hymnNumber: 19,
    hymnTitle: "We Thank Thee, O God, for a Prophet",
    selectedBy: bishop.id,
  });

  await createHymnSelection({
    sundayId: partialSundayId,
    hymnType: "sacrament",
    hymnNumber: 193,
    hymnTitle: "I Stand All Amazed",
    selectedBy: bishop.id,
  });

  // --- 08-22 — complete -----------------------------------------------------------------------
  const completeSundayId = await createSunday({
    date: COMPLETE,
    type: "standard",
    speakingSlots: 3,
    conductingUserId: bishop.id,
  });

  await createAssignment({
    sundayId: completeSundayId,
    slotNumber: 1,
    memberId: memberIds[2],
    topicId: topicIds[0],
    pipelineStage: "confirm",
    plannedBy: bishop.id,
  });

  await createAssignment({
    sundayId: completeSundayId,
    slotNumber: 2,
    memberId: memberIds[3],
    topicId: topicIds[1],
    pipelineStage: "confirm",
    plannedBy: bishop.id,
  });

  // AN ITER-004 EXTERNAL SPEAKER, and it fills the third slot exactly as a roster member does.
  // A visiting high councillor is a real speaker; counting only `member_id` would report this
  // fully planned Sunday as 2/3 and put it on a list of things to chase.
  await createAssignment({
    sundayId: completeSundayId,
    slotNumber: 3,
    externalSpeakerName: "Brother Elias Hale",
    externalSpeakerTitle: "High Councillor",
    topicId: topicIds[2],
    pipelineStage: "confirm",
    plannedBy: bishop.id,
  });

  await createPrayerAssignment({
    sundayId: completeSundayId,
    memberId: memberIds[4],
    prayerType: "invocation",
    stage: "done",
    askedBy: bishop.id,
  });

  await createPrayerAssignment({
    sundayId: completeSundayId,
    memberId: memberIds[5],
    prayerType: "benediction",
    stage: "done",
    askedBy: bishop.id,
  });

  for (const [hymnType, hymnNumber, hymnTitle] of [
    ["opening", 2, "The Spirit of God"],
    ["sacrament", 181, "Jesus of Nazareth, Savior and King"],
    ["closing", 152, "God Be with You Till We Meet Again"],
  ] as const) {
    await createHymnSelection({
      sundayId: completeSundayId,
      hymnType,
      hymnNumber,
      hymnTitle,
      selectedBy: bishop.id,
    });
  }

  // APPROVED, not draft — the Program pill scores out of two, so an approved programme is the
  // only state that reads complete. The partial Sunday above has no programme row at all, which
  // is the 0 end of the same scale.
  await createProgram({
    sundayId: completeSundayId,
    status: "approved",
    createdBy: bishop.id,
    approvedBy: bishop.id,
    approvedAt: "2027-08-18T18:00:00Z",
  });

  // --- 08-29 — no sacrament meeting -----------------------------------------------------------
  // `stake_conference` is in NO_MEETING_SUNDAY_TYPES, so this card renders a SENTENCE and no pill
  // row at all. Six pills reading 0/3 here would invite somebody to plan a meeting that is not
  // happening. `holiday` and `ward_conference` are deliberately NOT in that list — both hold an
  // ordinary meeting — so this must be a conference type to exercise the branch.
  await createSunday({
    date: NO_MEETING,
    type: "stake_conference",
    speakingSlots: 0,
  });

  console.log(
    "  ward, 3 users (bishop, counselor, org_president with NO talks.view), 6 households, " +
      "6 adult members, 5 topics, and August 2027 — 5 Sundays: 08-01 fast (0 slots, 1 prayer), " +
      "08-08 untouched with no conductor, 08-15 partial (2 topics / 1 speaker, 1 prayer, " +
      "2 hymns, no programme), 08-22 complete (3 topics / 3 speakers incl. 1 external, " +
      "2 prayers, 3 hymns, approved programme), 08-29 stake conference",
  );
}
