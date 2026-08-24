import {
  createDocumentChunk,
  createKnowledgeDocument,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// A corpus with ENOUGH SHAPE THAT THE COUNT SENTENCE HAS SOMETHING TO SAY.
//
// ---------------------------------------------------------------------------------------------
// WHY TWELVE TALKS AND NOT THREE
// ---------------------------------------------------------------------------------------------
// The count sentence is the whole feature — "Currently scoped to 4 of 12 conference talks. The
// standard works are always included." With three talks every filter produces 1, 2 or 3 and the
// sentence is arithmetic nobody reads. With twelve across four conferences and three callings,
// changing the recency select MOVES A NUMBER a person notices, which is the only way to judge
// whether the sentence is doing its job.
//
// ---------------------------------------------------------------------------------------------
// THE SCRIPTURE DOCUMENT IS THE POINT OF THE WHOLE SCENARIO
// ---------------------------------------------------------------------------------------------
// "Book of Mormon" is seeded with NULL speaker, role and conference date — exactly as the real
// ingest script writes it. The failure this plan is most likely to ship is a recency filter that
// silently removes it from every retrieval, and the checklist item that catches it is "set last
// 2 years, run the Retrieval Tester, still see scripture". That item is meaningless without a
// scripture document in the corpus.
//
// ---------------------------------------------------------------------------------------------
// ONE TALK IS DELIBERATELY UNLABELLED
// ---------------------------------------------------------------------------------------------
// "An older talk somebody uploaded" is `general_conference` with no metadata — the state the
// upload form now refuses, but which every talk uploaded before ai-d is in. No filter can reach
// it, which per migration 033 means it is silently ALWAYS INCLUDED when nothing is scoped and
// always excluded once anything is. DocumentList badges it "Not filterable"; whether that badge
// and its explanation actually land is a judgement only a person can make.
//
// ---------------------------------------------------------------------------------------------
// THE SEEDED EMBEDDINGS ARE UNIT VECTORS, WITH A CONSEQUENCE THE TESTER MUST KNOW
// ---------------------------------------------------------------------------------------------
// createDocumentChunk seeds a 1-on-one-axis vector rather than a real embedding, because a real
// one would mean an OpenAI call on every `npm run seed`. A typed English query will NOT align
// with those axes, so THE RETRIEVAL TESTER WILL RETURN NOTHING for the seeded corpus.
//
// That is why the scenario has the tester UPLOAD one scripture-tagged file and one conference
// talk before the retrieval step: those are embedded for real, and searching for their text is
// what makes "scripture survived the filter" observable on screen rather than inferred.

const CONFERENCES = [
  { label: "April 2026", date: "2026-04-01" },
  { label: "October 2025", date: "2025-10-01" },
  { label: "April 2022", date: "2022-04-01" },
  { label: "October 2019", date: "2019-10-01" },
] as const;

// Three callings across each conference, so a role filter and a recency filter cut the corpus in
// two different directions and their combination is visibly narrower than either.
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

  // knowledge.view and knowledge.manage are bishopric-only (lib/auth/permissions.ts). The
  // secretary exists to prove the refusal is a "Not permitted" page and not an empty panel —
  // an empty panel is a different claim.
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Delgado",
  });

  let axis = 0;

  // ------------------------------------------------------------------------------------------
  // The standard works — null metadata, and exempt from every filter
  // ------------------------------------------------------------------------------------------
  const scripture = await createKnowledgeDocument({
    title: "Book of Mormon",
    typeTag: "standard_works",
    uploadedAt: "2026-06-01T09:00:00Z",
  });

  const SCRIPTURE_PASSAGES = [
    "[Alma 32:21] And now as I said concerning faith — faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true.",
    "[Moroni 7:45] And charity suffereth long, and is kind, and envieth not, and is not puffed up, seeketh not her own, is not easily provoked, thinketh no evil.",
    "[Mosiah 18:9] Yea, and are willing to mourn with those that mourn; yea, and comfort those that stand in need of comfort.",
  ];

  for (const [index, content] of SCRIPTURE_PASSAGES.entries()) {
    await createDocumentChunk({
      documentId: scripture,
      content,
      chunkIndex: index,
      embeddingAxis: axis++,
    });
  }

  // ------------------------------------------------------------------------------------------
  // Twelve conference talks — four conferences, three callings each
  // ------------------------------------------------------------------------------------------
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
        content: `[${title}] A passage from ${speaker.name}'s ${conference.label} address, kept short because what is under test is the scope rather than the text.`,
        chunkIndex: 0,
        embeddingAxis: axis++,
      });
    }
  }

  // ------------------------------------------------------------------------------------------
  // One conference talk with NO metadata — the "Not filterable" case
  // ------------------------------------------------------------------------------------------
  const unlabelled = await createKnowledgeDocument({
    title: "An older talk somebody uploaded",
    typeTag: "general_conference",
    uploadedBy: bishop.id,
    uploadedAt: "2026-05-02T11:00:00Z",
  });

  await createDocumentChunk({
    documentId: unlabelled,
    content:
      "[An older talk somebody uploaded] This talk has no speaker, calling or conference recorded, so no filter can reach it.",
    chunkIndex: 0,
    embeddingAxis: axis++,
  });

  // ------------------------------------------------------------------------------------------
  // A stake letter — exempt for the same reason scripture is, and worth having on screen
  // ------------------------------------------------------------------------------------------
  const letter = await createKnowledgeDocument({
    title: "Stake presidency letter, January 2026",
    typeTag: "other",
    uploadedBy: bishop.id,
    uploadedAt: "2026-08-02T09:05:00Z",
  });

  await createDocumentChunk({
    documentId: letter,
    content:
      "[Stake presidency letter, January 2026] Ward councils should review their visit goals each quarter rather than each year.",
    chunkIndex: 0,
    embeddingAxis: axis++,
  });

  console.log(
    "  ward, 2 users, 15 knowledge documents (1 scripture, 13 conference, 1 letter), 18 passages",
  );
}
