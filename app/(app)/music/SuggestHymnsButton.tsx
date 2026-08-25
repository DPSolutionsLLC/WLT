"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UnverifiedHymnBadge } from "@/components/music/UnverifiedHymnBadge";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";
import { HYMN_TYPES, type HymnType } from "@/types/domain";

// The AI path.
//
// ---------------------------------------------------------------------------------------------
// GENERATING SAVES NOTHING
// ---------------------------------------------------------------------------------------------
// Suggestions live in this component's state and nowhere else. Navigating away loses them, and
// that is correct — nothing was decided (CLAUDE.md rule 3). Accepting one is a second, explicit
// request that names the slot, which is why each suggestion carries three buttons rather than one
// "accept": a hymn is a suggestion for the meeting, and which slot it goes in is the
// coordinator's call.
//
// Every number shown here has already been checked against the hymns table by the route
// (lib/ai/hymnSuggestions.ts). This component never has to decide whether a number is real.

type Suggestion = {
  number: number;
  title: string;
  reason: string;
};

const SLOT_LABELS: Record<HymnType, string> = {
  opening: "Opening",
  sacrament: "Sacrament",
  closing: "Closing",
};

export type SuggestHymnsButtonProps = {
  sundayId: string;
  hasTopics: boolean;
};

export function SuggestHymnsButton({ sundayId, hasTopics }: SuggestHymnsButtonProps) {
  const router = useRouter();

  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [droppedCount, setDroppedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function suggest(): Promise<void> {
    setErrorMessage(undefined);
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/hymns/suggest?sundayId=${encodeURIComponent(sundayId)}`,
      );
      const payload = await readJsonPayload(response);

      if (!response.ok) {
        // The route's OWN sentence. Six AI error kinds are six distinguishable messages, and
        // re-wording them here would collapse them into one (plans/retros/ai-c-feature-routes.md).
        setErrorMessage(
          messageFromPayload(payload, "Could not suggest hymns. Please try again."),
        );
        setSuggestions(null);
        return;
      }

      setSuggestions((payload.suggestions as Suggestion[] | undefined) ?? []);
      setDroppedCount(typeof payload.droppedCount === "number" ? payload.droppedCount : 0);
    } catch (error) {
      console.error("Could not suggest hymns", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
      setSuggestions(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function accept(suggestion: Suggestion, hymnType: HymnType): Promise<void> {
    setErrorMessage(undefined);
    setIsSaving(true);

    try {
      const response = await fetch("/api/hymns/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sundayId,
          hymnType,
          hymnNumber: suggestion.number,
          hymnTitle: suggestion.title,
          // TRUE, and this is the only component in the app that sends it. It records that the
          // choice began as a suggestion, which is what makes "how often is the AI actually
          // right" answerable later.
          aiSuggested: true,
        }),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(
          messageFromPayload(payload, "Could not save that hymn. Please try again."),
        );
        return;
      }

      // The accepted suggestion leaves the list; the others stay, because a coordinator usually
      // fills two slots from one batch. Cleared explicitly rather than by refresh, which
      // preserves client state (plans/retros/ai-a-client-and-settings.md).
      setSuggestions((current) =>
        current === null
          ? null
          : current.filter((entry) => entry.number !== suggestion.number),
      );
      router.refresh();
    } catch (error) {
      console.error("Could not accept a hymn suggestion", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={isLoading} onClick={() => void suggest()}>
          {isLoading ? "Thinking…" : "Suggest hymns"}
        </Button>
        {!hasTopics && (
          // Said before they press it, not after. Suggestions for a Sunday with no topics are a
          // general-purpose shortlist rather than a bad one, and a coordinator deserves to know
          // which they are about to get.
          <span className="text-xs text-muted">
            No topics yet, so these will suit a sacrament meeting generally.
          </span>
        )}
      </div>

      <FormError message={errorMessage} />

      {suggestions !== null && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-sm text-muted">
            Nothing here is saved. Choose a slot for the one you want.
          </p>

          {droppedCount > 0 && (
            // Shown rather than swallowed. The check that dropped them is the reason this
            // feature is safe to use, and a count is how anybody knows it is doing work.
            <p className="text-xs text-muted">
              {droppedCount === 1
                ? "One suggestion named a hymn number this ward's hymnbook could not confirm and was not shown."
                : `${droppedCount} suggestions named hymn numbers this ward's hymnbook could not confirm and were not shown.`}
            </p>
          )}

          {suggestions.length === 0 ? (
            <p className="text-sm text-muted">
              Every suggestion has been used. Ask again for more.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {suggestions.map((suggestion) => (
                <li key={suggestion.number} className="flex flex-col gap-2">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    <span>
                      {suggestion.number} — {suggestion.title}
                    </span>
                    <UnverifiedHymnBadge title={suggestion.title} />
                  </span>
                  <span className="text-sm text-muted">{suggestion.reason}</span>
                  <span className="flex flex-wrap gap-2">
                    {HYMN_TYPES.map((hymnType) => (
                      <Button
                        key={hymnType}
                        variant="secondary"
                        disabled={isSaving}
                        onClick={() => void accept(suggestion, hymnType)}
                      >
                        Use as {SLOT_LABELS[hymnType].toLowerCase()}
                        <span className="sr-only">
                          {" "}
                          hymn — {suggestion.number}, {suggestion.title}
                        </span>
                      </Button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
