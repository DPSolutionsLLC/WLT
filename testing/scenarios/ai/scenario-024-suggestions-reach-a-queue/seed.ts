import {
  createAiSettings,
  createDocumentChunk,
  createKnowledgeDocument,
  createTestUser,
  createTopic,
  createTopicCandidate,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// CLAUDE.md rule 3 is the rule the whole AI phase is built around, and the only way to be sure of
// it is to watch a real generation land and then check what moved. Everything here exists to make
// that check meaningful rather than assumed.
//
// THE LIBRARY IS SEEDED WITH OBVIOUS TITLES ON PURPOSE. "Faith in Jesus Christ" and "Repentance"
// are what a model asked for sacrament meeting topics will very likely propose, so the duplicate
// FILTER gets exercised by the walk instead of being taken on trust. If nothing is filtered on the
// first run, that is a finding worth recording, not a broken seed.
//
// The ward context is deliberately specific — "many young families, several recent converts" —
// because an unseeded run uses the ward's own settings AS the retrieval query. A generic context
// produces generic suggestions and the "is this ward-specific?" check has nothing to bite on.

const AUGUST = "2026-08-12T15:00:00.000Z";

const NINE_MONTHS_AGO = "2025-11-16T12:00:00.000Z";
const THREE_MONTHS_AGO = "2026-05-17T12:00:00.000Z";

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  // --- The bishopric ---------------------------------------------------------------------------
  // Both seats, because `topics.manage` is shared bishopric authority (CLAUDE.md §7) and a
  // counselor must be able to do everything the bishop can here.
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

  // --- The refused seat ------------------------------------------------------------------------
  // A ward secretary holds no topics permission at all, and migration 019 puts `topics` in the
  // bishopric-only RLS loop. This account must reach "Not permitted" — never an empty library,
  // which is a different and misleading claim.
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  // --- The ward's AI settings ------------------------------------------------------------------
  // `topicPreferences` and `wardContext` are BOTH the retrieval query on an unseeded run
  // (lib/ai/topicSuggestions.ts). Writing something bland here makes half this scenario
  // unjudgeable.
  await createAiSettings({
    createdAt: AUGUST,
    savedBy: bishop.id,
    toneVoice: "Warm and plain. Write the way somebody talks, not the way a handbook reads.",
    doctrinalEmphasis: "Christ-centred. Practical rather than abstract.",
    canonPriority: ["book_of_mormon", "new_testament"],
    maxScriptureReferences: 3,
    maxYearsOld: null,
    maxConferenceTalks: 2,
    preferKnowledgeBase: true,
    topicPreferences:
      "Favour topics a new member can act on this week. Avoid topics that need years of " +
      "background to follow.",
    wardContext:
      "Many young families with small children, several recent converts, and a steady stream " +
      "of members moving in and out for university.",
  });

  // --- Six active topics -----------------------------------------------------------------------
  // The first two are the DUPLICATE BAIT. The rest give the library enough shape that "the count
  // did not change" is a real observation rather than a comparison of 0 with 0.
  await createTopic({
    title: "Faith in Jesus Christ",
    category: "doctrinal",
    description: "The first principle, and what acting on it looks like on a Tuesday.",
    lastAssignedAt: THREE_MONTHS_AGO,
    suggestedScriptures: ["Alma 32:21", "Hebrews 11:1"],
  });

  await createTopic({
    title: "Repentance",
    category: "doctrinal",
    description: "Turning back, and how often it is meant to happen.",
    lastAssignedAt: NINE_MONTHS_AGO,
    suggestedScriptures: ["Mosiah 26:29"],
  });

  await createTopic({
    title: "The Sabbath Day",
    category: "doctrinal",
    description: "A delight rather than a list.",
    lastAssignedAt: NINE_MONTHS_AGO,
    suggestedScriptures: ["Isaiah 58:13-14"],
  });

  await createTopic({
    title: "Temple Worship",
    category: "doctrinal",
    description: "Preparing to attend, and what to bring to it.",
    suggestedScriptures: ["D&C 109:8"],
  });

  await createTopic({
    title: "The Book of Mormon",
    category: "scriptural",
    description: "Its place beside the Bible as a second witness.",
    suggestedScriptures: ["2 Nephi 29:8"],
  });

  await createTopic({
    title: "Come, Follow Me",
    category: "conference_talk",
    description: "Studying at home, together, through the week.",
    suggestedTalks: ["Come, Follow Me — April 2019 general conference"],
  });

  // --- One pending candidate -------------------------------------------------------------------
  // So the queue is NOT empty at the start. A generation that lands in an empty queue makes
  // "did anything actually arrive?" harder to answer than it needs to be, and this row also gives
  // the candidate-duplicate filter something to match against if the model proposes it again.
  await createTopicCandidate({
    title: "Ministering with Real Intent",
    category: "doctrinal",
    description: "What ministering asks beyond a monthly visit.",
    suggestedScriptures: ["Moroni 7:6-9"],
    suggestedTalks: ['Elder Holland, "Emissaries to the Church", April 2016'],
  });

  // --- A small corpus --------------------------------------------------------------------------
  // READ THE NOTE IN THE SCENARIO BEFORE JUDGING THE CITATIONS. These embeddings are hand-written
  // unit vectors, so they answer a query on the same axis with a similarity of exactly 1 and
  // every other query with 0 — including a real one embedded from the ward's settings. They make
  // the document counts on /knowledge real and the retrieval path run; they do NOT make the
  // suggestions corpus-driven. For that, upload a document through the app, which embeds it for
  // real (testing/infrastructure/seedUtils.ts).
  const mosiah = await createKnowledgeDocument({
    title: "Book of Mormon — Mosiah 18",
    typeTag: "standard_works",
    uploadedBy: bishop.id,
  });

  await createDocumentChunk({
    documentId: mosiah,
    chunkIndex: 0,
    content:
      "Mosiah 18:8-10 — And now, as ye are desirous to come into the fold of God, and to be " +
      "called his people, and are willing to bear one another's burdens, that they may be light.",
    embeddingAxis: 0,
  });

  const conference = await createKnowledgeDocument({
    title: "Elder Holland — Emissaries to the Church",
    typeTag: "general_conference",
    uploadedBy: bishop.id,
  });

  await createDocumentChunk({
    documentId: conference,
    chunkIndex: 0,
    content:
      "Ministering is not a program. It is what a congregation does for each other between " +
      "Sundays, and it is measured in the people who did not fall through.",
    embeddingAxis: 1,
  });

  console.log(
    "  ward, 3 users (bishop, counselor1, secretary), 1 AI settings version with a specific " +
      "ward context, 6 active topics (2 of them duplicate bait: Faith in Jesus Christ, " +
      "Repentance), 1 PENDING candidate, and a 2-document corpus with hand-seeded embeddings",
  );
}
