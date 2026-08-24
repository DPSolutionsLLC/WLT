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
        body: JSON.stringify({ query }),
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
            This is exactly what the AI receives as reference material.
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
