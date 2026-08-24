import type Anthropic from "@anthropic-ai/sdk";
import { MODULE_INSTRUCTIONS } from "@/lib/ai/moduleInstructions";
import {
  STANDARD_WORK_LABELS,
  type AiModule,
  type AiSettings,
  type ConferencePreferences,
  type ScripturePreferences,
} from "@/types/domain";

// PURE, and it TAKES SETTINGS AS AN ARGUMENT — a deliberate deviation from the phase plan's
// buildSystemPrompt({ wardId, … }). A function that resolves its own ward needs a database to
// test, and every other pure rule in this codebase (goalStatus.ts, messageTemplate.ts,
// prayerPipeline.ts) is a function of its inputs for exactly that reason. The caller resolves
// settings; this assembles them.

export type RetrievedChunk = { content: string; sourceLabel: string };

export type BuildSystemPromptInput = {
  settings: AiSettings | null;
  module: AiModule;
  retrievedChunks?: readonly RetrievedChunk[];
};

const NO_SETTINGS_PROSE =
  "This ward has not saved any AI preferences yet. Use plain, warm, straightforward language.";

function renderScripturePreferences(preferences: ScripturePreferences): string[] {
  const lines: string[] = [];

  if (preferences.canonPriority.length > 0) {
    const works = preferences.canonPriority
      .map((work) => STANDARD_WORK_LABELS[work])
      .join(", then ");
    lines.push(`When citing scripture, draw first from ${works}.`);
  }

  // A zero that renders as "0 references" reads like a formatting bug. It is a real choice, and
  // it is spelled as one.
  if (preferences.maxReferences === 0) {
    lines.push("Do not suggest scriptures.");
  } else {
    lines.push(
      `Suggest at most ${preferences.maxReferences} scripture ` +
        `${preferences.maxReferences === 1 ? "reference" : "references"}.`,
    );
  }

  if (preferences.relevanceNotes && preferences.relevanceNotes.trim() !== "") {
    lines.push(`On choosing scriptures: ${preferences.relevanceNotes.trim()}`);
  }

  return lines;
}

function renderConferencePreferences(preferences: ConferencePreferences): string[] {
  const lines: string[] = [];

  // null means "no recency limit" and is spelled that way. Treating it as zero would silently
  // forbid every conference talk ever given.
  if (preferences.maxYearsOld === null) {
    lines.push("Conference talks from any year are welcome.");
  } else {
    lines.push(
      `Prefer conference talks from the last ${preferences.maxYearsOld} ` +
        `${preferences.maxYearsOld === 1 ? "year" : "years"}.`,
    );
  }

  if (preferences.maxTalks === 0) {
    lines.push("Do not suggest conference talks.");
  } else {
    lines.push(
      `Suggest at most ${preferences.maxTalks} conference ` +
        `${preferences.maxTalks === 1 ? "talk" : "talks"}.`,
    );
  }

  if (preferences.preferKnowledgeBase) {
    lines.push(
      "Prefer talks and documents from the ward's own knowledge base over ones you recall.",
    );
  }

  return lines;
}

// PROSE, not JSON. A field that is null or blank is SKIPPED rather than rendered as "Tone: null"
// — a model reading "Tone: null" will try to honour it.
export function renderSettingsProse(settings: AiSettings | null): string {
  if (!settings) return NO_SETTINGS_PROSE;

  const lines: string[] = [];

  const addFreeText = (label: string, value: string | null) => {
    if (value && value.trim() !== "") lines.push(`${label}: ${value.trim()}`);
  };

  addFreeText("Tone and voice", settings.toneVoice);
  addFreeText("Doctrinal emphasis", settings.doctrinalEmphasis);

  if (settings.scripturePreferences) {
    lines.push(...renderScripturePreferences(settings.scripturePreferences));
  }
  if (settings.conferencePreferences) {
    lines.push(...renderConferencePreferences(settings.conferencePreferences));
  }

  addFreeText("On generating topics", settings.topicPreferences);
  addFreeText("About this ward", settings.wardContext);
  addFreeText("On thank-you messages", settings.thankYouPreferences);

  if (lines.length === 0) return NO_SETTINGS_PROSE;

  return `This ward has asked for the following.\n\n${lines.join("\n")}`;
}

function renderChunks(chunks: readonly RetrievedChunk[]): string {
  const excerpts = chunks
    .map((chunk) => `[${chunk.sourceLabel}] ${chunk.content}`)
    .join("\n\n");

  return (
    `Relevant material from the ward's knowledge base:\n\n${excerpts}\n\n` +
    "These are excerpts, not whole documents. Do not assume they say everything their source says."
  );
}

// Returns TWO or THREE blocks, always in this order:
//
//   0  ward AI settings, as prose            no cache_control
//   1  module instructions + citation rule   cache_control: ephemeral   <- the breakpoint
//   2  retrieved chunks                      no cache_control, OMITTED when there are none
//
// THE BREAKPOINT IS ON THE LAST STABLE BLOCK, AND LAYER 3 COMES AFTER IT. This is the most
// consequential line in the file. Caching is a prefix match: retrieved chunks vary per request,
// so anything cached after them never hits. Stable first, volatile last, always.
//
// Block 0 is present even when settings is null, so the block count for the first two layers is
// constant and the breakpoint assertion is an index check rather than a search.
//
// The minimum cacheable prefix is ~1024 tokens. A ward with sparse settings produces a stable
// prefix under that floor and cache_read_input_tokens stays 0. That is NOT a bug — it is the API
// floor, and it is written here so nobody spends an afternoon debugging it.
export function buildSystemPrompt(
  input: BuildSystemPromptInput,
): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: renderSettingsProse(input.settings) },
    {
      type: "text",
      text: MODULE_INSTRUCTIONS[input.module],
      cache_control: { type: "ephemeral" },
    },
  ];

  const chunks = input.retrievedChunks ?? [];
  if (chunks.length > 0) {
    blocks.push({ type: "text", text: renderChunks(chunks) });
  }

  return blocks;
}
