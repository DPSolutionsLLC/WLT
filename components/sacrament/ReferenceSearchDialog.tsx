"use client";

import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  normalizeCitation,
  talkHeading,
  type AddReferences,
  type NewReference,
} from "@/components/sacrament/referenceShared";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { ReferenceSuggestion } from "@/lib/references/suggestions";
import type { ReferenceKind, ReferencesTalk, TalkReference } from "@/types/domain";

// THE SEARCH WINDOW FOR ONE TALK — opened from the talk's Search button (decided with the user
// walking scenario 074).
//
// IT SEARCHES THE TOPIC THE MOMENT IT OPENS, because that is what a bishop wants nearly every
// time — and the words stay editable, so "something close to the topic but worded differently" is
// one edit away rather than a different screen. Each further search is a press, never a keystroke:
// every search spends an embedding call.
//
// THE TOPIC'S OWN SUGGESTED SCRIPTURES come first, as picks (user decision, Q5). They are the
// topic library's `suggested_scriptures`, typed by a person, so they are added as `manual` — no
// document claims them.
//
// PICK ONE OR SEVERAL, THEN ADD. A checkbox per item and one Add button, so choosing three
// passages is three ticks and one save. Nothing is added until that button is pressed (rule 3).
//
// ---------------------------------------------------------------------------
// FREE MODE — the "Search any topic" button above all the talks
// ---------------------------------------------------------------------------
// The user's ask: search "a variation on the topic, or a related topic", not tied to any talk's
// words. It opens EMPTY and searches nothing until asked, shows no topic suggestions (there is no
// topic), and carries an "Add to" picker — a reference belongs to a talk, so the window must be
// told which one. "Added" marks follow the chosen talk.

export type ReferenceSearchDialogProps = {
  sundayId: string;
  talks: readonly ReferencesTalk[];
  // Every reference on the Sunday. A citation already on the CHOSEN talk reads "Added" and cannot
  // be ticked.
  references: readonly TalkReference[];
  initialTalk: ReferencesTalk;
  free: boolean;
  onAdd: AddReferences;
  onClose: () => void;
};

export const PICK_HINT = "Select one or more, then press Add.";

type Pick = { key: string; kind: ReferenceKind; citation: string; snippet: string | null; documentId?: string };

const GROUPS: { kind: ReferenceKind; heading: string }[] = [
  { kind: "scripture", heading: "Scriptures" },
  { kind: "talk", heading: "General conference talks" },
  { kind: "other", heading: "Other documents" },
];

async function searchReferences(
  sundayId: string,
  assignmentId: string,
  query: string,
): Promise<ReferenceSuggestion[]> {
  const response = await fetch(`/api/sundays/${sundayId}/references/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignmentId, query }),
  });

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Could not search the scriptures and conference talks.",
    );
  }

  return (payload.suggestions ?? []) as ReferenceSuggestion[];
}

export function ReferenceSearchDialog({
  sundayId,
  talks,
  references,
  initialTalk,
  free,
  onAdd,
  onClose,
}: ReferenceSearchDialogProps) {
  const inputId = useId();
  const talkPickerId = useId();
  const [talkId, setTalkId] = useState(initialTalk.assignmentId);
  const talk = talks.find((candidate) => candidate.assignmentId === talkId) ?? initialTalk;
  const startingWords = free ? "" : initialTalk.topicTitle;
  const [query, setQuery] = useState(startingWords);
  // THE WORDS LAST SUBMITTED, starting with the topic — so the query below runs the topic search
  // the moment the window opens, and each Search press is a new key. A re-render repeats nothing.
  // Empty in free mode, which is what keeps it from searching until asked.
  const [submittedQuery, setSubmittedQuery] = useState(startingWords);

  const addedCitations = new Set(
    references
      .filter((reference) => reference.assignmentId === talk.assignmentId)
      .map((reference) => normalizeCitation(reference.citation)),
  );
  const [selected, setSelected] = useState<ReadonlyMap<string, Pick>>(new Map());
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string>();

  // `retry: false` — every attempt spends an embedding call, and a failure is shown with the
  // server's sentence rather than retried behind the reader's back.
  const searchQuery = useQuery({
    // The talk is NOT in the key: the route uses it only to check it is this Sunday's, and changing
    // "Add to" must not spend a second embedding call on the same words.
    queryKey: ["reference-search", sundayId, submittedQuery],
    queryFn: () => searchReferences(sundayId, talk.assignmentId, submittedQuery),
    enabled: submittedQuery !== "",
    retry: false,
    staleTime: Infinity,
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const words = query.trim();
    if (words === "") return;
    if (words === submittedQuery) void searchQuery.refetch();
    else setSubmittedQuery(words);
  }

  const isSearching = searchQuery.isFetching;

  function toggle(pick: Pick): void {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(pick.key)) next.delete(pick.key);
      else next.set(pick.key, pick);
      return next;
    });
  }

  async function addSelected(): Promise<void> {
    setIsAdding(true);
    setAddError(undefined);

    const inputs: NewReference[] = [...selected.values()].map((pick) => ({
      assignmentId: talk.assignmentId,
      kind: pick.kind,
      citation: pick.citation,
      source: pick.documentId === undefined ? "manual" : "search",
      ...(pick.documentId === undefined ? {} : { documentId: pick.documentId }),
    }));

    const failure = await onAdd(inputs);
    setIsAdding(false);

    if (failure !== null) {
      setAddError(failure);
      return;
    }

    onClose();
  }

  const suggestedPicks: Pick[] = (free ? [] : talk.suggestedScriptures).map((citation) => ({
    key: `suggested:${normalizeCitation(citation)}`,
    kind: "scripture",
    citation,
    snippet: null,
  }));

  const resultPicks: Pick[] =
    searchQuery.isSuccess
      ? searchQuery.data.map((suggestion) => ({
          key: `result:${suggestion.documentId}:${suggestion.citation}`,
          kind: suggestion.kind,
          citation: suggestion.citation,
          snippet: suggestion.snippet,
          documentId: suggestion.documentId,
        }))
      : [];

  const count = selected.size;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={free ? "Search scriptures and talks" : `Search — ${talkHeading(talk)}`}
    >
      <div className="flex flex-col gap-4">
        {free && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={talkPickerId} className="text-sm font-medium text-foreground">
              Add to
            </label>
            <select
              id={talkPickerId}
              value={talkId}
              onChange={(event) => setTalkId(event.target.value)}
              className="min-h-11 min-w-0 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {talks.map((option) => (
                <option key={option.assignmentId} value={option.assignmentId}>
                  {talkHeading(option)}
                </option>
              ))}
            </select>
          </div>
        )}

        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-48">
            <Input
              id={inputId}
              label="Search the scriptures and conference talks"
              value={query}
              placeholder={free ? "Any words, any topic" : undefined}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full min-w-0"
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={isSearching || query.trim() === ""}
          >
            {isSearching ? "Searching…" : "Search"}
          </Button>
        </form>

        <p className="text-sm text-muted">{PICK_HINT}</p>

        {suggestedPicks.length > 0 && (
          <PickGroup
            heading="Suggested for this topic"
            picks={suggestedPicks}
            selected={selected}
            addedCitations={addedCitations}
            onToggle={toggle}
          />
        )}

        {isSearching && (
          <p className="text-sm text-muted" role="status">
            Searching…
          </p>
        )}

        {!isSearching && searchQuery.isError && (
          <FormError message={searchQuery.error.message} />
        )}

        {!isSearching &&
          searchQuery.isSuccess &&
          (resultPicks.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing matched closely enough. Try other words, or add one manually.
            </p>
          ) : (
            GROUPS.map((group) => {
              const picks = resultPicks.filter((pick) => pick.kind === group.kind);
              if (picks.length === 0) return null;
              return (
                <PickGroup
                  key={group.kind}
                  heading={group.heading}
                  picks={picks}
                  selected={selected}
                  addedCitations={addedCitations}
                  onToggle={toggle}
                />
              );
            })
          ))}

        <FormError message={addError} />

        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-raised pt-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={count === 0 || isAdding} onClick={addSelected}>
            {isAdding
              ? "Adding…"
              : count === 0
                ? "Add"
                : `Add ${count} ${count === 1 ? "reference" : "references"}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PickGroup({
  heading,
  picks,
  selected,
  addedCitations,
  onToggle,
}: {
  heading: string;
  picks: Pick[];
  selected: ReadonlyMap<string, Pick>;
  addedCitations: ReadonlySet<string>;
  onToggle: (pick: Pick) => void;
}) {
  const headingId = useId();

  return (
    <div className="flex flex-col gap-1" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-muted">
        {heading}
      </h3>
      <ul className="flex flex-col gap-1">
        {picks.map((pick) => {
          const isAdded = addedCitations.has(normalizeCitation(pick.citation));
          return (
            <li key={pick.key}>
              <label
                className={`flex min-h-11 items-start gap-3 rounded-md border border-border px-3 py-2 ${
                  isAdded ? "" : "cursor-pointer hover:bg-surface"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0"
                  checked={isAdded || selected.has(pick.key)}
                  disabled={isAdded}
                  onChange={() => onToggle(pick)}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-foreground">{pick.citation}</span>
                  {pick.snippet !== null && (
                    <span className="text-xs italic text-muted">{pick.snippet}</span>
                  )}
                </span>
                {isAdded && <span className="shrink-0 text-xs font-medium text-muted">Added</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
