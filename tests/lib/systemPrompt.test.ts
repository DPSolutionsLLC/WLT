import { describe, expect, it } from "vitest";
import { CITATION_INSTRUCTION } from "@/lib/ai/moduleInstructions";
import { buildSystemPrompt, renderSettingsProse } from "@/lib/ai/systemPrompt";
import { AI_MODULES, type AiSettings } from "@/types/domain";

// Phase 5 test **system-prompt**. The assertion that matters is BREAKPOINT PLACEMENT: caching is
// a prefix match, so anything cached after the per-request retrieved chunks never hits.
//
// This suite deliberately does NOT assert that cache_read_input_tokens is non-zero. The minimum
// cacheable prefix is ~1024 tokens, and a ward with sparse settings sits under that floor — a
// test asserting otherwise would fail for a reason that is not a bug.

const FULL_SETTINGS: AiSettings = {
  id: "settings-1",
  toneVoice: "Warm and brief, never formal.",
  doctrinalEmphasis: "Covenant living.",
  scripturePreferences: {
    canonPriority: ["book_of_mormon", "new_testament"],
    maxReferences: 3,
    relevanceNotes: "Prefer passages a new member would recognise.",
  },
  conferencePreferences: { maxYearsOld: 5, maxTalks: 2, preferKnowledgeBase: true },
  topicPreferences: "Avoid topics used in the last year.",
  wardContext: "A young ward with many families new to the area.",
  thankYouPreferences: "Mention what they actually spoke about.",
  savedBy: "user-1",
  createdAt: "2026-08-01T00:00:00.000Z",
};

function chunkList() {
  return [
    { content: "And now, as I said concerning faith…", sourceLabel: "Alma 32" },
    { content: "Charity is the pure love of Christ.", sourceLabel: "Moroni 7" },
  ];
}

describe("buildSystemPrompt", () => {
  it("returns three blocks in layer order when chunks are supplied", () => {
    const blocks = buildSystemPrompt({
      settings: FULL_SETTINGS,
      module: "topic_suggestions",
      retrievedChunks: chunkList(),
    });

    expect(blocks).toHaveLength(3);
    expect(blocks[0].text).toContain("Warm and brief");
    expect(blocks[1].text).toContain(CITATION_INSTRUCTION);
    expect(blocks[2].text).toContain("[Alma 32]");
    expect(blocks[2].text).toContain("[Moroni 7]");
  });

  // THE assertion. Exactly one breakpoint, and it sits before the volatile layer.
  it("sets cache_control on exactly one block, above the chunks block", () => {
    const blocks = buildSystemPrompt({
      settings: FULL_SETTINGS,
      module: "topic_suggestions",
      retrievedChunks: chunkList(),
    });

    const breakpointIndexes = blocks
      .map((block, index) => (block.cache_control ? index : -1))
      .filter((index) => index !== -1);

    expect(breakpointIndexes).toHaveLength(1);

    const chunksIndex = blocks.findIndex((block) => block.text.includes("[Alma 32]"));
    expect(chunksIndex).toBeGreaterThan(-1);
    expect(breakpointIndexes[0]).toBeLessThan(chunksIndex);
  });

  it("returns exactly two blocks with no chunks, the last carrying the breakpoint", () => {
    const blocks = buildSystemPrompt({
      settings: FULL_SETTINGS,
      module: "settings_preview",
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("treats an empty chunk list the same as no chunks", () => {
    const blocks = buildSystemPrompt({
      settings: FULL_SETTINGS,
      module: "settings_preview",
      retrievedChunks: [],
    });

    expect(blocks).toHaveLength(2);
  });

  // Block 0 exists even with no settings, so the prefix shape is constant and the breakpoint
  // assertion above stays an index check rather than a search.
  it("keeps block 0 when settings are null and never renders the word null", () => {
    const blocks = buildSystemPrompt({ settings: null, module: "settings_preview" });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain("has not saved any AI preferences");
    for (const block of blocks) {
      expect(block.text).not.toContain("null");
    }
  });

  it("gives every module a block ending with the citation instruction", () => {
    for (const aiModule of AI_MODULES) {
      const blocks = buildSystemPrompt({ settings: null, module: aiModule });
      expect(blocks[1].text.endsWith(CITATION_INSTRUCTION)).toBe(true);
    }
  });
});

describe("renderSettingsProse", () => {
  it("skips null and blank fields rather than labelling them", () => {
    const prose = renderSettingsProse({
      ...FULL_SETTINGS,
      toneVoice: null,
      doctrinalEmphasis: "   ",
      topicPreferences: null,
    });

    expect(prose).not.toContain("Tone and voice");
    expect(prose).not.toContain("Doctrinal emphasis");
    expect(prose).not.toContain("On generating topics");
    expect(prose).not.toContain("null");
    expect(prose).toContain("About this ward");
  });

  // null means "no recency limit". Rendering it as a number — or as the word null — would tell
  // the model something the ward never said.
  it("spells maxYearsOld: null as words", () => {
    const prose = renderSettingsProse({
      ...FULL_SETTINGS,
      conferencePreferences: { maxYearsOld: null, maxTalks: 2, preferKnowledgeBase: false },
    });

    expect(prose).toContain("any year");
    expect(prose).not.toContain("null");
    expect(prose).not.toContain("last 0 years");
  });

  // A zero rendered as "0 references" reads like a formatting bug rather than an instruction.
  it("spells maxReferences: 0 as a refusal to suggest", () => {
    const prose = renderSettingsProse({
      ...FULL_SETTINGS,
      scripturePreferences: {
        canonPriority: [],
        maxReferences: 0,
        relevanceNotes: null,
      },
    });

    expect(prose).toContain("Do not suggest scriptures.");
    expect(prose).not.toContain("0 scripture");
  });

  it("renders canon priority in the saved order, by label", () => {
    const prose = renderSettingsProse(FULL_SETTINGS);

    expect(prose).toContain("Book of Mormon, then New Testament");
    expect(prose).not.toContain("book_of_mormon");
  });

  it("falls back to the no-settings sentence when every field is empty", () => {
    const prose = renderSettingsProse({
      ...FULL_SETTINGS,
      toneVoice: null,
      doctrinalEmphasis: null,
      scripturePreferences: null,
      conferencePreferences: null,
      topicPreferences: null,
      wardContext: null,
      thankYouPreferences: null,
    });

    expect(prose).toContain("has not saved any AI preferences");
  });
});
