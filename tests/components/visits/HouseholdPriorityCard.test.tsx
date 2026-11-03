import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HouseholdPriorityCard } from "@/app/(app)/visits/HouseholdPriorityCard";
import type { VisitProgressRow } from "@/lib/visits/progress";

// One household card on the Households tab (ITER-055 bv2).

const asOf = new Date("2027-03-01T12:00:00Z");

function row(overrides: Partial<VisitProgressRow> = {}): VisitProgressRow {
  return {
    householdId: "household-1",
    familyName: "Rivera",
    lastVisitedOn: "2026-09-10",
    lastAttemptedOn: null,
    attemptsSinceLastVisit: 0,
    doNotContact: false,
    priority: {
      band: "on_track",
      elapsedFraction: 0.4,
      dueOn: "2027-09-10",
      cadence: { amount: 1, unit: "year" },
      cadenceSource: "goal",
    },
    conductedBy: "Sam Ortiz",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("HouseholdPriorityCard", () => {
  it("names the household, its band, when it is due and who last went", () => {
    render(<HouseholdPriorityCard row={row()} asOf={asOf} />);

    expect(screen.getByText("Rivera")).toBeTruthy();
    expect(screen.getByText(/On track/)).toBeTruthy();
    expect(screen.getByText(/^Due /)).toBeTruthy();
    expect(screen.getByText(/Last visited .* by Sam Ortiz/)).toBeTruthy();
  });

  it("says when the household carries its own cadence", () => {
    render(
      <HouseholdPriorityCard
        row={row({
          priority: { ...row().priority!, cadenceSource: "household" },
        })}
        asOf={asOf}
      />,
    );
    expect(screen.getByText(/this household's own cadence/)).toBeTruthy();
  });

  it("counts attempts since the last visit", () => {
    render(
      <HouseholdPriorityCard
        row={row({ attemptsSinceLastVisit: 2, lastAttemptedOn: "2027-01-05" })}
        asOf={asOf}
      />,
    );
    expect(screen.getByText(/2 attempts since then/)).toBeTruthy();
  });

  it("marks a never-visited household without a due date", () => {
    render(
      <HouseholdPriorityCard
        row={row({
          lastVisitedOn: null,
          conductedBy: null,
          priority: { ...row().priority!, band: "never_visited", elapsedFraction: null, dueOn: null },
        })}
        asOf={asOf}
      />,
    );
    expect(screen.getByText("Never visited.")).toBeTruthy();
    expect(screen.queryByText(/^Due /)).toBeNull();
  });

  it("shows a do-not-contact household marked, and offers it no buttons the page left out", () => {
    render(
      <HouseholdPriorityCard row={row({ doNotContact: true, priority: null })} asOf={asOf} />,
    );
    expect(screen.getByText("Do not contact")).toBeTruthy();
    expect(screen.getByText(/not counted toward the goal/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens its windows from the small buttons on the title line", () => {
    const onLogVisit = vi.fn();
    const onOpenCadence = vi.fn();
    render(
      <HouseholdPriorityCard
        row={row()}
        asOf={asOf}
        onLogVisit={onLogVisit}
        onOpenCadence={onOpenCadence}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Log a visit to the Rivera household" }));
    fireEvent.click(screen.getByRole("button", { name: "How often to visit the Rivera household" }));

    expect(onLogVisit).toHaveBeenCalledTimes(1);
    expect(onOpenCadence).toHaveBeenCalledTimes(1);
  });
});
