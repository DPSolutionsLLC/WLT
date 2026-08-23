import { parseDateOnly, type DateOnly } from "@/lib/calendar/dates";

// Staleness bucketing for the topic picker: has this been used recently, a while ago, or never?
// Pure and client-importable — TopicList renders it, and a single import of
// lib/topics/queries.ts would pull in next/headers and break the production build
// (plans/retros/roster-b-picker-and-orgs.md).

export const TOPIC_STALENESS = ["unused", "fresh", "recent"] as const;
export type TopicStaleness = (typeof TOPIC_STALENESS)[number];

// A Record rather than a lookup with a fallback: a bucket added later must not render as its
// own key.
export const TOPIC_STALENESS_LABELS: Record<TopicStaleness, string> = {
  unused: "Not used yet",
  fresh: "Used a while ago",
  recent: "Used recently",
};

// Six months. A topic used inside the last half-year is one a congregation will remember hearing
// about; past that it reads as new again. The boundary is named rather than inlined so the test
// and the rule cannot drift apart.
export const RECENT_MONTHS = 6;

// Inclusive of the boundary month: a topic used exactly RECENT_MONTHS ago is still `recent`. The
// bishopric is choosing what to plan NEXT, and rounding a borderline topic toward "recent" costs
// them one alternative, while rounding it toward "fresh" costs a congregation a repeat.
export function topicStaleness(
  lastAssignedAt: string | null,
  today: DateOnly,
): TopicStaleness {
  if (lastAssignedAt === null) return "unused";

  const monthsAgo = monthsBetween(lastAssignedAt.slice(0, 10) as DateOnly, today);

  return monthsAgo <= RECENT_MONTHS ? "recent" : "fresh";
}

// Whole calendar months between two dates, floored at zero. A `last_assigned_at` in the future
// is not a state the app can produce, but a clock skew between the database and the browser can
// make it look like one for a few seconds — and a negative month count would flip a recent topic
// to `fresh`.
function monthsBetween(from: DateOnly, to: DateOnly): number {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);

  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());

  // A partial month does not count: 5 months and 29 days is still 5.
  const adjusted = end.getUTCDate() < start.getUTCDate() ? months - 1 : months;

  return Math.max(0, adjusted);
}

// Unused topics FIRST, then the least recently used. That is the order the library is browsed
// in — a bishopric opens it to find something they have not done lately, so the answer is at the
// top rather than at the end of a scroll.
//
// The sort is stable within a bucket by title, so re-rendering the same list twice does not
// reshuffle rows that share a date.
export function compareTopicsByStaleness(
  left: { lastAssignedAt: string | null; title: string },
  right: { lastAssignedAt: string | null; title: string },
): number {
  if (left.lastAssignedAt === null && right.lastAssignedAt === null) {
    return left.title.localeCompare(right.title);
  }

  if (left.lastAssignedAt === null) return -1;
  if (right.lastAssignedAt === null) return 1;

  if (left.lastAssignedAt === right.lastAssignedAt) {
    return left.title.localeCompare(right.title);
  }

  return left.lastAssignedAt < right.lastAssignedAt ? -1 : 1;
}
