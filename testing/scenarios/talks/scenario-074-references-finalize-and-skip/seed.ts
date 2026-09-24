import {
  createAssignment,
  createHousehold,
  createMember,
  createSunday,
  createTalkReference,
  createTestUser,
  createTopic,
  ensureTestWard,
} from "../../../infrastructure/seedUtils.ts";

// ---------------------------------------------------------------------------
// FOUR SUNDAYS, ONE PER REFERENCES STATE, RELATIVE TO TODAY
// ---------------------------------------------------------------------------
//   A  3 slots, topics finalized, 2 refs on talk 1, References FINALIZED   `Refs 2` + filled tick
//   B  2 slots, topics set, 0 refs, References SKIPPED                    `Refs: skipped` + filled
//   C  3 slots, topics set, 1 manual ref, References OPEN                 `Refs 1`, amber, empty
//   D  fast Sunday, 0 slots                                               no Refs pill at all
//
// RELATIVE TO TODAY, NOT FIXED DATES. The hub opens on the current month, and scenario 073's walk
// found that fixed dates drift out of any window that reads "near today". Do not tidy these into
// fixed dates.
//
// NO KNOWLEDGE CORPUS IS SEEDED. The harness's hand-written vectors match no real query
// (plans/retros/ai-b-knowledge-and-retrieval.md), so a seeded corpus would make every search
// check unable to fail. The walker uploads real documents through /knowledge, which embeds them.
// The seeded references are therefore all `manual`, the only source that needs no document.

function sundayOnOrBefore(today: Date): Date {
  const date = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
}

function weeksFrom(anchor: Date, weeks: number): string {
  const date = new Date(anchor);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

const ANCHOR = sundayOnOrBefore(new Date());

const SUNDAY_A = weeksFrom(ANCHOR, 1);
const SUNDAY_B = weeksFrom(ANCHOR, 2);
const SUNDAY_C = weeksFrom(ANCHOR, 3);
const SUNDAY_D = weeksFrom(ANCHOR, 4);

// FIXED instants, so a re-seeded run shows the same stamps and "it did not move" is visible.
const TOPICS_FINALIZED_AT = "2026-09-01T17:30:00Z";
const REFERENCES_DECIDED_AT = "2026-09-02T17:30:00Z";

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Peter",
    lastName: "Nakamura",
  });

  // `talks.view` WITHOUT `talks.plan`: sees the hub and NO References pill at all (migration 080).
  await createTestUser({
    handle: "music",
    role: "music_coordinator",
    org: "bishopric",
    firstName: "Hannah",
    lastName: "Restrepo",
  });

  const NAMES: ReadonlyArray<readonly [string, string]> = [
    ["Sarah", "Whitfield"],
    ["Andre", "Bell"],
    ["Claire", "Bennett"],
  ];

  const memberIds: string[] = [];
  for (const [firstName, lastName] of NAMES) {
    const householdId = await createHousehold({ familyName: lastName });
    memberIds.push(
      await createMember({ firstName, lastName, householdId, category: "adult", status: "active" }),
    );
  }

  // Seven, so changing a topic on A or B means picking a DIFFERENT one rather than clearing it.
  const topicTitles = [
    "Faith in Jesus Christ",
    "The Power of Covenants",
    "Ministering as the Savior Did",
    "Gratitude",
    "Keeping the Sabbath Day Holy",
    "Prayer",
    "Repentance",
  ] as const;

  // SUGGESTED SCRIPTURES on the two topics the walk searches, so the search window's "Suggested
  // for this topic" picks have something to show. "Alma 32:21" on Faith is ALSO seeded as one of
  // A's references, which is what makes that pick read "Added" there.
  const SUGGESTED: Partial<Record<(typeof topicTitles)[number], string[]>> = {
    "Faith in Jesus Christ": ["Alma 32:21", "Hebrews 11:1", "Ether 12:6"],
    "The Power of Covenants": ["Mosiah 18:8–10", "Doctrine and Covenants 84:33–40"],
  };

  const topicIds: string[] = [];
  for (const title of topicTitles) {
    topicIds.push(await createTopic({ title, suggestedScriptures: SUGGESTED[title] }));
  }

  // --- A — References FINALIZED -----------------------------------------------------------------
  // The one where a topic change must return References to OPEN while keeping both references.
  const sundayA = await createSunday({
    date: SUNDAY_A,
    speakingSlots: 3,
    conductingUserId: bishop.id,
    topicsFinalizedAt: TOPICS_FINALIZED_AT,
    referencesFinalizedAt: REFERENCES_DECIDED_AT,
  });

  const talkA1 = await createAssignment({
    sundayId: sundayA,
    slotNumber: 1,
    memberId: memberIds[0],
    topicId: topicIds[0],
    pipelineStage: "plan",
    plannedBy: bishop.id,
  });

  for (const [index, memberId] of [memberIds[1], memberIds[2]].entries()) {
    await createAssignment({
      sundayId: sundayA,
      slotNumber: index + 2,
      memberId,
      topicId: topicIds[index + 1],
      pipelineStage: "plan",
      plannedBy: bishop.id,
    });
  }

  await createTalkReference({ assignmentId: talkA1, kind: "scripture", citation: "Alma 32:21" });
  await createTalkReference({ assignmentId: talkA1, kind: "scripture", citation: "Ether 12:6" });

  // --- B — References SKIPPED -------------------------------------------------------------------
  // The one where a topic change must leave the skip STANDING.
  const sundayB = await createSunday({
    date: SUNDAY_B,
    speakingSlots: 2,
    conductingUserId: bishop.id,
    referencesSkippedAt: REFERENCES_DECIDED_AT,
  });

  for (const index of [0, 1]) {
    await createAssignment({
      sundayId: sundayB,
      slotNumber: index + 1,
      topicId: topicIds[index + 3],
      pipelineStage: "plan",
      plannedBy: bishop.id,
    });
  }

  // --- C — References OPEN, one manual reference -------------------------------------------------
  // Where the search, add, remove and finalize are walked.
  const sundayC = await createSunday({
    date: SUNDAY_C,
    speakingSlots: 3,
    conductingUserId: bishop.id,
  });

  const talkC1 = await createAssignment({
    sundayId: sundayC,
    slotNumber: 1,
    memberId: memberIds[0],
    topicId: topicIds[1],
    pipelineStage: "plan",
    plannedBy: bishop.id,
  });

  for (const index of [1, 2]) {
    await createAssignment({
      sundayId: sundayC,
      slotNumber: index + 1,
      topicId: topicIds[index + 4],
      pipelineStage: "plan",
      plannedBy: bishop.id,
    });
  }

  await createTalkReference({
    assignmentId: talkC1,
    kind: "talk",
    citation: "“Covenants and Responsibilities” — October 2024",
  });

  // --- D — fast Sunday, no speakers --------------------------------------------------------------
  await createSunday({
    date: SUNDAY_D,
    type: "fast_sunday",
    speakingSlots: 0,
    conductingUserId: bishop.id,
  });

  console.log(
    "  ward, 3 users (bishop, counselor1, music_coordinator), 3 members, 7 topics, and four " +
      `Sundays: A ${SUNDAY_A} (References FINALIZED, 2 refs on talk 1), ` +
      `B ${SUNDAY_B} (References SKIPPED, 0 refs), C ${SUNDAY_C} (open, 1 manual ref), ` +
      `D ${SUNDAY_D} (fast Sunday, 0 slots). No knowledge corpus — upload one through ` +
      "/knowledge before walking search.",
  );
}
