"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { AllOrganizationsTable } from "@/app/(app)/visits/AllOrganizationsTable";
import { VisitReportFeed } from "@/app/(app)/visits/feed/VisitReportFeed";
import { GoalHistory } from "@/app/(app)/visits/GoalHistory";
import { HouseholdsPanel, type HouseholdsPanelProps } from "@/app/(app)/visits/HouseholdsPanel";
import { MyVisits, type MyVisitsProps } from "@/app/(app)/visits/MyVisits";
import { SharingPanel, type SharingPanelProps } from "@/app/(app)/visits/SharingPanel";
import { FormError } from "@/components/ui/FormError";
import type { ReportFeedPage } from "@/lib/reports/types";
// Type-only: the server-only module stays out of the client bundle.
import type { AllOrgProgress } from "@/lib/visits/allOrgProgress";
import type { GoalHistoryEntry } from "@/lib/visits/goalHistory";
import {
  VISITS_TAB_LABELS,
  type VisitHouseholdSort,
  type VisitsTab,
  type VisitsView,
} from "@/lib/visits/visitsView";

// The Visits page's tabs (ITER-055 bv2, prototype VisitsPage, module-map §6 sub-view machine).
// The page decides which tabs a reader sees (visibleVisitsTabs()); the tab and the household sort
// are remembered on the account, so the page reopens as it was left.

async function saveView(view: VisitsView): Promise<void> {
  const response = await fetch("/api/session/page-view", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page: "visits", view }),
  });

  if (response.ok) return;

  let message = "Could not remember how you left this page.";
  try {
    const parsed = (await response.json()) as { error?: unknown };
    if (typeof parsed.error === "string") message = parsed.error;
  } catch {
    message = "The server sent a response this page could not read.";
  }
  throw new Error(message);
}

export type VisitsScreenProps = {
  visibleTabs: readonly VisitsTab[];
  initialView: VisitsView;
  households: Omit<HouseholdsPanelProps, "sort" | "onSortChange">;
  feed: { initialPage: ReportFeedPage; ownOrganizationId: string | null; sharingSentence: string };
  // Null when the reader cannot see that tab.
  allOrganizations: AllOrgProgress | null;
  goalHistory: GoalHistoryEntry[] | null;
  sharing: SharingPanelProps | null;
  myVisits: MyVisitsProps | null;
};

export function VisitsScreen({
  visibleTabs,
  initialView,
  households,
  feed,
  allOrganizations,
  goalHistory,
  sharing,
  myVisits,
}: VisitsScreenProps) {
  const [view, setView] = useState<VisitsView>(initialView);
  const [saveError, setSaveError] = useState<string | undefined>();
  const tabRefs = useRef<Partial<Record<VisitsTab, HTMLButtonElement | null>>>({});

  function remember(next: VisitsView) {
    setView(next);
    setSaveError(undefined);
    saveView(next).catch((error: unknown) => {
      setSaveError(error instanceof Error ? error.message : "Could not remember this page.");
    });
  }

  function choose(tab: VisitsTab) {
    if (tab !== view.tab) remember({ ...view, tab });
  }

  function changeSort(sort: VisitHouseholdSort) {
    if (sort !== view.sort) remember({ ...view, sort });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const index = visibleTabs.indexOf(view.tab);
    const next = visibleTabs[(index + step + visibleTabs.length) % visibleTabs.length];
    choose(next);
    tabRefs.current[next]?.focus();
  }

  function panelFor(tab: VisitsTab) {
    if (tab === "feed") {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Every visit that has been reported, newest first. What you have read is yours alone.{" "}
            {feed.sharingSentence}
          </p>
          <VisitReportFeed
            initialPage={feed.initialPage}
            ownOrganizationId={feed.ownOrganizationId}
          />
          <p className="text-sm text-muted">
            Notes are shortened to one line here. The full shared note is under Recent visits on
            the Households tab.
          </p>
        </div>
      );
    }

    if (tab === "all_organizations" && allOrganizations !== null) {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            One row per household, with every organization that has claimed it. A household nobody
            has claimed sorts to the top.
          </p>
          <AllOrganizationsTable progress={allOrganizations} />
        </div>
      );
    }

    if (tab === "goal_history" && goalHistory !== null) return <GoalHistory entries={goalHistory} />;

    if (tab === "sharing" && sharing !== null) return <SharingPanel {...sharing} />;

    if (tab === "my_visits" && myVisits !== null) return <MyVisits {...myVisits} />;

    return <HouseholdsPanel {...households} sort={view.sort} onSortChange={changeSort} />;
  }

  const activeTab = visibleTabs.includes(view.tab) ? view.tab : "households";

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Visits" className="flex gap-1 overflow-x-auto border-b border-border">
        {visibleTabs.map((tab) => {
          const selected = tab === activeTab;
          return (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[tab] = element;
              }}
              type="button"
              role="tab"
              id={`visits-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`visits-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(tab)}
              onKeyDown={onKeyDown}
              className={
                "min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-medium focus-visible:outline-2 " +
                "focus-visible:outline-offset-2 focus-visible:outline-primary " +
                (selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted hover:text-foreground")
              }
            >
              {VISITS_TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>

      <FormError message={saveError} />

      <div role="tabpanel" id={`visits-panel-${activeTab}`} aria-labelledby={`visits-tab-${activeTab}`}>
        {panelFor(activeTab)}
      </div>
    </div>
  );
}
