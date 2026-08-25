import { isPlaceholderTitle } from "@/lib/music/hymnSource";
import { normalizeForSearch } from "@/lib/music/hymnSearch";
import type { HymnType } from "@/types/domain";

// The list of hymns Claude is allowed to choose from.
//
// ---------------------------------------------------------------------------------------------
// THIS FILE IS THE ANSWER TO ITER-016
// ---------------------------------------------------------------------------------------------
// ITER-016 recorded that two of fifteen AI-suggested conference talk citations were confirmed
// wrong, and that the mixture is the problem: an all-wrong batch gets noticed, a mostly-right one
// teaches people to trust the rest. A hymn number is the same failure with a worse consequence —
// it gets sung by two hundred people on a Sunday morning.
//
// The mitigation available here is stronger than the one available to ITER-016, and it is this
// file: the entire candidate set is small enough to put INTO the prompt, so the model RANKS
// rather than RECALLS. It is not asked "what hymn is about gratitude"; it is handed forty hymns
// and asked which of them fit. The route then checks every number it gets back against this same
// list before anything reaches a screen.
//
// PURE. No client, no database — the route reads the hymns and the topics and passes them in.

export type CandidateHymn = {
  number: number;
  title: string;
  topicTags: readonly string[];
};

export type HymnCandidate = {
  number: number;
  title: string;
  tags: string[];
};

// Forty is enough for the model to have a real choice within one Sunday's subject matter; sixty
// is where the list stops being a shortlist and starts being the hymnbook again, at which point
// the prompt is paying for tokens that do not change the answer.
export const MIN_CANDIDATES = 40;
export const MAX_CANDIDATES = 60;

// Words that appear in topic titles and tell us nothing about which hymn fits.
const STOP_WORDS = new Set([
  "the", "and", "for", "our", "your", "with", "from", "that", "this", "these", "those",
  "into", "unto", "are", "was", "were", "have", "has", "had", "will", "shall", "can",
  "how", "why", "what", "when", "who", "whom", "all", "his", "her", "its", "their",
  "them", "they", "you", "who", "not", "but", "out", "own", "one", "two", "through",
  "about", "being", "been", "more", "most", "than", "then", "upon", "over", "under",
]);

const MIN_KEYWORD_LENGTH = 4;

// Topic titles become the words we match tags against. A topic is a sentence a speaker works
// from — "Finding Peace in Times of Trial" — and the tags are single words, so the join has to
// happen at the word level.
export function topicKeywords(topicTitles: readonly string[]): string[] {
  const keywords = new Set<string>();

  for (const title of topicTitles) {
    for (const word of normalizeForSearch(title).split(/[^a-z0-9]+/)) {
      if (word.length < MIN_KEYWORD_LENGTH) continue;
      if (STOP_WORDS.has(word)) continue;
      keywords.add(word);
    }
  }

  return [...keywords];
}

// A tag is stored snake_case; a keyword is one word. "second_coming" has to be reachable from
// "coming", so tags are split as well as compared whole.
function tagWords(tag: string): string[] {
  return normalizeForSearch(tag).split(/[^a-z0-9]+/).filter((word) => word !== "");
}

function scoreHymn(hymn: CandidateHymn, keywords: readonly string[]): number {
  if (keywords.length === 0) return 0;

  let score = 0;

  for (const tag of hymn.topicTags) {
    const words = tagWords(tag);
    for (const keyword of keywords) {
      // A whole-tag match is worth more than a word inside a compound tag: a hymn tagged
      // `gratitude` is more squarely about gratitude than one tagged `gratitude_in_trials`.
      if (words.length === 1 && words[0] === keyword) {
        score += 3;
      } else if (words.includes(keyword)) {
        score += 2;
      } else if (words.some((word) => word.startsWith(keyword) || keyword.startsWith(word))) {
        score += 1;
      }
    }
  }

  // The title carries meaning the tags may have missed — "I Am a Child of God" for a topic about
  // identity. Worth less than a tag, which somebody chose deliberately.
  const title = normalizeForSearch(hymn.title);
  for (const keyword of keywords) {
    if (title.includes(keyword)) score += 1;
  }

  return score;
}

const SACRAMENT_TAG = "sacrament";

export type BuildCandidatesInput = {
  topicTitles: readonly string[];
  hymns: readonly CandidateHymn[];
  // When the coordinator is filling a specific slot. `sacrament` narrows the pool hard — see
  // below. The other two do not: an opening hymn and a closing hymn come from the whole book.
  hymnType?: HymnType | null;
};

// ---------------------------------------------------------------------------------------------
// PLACEHOLDERS ARE EXCLUDED FROM CANDIDACY ENTIRELY
// ---------------------------------------------------------------------------------------------
// They are searchable, because 299 unfindable numbers would be the "no such hymn" failure the
// seed file warns about. They are NOT suggestible: a suggestion is a recommendation to sing
// something, and "[Placeholder] Hymn 43" is a recommendation to sing nothing. Excluding them here
// rather than filtering them later means the model is never even shown one, so it cannot pick one.
//
// Today that leaves 42 real hymns, which is fewer than MIN_CANDIDATES. That is the honest answer
// while the hymnbook is partly seeded: the model ranks among every hymn this app can vouch for.
export function buildCandidates(input: BuildCandidatesInput): HymnCandidate[] {
  const real = input.hymns.filter((hymn) => !isPlaceholderTitle(hymn.title));

  // A SACRAMENT HYMN COMES FROM THE SACRAMENT HYMNS. The hymnbook sets that section aside and a
  // congregation does not sing "Joy to the World" while the sacrament is passed. This is the one
  // place a slot narrows the pool, and it narrows it before scoring so a strong topic match can
  // never pull a non-sacrament hymn into the list.
  //
  // Falls back to the whole pool if nothing carries the tag at all, so an imported hymnbook that
  // tags its sections differently degrades to "suggests from everything" rather than to
  // "suggests nothing" with no explanation.
  const sacramentOnly =
    input.hymnType === "sacrament"
      ? real.filter((hymn) => hymn.topicTags.some((tag) => normalizeForSearch(tag) === SACRAMENT_TAG))
      : [];

  const pool = input.hymnType === "sacrament" && sacramentOnly.length > 0 ? sacramentOnly : real;

  const keywords = topicKeywords(input.topicTitles);

  const scored = pool
    .map((hymn) => ({ hymn, score: scoreHymn(hymn, keywords) }))
    .sort((left, right) =>
      left.score === right.score ? left.hymn.number - right.hymn.number : right.score - left.score,
    );

  // WITH NO TOPICS, EVERY SCORE IS ZERO AND THE POOL SURVIVES IN NUMBER ORDER. A Sunday with no
  // topics assigned yet is an ordinary state — the coordinator often works ahead of the
  // bishopric — and it must produce a usable list rather than an empty one. The prompt says
  // plainly that no topics were given, so the model is asked for hymns that suit a sacrament
  // meeting generally rather than being left to invent a subject.
  const chosen = scored.slice(0, MAX_CANDIDATES);

  return chosen.map(({ hymn }) => ({
    number: hymn.number,
    title: hymn.title,
    tags: [...hymn.topicTags],
  }));
}
