import { z } from "zod";
import type { HymnCandidate } from "@/lib/music/hymnCandidates";
import type { HymnType } from "@/types/domain";

// PURE. No client, no database, no next/headers — it builds strings and a schema, and the route
// does the calling, exactly as lib/ai/topicSuggestions.ts does.

// ---------------------------------------------------------------------------------------------
// What Claude is asked to return
// ---------------------------------------------------------------------------------------------
//
// `number` is the only field that survives validation. The title comes back too, but only so the
// model has to commit to which hymn it means — validateSuggestions() throws the returned title
// away and substitutes the one in the table. A model that returns number 27 with the title of
// hymn 30 is telling us it has confused the two, and the number is the half the table can check.

export const MAX_HYMN_SUGGESTIONS = 5;
export const DEFAULT_HYMN_SUGGESTIONS = 3;

export const hymnSuggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        number: z.number().int().positive(),
        title: z.string().max(200),
        // One line, and the cap enforces it. A paragraph per hymn turns a shortlist into an essay
        // the coordinator skims, and skimming is how a wrong number gets accepted.
        reason: z.string().min(10).max(240),
      }),
    )
    .min(1),
});

export type HymnSuggestions = z.infer<typeof hymnSuggestionsSchema>;
export type RawHymnSuggestion = HymnSuggestions["suggestions"][number];

// What reaches a screen. `title` is the TABLE's title, never the model's.
export type ValidatedHymnSuggestion = {
  number: number;
  title: string;
  reason: string;
};

export type ValidationResult = {
  kept: ValidatedHymnSuggestion[];
  droppedNumbers: number[];
};

// ---------------------------------------------------------------------------------------------
// THE CHECK ITER-016 ASKED FOR
// ---------------------------------------------------------------------------------------------
// Every returned number is looked up in the candidate list that was put in the prompt. A number
// that is not there is DROPPED — not corrected, not shown with a warning. There is no such thing
// as a hymn suggestion that is nearly right: either the number names a hymn this app can vouch
// for, or it names something a congregation would be asked to sing that nobody has verified.
//
// The title is replaced rather than compared, so a model that returns the right number with a
// mistyped title still produces a correct suggestion, and one that returns a plausible title with
// a wrong number produces nothing at all. That asymmetry is deliberate: the number is what gets
// printed and sung.
//
// A duplicate number is dropped too — a shortlist that names the same hymn twice is a shortlist
// one item shorter than it claims.
export function validateSuggestions(
  suggestions: readonly RawHymnSuggestion[],
  candidates: readonly HymnCandidate[],
): ValidationResult {
  const byNumber = new Map(candidates.map((candidate) => [candidate.number, candidate]));
  const kept: ValidatedHymnSuggestion[] = [];
  const droppedNumbers: number[] = [];
  const seen = new Set<number>();

  for (const suggestion of suggestions) {
    const candidate = byNumber.get(suggestion.number);

    if (candidate === undefined || seen.has(suggestion.number)) {
      droppedNumbers.push(suggestion.number);
      continue;
    }

    seen.add(suggestion.number);
    kept.push({
      number: candidate.number,
      title: candidate.title,
      reason: suggestion.reason.trim(),
    });
  }

  return { kept, droppedNumbers };
}

// ---------------------------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------------------------
//
// Kept plain. Current models follow instructions closely, and step-by-step scripts and emphatic
// ALL-CAPS directives DEGRADE the output — the model starts hedging every sentence instead of
// choosing hymns. State the task, name the constraints once, and stop.

const HYMN_TYPE_PROMPT_LABELS: Record<HymnType, string> = {
  opening: "opening hymn",
  sacrament: "sacrament hymn",
  closing: "closing hymn",
};

export type HymnSuggestionPromptInput = {
  sundayLabel: string;
  hymnType: HymnType | null;
  topicTitles: readonly string[];
  candidates: readonly HymnCandidate[];
  count: number;
};

// The candidate list, one hymn per line, number first. Tags come along because they are what the
// ward's own librarian said the hymn is about, and they give the model something to reason from
// beyond the title.
function renderCandidates(candidates: readonly HymnCandidate[]): string {
  return candidates
    .map((candidate) =>
      candidate.tags.length === 0
        ? `${candidate.number}. ${candidate.title}`
        : `${candidate.number}. ${candidate.title} — ${candidate.tags.join(", ")}`,
    )
    .join("\n");
}

export function buildHymnSuggestionPrompt(input: HymnSuggestionPromptInput): string {
  const slot =
    input.hymnType === null
      ? "hymns"
      : `${HYMN_TYPE_PROMPT_LABELS[input.hymnType]} options`;

  const sections: string[] = [
    `Choose ${input.count} ${slot} for the sacrament meeting on ${input.sundayLabel}.`,
  ];

  if (input.topicTitles.length > 0) {
    sections.push(
      `The ${input.topicTitles.length === 1 ? "talk that Sunday is" : "talks that Sunday are"} on:\n\n` +
        input.topicTitles.map((title) => `- ${title}`).join("\n"),
    );
  } else {
    // Said explicitly rather than left as a gap. A prompt that simply omits the topics invites
    // the model to guess at a subject; naming the absence gets a general-purpose shortlist, which
    // is the honest answer for a Sunday nobody has assigned talks to yet.
    sections.push(
      "No talk topics have been assigned to that Sunday yet, so choose hymns that suit a " +
        "sacrament meeting generally.",
    );
  }

  sections.push(
    "Choose only from these hymns, by number. Nothing outside this list is available to " +
      "this ward:\n\n" +
      renderCandidates(input.candidates),
  );

  sections.push(
    "For each hymn give its number, its title, and one line saying what connects it to the " +
      "meeting. Do not suggest a hymn that is not on the list above.",
  );

  return sections.join("\n\n");
}
