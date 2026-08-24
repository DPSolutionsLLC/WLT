import { z } from "zod";
import { TOPIC_CATEGORIES } from "@/types/domain";

// PURE. No client, no database, no next/headers — it builds strings and a schema, and the route
// does the calling. Same reason lib/ai/systemPrompt.ts and lib/assignments/messageTemplate.ts are
// pure: a function of its inputs is a function a test can reach without a network.

// ---------------------------------------------------------------------------------------------
// What Claude is asked to return
// ---------------------------------------------------------------------------------------------
//
// `category` is the existing TOPIC_CATEGORIES union, so a suggestion cannot carry a category the
// topic_candidates CHECK constraint would reject. Reusing the constant means a category added
// there is offered here without anyone remembering to.
//
// THE FIELD LENGTHS ARE NOT ARBITRARY. `suggestedTalks` arrives as three parts and is stored as
// ONE STRING (see formatTalkCitation below), and lib/validation/topic.ts caps a stored suggestion
// at 200 characters. 60 + 100 + 30 plus the separators lands under that, so a well-formed
// citation is never truncated into something a reader cannot go and check.

export const MAX_SUGGESTED_SCRIPTURES = 5;
export const MAX_SUGGESTED_TALKS = 3;

export const topicSuggestionsSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(3).max(120),
        category: z.enum(TOPIC_CATEGORIES),
        description: z.string().min(10).max(500),
        suggestedScriptures: z.array(z.string().max(80)).max(MAX_SUGGESTED_SCRIPTURES),
        suggestedTalks: z
          .array(
            z.object({
              speaker: z.string().max(60),
              title: z.string().max(100),
              conference: z.string().max(30),
            }),
          )
          .max(MAX_SUGGESTED_TALKS),
      }),
    )
    .min(1),
});

export type TopicSuggestions = z.infer<typeof topicSuggestionsSchema>;
export type TopicSuggestion = TopicSuggestions["topics"][number];
export type SuggestedTalk = TopicSuggestion["suggestedTalks"][number];

// Claude returns a talk as three fields; `topics.suggested_talks` and
// `topic_candidates.suggested_talks` store a flat array of STRINGS, and mapCandidateRow's
// toSuggestionList() DROPS any entry that is not one. Writing the object through unchanged would
// produce a candidate whose talks silently read as null — the citation would vanish between the
// insert and the screen with no error anywhere.
//
// So the structure exists only to make the model answer in parts, which produces better-formed
// citations than asking for one blob, and it is flattened here at the boundary.
export function formatTalkCitation(talk: SuggestedTalk): string {
  const speaker = talk.speaker.trim();
  const title = talk.title.trim();
  const conference = talk.conference.trim();

  return [speaker, title === "" ? null : `"${title}"`, conference]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");
}

// ---------------------------------------------------------------------------------------------
// Filtering what came back
// ---------------------------------------------------------------------------------------------
//
// Migration 018 puts a UNIQUE index on `topics (ward_id, lower(title))`, so a duplicate title
// cannot reach the library at all — it 409s at ACCEPT time, which is the worst possible place to
// find out. By then the bishopric has read the suggestion, liked it, and pressed the button.
//
// So the match is made here, on the same lower(title) the index uses, and it covers ARCHIVED
// topics too: the index does not care about status, and a suggestion duplicating something the
// ward archived last year is refused exactly the same way.
//
// Also de-duplicates within one response. A model asked for eight topics occasionally returns the
// same idea twice, and inserting both would put two identical rows in the queue for a person to
// reject one at a time.
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

export type FilteredSuggestions = {
  kept: TopicSuggestion[];
  filteredCount: number;
};

export function filterNovelSuggestions(
  suggestions: readonly TopicSuggestion[],
  takenTitles: readonly string[],
): FilteredSuggestions {
  const seen = new Set(takenTitles.map(normalizeTitle));
  const kept: TopicSuggestion[] = [];

  for (const suggestion of suggestions) {
    const key = normalizeTitle(suggestion.title);
    if (key === "" || seen.has(key)) continue;

    seen.add(key);
    kept.push(suggestion);
  }

  return { kept, filteredCount: suggestions.length - kept.length };
}

// ---------------------------------------------------------------------------------------------
// The prompts
// ---------------------------------------------------------------------------------------------
//
// Kept plain, and this is worth stating rather than assuming: current models follow instructions
// closely, and step-by-step scripts and emphatic ALL-CAPS directives DEGRADE the output — the
// model starts hedging every sentence instead of writing the suggestions. State the task, name
// the constraints once, and stop.

export type TopicSuggestionPromptInput = {
  count: number;
  seed: string | null;
  existingTitles: readonly string[];
  recentlyUsedTitles: readonly string[];
};

// A bare list of titles, one per line. Long lists are truncated with a count rather than sent
// whole: a ward with two hundred topics would otherwise spend most of the prompt on titles, and
// the request is "suggest something else", not "recite what I have".
const MAX_LISTED_TITLES = 60;

function renderTitleList(titles: readonly string[]): string {
  const unique = [...new Set(titles.map((title) => title.trim()).filter((t) => t !== ""))];

  if (unique.length <= MAX_LISTED_TITLES) return unique.join("\n");

  const shown = unique.slice(0, MAX_LISTED_TITLES);
  return `${shown.join("\n")}\n(and ${unique.length - shown.length} more)`;
}

// The existing titles go IN THE PROMPT as "suggest something else". Asking for novelty is
// cheaper than filtering duplicates afterwards and produces better suggestions — the model
// spends its effort somewhere new rather than on a title that will be discarded.
//
// The route filters anyway. A prompt is a request; a filter is a guarantee.
export function buildTopicSuggestionPrompt(input: TopicSuggestionPromptInput): string {
  const sections: string[] = [
    `Suggest ${input.count} sacrament meeting talk ${input.count === 1 ? "topic" : "topics"} for this ward.`,
  ];

  if (input.seed !== null && input.seed.trim() !== "") {
    sections.push(`What they have asked for: ${input.seed.trim()}`);
  }

  if (input.existingTitles.length > 0) {
    sections.push(
      "Already in this ward's topic library or waiting in its queue. Suggest something else:\n\n" +
        renderTitleList(input.existingTitles),
    );
  }

  if (input.recentlyUsedTitles.length > 0) {
    sections.push(
      "Spoken on recently, so the congregation has heard them lately:\n\n" +
        renderTitleList(input.recentlyUsedTitles),
    );
  }

  sections.push(
    "For each one give a title a speaker can work from, a sentence or two saying what it asks " +
      "the congregation to consider, the scripture references that support it, and any general " +
      "conference talks that address it.",
  );

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// The retrieval query
// ---------------------------------------------------------------------------------------------
//
// WITH NO SEED, THE WARD'S OWN SETTINGS ARE THE QUERY. That is what makes an unseeded run
// ward-specific rather than generic: retrieval searches the corpus for what this ward is
// actually dealing with, and those passages are what the model writes from.
//
// Returns null when there is nothing to search for. A ward with no settings and no seed has
// given retrieval no signal at all, and embedding the empty string would return the corpus's
// arbitrary nearest neighbours dressed up as relevant material — worse than no layer 3, which
// buildSystemPrompt handles as a supported state.
export function buildRetrievalQuery(input: {
  seed: string | null;
  topicPreferences: string | null;
  wardContext: string | null;
}): string | null {
  const parts = [input.seed, input.topicPreferences, input.wardContext]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "");

  return parts.length === 0 ? null : parts.join(" ");
}
