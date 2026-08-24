import {
  createAiSettings,
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// Two saved versions of the ward's AI settings, by different people on different dates.
//
// ---------------------------------------------------------------------------------------------
// WHY TWO, AND WHY DELIBERATELY PLAIN
// ---------------------------------------------------------------------------------------------
// One version would prove only that the form loads something. Two proves the "active = latest"
// rule is real on screen: the form must load the AUGUST one, and only the August one may carry
// the Active badge.
//
// The tone on both is deliberately flat and generic. The walk's central question is whether an
// UNSAVED tone change visibly changes the preview output, and that comparison only works if the
// baseline sounds like nothing in particular. A seeded tone of "warm and brief" would make the
// tester's edit indistinguishable from what was already there.
//
// ---------------------------------------------------------------------------------------------
// THE TWO created_at VALUES ARE EXPLICIT, AND THAT IS LOAD-BEARING
// ---------------------------------------------------------------------------------------------
// `ai_settings` is append-only and "active" means latest created_at, with id as the tie-break
// (lib/ai/queries.ts). Two rows inserted with the default now() would land a millisecond apart
// and the walk would have no stable answer to "which one should say Active". A month between
// them also makes the history readable as a history rather than as two identical lines.
//
// ---------------------------------------------------------------------------------------------
// NOTHING SEEDS A KNOWLEDGE BASE
// ---------------------------------------------------------------------------------------------
// A ward with zero documents gets a system prompt with layers 1 and 2 and NO layer 3. That is a
// legitimate state, it is what ai-a ships, and it is what this scenario walks. Retrieval arrives
// in ai-b.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  // Three seats, three different answers to "can I reach /ai-settings".
  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  // Bishopric authority is SHARED (CLAUDE.md §7). A counselor saved the older version, so the
  // history has two different names in it and the walk can see that a counselor's save is a
  // first-class one rather than a lesser record.
  const counselor = await createTestUser({
    handle: "counselor1",
    role: "counselor",
    counselorPosition: 1,
    org: "bishopric",
    firstName: "Peter",
    lastName: "Nakamura",
  });

  // Holds no ai_settings permission at all, so this account must reach a "Not permitted" page
  // rather than an empty form — an empty form is a different and misleading claim.
  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    firstName: "Ruth",
    lastName: "Kaufman",
  });

  // --- The older version: July, saved by the counselor -------------------------------------
  await createAiSettings({
    createdAt: "2026-07-12T15:20:00.000Z",
    savedBy: counselor.id,
    toneVoice: "Standard tone. Complete sentences.",
    doctrinalEmphasis: "General gospel principles.",
    canonPriority: ["new_testament"],
    maxScriptureReferences: 2,
    maxYearsOld: 10,
    maxConferenceTalks: 2,
    preferKnowledgeBase: false,
    wardContext: "A ward of about 300 members.",
  });

  // --- The active version: August, saved by the bishop --------------------------------------
  // This is the one the form must load. If the July values appear instead, "active = latest" is
  // broken and every later AI feature inherits the wrong configuration.
  await createAiSettings({
    createdAt: "2026-08-12T18:45:00.000Z",
    savedBy: bishop.id,
    toneVoice: "Standard tone. Write in full paragraphs and use formal address.",
    doctrinalEmphasis: "Faith, repentance, and covenant keeping.",
    canonPriority: ["book_of_mormon", "new_testament"],
    maxScriptureReferences: 3,
    scriptureNotes: "Prefer passages a new member would recognise.",
    // null means NO recency limit, and the form must show this box BLANK rather than as a zero.
    maxYearsOld: null,
    maxConferenceTalks: 3,
    preferKnowledgeBase: true,
    topicPreferences: "Avoid topics the ward has used in the last year.",
    wardContext:
      "A ward of about 300 members with many young families new to the area, and a " +
      "significant number of members serving in the military.",
    thankYouPreferences: "Refer to what the speaker actually said, not to speaking in general.",
  });
}
