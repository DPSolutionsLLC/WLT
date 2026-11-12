// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HouseholdsPanel, type HouseholdsPanelProps } from "@/app/(app)/visits/HouseholdsPanel";
import type { VisitProgress, VisitProgressRow } from "@/lib/visits/progress";
import type { SessionUser } from "@/types/domain";

// Defect 100-D1: Contact → "Schedule an appointment" closed the Contact window and the
// Appointments window never appeared. A browser fires a dialog's `close` event AFTER `close()`
// returns, and that late event reset the open window to none. jsdom has no dialog support, so the
// fake below does what a browser does: closing queues the event.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    setTimeout(() => this.dispatchEvent(new Event("close")), 0);
  };
});

afterEach(() => {
  cleanup();
});

const ORG_ID = "org-eq";

const carver: VisitProgressRow = {
  householdId: "household-carver",
  familyName: "Carver",
  lastVisitedOn: null,
  lastAttemptedOn: null,
  attemptsSinceLastVisit: 0,
  partlyReached: null,
  doNotContact: false,
  priority: null,
  sweep: null,
  conductedBy: null,
};

const progress: VisitProgress = {
  orgId: ORG_ID,
  asOf: "2026-11-09T12:00:00.000Z",
  rows: [carver],
  statistics: null,
  goal: null,
  goalHasNoCadence: false,
  stewardship: null,
} as unknown as VisitProgress; // Only the fields the Households tab reads are needed here.

function renderPanel() {
  const props: HouseholdsPanelProps = {
    initialProgress: progress,
    organizations: [{ id: ORG_ID, label: "Elders Quorum" }],
    editableOrgId: ORG_ID,
    canManageGoals: true,
    canLog: true,
    // The Contact and Appointments windows never read the user; a full session is not needed.
    user: { id: "user-1", orgId: ORG_ID } as unknown as SessionUser,
    sort: "priority",
    onSortChange: () => undefined,
    goals: [],
    goalOrganizations: [],
    householdOptions: [{ id: carver.householdId, label: "Carver" }],
    stewardshipHouseholds: [],
    initialStewardship: null,
    appointments: [],
    householdContacts: {},
    wardTimeZone: "America/Denver",
    today: "2026-11-09",
    wardToday: "2026-11-09",
    showsPastGoals: true,
    leaders: [],
    memberNames: {},
    recentVisits: null,
    // An Elders Quorum reader: the Bishopric's assignments are never handed to this tab.
    assignments: null,
  };

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <HouseholdsPanel {...props} />
    </QueryClientProvider>,
  );
}

function openDialogTitles(): string[] {
  return [...document.querySelectorAll("dialog")]
    .filter((dialog) => dialog.open)
    .map((dialog) => dialog.querySelector("h2")?.textContent ?? "");
}

async function flushDialogEvents() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe("HouseholdsPanel windows", () => {
  it("opens Appointments from the Contact window and keeps it open (defect 100-D1)", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Contact the Carver household" }));
    await flushDialogEvents();
    expect(openDialogTitles()).toEqual(["Contact — Carver"]);

    fireEvent.click(screen.getByRole("button", { name: "Schedule an appointment" }));
    await flushDialogEvents();

    expect(openDialogTitles()).toEqual(["Appointments"]);
  });

  it("still closes a window when its own Close is pressed", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Contact the Carver household" }));
    await flushDialogEvents();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await flushDialogEvents();

    expect(openDialogTitles()).toEqual([]);
  });
});
