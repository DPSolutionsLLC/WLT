"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { UnverifiedHymnBadge } from "@/components/music/UnverifiedHymnBadge";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";
import type { HymnType } from "@/types/domain";

// Search the hymnbook and put one hymn in one slot.
//
// It searches on the SERVER through GET /api/hymns rather than shipping 341 rows to the browser
// and filtering here. The matching rules are pure and could run either side
// (lib/music/hymnSearch.ts), but a screen that holds its own copy of a table is a screen that
// goes stale the moment somebody runs `npm run hymns:import`.
//
// Every result shows whether the number is a real hymn. 299 of the 341 rows are synthetic until
// a hymnbook is loaded (migration 042), and the one moment that matters is this one — a
// coordinator about to choose one.

type HymnResult = {
  number: number;
  title: string;
  topicTags: string[];
  source: string;
};

export type HymnSearchModalProps = {
  sundayId: string;
  hymnType: HymnType;
  slotLabel: string;
  hasSelection: boolean;
};

const DEBOUNCE_MS = 250;

export function HymnSearchModal({
  sundayId,
  hymnType,
  slotLabel,
  hasSelection,
}: HymnSearchModalProps) {
  const router = useRouter();
  const inputId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HymnResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  // Debounced, and every in-flight search is abandoned when a newer one starts. Without the
  // abort, a slow response for "sac" can land after a fast one for "sacrament" and replace the
  // right results with stale ones — the cache-write-racing-a-refetch shape program-b recorded.
  useEffect(() => {
    if (!isOpen) return;

    const trimmed = query.trim();
    // Returns without clearing `results`. Clearing state synchronously inside an effect body
    // triggers a cascading render, and it is unnecessary: `visibleResults` below derives the
    // empty list from the empty query, which is the same answer computed rather than stored.
    if (trimmed === "") return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsSearching(true);
      setErrorMessage(undefined);

      void (async () => {
        try {
          const response = await fetch(
            `/api/hymns?query=${encodeURIComponent(trimmed)}`,
            { signal: controller.signal },
          );
          const payload = await readJsonPayload(response);

          if (!response.ok) {
            setErrorMessage(
              messageFromPayload(payload, "Could not search the hymnbook. Please try again."),
            );
            return;
          }

          setResults((payload.hymns as HymnResult[] | undefined) ?? []);
        } catch (error) {
          // An abort is this component cancelling its own request, not a failure anybody needs
          // to read about.
          if (controller.signal.aborted) return;
          console.error("Could not search hymns", error);
          setErrorMessage("Could not reach the server. Check your connection and try again.");
        } finally {
          if (!controller.signal.aborted) setIsSearching(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isOpen, query]);

  async function choose(hymn: HymnResult): Promise<void> {
    setErrorMessage(undefined);
    setIsSaving(true);

    try {
      const response = await fetch("/api/hymns/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sundayId,
          hymnType,
          hymnNumber: hymn.number,
          // The TABLE's title, sent so the selection carries it. The program draft is a snapshot
          // and must keep the title it was approved with (lib/music/queries.ts).
          hymnTitle: hymn.title,
          // FALSE. A hymn found by searching is the coordinator's own choice, and only
          // SuggestHymnsButton may claim otherwise.
          aiSuggested: false,
        }),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(
          messageFromPayload(payload, "Could not save that hymn. Please try again."),
        );
        return;
      }

      // Closed and cleared BEFORE the refresh rather than relying on it. router.refresh()
      // preserves client state (plans/retros/ai-a-client-and-settings.md), so a modal left open
      // would sit there showing yesterday's search over today's saved hymn.
      setIsOpen(false);
      setQuery("");
      setResults([]);
      router.refresh();
    } catch (error) {
      console.error("Could not save a hymn selection", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function clear(): Promise<void> {
    setErrorMessage(undefined);
    setIsSaving(true);

    try {
      const response = await fetch("/api/hymns/select", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sundayId, hymnType }),
      });

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        setErrorMessage(
          messageFromPayload(payload, "Could not clear that hymn. Please try again."),
        );
        return;
      }

      setIsOpen(false);
      setQuery("");
      setResults([]);
      router.refresh();
    } catch (error) {
      console.error("Could not clear a hymn selection", error);
      setErrorMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  // DERIVED, not stored. An empty query has no results by definition, so it is computed here
  // rather than written back into state by the effect above.
  const visibleResults = query.trim() === "" ? [] : results;

  return (
    <>
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => setIsOpen(true)}
        disabled={isSaving}
      >
        {hasSelection ? "Change" : "Choose"}
        <span className="sr-only"> the {slotLabel.toLowerCase()}</span>
      </Button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title={slotLabel}>
        <div className="flex flex-col gap-3">
          <Input
            id={inputId}
            label="Search the hymnbook"
            value={query}
            autoComplete="off"
            placeholder="A number, a title, or what it is about"
            onChange={(event) => setQuery(event.target.value)}
          />

          <FormError message={errorMessage} />

          {query.trim() === "" ? (
            <p className="text-sm text-muted">
              Search by hymn number, by title, or by subject — &ldquo;sacrament&rdquo;,
              &ldquo;gratitude&rdquo;.
            </p>
          ) : isSearching ? (
            <p className="text-sm text-muted">Searching…</p>
          ) : visibleResults.length === 0 ? (
            // NOT "no such hymn". The hymnbook is only partly verified, and telling somebody a
            // hymn does not exist when the truth is that this app has not been told about it is
            // the failure supabase/seed/hymns.sql warns about by name.
            <p className="text-sm text-muted">
              Nothing in the hymnbook matches that. Not every hymn has been loaded yet, so a
              number you know is real may not be found by its title — try the number itself.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {visibleResults.map((hymn) => (
                <li key={hymn.number}>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void choose(hymn)}
                    className="flex min-h-11 w-full flex-col items-start gap-1 rounded-md border border-border px-3 py-2 text-left hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                      <span>
                        {hymn.number} — {hymn.title}
                      </span>
                      <UnverifiedHymnBadge title={hymn.title} />
                    </span>
                    {hymn.topicTags.length > 0 && (
                      <span className="text-xs text-muted">
                        {hymn.topicTags.join(", ").replace(/_/g, " ")}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {hasSelection && (
              <Button variant="danger" disabled={isSaving} onClick={() => void clear()}>
                Clear this hymn
              </Button>
            )}
            <Button variant="secondary" disabled={isSaving} onClick={() => setIsOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
