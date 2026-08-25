import { describe, expect, it } from "vitest";
import { buildProgramEditPrompt } from "@/lib/ai/programEdit";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import { MODULE_INSTRUCTIONS, CITATION_INSTRUCTION } from "@/lib/ai/moduleInstructions";
import type { ProgramDraft } from "@/lib/program/draft";
import type { ChatTurn } from "@/lib/validation/aiProgramEdit";
import { AI_MODULES, type AiSettings } from "@/types/domain";

// The prompt is what makes the edit an EDIT rather than a rewrite.
//
// Two properties, and both are the kind that fail silently. A prompt missing the current draft
// produces a plausible program that has nothing to do with this Sunday. A prompt missing the
// history makes "no, the second speaker" meaningless — and neither shows up as an error, only as
// a bad answer somebody has to notice.
//
// PURE, so this suite needs no network and no database (lib/ai/programEdit.ts).

function draft(overrides: Partial<ProgramDraft> = {}): ProgramDraft {
  return {
    version: 1,
    heading: null,
    date: "2026-09-20",
    sundayType: "standard",
    presiding: { printedName: "Mark Andersen", publicName: "Mark A." },
    conducting: { printedName: "Peter Lindqvist", publicName: "Peter L." },
    organist: null,
    chorister: null,
    openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
    invocation: { printedName: "David Brooks", publicName: "David B." },
    wardBusiness: "Sustaining a new Elders Quorum secretary.",
    sacramentHymn: null,
    specialNotes: null,
    musicalNumber: null,
    speakers: [
      {
        slotNumber: 1,
        kind: "member",
        printedName: "Sarah Whitfield",
        publicName: "Sarah W.",
        topic: "Charity Never Faileth",
      },
      { slotNumber: 2, kind: "empty", printedName: null, publicName: null, topic: null },
    ],
    closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
    benediction: null,
    announcements: "Ward temple night on Thursday.",
    leadershipContacts: [],
    missionaries: null,
    missing: ["sacrament_hymn", "benediction", "speaker_slot"],
    ...overrides,
  };
}

const HISTORY: ChatTurn[] = [
  { role: "user", content: "Add a note that the Primary children will sing." },
  { role: "assistant", content: "Special notes: nothing → The Primary children will sing." },
];

describe("buildProgramEditPrompt — the current draft", () => {
  it("carries every field the model must return unchanged", () => {
    const prompt = buildProgramEditPrompt({
      draft: draft(),
      history: [],
      instruction: "Change the ward business.",
    });

    expect(prompt).toContain("Sarah Whitfield");
    expect(prompt).toContain("Charity Never Faileth");
    expect(prompt).toContain("Sustaining a new Elders Quorum secretary.");
    expect(prompt).toContain("Ward temple night on Thursday.");
    expect(prompt).toContain("2026-09-20");
  });

  // The literal version, the date and the sundayType are the three the API cannot constrain — the
  // SDK downgrades them into schema descriptions — so the prompt is the layer that carries them.
  it("names the fields the schema cannot enforce", () => {
    const prompt = buildProgramEditPrompt({
      draft: draft(),
      history: [],
      instruction: "Anything.",
    });

    expect(prompt).toContain('"version": 1');
    expect(prompt).toContain("`version`");
    expect(prompt).toContain("`date`");
    expect(prompt).toContain("`sundayType`");
  });

  it("carries the instruction verbatim", () => {
    const instruction = "Add a note that the Primary children will sing during the sacrament.";
    const prompt = buildProgramEditPrompt({ draft: draft(), history: [], instruction });

    expect(prompt).toContain(instruction);
  });
});

describe("buildProgramEditPrompt — the conversation", () => {
  it("carries every turn, in order", () => {
    const prompt = buildProgramEditPrompt({
      draft: draft(),
      history: HISTORY,
      instruction: "Now change the ward business too.",
    });

    for (const turn of HISTORY) {
      expect(prompt).toContain(turn.content);
    }

    expect(prompt.indexOf(HISTORY[0].content)).toBeLessThan(
      prompt.indexOf(HISTORY[1].content),
    );
  });

  // An empty history renders NOTHING, not an empty "Earlier in this conversation:" heading. A
  // model reading a heading with nothing under it will try to honour it.
  it("omits the conversation section entirely when there is none", () => {
    const prompt = buildProgramEditPrompt({
      draft: draft(),
      history: [],
      instruction: "Anything.",
    });

    expect(prompt).not.toContain("Earlier in this conversation");
  });

  it("labels who said what, so the turns cannot be read as one voice", () => {
    const prompt = buildProgramEditPrompt({
      draft: draft(),
      history: HISTORY,
      instruction: "Anything.",
    });

    expect(prompt).toContain("They asked:");
    expect(prompt).toContain("What changed:");
  });
});

describe("the program_edit system block", () => {
  it("is registered as an AI module", () => {
    expect(AI_MODULES).toContain("program_edit");
  });

  it("tells the model to leave untouched fields alone and never to write a placeholder", () => {
    const block = MODULE_INSTRUCTIONS.program_edit;

    expect(block).toMatch(/exactly as it\s+was/);
    expect(block).toContain("TBD");
    expect(block).toMatch(/stays null/);
  });

  // Composed by MODULE_INSTRUCTIONS rather than written into the block, so a module cannot be
  // added that quietly omits it.
  it("ends with the citation instruction like every other module", () => {
    expect(MODULE_INSTRUCTIONS.program_edit.endsWith(CITATION_INSTRUCTION)).toBe(true);
  });
});

describe("the program_edit system prompt", () => {
  const settings: AiSettings = {
    id: "settings-1",
    toneVoice: "Warm and plain. Never formal for its own sake.",
    doctrinalEmphasis: null,
    scripturePreferences: null,
    conferencePreferences: null,
    topicPreferences: null,
    wardContext: "A student ward with many young families.",
    thankYouPreferences: null,
    savedBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("carries the ward's settings into the first block", () => {
    const blocks = buildSystemPrompt({ settings, module: "program_edit" });

    expect(blocks[0].text).toContain("Warm and plain. Never formal for its own sake.");
    expect(blocks[0].text).toContain("A student ward with many young families.");
  });

  // The breakpoint sits on the LAST STABLE block. Caching is a prefix match, so anything volatile
  // above it never hits (lib/ai/systemPrompt.ts).
  it("puts the module instructions second, with the cache breakpoint on them", () => {
    const blocks = buildSystemPrompt({ settings, module: "program_edit" });

    expect(blocks).toHaveLength(2);
    expect(blocks[1].text).toBe(MODULE_INSTRUCTIONS.program_edit);
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  // No retrieval on this module. A program edit is a text change to a document the user is
  // holding — there is no question for the corpus to answer.
  it("has no retrieved-chunks block", () => {
    const blocks = buildSystemPrompt({ settings, module: "program_edit" });

    expect(blocks.some((block) => block.text.includes("knowledge base"))).toBe(false);
  });
});
