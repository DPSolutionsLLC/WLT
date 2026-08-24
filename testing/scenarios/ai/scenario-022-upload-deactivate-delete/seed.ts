import {
  createDocumentChunk,
  createKnowledgeDocument,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// An existing corpus, so deactivation is a VISIBLE CHANGE IN RETRIEVAL rather than a status
// badge with nothing behind it.
//
// ---------------------------------------------------------------------------------------------
// WHY SEED A CORPUS AT ALL WHEN THE SCENARIO UPLOADS FOUR FILES
// ---------------------------------------------------------------------------------------------
// The uploads prove parsing, chunking and embedding — the path that needs real files and a real
// OpenAI call. But an upload takes time, and "deactivate this and watch it disappear from search"
// needs a document that is already there and already indexed. Seeding one separates the two
// questions: if an upload fails, the deactivation half of the walk still works.
//
// ---------------------------------------------------------------------------------------------
// THE SEEDED EMBEDDINGS ARE UNIT VECTORS, AND THAT HAS A CONSEQUENCE THE TESTER MUST KNOW
// ---------------------------------------------------------------------------------------------
// createDocumentChunk seeds a 1-on-one-axis vector rather than a real embedding, because a real
// one would mean an OpenAI call on every `npm run seed`. A typed English query will NOT align
// with those axes, so THE RETRIEVAL TESTER WILL NOT RETURN THE SEEDED PASSAGES. That is expected
// and it is written into the scenario steps: the tester searches for text from the documents
// they UPLOADED, which were embedded for real.
//
// What the seeded corpus is for is the count on screen, the deactivate/reactivate toggle, and
// the delete confirm naming a real passage count.
//
// ---------------------------------------------------------------------------------------------
// THREE SEATS, THREE ANSWERS TO "CAN I REACH /knowledge"
// ---------------------------------------------------------------------------------------------
// knowledge.view and knowledge.manage are bishopric-only (lib/auth/permissions.ts). The
// secretary exists to prove the refusal is a "Not permitted" page and not an empty library —
// an empty library is a different claim.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // Bishopric authority is SHARED (CLAUDE.md §7). A counselor uploaded one of the two seeded
  // documents, so the list shows two different names and the walk can see that a counselor's
  // upload is a first-class one.
  const counselor = await createTestUser({
    handle: "counselor1",
    role: "counselor",
    counselorPosition: 1,
    org: "bishopric",
    firstName: "Peter",
    lastName: "Nakamura",
  });

  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Delgado",
  });

  // ------------------------------------------------------------------------------------------
  // Document one — every passage embedded. The ordinary, healthy case.
  // ------------------------------------------------------------------------------------------
  const conferenceTalk = await createKnowledgeDocument({
    title: "Elder Holland, April 2024",
    typeTag: "general_conference",
    uploadedBy: bishop.id,
    uploadedAt: "2026-07-14T16:20:00Z",
  });

  const HOLLAND_PASSAGES = [
    "[Elder Holland, April 2024 (part 1)] Faith is the first principle, and it is a principle of action before it is ever a principle of comfort.",
    "[Elder Holland, April 2024 (part 2)] To those who feel their faith is small: a seed is small too, and nobody faults a seed for being one.",
    "[Elder Holland, April 2024 (part 3)] Ministering is not a program. It is the ordinary work of noticing one another.",
    "[Elder Holland, April 2024 (part 4)] Hold on to what you do know while you wait for what you do not.",
  ];

  for (const [index, content] of HOLLAND_PASSAGES.entries()) {
    await createDocumentChunk({
      documentId: conferenceTalk,
      content,
      chunkIndex: index,
      embeddingAxis: index,
    });
  }

  // ------------------------------------------------------------------------------------------
  // Document two — one passage UNEMBEDDED, so the two counts differ on screen.
  // ------------------------------------------------------------------------------------------
  // "6 passages, 5 embedded — 1 not searchable" is the line that makes a partial embedding
  // failure visible. Seeding a document where the counts are equal would never render it, and
  // the wording would ship unread.
  const stakeLetter = await createKnowledgeDocument({
    title: "Stake presidency letter, January 2026",
    typeTag: "other",
    uploadedBy: counselor.id,
    uploadedAt: "2026-08-02T09:05:00Z",
  });

  const LETTER_PASSAGES = [
    "[Stake presidency letter, January 2026 (part 1)] Brothers and sisters, we write concerning the coming year of ministering assignments.",
    "[Stake presidency letter, January 2026 (part 2)] Ward councils should review their visit goals each quarter rather than each year.",
    "[Stake presidency letter, January 2026 (part 3)] Youth should be invited to speak in sacrament meeting at least twice a year.",
    "[Stake presidency letter, January 2026 (part 4)] Temple recommend interviews may be scheduled through the executive secretary.",
    "[Stake presidency letter, January 2026 (part 5)] We express our confidence in the bishoprics of this stake.",
    "[Stake presidency letter, January 2026 (part 6)] This passage failed to embed when the letter was uploaded.",
  ];

  for (const [index, content] of LETTER_PASSAGES.entries()) {
    await createDocumentChunk({
      documentId: stakeLetter,
      content,
      chunkIndex: index,
      // The last one is the failure. Its text is kept on purpose (lib/knowledge/ingest.ts) and
      // match_document_chunks must never return it.
      embeddingAxis: index === LETTER_PASSAGES.length - 1 ? null : 10 + index,
    });
  }

  console.log("  ward, 3 users, 2 knowledge documents, 10 passages (1 unembedded)");
}
