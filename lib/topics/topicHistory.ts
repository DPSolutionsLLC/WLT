import { z } from "zod";
import { MS_PER_DAY, addMonths, parseDateOnly, type DateOnly } from "@/lib/calendar/dates";

// THE WARD'S TOPIC HISTORY — every topic a talk has carried, when, and who gave it (the user's
// decision, 2026-09-29: "a good usable history of topics that have been used", replacing the
// topic library). Read by the Topic history page and, in the topic window, as the live
// "Used before" hint.
//
// Pure: no clock, no storage. Every function that needs the day takes `today`, because a function
// that reads `new Date()` answers differently on a server than in a browser (lib/sacrament's rule).

export type TopicHistoryEntry = {
  assignmentId: string;
  sundayId: string;
  date: DateOnly;
  topicTitle: string;
  // Null is a talk with a topic and nobody in it yet — a real state, since a ward lays out topics
  // before finding speakers. It renders as an absence, never as "None".
  speakerName: string | null;
  // Strictly after today. This Sunday's talk is decided and about to be heard.
  isUpcoming: boolean;
};

export const TOPIC_HISTORY_SORTS = ["date_desc", "date_asc", "topic", "speaker"] as const;
export type TopicHistorySort = (typeof TOPIC_HISTORY_SORTS)[number];

export const TOPIC_HISTORY_SORT_LABELS: Record<TopicHistorySort, string> = {
  date_desc: "Newest first",
  date_asc: "Oldest first",
  topic: "Topic A–Z",
  speaker: "Speaker A–Z",
};

// How a leader LEFT the Topic history page, so it reopens that way (the user's standing rule,
// 2026-09-24). Stored on the account through lib/users/userSettings.ts. Only the sort is kept: a
// search is a question asked once, and reopening the page still filtered would hide topics.
// HOW FAR BACK — the user's decisions, 2026-09-29, walking scenario 084. The history page shows
// the last N months (6 unless the leader asks for more or fewer), and the topic window's "Used
// before" hint and Check topic look back one year. Both are windows on what is SHOWN: nothing is
// filtered out of the data, and a topic already planned for a coming Sunday always counts.
export const DEFAULT_HISTORY_MONTHS = 6;
export const MAX_HISTORY_MONTHS = 600;
export const HINT_LOOKBACK_MONTHS = 12;

// `months` defaults, so a view saved before the window existed still reads rather than falling
// back to the default sort.
export const topicHistoryViewSchema = z.object({
  sort: z.enum(TOPIC_HISTORY_SORTS),
  months: z.number().int().min(1).max(MAX_HISTORY_MONTHS).default(DEFAULT_HISTORY_MONTHS),
});
export type TopicHistoryView = z.infer<typeof topicHistoryViewSchema>;

export const DEFAULT_TOPIC_HISTORY_VIEW: TopicHistoryView = {
  sort: "date_desc",
  months: DEFAULT_HISTORY_MONTHS,
};

// Upcoming uses, plus everything on or after the day `months` months before today.
export function withinMonths(
  entries: readonly TopicHistoryEntry[],
  months: number,
  today: DateOnly,
): TopicHistoryEntry[] {
  const since = addMonths(today, -months);
  return entries.filter((entry) => entry.isUpcoming || entry.date >= since);
}

// Falls back rather than throwing: a preference nobody can parse must not take the page down.
export function parseTopicHistoryView(value: unknown): TopicHistoryView {
  if (value === undefined || value === null) return DEFAULT_TOPIC_HISTORY_VIEW;

  const parsed = topicHistoryViewSchema.safeParse(value);
  if (!parsed.success) {
    console.warn(
      `The saved Topic history view ${JSON.stringify(value)} is not readable; opening the default.`,
    );
    return DEFAULT_TOPIC_HISTORY_VIEW;
  }
  return parsed.data;
}

const MIN_WORD_LENGTH = 3;
const MIN_TYPED_LENGTH = 2;

// Common words that are three letters or longer and say nothing about a subject. Without them
// "The Sabbath" and "The Atonement" read as similar, and typing "The" lists the whole history —
// the prototype's own comment meant to exclude "the" and "and", and its length rule did not
// (found building Topics rebuild t5, where the AI suggestions are filtered with this rule).
const STOP_WORDS = new Set([
  "the", "and", "for", "our", "you", "your", "with", "from", "that", "this", "these", "those",
  "his", "her", "its", "their", "how", "why", "who", "what", "when", "are", "was", "were",
  "into", "unto", "upon", "all", "not", "can", "has", "have", "about",
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word));
}

// A port of the prototype's rule: two topics are similar when they share a word of three or more
// letters (common words aside), where either word may be a PREFIX of the other. The prefix is what lets "fai" surface
// "Faith in Jesus Christ" while it is still being typed. Deliberately simple — a stand-in for real
// semantic matching, and loud rather than clever, so a near miss is shown to a person.
export function topicSimilarity(left: string, right: string): boolean {
  const leftWords = significantWords(left);
  const rightWords = significantWords(right);

  return leftWords.some((leftWord) =>
    rightWords.some(
      (rightWord) => rightWord.startsWith(leftWord) || leftWord.startsWith(rightWord),
    ),
  );
}

function topicKey(title: string): string {
  return title.trim().toLowerCase();
}

// The entries whose topic resembles what is being typed, ONE PER DISTINCT TOPIC — its most recent
// use — newest first. The same topic given three times is one line, not three.
export function similarTopicUses(
  typed: string,
  history: readonly TopicHistoryEntry[],
): TopicHistoryEntry[] {
  const query = typed.trim();
  if (query.length < MIN_TYPED_LENGTH) return [];

  const latestByTopic = new Map<string, TopicHistoryEntry>();
  for (const entry of history) {
    if (!topicSimilarity(query, entry.topicTitle)) continue;
    const key = topicKey(entry.topicTitle);
    const existing = latestByTopic.get(key);
    if (existing === undefined || entry.date > existing.date) latestByTopic.set(key, entry);
  }

  return [...latestByTopic.values()].sort(byDateDescending);
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

// The prototype's thresholds: days under 30, months under 365 days, years after that. A future
// date reads "Coming up" rather than a negative number, and no date at all is "Never spoken".
export function timeAgoLabel(date: DateOnly | null, today: DateOnly): string {
  if (date === null) return "Never spoken";

  const days = Math.round(
    (parseDateOnly(today).getTime() - parseDateOnly(date).getTime()) / MS_PER_DAY,
  );

  if (days < 0) return "Coming up";
  if (days < 30) return plural(days, "day");
  if (days < 365) return plural(Math.round(days / 30), "month");
  return plural(Math.round(days / 365), "year");
}

function byDateDescending(left: TopicHistoryEntry, right: TopicHistoryEntry): number {
  return left.date === right.date ? 0 : left.date < right.date ? 1 : -1;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

// A talk with no speaker yet sorts LAST under "Speaker A–Z" — it has no name to place.
function compareSpeakers(left: TopicHistoryEntry, right: TopicHistoryEntry): number {
  if (left.speakerName === null || right.speakerName === null) {
    return left.speakerName === right.speakerName ? 0 : left.speakerName === null ? 1 : -1;
  }
  return compareText(left.speakerName, right.speakerName);
}

const COMPARATORS: Record<
  TopicHistorySort,
  (left: TopicHistoryEntry, right: TopicHistoryEntry) => number
> = {
  date_desc: byDateDescending,
  date_asc: (left, right) => -byDateDescending(left, right),
  topic: (left, right) => compareText(left.topicTitle, right.topicTitle),
  speaker: compareSpeakers,
};

// `query` matches the topic OR the speaker, ignoring case. Ties on every sort break newest first,
// so the order is stable between two renders of the same data.
export function filterAndSortTopicHistory(
  entries: readonly TopicHistoryEntry[],
  options: { query: string; sort: TopicHistorySort },
): TopicHistoryEntry[] {
  const needle = options.query.trim().toLowerCase();
  const matching =
    needle === ""
      ? [...entries]
      : entries.filter(
          (entry) =>
            entry.topicTitle.toLowerCase().includes(needle) ||
            (entry.speakerName?.toLowerCase().includes(needle) ?? false),
        );

  const compare = COMPARATORS[options.sort];
  return matching.sort((left, right) => compare(left, right) || byDateDescending(left, right));
}
