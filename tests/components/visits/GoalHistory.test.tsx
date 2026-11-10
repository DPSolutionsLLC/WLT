import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GoalHistory } from "@/app/(app)/visits/GoalHistory";
import type { GoalHistoryEntry } from "@/lib/visits/goalHistory";

// The Past goals tab (ITER-055 bv4).

afterEach(() => {
  cleanup();
});

const SWEEP: GoalHistoryEntry = {
  goalId: "goal-1",
  orgId: "org-bishopric",
  orgName: "Bishopric",
  title: "Every household this year",
  kind: "sweep",
  cadence: null,
  startedOn: "2027-01-03",
  endedOn: "2027-05-30",
  endReason: "set_aside",
  sweep: { total: 10, done: 4, partlyReached: 2, notYet: 4 },
  onTrack: null,
};

describe("GoalHistory", () => {
  it("lists an ended sweep with its dates, how it ended and its final numbers", () => {
    render(<GoalHistory entries={[SWEEP]} />);

    expect(screen.getByText("Bishopric")).toBeTruthy();
    expect(screen.getByText(/Every household once · .* to .* · Set aside/)).toBeTruthy();
    expect(screen.getByText("4 of 10 done · 2 partly reached · 4 not yet")).toBeTruthy();
  });

  it("gives a cadence goal its on-track share", () => {
    render(
      <GoalHistory
        entries={[
          {
            ...SWEEP,
            goalId: "goal-2",
            kind: "cadence",
            cadence: { amount: 1, unit: "year" },
            endReason: "completed",
            sweep: null,
            onTrack: { onTrack: 3, counted: 4, percent: 75 },
          },
        ]}
      />,
    );

    expect(screen.getByText(/Completed/)).toBeTruthy();
    expect(screen.getByText("75% on track (3 of 4)")).toBeTruthy();
  });

  it("says plainly when nothing has ended", () => {
    render(<GoalHistory entries={[]} />);
    expect(screen.getByText(/No goal has ended yet/)).toBeTruthy();
  });
});
