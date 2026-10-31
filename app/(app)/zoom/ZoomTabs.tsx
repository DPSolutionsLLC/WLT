"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { InviteesPanel } from "@/app/(app)/zoom/InviteesPanel";
import { LinkPoolPanel } from "@/app/(app)/zoom/LinkPoolPanel";
import { RegistrationsPanel, type RegistrationsPanelProps } from "@/app/(app)/zoom/RegistrationsPanel";
import { RemoteControlPanel } from "@/app/(app)/zoom/RemoteControlPanel";
import { RemoteLinksPanel } from "@/app/(app)/zoom/RemoteLinksPanel";
import { FormError } from "@/components/ui/FormError";
import type { ZoomInvitee } from "@/lib/zoom/invitees";
import type { PoolSummary } from "@/lib/zoom/joinLinkPool";
import type { RemoteLinkRow } from "@/lib/zoom/remoteLinkRow";
import { pendingCount } from "@/lib/zoom/registrationRow";
import type { RemoteLinkOwnState } from "@/lib/zoom/remoteLinks";
import type { ZoomTab } from "@/lib/zoom/zoomView";
import type { SessionUser } from "@/types/domain";

// The Zoom page's tabs (ITER-051, ITER-053, ITER-052, module-map §6.5). The page decides which tabs a reader
// sees (visibleZoomTabs()); a reader with one tab gets that panel alone and no tab bar. The tab is
// remembered on the account, so the page reopens as it was left.

const TAB_LABELS: Record<ZoomTab, string> = {
  remote: "Remote control",
  invitees: "Invitees",
  registrations: "Sign-ups",
  pool: "Link pool",
  links: "Remote links",
};

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
  // Null when the reader cannot see that tab.
  linkRows: RemoteLinkRow[] | null;
  pool: PoolSummary | null;
  invitees: ZoomInvitee[] | null;
  // Null when the reader cannot see the Sign-ups tab.
  signUps: Omit<RegistrationsPanelProps, "canManage"> | null;
  canManageInvitees: boolean;
  user: SessionUser;
  wardName: string | null;
  visibleTabs: readonly ZoomTab[];
  initialTab: ZoomTab;
};

export function ZoomTabs({
  ownState,
  linkWentAway,
  linkRows,
  pool,
  invitees,
  signUps,
  canManageInvitees,
  user,
  wardName,
  visibleTabs,
  initialTab,
}: ZoomTabsProps) {
  const [activeTab, setActiveTab] = useState<ZoomTab>(
    visibleTabs.includes(initialTab) ? initialTab : "remote",
  );
  const [saveError, setSaveError] = useState<string | undefined>();
  const tabRefs = useRef<Record<ZoomTab, HTMLButtonElement | null>>({
    remote: null,
    invitees: null,
    registrations: null,
    pool: null,
    links: null,
  });

  const remotePanel = <RemoteControlPanel state={ownState} linkWentAway={linkWentAway} />;
  const waitingSignUps = signUps ? pendingCount(signUps.registrations) : 0;

  function labelFor(tab: ZoomTab): string {
    if (tab === "registrations" && waitingSignUps > 0) return `${TAB_LABELS[tab]} · ${waitingSignUps}`;
    return TAB_LABELS[tab];
  }

  if (visibleTabs.length <= 1) return remotePanel;

  function panelFor(tab: ZoomTab) {
    if (tab === "invitees" && invitees) {
      return (
        <InviteesPanel
          invitees={invitees}
          canManage={canManageInvitees}
          user={user}
          wardName={wardName}
        />
      );
    }
    if (tab === "registrations" && signUps) {
      return <RegistrationsPanel {...signUps} canManage={canManageInvitees} />;
    }
    if (tab === "pool" && pool) return <LinkPoolPanel initialPool={pool} />;
    if (tab === "links" && linkRows) return <RemoteLinksPanel initialRows={linkRows} />;
    return remotePanel;
  }

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
    const index = visibleTabs.indexOf(activeTab);
    const next = visibleTabs[(index + step + visibleTabs.length) % visibleTabs.length];
    choose(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Zoom"
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
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
              id={`zoom-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`zoom-panel-${tab}`}
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
              {labelFor(tab)}
            </button>
          );
        })}
      </div>

      <FormError message={saveError} />

      <div role="tabpanel" id={`zoom-panel-${activeTab}`} aria-labelledby={`zoom-tab-${activeTab}`}>
        {panelFor(activeTab)}
      </div>
    </div>
  );
}
