import {
  createDocumentChunk,
  createKnowledgeDocument,
  createRetrievalFilter,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// Scenario 026's corpus, plus TWO FILTERS ALREADY SAVED.
//
// ---------------------------------------------------------------------------------------------
// WHY THE TWO SAVED FILTERS ARE THE POINT OF THIS SEED
// ---------------------------------------------------------------------------------------------
// Two things in the checklist are unreachable on an empty list:
//
//   1. The checkbox list itself. A saved filter has to be SEEN in the scope panel with its
//      source phrase underneath before anybody can judge whether the phrase earns its place —
//      and the phrase is the whole argument for storing `source_phrase` at all.
//
//   2. The duplicate-label refusal. Migration 034 refuses two filters with one label per ward,
//      and the route turns that into a sentence rather than a 500. The tester reaches it by
//      naming a new filter "Prophets", which only collides if "Prophets" already exists.
//
// ---------------------------------------------------------------------------------------------
// THE CORPUS IS THE SAME SHAPE AS 026, AND DELIBERATELY SO
// ---------------------------------------------------------------------------------------------
// The resolver's proposals have to be judged against a corpus where they would MEAN something.
// "Talks by President Nelson" resolving correctly is a weak observation if the ward has no Nelson
// talks; the count sentence updating when the filter is ticked is what makes it real.
//
// As in 026, the seeded embeddings are hand-written unit vectors, so the Retrieval Tester will
// not return the seeded passages for a typed English query. That does not matter here — this
// scenario is about the resolver and the checkbox list, not about retrieval results.

const CONFERENCES = [
  { label: "April 2026", date: "2026-04-01" },
  { label: "October 2025", date: "2025-10-01" },
  { label: "April 2022", date: "2022-04-01" },
  { label: "October 2019", date: "2019-10-01" },
] as const;

const SPEAKERS = [
  { name: "Russell M. Nelson", role: "prophet" as const },
  { name: "Dallin H. Oaks", role: "apostle" as const },
  { name: "Gerrit W. Gong", role: "seventy" as const },
];

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

  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Delgado",
  });

  let axis = 0;

  // The standard works, exempt from every filter — kept here so the count sentence's
  // "the standard works are always included" clause is true on screen rather than theoretical.
  const scripture = await createKnowledgeDocument({
    title: "Book of Mormon",
    typeTag: "standard_works",
    uploadedAt: "2026-06-01T09:00:00Z",
  });

  await createDocumentChunk({
    documentId: scripture,
    content:
      "[Alma 32:21] And now as I said concerning faith — faith is not to have a perfect knowledge of things.",
    chunkIndex: 0,
    embeddingAxis: axis++,
  });

  // Twelve conference talks — four conferences, three callings each.
  for (const conference of CONFERENCES) {
    for (const speaker of SPEAKERS) {
      const title = `${speaker.name}, ${conference.label}`;

      const document = await createKnowledgeDocument({
        title,
        typeTag: "general_conference",
        speaker: speaker.name,
        speakerRole: speaker.role,
        conferenceDate: conference.date,
        uploadedBy: bishop.id,
        uploadedAt: "2026-07-14T16:20:00Z",
      });

      await createDocumentChunk({
        documentId: document,
        content: `[${title}] A passage from ${speaker.name}'s ${conference.label} address.`,
        chunkIndex: 0,
        embeddingAxis: axis++,
      });
    }
  }

  // ------------------------------------------------------------------------------------------
  // Two saved filters
  // ------------------------------------------------------------------------------------------
  // "Prophets" is the one the tester will COLLIDE WITH when they try to save a second filter by
  // that name. Its source phrase is deliberately different from its label, because that is the
  // case where storing the phrase earns its keep — the label alone would not tell you the filter
  // is about the calling rather than about a person.
  await createRetrievalFilter({
    label: "Prophets",
    sourcePhrase: "talks given by the prophet",
    speakerRoles: ["prophet"],
    createdBy: bishop.id,
  });

  // A filter on a SPEAKER rather than a calling, so the checkbox list shows both shapes and the
  // tester can see that the two narrow differently.
  await createRetrievalFilter({
    label: "Elder Gong",
    sourcePhrase: "anything by Gerrit W. Gong",
    speakers: ["Gerrit W. Gong"],
    createdBy: bishop.id,
  });

  console.log(
    "  ward, 2 users, 13 knowledge documents, 13 passages, 2 saved retrieval filters",
  );
}
