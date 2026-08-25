import { isPlaceholderTitle } from "@/lib/music/hymnSource";

// Finding a hymn by number, by title, or by what it is about.
//
// PURE. It imports hymnSource.ts, which imports only the CSV parser, and nothing else — no
// client, no next/headers. The search modal runs this in the browser over a list it already
// holds, and lib/music/queries.ts runs the same function on the server. One set of rules, so the
// two can never disagree about what matches (plans/retros/roster-b-picker-and-orgs.md).

// The shape this needs, not the shape the database returns. Declared structurally and matched
// generically so a caller gets its own richer type back — the searcher has no opinion about what
// else a hymn row carries.
export type SearchableHymn = {
  number: number;
  title: string;
  topicTags: readonly string[];
};

export const DEFAULT_SEARCH_LIMIT = 25;

// ---------------------------------------------------------------------------------------------
// NORMALISATION, AND WHY THE APOSTROPHE IS THE HARD PART
// ---------------------------------------------------------------------------------------------
// Hymn 21 is "Come, Listen to a Prophet's Voice" and hymn 26 is "Joseph Smith's First Prayer".
// Both are already in the seed, and both are exactly the string that breaks naive matching: the
// seed stores a straight apostrophe, a phone's keyboard produces a curly one (U+2019) by default,
// and "Prophet’s" does not contain "Prophet's". A coordinator typing the title they are reading
// off the page would get no results and conclude the hymn is not seeded.
//
// So every apostrophe variant folds to one character before comparison. Accents fold the same
// way through NFD decomposition — "Prière" typed as "Priere" still matches — which costs nothing
// and removes a second class of near-miss.
const APOSTROPHES = /[‘’ʼ`´]/g;
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(APOSTROPHES, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// A tag is stored snake_case ("second_coming"). Somebody searching types "second coming", so
// both sides collapse their separators before comparison.
function normalizeTag(value: string): string {
  return normalizeForSearch(value).replace(/[_-]+/g, " ");
}

// Lower is better. Written out rather than inferred so the intended order is readable in one
// place: the number you typed, then a title that begins with what you typed, then a title that
// contains it, then what the hymn is about.
const RANK_EXACT_NUMBER = 0;
const RANK_TITLE_PREFIX = 1;
const RANK_TITLE_SUBSTRING = 2;
const RANK_TAG_EXACT = 3;
const RANK_TAG_SUBSTRING = 4;

function rankOf(hymn: SearchableHymn, needle: string, needleNumber: number | null): number | null {
  if (needleNumber !== null && hymn.number === needleNumber) return RANK_EXACT_NUMBER;

  const title = normalizeForSearch(hymn.title);
  if (title.startsWith(needle)) return RANK_TITLE_PREFIX;
  if (title.includes(needle)) return RANK_TITLE_SUBSTRING;

  const tags = hymn.topicTags.map(normalizeTag);
  if (tags.some((tag) => tag === needle)) return RANK_TAG_EXACT;
  if (tags.some((tag) => tag.includes(needle))) return RANK_TAG_SUBSTRING;

  return null;
}

export type MatchHymnsOptions = {
  limit?: number;
};

// AN EMPTY QUERY MATCHES NOTHING, on purpose. A picker that opens showing hymns 1 to 25 invites
// somebody to scroll for hymn 300; one that opens empty asks them to type. The caller renders the
// prompt — this returns the honest answer, which is that nothing has been searched for yet.
//
// PLACEHOLDERS ARE SEARCHABLE and are not hidden. Hiding them would make 299 of the 341 numbers
// silently unfindable, which is the "no such hymn" failure the seed file warns about wearing a
// different hat. They sort AFTER a real hymn of the same rank, so a genuine match is never pushed
// down the list by one.
export function matchHymns<Hymn extends SearchableHymn>(
  hymns: readonly Hymn[],
  query: string,
  options: MatchHymnsOptions = {},
): Hymn[] {
  const needle = normalizeForSearch(query);
  if (needle === "") return [];

  // Number matching is EXACT and only for a query that is nothing but digits. "Hymn 2" and "2"
  // both reach hymn 2 — the first through its title, the second through its number — but "1" must
  // not match 100 through 199, which is what a substring number match would do.
  const needleNumber = /^\d+$/.test(needle) ? Number.parseInt(needle, 10) : null;

  const ranked: { hymn: Hymn; rank: number }[] = [];

  for (const hymn of hymns) {
    const rank = rankOf(hymn, needle, needleNumber);
    if (rank !== null) ranked.push({ hymn, rank });
  }

  ranked.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;

    const leftIsPlaceholder = isPlaceholderTitle(left.hymn.title);
    const rightIsPlaceholder = isPlaceholderTitle(right.hymn.title);
    if (leftIsPlaceholder !== rightIsPlaceholder) return leftIsPlaceholder ? 1 : -1;

    return left.hymn.number - right.hymn.number;
  });

  return ranked.slice(0, options.limit ?? DEFAULT_SEARCH_LIMIT).map((entry) => entry.hymn);
}
