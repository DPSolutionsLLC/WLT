import { z } from "zod";
import { topicSimilarity } from "@/lib/topics/topicHistory";

// PURE. No client, no database, no next/headers — it builds strings and a schema, and the route
// does the calling. Same reason lib/ai/systemPrompt.ts and lib/assignments/messageTemplate.ts are
// pure: a function of its inputs is a function a test can reach without a network.
//
// TALK TOPIC IDEAS, for the topic window's "Suggest topics" (Topics rebuild t5). There is no topic
// library (migration 086): a suggestion is a DRAFT the planner may tap into the topic box, and it
// reaches a talk only when they press Save (rule 3). Nothing here, and nothing in the route, stores
// one. The library's candidate schema and helpers went with the library.

// ---------------------------------------------------------------------------------------------
// What Claude is asked to return
// ---------------------------------------------------------------------------------------------
//
// A title a speaker can work from, and one sentence saying why it suits this ward now. The title
// cap sits well under MAX_TOPIC_TITLE (200) so a tapped suggestion always fits the topic box.

export const MAX_TOPIC_IDEAS = 8;
export const TOPIC_IDEAS_REQUESTED = 5;

export const talkTopicIdeasSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(3).max(120),
        why: z.string().min(10).max(240),
      }),
    )
    .min(1)
    .max(MAX_TOPIC_IDEAS),
});

export type TalkTopicIdea = z.infer<typeof talkTopicIdeasSchema>["topics"][number];

// ---------------------------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------------------------
//
// Kept plain, and this is worth stating rather than assuming: current models follow instructions
// closely, and step-by-step scripts and emphatic ALL-CAPS directives DEGRADE the output — the
// model starts hedging every sentence instead of writing the suggestions. State the task, name
// the constraints once, and stop.

export type TalkTopicPromptInput = {
  context: string | null;
  // Topics given in the last RECENT_MONTHS months, and ones already on the calendar ahead.
  recentTitles: readonly string[];
  upcomingTitles: readonly string[];
  // Titles already offered in this window, so "More suggestions" brings new ones.
  alreadyOffered: readonly string[];
  // "October 2026" — the Sunday's month, so the season can nudge the ideas.
  month: string;
};

// Long lists are truncated with a count rather than sent whole: the request is "suggest something
// else", not "recite what we have".
const MAX_LISTED_TITLES = 60;

function renderTitleList(titles: readonly string[]): string {
  const unique = [...new Set(titles.map((title) => title.trim()).filter((t) => t !== ""))];

  if (unique.length <= MAX_LISTED_TITLES) return unique.join("\n");

  const shown = unique.slice(0, MAX_LISTED_TITLES);
  return `${shown.join("\n")}\n(and ${unique.length - shown.length} more)`;
}

// The titles to avoid go IN THE PROMPT. Asking for novelty is cheaper than filtering afterwards
// and produces better ideas; the route filters anyway, because a prompt is a request and a filter
// is a guarantee (filterFreshTopicIdeas below).
export function buildTalkTopicPrompt(input: TalkTopicPromptInput): string {
  const sections: string[] = [
    `Suggest ${TOPIC_IDEAS_REQUESTED} sacrament meeting talk topics for a Sunday in ${input.month}.`,
  ];

  if (input.context !== null && input.context.trim() !== "") {
    sections.push(`What the planner has in mind: ${input.context.trim()}`);
  }

  if (input.recentTitles.length > 0) {
    sections.push(
      "Given in this ward recently, so the congregation has heard them lately:\n\n" +
        renderTitleList(input.recentTitles),
    );
  }

  if (input.upcomingTitles.length > 0) {
    sections.push(
      "Already planned for coming Sundays:\n\n" + renderTitleList(input.upcomingTitles),
    );
  }

  if (input.alreadyOffered.length > 0) {
    sections.push(
      "Already suggested to the planner, so offer different ones:\n\n" +
        renderTitleList(input.alreadyOffered),
    );
  }

  sections.push(
    "Suggest topics that are none of these and not close to them. For each, give a title a " +
      "speaker can work from and one sentence saying why it suits this ward now.",
  );

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// The filter
// ---------------------------------------------------------------------------------------------
//
// Drops an idea that resembles anything to avoid, by the SAME rule the topic window's "Used before"
// hint uses (topicSimilarity), so a suggestion is never one the hint would immediately flag. Also
// drops a repeat within one response.
export function filterFreshTopicIdeas(
  ideas: readonly TalkTopicIdea[],
  avoid: readonly string[],
): { kept: TalkTopicIdea[]; filteredCount: number } {
  const kept: TalkTopicIdea[] = [];

  for (const idea of ideas) {
    const title = idea.title.trim();
    if (title === "") continue;
    if (avoid.some((taken) => topicSimilarity(title, taken))) continue;
    if (kept.some((earlier) => topicSimilarity(title, earlier.title))) continue;
    kept.push({ title, why: idea.why.trim() });
  }

  return { kept, filteredCount: ideas.length - kept.length };
}

// ---------------------------------------------------------------------------------------------
// The retrieval query
// ---------------------------------------------------------------------------------------------
//
// WITH NO CONTEXT, THE WARD'S OWN SETTINGS ARE THE QUERY. That is what makes an unsteered run
// ward-specific rather than generic: retrieval searches the corpus for what this ward is actually
// dealing with, and those passages are what the model writes from.
//
// Returns null when there is nothing to search for. Embedding the empty string would return the
// corpus's arbitrary nearest neighbours dressed up as relevant material — worse than no layer 3,
// which buildSystemPrompt handles as a supported state.
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
