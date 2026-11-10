// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisitGoalPanel } from "@/app/(app)/visits/VisitGoalPanel";
import type { VisitGoal } from "@/lib/visits/queries";

// The goal window (ITER-055 bv4): one active goal per organization, sweeps carry no schedule, and
// ending a goal sends `{ end }` and nothing else.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ORG_ID = "org-bishopric";

const SWEEP: VisitGoal = {
  id: "goal-1",
  orgId: ORG_ID,
  title: "Every household this year",
  targetType: "all_households",
  cadence: null,
  notice: null,
  deadline: null,
  kind: "sweep",
  startedOn: "2027-01-03",
  endedAt: null,
  endReason: null,
  createdBy: "user-1",
  createdAt: "2027-01-03T00:00:00.000Z",
};

function renderPanel(goals: VisitGoal[], showsPastGoals = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <VisitGoalPanel
        goals={goals}
        organizations={[{ id: ORG_ID, label: "Bishopric" }]}
        canManage
        ownOrgId={ORG_ID}
        today="2027-03-01"
        showsPastGoals={showsPastGoals}
      />
    </QueryClientProvider>,
  );
}

describe("VisitGoalPanel", () => {
  it("does not offer a second goal while one is active", () => {
    renderPanel([SWEEP]);

    expect(screen.queryByRole("button", { name: "Set a goal" })).toBeNull();
    expect(screen.getByText("End the current goal to set a new one.")).toBeTruthy();
    expect(screen.getByText(/Every household once, from /)).toBeTruthy();
  });

  it("ends a goal with the reason alone", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ goal: SWEEP }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPanel([SWEEP]);

    fireEvent.click(screen.getByRole("button", { name: "End goal" }));
    expect(screen.getByText(/It stays on the Past goals tab/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set aside" }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/visit-goals/goal-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ end: "set_aside" }) }),
    );
  });

  it("does not offer End goal while the goal is being edited (defect 101-D1)", () => {
    renderPanel([SWEEP]);

    fireEvent.click(screen.getByRole("button", { name: "End goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.queryByRole("button", { name: "End goal" })).toBeNull();
    expect(screen.queryByText(/How did this goal end/)).toBeNull();
    expect(screen.getByText("Editing this goal")).toBeTruthy();
  });

  it("points to Past goals only for a reader who has that tab", () => {
    renderPanel([]);
    expect(screen.getByText("No active goal. Ended goals are on the Past goals tab.")).toBeTruthy();
    cleanup();

    renderPanel([], false);
    expect(screen.getByText("No active goal.")).toBeTruthy();
  });

  it("hides the schedule fields for a sweep and sends none", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ goal: SWEEP }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    renderPanel([]);

    fireEvent.click(screen.getByRole("button", { name: "Set a goal" }));
    fireEvent.click(screen.getByLabelText("Visit every household once"));

    expect(screen.queryByLabelText("Unit")).toBeNull();
    expect((screen.getByLabelText("Starts") as HTMLInputElement).value).toBe("2027-03-01");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save goal" }));
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: "sweep", startedOn: "2027-03-01", orgId: ORG_ID });
    expect(body).not.toHaveProperty("cadenceAmount");
  });
});
