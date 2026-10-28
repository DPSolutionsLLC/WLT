"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { RemoteControlPanel } from "@/app/(app)/zoom/RemoteControlPanel";
import { RemoteLinksPanel } from "@/app/(app)/zoom/RemoteLinksPanel";
import { FormError } from "@/components/ui/FormError";
import type { RemoteLinkRow } from "@/lib/zoom/remoteLinkRow";
import type { RemoteLinkOwnState } from "@/lib/zoom/remoteLinks";
import type { ZoomTab } from "@/lib/zoom/zoomView";

// The Zoom page's tabs (ITER-051, module-map §6.5). A reader who cannot manage links has one
// screen, so they get the Remote control panel alone and no tab bar. The tab is remembered on the
// account, so the page reopens as it was left.

const TAB_LABELS: Record<ZoomTab, string> = {
  remote: "Remote control",
  links: "Remote links",
};

const TAB_ORDER: readonly ZoomTab[] = ["remote", "links"];

async function saveTab(tab: ZoomTab): Promise<void> {
  const response = await fetch("/api/session/page-view", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page: "zoom", view: { tab } }),
  });

  if (response.ok) return;

  let message = "Could not remember which tab you left open.";
  try {
    const parsed = (await response.json()) as { error?: unknown };
    if (typeof parsed.error === "string") message = parsed.error;
  } catch {
    message = "The server sent a response this page could not read.";
  }
  throw new Error(message);
}

export type ZoomTabsProps = {
  ownState: RemoteLinkOwnState;
  linkWentAway: boolean;
  // Null when the reader cannot manage links: no tab bar at all.
  linkRows: RemoteLinkRow[] | null;
  initialTab: ZoomTab;
};

export function ZoomTabs({ ownState, linkWentAway, linkRows, initialTab }: ZoomTabsProps) {
  const [activeTab, setActiveTab] = useState<ZoomTab>(linkRows ? initialTab : "remote");
  const [saveError, setSaveError] = useState<string | undefined>();
  const tabRefs = useRef<Record<ZoomTab, HTMLButtonElement | null>>({ remote: null, links: null });

  const remotePanel = <RemoteControlPanel state={ownState} linkWentAway={linkWentAway} />;

  if (!linkRows) return remotePanel;

  function choose(tab: ZoomTab) {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setSaveError(undefined);
    saveTab(tab).catch((error: unknown) => {
      setSaveError(error instanceof Error ? error.message : "Could not remember your tab.");
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const index = TAB_ORDER.indexOf(activeTab);
    const next = TAB_ORDER[(index + step + TAB_ORDER.length) % TAB_ORDER.length];
    choose(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Zoom" className="flex gap-1 border-b border-border">
        {TAB_ORDER.map((tab) => {
          const selected = tab === activeTab;
          return (
            <button
              key={tab}
              ref={(element) => {
                tabRefs.current[tab] = element;
              }}
              type="button"
              role="tab"
              id={`zoom-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`zoom-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(tab)}
              onKeyDown={onKeyDown}
              className={
                "-mb-px min-h-11 border-b-2 px-4 text-sm font-medium focus-visible:outline-2 " +
                "focus-visible:outline-offset-2 focus-visible:outline-primary " +
                (selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted hover:text-foreground")
              }
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>

      <FormError message={saveError} />

      <div role="tabpanel" id={`zoom-panel-${activeTab}`} aria-labelledby={`zoom-tab-${activeTab}`}>
        {activeTab === "remote" ? remotePanel : <RemoteLinksPanel initialRows={linkRows} />}
      </div>
    </div>
  );
}
