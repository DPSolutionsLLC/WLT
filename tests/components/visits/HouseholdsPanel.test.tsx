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
  address: "22 Maple Street",
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

function renderPanel(overrides: Partial<HouseholdsPanelProps> = {}) {
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
    byStreet: false,
    onByStreetChange: () => undefined,
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
    companionLeaders: [],
    memberNames: {},
    recentVisits: null,
    // An Elders Quorum reader: the Bishopric's assignments are never handed to this tab.
    assignments: null,
    ...overrides,
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

// ITER-055 bv8: Group by street.
describe("HouseholdsPanel street grouping", () => {
  const rivera: VisitProgressRow = { ...carver, householdId: "household-rivera", familyName: "Rivera", address: "4 Ridge Rd" };
  const abbott: VisitProgressRow = { ...carver, householdId: "household-abbott", familyName: "Abbott", address: "11 Maple St" };
  const jensen: VisitProgressRow = { ...carver, householdId: "household-jensen", familyName: "Jensen", address: null };
  const threeStreets = { ...progress, rows: [jensen, rivera, carver, abbott] } as VisitProgress;

  it("groups streets A to Z, no street last, with the sort inside each", () => {
    renderPanel({ initialProgress: threeStreets, byStreet: true, sort: "familyName" });

    const groups = screen.getAllByRole("region");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Maple Street",
      "Ridge Road",
      "No street on file",
    ]);
    expect(groups[0].textContent).toMatch(/Abbott[\s\S]*Carver/);
    expect(groups[0].querySelector("h3")?.textContent).toBe("Maple Street · 2");
  });

  it("is one list when the switch is off, and the switch reports a change", () => {
    const onByStreetChange = vi.fn();
    renderPanel({ initialProgress: threeStreets, byStreet: false, onByStreetChange });

    expect(screen.queryAllByRole("region")).toEqual([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Group by street" }));
    expect(onByStreetChange).toHaveBeenCalledWith(true);
  });
});

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
