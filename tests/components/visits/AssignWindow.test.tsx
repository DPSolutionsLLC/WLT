// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppointmentRow } from "@/app/(app)/visits/AppointmentPanel";
import { AssignWindow } from "@/app/(app)/visits/AssignWindow";
import type { BishopricMember } from "@/lib/visits/assignmentShares";
import type { VisitAssignment } from "@/types/domain";

// The Assign window (ITER-055 bv5). Once a ticked household is held by anybody, the box says what
// EACH button would do — decided walking scenario 102, where it described Assign alone.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

afterEach(cleanup);

const MEMBERS: BishopricMember[] = [
  { id: "user-1", role: "counselor", counselorPosition: 1, firstName: "Aaron", lastName: "Pike" },
  { id: "user-2", role: "counselor", counselorPosition: 2, firstName: "Lena", lastName: "Ortiz" },
];

const HOUSEHOLDS = [
  { id: "house-ellis", familyName: "Ellis" },
  { id: "house-garcia", familyName: "Garcia" },
];

const ELLIS_HELD_BY_LENA: VisitAssignment = {
  id: "assignment-1",
  orgId: "org-bishopric",
  householdId: "house-ellis",
  goalId: "goal-1",
  assignedTo: "user-2",
  assignedBy: null,
  createdAt: "2027-01-03T00:00:00.000Z",
  endedAt: null,
  endReason: null,
};

const ELLIS_APPOINTMENT: AppointmentRow = {
  id: "appointment-1",
  householdId: "house-ellis",
  householdName: "Ellis",
  scheduledFor: "2027-01-10T02:30:00.000Z",
  status: "scheduled",
  visitLogId: null,
  madeByName: "Lena Ortiz",
  notes: null,
};

function renderWindow(appointments: AppointmentRow[] = []) {
  return render(
    <AssignWindow
      households={HOUSEHOLDS}
      members={MEMBERS}
      openAssignments={[ELLIS_HELD_BY_LENA]}
      appointments={appointments}
      onDone={vi.fn()}
    />,
  );
}

function tick(familyName: string) {
  fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(familyName) }));
}

describe("AssignWindow", () => {
  it("shows no explanation while only unassigned households are ticked", () => {
    renderWindow();
    tick("Garcia");

    expect(screen.queryByText(/gives .* to/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Unassign/ })).toBeNull();
  });

  it("says what Assign and Unassign each do for a held household", () => {
    renderWindow([ELLIS_APPOINTMENT]);
    tick("Ellis");

    const box = screen.getByText(/gives Ellis to 1st Counselor/).closest("div")!.parentElement!;
    expect(box.textContent).toContain("Assign gives Ellis to 1st Counselor.");
    expect(box.textContent).toContain("Ellis moves from 2nd Counselor, and their to-do closes.");
    expect(box.textContent).toContain("Ellis has a visit scheduled by Lena Ortiz. It stays on their appointments.");
    expect(box.textContent).toContain(
      "Unassign 1 household gives Ellis back to nobody, and 2nd Counselor's to-do closes.",
    );
  });

  it("says Unassign leaves a ticked household nobody holds as it is", () => {
    renderWindow();
    tick("Ellis");
    tick("Garcia");

    expect(screen.getByText(/gives Ellis and Garcia to 1st Counselor/)).toBeTruthy();
    expect(screen.getByText("Garcia isn't assigned to anyone, so Unassign leaves it as it is.")).toBeTruthy();
  });

  it("does not say a household moves when it is ticked for the person who already has it", () => {
    renderWindow();
    fireEvent.change(screen.getByLabelText("Who will visit"), { target: { value: "user-2" } });
    tick("Ellis");

    expect(screen.getByText(/gives Ellis to 2nd Counselor/)).toBeTruthy();
    expect(screen.queryByText(/moves from/)).toBeNull();
  });
});
