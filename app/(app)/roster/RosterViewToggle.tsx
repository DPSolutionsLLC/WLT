"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ROSTER_VIEW_MODES, type RosterViewMode } from "@/types/domain";

export type RosterViewToggleProps = {
  view: RosterViewMode;
  hasViewParam: boolean;
  query: Record<string, string>;
};

// Per user, per device. `users` has no settings column, and adding one would widen exactly the
// column grant migration 022 just narrowed — so a layout preference lives in localStorage,
// which is the right granularity for it anyway.
//
// The `?view=` search param stays the source of truth so the page above can remain a Server
// Component. This only restores the stored choice when the URL carries no view at all.
const STORAGE_KEY = "roster-view";

const LABELS: Record<RosterViewMode, string> = {
  household: "Households",
  list: "All members",
};

function buildHref(query: Record<string, string>, view: RosterViewMode): string {
  const params = new URLSearchParams(query);
  params.set("view", view);
  return `/roster?${params.toString()}`;
}

export function RosterViewToggle({ view, hasViewParam, query }: RosterViewToggleProps) {
  const router = useRouter();

  useEffect(() => {
    if (hasViewParam) return;

    let stored: string | null = null;

    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.error("Could not read the saved roster view", error);
      return;
    }

    if (stored === null) return;
    if (!(ROSTER_VIEW_MODES as readonly string[]).includes(stored)) return;
    if (stored === view) return;

    router.replace(buildHref(query, stored as RosterViewMode));
  }, [hasViewParam, query, router, view]);

  function selectView(next: RosterViewMode) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      console.error("Could not save the roster view preference", error);
    }

    router.push(buildHref(query, next));
  }

  return (
    <div
      role="group"
      aria-label="Roster view"
      className="flex w-full gap-2 md:w-auto"
    >
      {ROSTER_VIEW_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={view === mode}
          onClick={() => selectView(mode)}
          className={`min-h-11 flex-1 rounded-md border px-3 text-sm md:flex-none ${
            view === mode
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-surface text-foreground hover:bg-surface-raised"
          }`}
        >
          {LABELS[mode]}
        </button>
      ))}
    </div>
  );
}
