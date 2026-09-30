"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Pill } from "@/components/ui/Pill";
import { SearchBox } from "@/components/ui/SearchBox";
import { Button } from "@/components/ui/Button";
import { formatSundayLabelWithYear, type DateOnly } from "@/lib/calendar/dates";
import {
  MAX_HISTORY_MONTHS,
  TOPIC_HISTORY_SORT_LABELS,
  TOPIC_HISTORY_SORTS,
  filterAndSortTopicHistory,
  withinMonths,
  type TopicHistoryEntry,
  type TopicHistorySort,
  type TopicHistoryView,
} from "@/lib/topics/topicHistory";

// Every topic given in sacrament meeting, searchable and sortable. The sort is remembered on the
// account (lib/topics/topicHistory.ts); the search is not.
//
// Dates render WITH the year — a history spans years — and in UTC, because `sundays.date` is a
// `date` column (CLAUDE.md rule 12, through lib/calendar/dates.ts).
//
// A ROW STACKS BELOW `sm:`. The old "Recently used" row put a fixed-width date column beside the
// title and squeezed it to 17px at 375px (sacrament-topics-finalize-and-history, walk).

const SELECT_CLASSES =
  "min-h-11 w-full min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary sm:w-auto";

// Long enough that a run of changes is one save (and one audit row).
const SAVE_DELAY_MS = 500;

async function saveView(view: TopicHistoryView): Promise<void> {
  const response = await fetch("/api/session/page-view", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page: "topic_history", view }),
  });

  if (response.ok) return;

  let message = "Could not remember how you left this page. Please try again.";
  try {
    const parsed = (await response.json()) as { error?: unknown };
    if (typeof parsed.error === "string") message = parsed.error;
  } catch {
    message = "The server sent a response this page could not read.";
  }
  throw new Error(message);
}

export type TopicHistoryListProps = {
  entries: TopicHistoryEntry[];
  initialView: TopicHistoryView;
  today: DateOnly;
};

export function TopicHistoryList({ entries, initialView, today }: TopicHistoryListProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TopicHistorySort>(initialView.sort);
  // HOW FAR BACK (the user's decision walking scenario 084): typed, then applied with Show, so a
  // half-typed number never empties the list. Remembered with the sort.
  const [months, setMonths] = useState(initialView.months);
  const [monthsDraft, setMonthsDraft] = useState(String(initialView.months));
  const [monthsError, setMonthsError] = useState<string>();
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  // 0 means "nothing to save yet", so opening the page never writes the view it was just given.
  const [changeCount, setChangeCount] = useState(0);

  useEffect(() => {
    if (changeCount === 0) return;
    const timer = setTimeout(() => {
      saveView({ sort, months }).catch((saveFailure: unknown) =>
        setSaveError(
          saveFailure instanceof Error
            ? saveFailure.message
            : "Could not reach the server, so this view was not remembered.",
        ),
      );
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [changeCount, sort, months]);

  function changeSort(next: TopicHistorySort) {
    setSort(next);
    setSaveError(undefined);
    setChangeCount((count) => count + 1);
  }

  function applyMonths(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = Number(monthsDraft);
    if (!Number.isInteger(next) || next < 1 || next > MAX_HISTORY_MONTHS) {
      setMonthsError(`Enter a whole number of months, from 1 to ${MAX_HISTORY_MONTHS}.`);
      return;
    }
    setMonthsError(undefined);
    setMonths(next);
    setSaveError(undefined);
    setChangeCount((count) => count + 1);
  }

  if (entries.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">Topics appear here once a talk has one.</p>
      </Card>
    );
  }

  const shown = filterAndSortTopicHistory(withinMonths(entries, months, today), { query, sort });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <SearchBox
          id="topic-history-search"
          label="Search topics or speakers"
          placeholder="Search topics or speakers"
          value={query}
          onValueChange={setQuery}
          className="min-w-0 flex-1"
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="topic-history-sort" className="text-sm font-medium text-foreground">
            Sort
          </label>
          <select
            id="topic-history-sort"
            value={sort}
            onChange={(event) => changeSort(event.target.value as TopicHistorySort)}
            className={SELECT_CLASSES}
          >
            {TOPIC_HISTORY_SORTS.map((option) => (
              <option key={option} value={option}>
                {TOPIC_HISTORY_SORT_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <form onSubmit={applyMonths} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="topic-history-months" className="text-sm font-medium text-foreground">
            Show the last
          </label>
          <div className="flex items-center gap-2">
            <input
              id="topic-history-months"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_HISTORY_MONTHS}
              value={monthsDraft}
              onChange={(event) => setMonthsDraft(event.target.value)}
              className="min-h-11 w-24 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            <span className="text-sm text-foreground">months</span>
          </div>
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <p className="basis-full text-xs text-muted">
          Topics already planned for a coming Sunday are always shown.
        </p>
      </form>
      <FormError message={monthsError} />

      <FormError message={saveError} />

      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {query.trim() === ""
            ? `No topics in the last ${months} ${months === 1 ? "month" : "months"}. Show more months to look further back.`
            : "No topic or speaker matches that search."}
        </p>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {shown.map((entry) => (
              <li
                key={entry.assignmentId}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <span className="shrink-0 text-sm text-muted sm:w-44">
                  {formatSundayLabelWithYear(entry.date)}
                </span>
                <span className="min-w-0 flex-1 font-medium text-foreground">
                  {entry.topicTitle}
                  {entry.isUpcoming && (
                    <Pill tone="pending" className="ml-2 align-middle">
                      Coming up
                    </Pill>
                  )}
                </span>
                {entry.speakerName !== null && (
                  <span className="min-w-0 text-sm text-muted sm:text-right">
                    {entry.speakerName}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
