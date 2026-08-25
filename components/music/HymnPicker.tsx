"use client";

import { useEffect, useId, useRef, useState } from "react";
import { UnverifiedHymnBadge } from "@/components/music/UnverifiedHymnBadge";
import { Input } from "@/components/ui/Input";
import { messageFromPayload, readJsonPayload } from "@/lib/program/requests";

// A hymn number and title, with the hymnbook behind them.
//
// ---------------------------------------------------------------------------------------------
// FREE TEXT IS STILL POSSIBLE, AND THAT IS NOT A FALLBACK
// ---------------------------------------------------------------------------------------------
// A ward that sings something outside the hymnbook is a real case — a Primary song, a Christmas
// piece, an arrangement somebody wrote. Both boxes stay typeable. What the picker adds is that
// typing a NUMBER fills the title in for you, and that a search finds a hymn when you know the
// words and not the number.
//
// It fills the title only when the title box is EMPTY. Overwriting something a person typed
// because a number happens to match would silently undo the free-text case this component exists
// to preserve.
//
// CLIENT-SAFE. It reaches the hymnbook through GET /api/hymns and imports nothing that touches
// next/headers (plans/retros/roster-b-picker-and-orgs.md).

export type HymnPickerValue = {
  number: number;
  title: string;
};

type HymnResult = {
  number: number;
  title: string;
  topicTags: string[];
};

export type HymnPickerProps = {
  idPrefix: string;
  label: string;
  value: HymnPickerValue | null;
  onChange: (next: HymnPickerValue | null) => void;
  disabled: boolean;
};

const DEBOUNCE_MS = 250;
const MAX_VISIBLE_RESULTS = 8;

export function HymnPicker({ idPrefix, label, value, onChange, disabled }: HymnPickerProps) {
  const searchId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HymnResult[]>([]);
  const [lookupMessage, setLookupMessage] = useState<string>();

  // The number whose title has already been looked up, so a re-render or an unrelated keystroke
  // does not fire the same request again. A ref rather than state: changing it must not itself
  // cause a render.
  const resolvedNumber = useRef<number | null>(null);

  const hymnNumber = value?.number ?? null;
  const hymnTitle = value?.title ?? "";

  // Look the title up when a number is typed and the title box is empty.
  useEffect(() => {
    if (disabled) return;
    if (hymnNumber === null) return;
    if (hymnTitle.trim() !== "") return;
    if (resolvedNumber.current === hymnNumber) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/hymns?query=${hymnNumber}&limit=1`, {
            signal: controller.signal,
          });
          const payload = await readJsonPayload(response);

          if (!response.ok) {
            setLookupMessage(
              messageFromPayload(payload, "Could not look that hymn number up."),
            );
            return;
          }

          resolvedNumber.current = hymnNumber;

          const hymns = (payload.hymns as HymnResult[] | undefined) ?? [];
          const match = hymns.find((hymn) => hymn.number === hymnNumber);

          if (match === undefined) {
            // NOT "no such hymn". Only 42 of the 341 rows are verified until a hymnbook is
            // loaded, so an unknown number means unknown — the seed file's own instruction.
            setLookupMessage(
              `Hymn ${hymnNumber} is not in the hymnbook this app has been given. Type the title if you know it.`,
            );
            return;
          }

          setLookupMessage(undefined);
          onChange({ number: hymnNumber, title: match.title });
        } catch (error) {
          if (controller.signal.aborted) return;
          console.error("Could not look up a hymn number", error);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [disabled, hymnNumber, hymnTitle, onChange]);

  // The search box. Every in-flight request is abandoned when a newer one starts, so a slow
  // response for "sac" cannot land after a fast one for "sacrament".
  useEffect(() => {
    if (disabled) return;

    const trimmed = query.trim();
    // Returns without clearing `results`. Clearing state synchronously inside an effect body
    // triggers a cascading render; `visibleResults` below derives the empty list from the empty
    // query instead.
    if (trimmed === "") return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/hymns?query=${encodeURIComponent(trimmed)}&limit=${MAX_VISIBLE_RESULTS}`,
            { signal: controller.signal },
          );
          const payload = await readJsonPayload(response);
          if (!response.ok) return;
          setResults((payload.hymns as HymnResult[] | undefined) ?? []);
        } catch (error) {
          if (controller.signal.aborted) return;
          console.error("Could not search hymns", error);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [disabled, query]);

  function setNumber(raw: string): void {
    const parsed = Number.parseInt(raw, 10);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      resolvedNumber.current = null;
      setLookupMessage(undefined);
      onChange(null);
      return;
    }

    onChange({ number: parsed, title: hymnTitle });
  }

  function choose(hymn: HymnResult): void {
    resolvedNumber.current = hymn.number;
    setLookupMessage(undefined);
    setQuery("");
    setResults([]);
    onChange({ number: hymn.number, title: hymn.title });
  }

  // DERIVED, not stored — see the effect above.
  const visibleResults = query.trim() === "" ? [] : results;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Input
          id={`${idPrefix}-number`}
          label={`${label} number`}
          type="number"
          min={1}
          inputMode="numeric"
          value={hymnNumber === null ? "" : String(hymnNumber)}
          disabled={disabled}
          onChange={(event) => setNumber(event.target.value)}
        />
        {/* Typeable even with no number chosen would store a title with nothing to identify it —
            a hymn is identified by its number. Disabled until there is one, and the placeholder
            says so rather than accepting keystrokes and discarding them. */}
        <Input
          id={`${idPrefix}-title`}
          label={`${label} title`}
          value={hymnTitle}
          disabled={disabled || hymnNumber === null}
          placeholder={hymnNumber === null ? "Enter a hymn number first" : undefined}
          onChange={(event) =>
            hymnNumber === null
              ? undefined
              : onChange({ number: hymnNumber, title: event.target.value })
          }
        />
      </div>

      {hymnTitle.trim() !== "" && (
        <div>
          <UnverifiedHymnBadge title={hymnTitle} />
        </div>
      )}

      {lookupMessage !== undefined && <p className="text-sm text-muted">{lookupMessage}</p>}

      {!disabled && (
        <div className="flex flex-col gap-2">
          <Input
            id={`${searchId}-search`}
            label={`Find a ${label.toLowerCase()} by title or subject`}
            value={query}
            autoComplete="off"
            placeholder="Optional — type a number above instead"
            onChange={(event) => setQuery(event.target.value)}
          />

          {visibleResults.length > 0 && (
            <ul className="flex flex-col gap-1">
              {visibleResults.map((hymn) => (
                <li key={hymn.number}>
                  <button
                    type="button"
                    onClick={() => choose(hymn)}
                    className="flex min-h-11 w-full flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm text-foreground hover:bg-surface"
                  >
                    <span>
                      {hymn.number} — {hymn.title}
                    </span>
                    <UnverifiedHymnBadge title={hymn.title} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
