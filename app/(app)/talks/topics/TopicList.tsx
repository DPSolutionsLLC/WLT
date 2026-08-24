"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CandidateQueue } from "@/app/(app)/talks/topics/CandidateQueue";
import { SuggestTopicsButton } from "@/app/(app)/talks/topics/SuggestTopicsButton";
import { TopicForm, type TopicFormValues } from "@/app/(app)/talks/topics/TopicForm";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { formatDateOnly, type DateOnly } from "@/lib/calendar/dates";
// Type-only, so nothing from the server-only module survives the build (roster-b).
import type { Topic, TopicCandidate } from "@/lib/topics/queries";
import { TOPIC_STALENESS_LABELS, topicStaleness } from "@/lib/topics/topicRotation";
import {
  TOPIC_CATEGORIES,
  TOPIC_CATEGORY_LABELS,
  type TopicCategory,
  type TopicStatus,
} from "@/types/domain";

export const TOPICS_QUERY_KEY = "topics";
export const CANDIDATES_QUERY_KEY = "topic-candidates";

export type TopicListProps = {
  initialTopics: Topic[];
  initialCandidates: TopicCandidate[];
  canManage: boolean;
};

type Filters = {
  category: TopicCategory | "all";
  status: TopicStatus;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

// The parameter names are `category` and `status`, checked against app/api/topics/route.ts
// rather than assumed. A name that handler does not read is silently IGNORED (roster-b).
async function fetchTopics(filters: Filters): Promise<Topic[]> {
  const params = new URLSearchParams({ status: filters.status });
  if (filters.category !== "all") params.set("category", filters.category);

  const response = await fetch(`/api/topics?${params.toString()}`);
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Could not load the topic library.",
    );
  }

  return (payload.topics ?? []) as Topic[];
}

async function fetchCandidates(): Promise<TopicCandidate[]> {
  const response = await fetch("/api/topic-candidates");
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Could not load the suggested topics.",
    );
  }

  return (payload.candidates ?? []) as TopicCandidate[];
}

export function TopicList({ initialTopics, initialCandidates, canManage }: TopicListProps) {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Filters>({ category: "all", status: "active" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  // Not memoised: TanStack Query hashes the key structurally, so a fresh object each render is
  // the same key (roster-b).
  const topicsQuery = useQuery({
    queryKey: [TOPICS_QUERY_KEY, filters.category, filters.status],
    queryFn: () => fetchTopics(filters),
    // The server render seeded the DEFAULT filter only. Any other combination is a real fetch,
    // so seeding it here would show the wrong list for a moment.
    initialData:
      filters.category === "all" && filters.status === "active" ? initialTopics : undefined,
  });

  const candidatesQuery = useQuery({
    queryKey: [CANDIDATES_QUERY_KEY],
    queryFn: fetchCandidates,
    initialData: initialCandidates,
  });

  const today: DateOnly = formatDateOnly(new Date());

  async function refreshTopics(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: [TOPICS_QUERY_KEY] });
  }

  async function refreshCandidates(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [CANDIDATES_QUERY_KEY] }),
      refreshTopics(),
    ]);
  }

  // Returns a MESSAGE on failure and null on success, which is the contract TopicForm expects.
  async function send(
    url: string,
    method: "POST" | "PATCH",
    body: unknown,
    fallback: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        return typeof payload.error === "string" ? payload.error : fallback;
      }

      await refreshTopics();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : fallback;
    }
  }

  async function create(values: TopicFormValues): Promise<string | null> {
    const failure = await send("/api/topics", "POST", values, "Could not create that topic.");
    if (failure === null) setIsAdding(false);
    return failure;
  }

  async function update(topicId: string, values: TopicFormValues): Promise<string | null> {
    const failure = await send(
      `/api/topics/${topicId}`,
      "PATCH",
      values,
      "Could not save that topic.",
    );
    if (failure === null) setEditingId(null);
    return failure;
  }

  // ARCHIVE, never delete. A topic referenced by an assignment must not vanish from that
  // assignment's history, so there is no delete route to call even if this offered one.
  async function setStatus(topicId: string, status: TopicStatus): Promise<void> {
    setErrorMessage(undefined);

    const failure = await send(
      `/api/topics/${topicId}`,
      "PATCH",
      { status },
      "Could not change that topic.",
    );

    if (failure !== null) setErrorMessage(failure);
  }

  const topics = topicsQuery.data ?? [];

  const queryError =
    topicsQuery.error instanceof Error
      ? topicsQuery.error.message
      : candidatesQuery.error instanceof Error
        ? candidatesQuery.error.message
        : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <label
            htmlFor="topic-filter-category"
            className="flex flex-col gap-1 text-sm font-medium text-foreground"
          >
            Category
            <select
              id="topic-filter-category"
              value={filters.category}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  category: event.target.value as TopicCategory | "all",
                }))
              }
              className="min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <option value="all">All categories</option>
              {TOPIC_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {TOPIC_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>

          <label
            htmlFor="topic-filter-status"
            className="flex flex-col gap-1 text-sm font-medium text-foreground"
          >
            Showing
            <select
              id="topic-filter-status"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as TopicStatus,
                }))
              }
              className="min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <option value="active">In the library</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>

        <FormError message={errorMessage ?? queryError} />

        {canManage && !isAdding && (
          <Button type="button" onClick={() => setIsAdding(true)} className="self-start">
            Add a topic
          </Button>
        )}

        {canManage && isAdding && (
          <Card>
            <h2 className="text-base font-semibold text-foreground">Add a topic</h2>
            <div className="mt-3">
              <TopicForm
                idPrefix="topic-add"
                submitLabel="Add to the library"
                onSubmit={create}
                onCancel={() => setIsAdding(false)}
              />
            </div>
          </Card>
        )}
      </div>

      {topics.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            {filters.status === "archived"
              ? "No topics have been archived."
              : "No topics in the library yet. Add one above."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {topics.map((topic) => {
            const staleness = topicStaleness(topic.lastAssignedAt, today);

            return (
              <li key={topic.id}>
                <Card>
                  {editingId === topic.id ? (
                    <TopicForm
                      initial={topic}
                      idPrefix={`topic-edit-${topic.id}`}
                      submitLabel="Save"
                      onSubmit={(values) => update(topic.id, values)}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h2 className="text-sm font-semibold text-foreground">
                          {topic.title}
                        </h2>
                        {topic.category && (
                          <span className="text-xs text-muted">
                            {TOPIC_CATEGORY_LABELS[topic.category]}
                          </span>
                        )}
                        {/* Words, never a raw timestamp. "Used a while ago" is what a
                            bishopric is actually asking, and a date makes them do the
                            arithmetic themselves (lib/topics/topicRotation.ts). */}
                        <span className="text-xs text-muted">
                          {TOPIC_STALENESS_LABELS[staleness]}
                        </span>
                        {topic.source === "ai_generated" && (
                          <span className="text-xs text-muted">Accepted from a suggestion</span>
                        )}
                      </div>

                      {topic.description && (
                        <p className="mt-2 text-sm text-muted">{topic.description}</p>
                      )}

                      {topic.suggestedScriptures && (
                        <p className="mt-2 text-sm text-muted">
                          Scriptures: {topic.suggestedScriptures.join(", ")}
                        </p>
                      )}

                      {topic.suggestedTalks && (
                        <p className="mt-1 text-sm text-muted">
                          Talks: {topic.suggestedTalks.join(", ")}
                        </p>
                      )}

                      {canManage && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setEditingId(topic.id)}
                          >
                            Edit
                            <span className="sr-only"> {topic.title}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              setStatus(
                                topic.id,
                                topic.status === "archived" ? "active" : "archived",
                              )
                            }
                          >
                            {topic.status === "archived" ? "Restore" : "Archive"}
                            <span className="sr-only"> {topic.title}</span>
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* Above the queue it fills, and only for somebody who could accept what it produces.
          `refreshCandidates` is the callback CandidateQueue already takes — one refresh path,
          not a second one added beside it. */}
      {canManage && <SuggestTopicsButton onSuggested={refreshCandidates} />}

      <CandidateQueue
        candidates={candidatesQuery.data ?? []}
        canManage={canManage}
        onReviewed={refreshCandidates}
      />
    </div>
  );
}
