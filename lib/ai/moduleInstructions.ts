import type { AiModule } from "@/types/domain";

// PURE. No imports beyond types/domain, so a client component can import this file safely
// (plans/retros/roster-b-picker-and-orgs.md). lib/ai/client.ts and lib/ai/queries.ts are the
// server-only halves of this directory; these two are not.
//
// Each block is three or four plain sentences on purpose. Current Claude models follow
// instructions closely, and a paragraph of "CRITICAL: YOU MUST NEVER" language causes
// over-application — the model starts hedging every sentence instead of writing the draft. State
// the task and the constraints once.

// Rule 4 of the phase plan, in one exported constant so a later module cannot forget it by hand.
// It is composed in below rather than retyped per block.
export const CITATION_INSTRUCTION =
  "Cite the source of any scripture or conference talk you reference, for example " +
  "*Alma 32:21* or *Elder Holland, April 2024*.";

const BLOCKS: Record<AiModule, string> = {
  // The honest one. A preview is a sample the bishopric is judging, and saying so is what stops
  // it reading as a message somebody already sent.
  settings_preview:
    "The bishopric is testing how these settings sound. Write a short sample response to the " +
    "request below, in the voice the settings describe. This is a sample for them to judge and " +
    "it will not be sent to anyone.",

  topic_suggestions:
    "Suggest sacrament meeting talk topics for this ward. Each one needs a title a speaker can " +
    "work from and a sentence saying what it asks the congregation to consider. Favour topics " +
    "that fit the ward's circumstances over general ones.",

  confirmation_message:
    "Draft a short message confirming a speaking assignment. Name the date, the topic, and how " +
    "long they are asked to speak. Keep it warm and brief — it is read on a phone, and a member " +
    "of the bishopric will read it over before sending it.",

  thank_you_message:
    "Draft a short thank-you message to someone who has spoken in sacrament meeting. Refer to " +
    "what they spoke about rather than thanking them in general terms. Two or three sentences.",
};

// Every block ends with the citation instruction. Composed here rather than written into each
// string, so adding a module cannot produce one that quietly omits it.
export const MODULE_INSTRUCTIONS: Record<AiModule, string> = Object.fromEntries(
  Object.entries(BLOCKS).map(([module, block]) => [
    module,
    `${block}\n\n${CITATION_INSTRUCTION}`,
  ]),
) as Record<AiModule, string>;
