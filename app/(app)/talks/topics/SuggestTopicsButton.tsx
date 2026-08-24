"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import {
  DEFAULT_SUGGESTION_COUNT,
  MAX_SEED_LENGTH,
  MAX_SUGGESTION_COUNT,
} from "@/lib/validation/aiRequests";

// Asks for suggestions and puts them in the queue below. It writes nothing to the topic library
// and there is no control here that could — the accept button on each candidate is the only door
// (CLAUDE.md rule 3).
//
// Rendered only when `canManage` is true. A visible-but-refused button teaches somebody the
// feature exists and that they are not allowed it, which is a worse answer than a page that
// simply does not offer it.

export const SEED_HELP =
  "Optional. Something like \"fast Sunday\" or \"for the youth\" — leave it blank to use the " +
  "ward's own preferences.";

// The outcome as a SENTENCE, with all three numbers. "3 added" alone leaves somebody who asked
// for 5 wondering what happened to the other two, and an empty queue beside a success message is
// a confusing pair.
export function describeOutcome(
  returned: number,
  inserted: number,
  filtered: number,
): string {
  if (returned === 0) {
    return "The AI did not return any suggestions. Try again, or add a nudge.";
  }

  if (inserted === 0) {
    return `${returned} ${returned === 1 ? "suggestion" : "suggestions"} came back, and every ` +
      "one was a topic you already have. Nothing was added.";
  }

  const head = `${returned} ${returned === 1 ? "suggestion" : "suggestions"}, ${inserted} added to the queue`;

  return filtered === 0
    ? `${head}.`
    : `${head} — ${filtered} ${filtered === 1 ? "was a topic" : "were topics"} you already have.`;
}

export type SuggestTopicsButtonProps = {
  onSuggested: () => Promise<void>;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

function readCount(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" ? value : 0;
}

export function SuggestTopicsButton({ onSuggested }: SuggestTopicsButtonProps) {
  const [count, setCount] = useState(DEFAULT_SUGGESTION_COUNT);
  const [seed, setSeed] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [outcome, setOutcome] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  async function suggest(): Promise<void> {
    setErrorMessage(undefined);
    setOutcome(undefined);
    setIsWorking(true);

    try {
      const response = await fetch("/api/topics/ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, seed: seed.trim() === "" ? null : seed.trim() }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        // Every one of ai-a's six error kinds arrives as its own written sentence. Re-wording
        // them here would collapse "the key is missing" and "the service is busy" into one.
        setErrorMessage(
          typeof payload.error === "string"
            ? payload.error
            : "Could not suggest topics. Please try again.",
        );
        return;
      }

      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];

      setOutcome(
        describeOutcome(
          readCount(payload, "returnedCount"),
          candidates.length,
          readCount(payload, "filteredCount"),
        ),
      );

      // The queue below refreshes through TopicList's existing invalidation, so the new
      // candidates appear without a reload and without a second refresh mechanism.
      await onSuggested();
    } catch (error) {
      console.error("Could not suggest topics", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold text-foreground">Ask for suggestions</h2>
      <p className="mt-1 text-sm text-muted">
        Suggestions land in the queue below. Nothing reaches your topic library until you accept
        it.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <label
          htmlFor="suggest-topics-count"
          className="flex flex-col gap-1 text-sm font-medium text-foreground"
        >
          How many
          <select
            id="suggest-topics-count"
            value={count}
            disabled={isWorking}
            onChange={(event) => setCount(Number(event.target.value))}
            className="min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:w-32"
          >
            {Array.from({ length: MAX_SUGGESTION_COUNT }, (_, index) => index + 1).map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ),
            )}
          </select>
        </label>

        {/* Input requires an id, and every control on this page needs a distinct one
            (plans/retros/talks-c-prayers-topics.md). */}
        <Input
          id="suggest-topics-seed"
          label="A nudge (optional)"
          value={seed}
          maxLength={MAX_SEED_LENGTH}
          disabled={isWorking}
          placeholder="fast Sunday"
          onChange={(event) => setSeed(event.target.value)}
        />
        <p className="-mt-1 text-sm text-muted">{SEED_HELP}</p>

        <Button
          type="button"
          className="self-start"
          // Generation runs at "high" effort over the whole corpus and takes noticeably longer
          // than a message draft. Without a progress state this button gets pressed repeatedly,
          // and each press is a separate spend.
          disabled={isWorking}
          onClick={() => void suggest()}
        >
          {isWorking ? "Thinking…" : "Suggest topics"}
        </Button>

        {outcome !== undefined && <p className="text-sm text-foreground">{outcome}</p>}

        <FormError message={errorMessage} />
      </div>
    </Card>
  );
}
