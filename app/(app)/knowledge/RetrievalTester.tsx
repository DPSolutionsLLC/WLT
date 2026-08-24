"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { describeSimilarity } from "@/lib/validation/knowledge";

// The one place a human can see what the corpus ACTUALLY returns. When a topic suggestion cites
// something odd, the question is whether retrieval or the prompt is at fault, and one query here
// answers it.
//
// The line above the results is the feature, not decoration.

export type RetrievalTesterProps = {
  hasDocuments: boolean;
};

type SearchResult = {
  content: string;
  sourceLabel: string;
  similarity: number;
};

export function RetrievalTester({ hasDocuments }: RetrievalTesterProps) {
  const [query, setQuery] = useState("");
  // DEFAULTS TO SCOPED, matching the route's schema default. Scoped is the HONEST preview: it
  // shows what topic suggestions will actually retrieve. Searching everything is genuinely more
  // useful while DECIDING what the scope should be, which is a different question asked from the
  // same screen — hence a toggle rather than one behaviour.
  const [useScope, setUseScope] = useState(true);
  const [results, setResults] = useState<SearchResult[]>();
  const [searchError, setSearchError] = useState<string>();
  const [isSearching, setIsSearching] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchError(undefined);
    // Cleared before the call, so a failure never leaves the PREVIOUS results on screen looking
    // like the answer to the query that just failed.
    setResults(undefined);
    setIsSearching(true);

    try {
      const response = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, useScope }),
      });

      const body: { results?: SearchResult[]; error?: string } = await response.json();

      if (!response.ok || !body.results) {
        setSearchError(body.error ?? "Could not search the knowledge base. Please try again.");
        return;
      }

      setResults(body.results);
    } catch (error) {
      console.error("Could not run a knowledge search", error);
      setSearchError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <div>
          <h2 className="text-base font-semibold text-foreground">Try a search</h2>
          <p className="mt-1 text-sm text-muted">
            {useScope
              ? "This is exactly what the AI receives as reference material."
              : "Searching every active document, ignoring the scope above. Useful for deciding what to scope to — not what the AI will actually see."}
          </p>
        </div>

        <Input
          id="knowledge-search"
          label="Search the knowledge base"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="faith"
          maxLength={500}
        />

        <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-primary)]"
            checked={useScope}
            onChange={(event) => {
              setUseScope(event.target.checked);
              // Cleared on toggle, so the previous results never sit under a changed setting
              // looking like they answered it. Comparing scoped and unscoped is the whole point
              // of the control, and stale results would make that comparison a lie.
              setResults(undefined);
            }}
          />
          Search using the ward&apos;s scope
        </label>

        <div>
          <Button type="submit" disabled={isSearching || !hasDocuments}>
            {isSearching ? "Searching…" : "Search"}
          </Button>
        </div>

        {!hasDocuments && (
          <p className="text-xs text-muted">
            There is nothing to search yet. Add a document first.
          </p>
        )}

        <FormError message={searchError} />

        {results !== undefined && results.length === 0 && (
          // A legitimate answer, not a failure. Worded so it does not read as a bug: the floor
          // exists because weak passages are worse than none — they read as authoritative to the
          // model, which then cites them.
          //
          // It also ends with the NEXT MOVE. Saying only that nothing matched is accurate and
          // leaves the reader nowhere; the two things that actually change the outcome are
          // different words or a document that covers the subject.
          <p className="text-sm text-muted">
            Nothing in the knowledge base is close enough to this to be worth quoting, so the AI
            would answer from the ward&apos;s settings alone. Try different wording, or add a
            document that covers this subject.
            {/* A NARROW SCOPE DOES NOT LOWER THE SIMILARITY FLOOR, and a ward that has scoped
                tightly will see this often and correctly. Naming the scope as a possible cause is
                what stops it reading as a broken search. */}
            {useScope
              ? " If the ward's scope is narrow, that alone can be the reason — untick the box above to search everything."
              : ""}
          </p>
        )}

        {results !== undefined && results.length > 0 && (
          <ul className="flex flex-col gap-3">
            {results.map((result, index) => (
              <li
                key={`${result.sourceLabel}-${index}`}
                className="rounded-md border border-dashed border-border bg-surface p-3"
              >
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {result.sourceLabel}
                  </span>
                  {/* WORDS, not the raw score. This screen exists to be inspected, which was the
                      argument for "0.412" — but a number is only inspectable against a scale, and
                      the scale here is 0.3 to about 0.45 rather than 0 to 1. Nobody reading this
                      knows that, so the number ranked the results without ever saying whether any
                      of them was good. The list already carries the ordering. */}
                  <span className="text-xs text-muted">
                    {describeSimilarity(result.similarity)}
                  </span>
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                  {result.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </form>
    </Card>
  );
}
