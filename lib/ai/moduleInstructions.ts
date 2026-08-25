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

  // The only module that returns a WHOLE DOCUMENT rather than a paragraph, which changes what
  // the constraints have to say. The risk here is not tone; it is a field quietly going missing
  // or being improved without being asked.
  program_edit:
    "A ward secretary is editing a sacrament meeting program by describing the change they " +
    "want. Return the whole program with their change made and every other field exactly as it " +
    "was — the fields they did not mention are not yours to tidy or improve. A place with " +
    "nobody in it stays null: never write \"TBD\" or any other placeholder, because it would " +
    "be printed as though somebody had typed it. Nothing you return is saved until they have " +
    "read the change and accepted it.",

  // ---------------------------------------------------------------------------------------
  // WHY THE HYMNS ARE HANDED OVER RATHER THAN RECALLED
  // ---------------------------------------------------------------------------------------
  // ITER-016 recorded two confirmed-wrong conference talk citations out of fifteen, and noted
  // that the MIXTURE is what does the damage: an all-wrong batch gets noticed, a mostly-right
  // one teaches people to trust the rest. A hymn number is the same failure with a worse
  // ending — it is sung by a congregation on a Sunday morning.
  //
  // So the model is never asked which hymn is about gratitude. The whole candidate list goes
  // into the user prompt (lib/music/hymnCandidates.ts) and it RANKS rather than RECALLS, and
  // every number that comes back is checked against that list before it reaches a screen
  // (validateSuggestions in lib/ai/hymnSuggestions.ts).
  //
  // If you are here to simplify this by trusting the model with hymn numbers: that is the
  // change ITER-016 exists to warn you off. The candidate set is 341 rows at most. It fits.
  hymn_suggestions:
    "A ward music coordinator is choosing hymns for a sacrament meeting. Choose from the list " +
    "of hymns in the request and from nothing else, and give each choice one line saying what " +
    "connects it to that meeting. If the list holds nothing that fits, say so rather than " +
    "reaching for a hymn that is not on it. Nothing you suggest is saved until the " +
    "coordinator accepts it.",
};

// Every block ends with the citation instruction. Composed here rather than written into each
// string, so adding a module cannot produce one that quietly omits it.
export const MODULE_INSTRUCTIONS: Record<AiModule, string> = Object.fromEntries(
  Object.entries(BLOCKS).map(([module, block]) => [
    module,
    `${block}\n\n${CITATION_INSTRUCTION}`,
  ]),
) as Record<AiModule, string>;
