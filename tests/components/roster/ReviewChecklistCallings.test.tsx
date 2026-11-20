import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewChecklist } from "@/app/(app)/roster/import/ReviewChecklist";
import type { RosterReview } from "@/lib/roster/paste/buildRosterDiff";
import type { PasteCallingReview, PasteCallingRow } from "@/lib/roster/paste/callingRows";

// The Callings groups on the roster paste checklist (ITER-058 cr3).

function callingRow(overrides: Partial<PasteCallingRow>): PasteCallingRow {
  return {
    id: "calling:c1:x",
    sentence: "Aaron Pike: from 1st Counselor to 2nd Counselor.",
    details: [],
    isRelease: false,
    canApply: true,
    refusal: null,
    moveOutId: null,
    releasedCallingLabel: null,
    ...overrides,
  };
}

function reviewWith(
  callingChanges: PasteCallingReview,
  movedOut: RosterReview["movedOut"] = [],
): RosterReview {
  return {
    newPeople: [],
    changedPeople: [],
    householdAddresses: [],
    movedOut,
    callingChanges,
    silentUpdateCount: 0,
    unchangedCount: 0,
    newHouseholdCount: 0,
    guard: { movedOutCount: 0, activeCount: 0, suspicious: false },
  };
}

function renderChecklist(
  callingChanges: PasteCallingReview,
  onChange = vi.fn(),
  movedOut: RosterReview["movedOut"] = [],
) {
  render(
    <ReviewChecklist
      review={reviewWith(callingChanges, movedOut)}
      selectedIds={new Set()}
      onChange={onChange}
      moveOutTickAllLocked={false}
      disabled={false}
    />,
  );
  return onChange;
}

function groupTitled(title: string): HTMLElement {
  const group = screen.getByText(title).closest("details");
  if (!group) throw new Error(`No group titled ${title}`);
  return group;
}

describe("ReviewChecklist calling groups", () => {
  afterEach(cleanup);

  it("starts a calling change unticked and lets it be ticked", () => {
    const onChange = renderChecklist({ rows: [callingRow({})], reviewedByBishopric: false });

    const box = screen.getByRole("checkbox", { name: /from 1st Counselor to 2nd Counselor/ });
    expect(box).not.toBeChecked();

    fireEvent.click(box);
    expect([...onChange.mock.calls[0][0]]).toEqual(["calling:c1:x"]);
  });

  it("keeps Tick all off for releases of people still on the list", () => {
    renderChecklist({
      rows: [
        callingRow({
          id: "release:c2",
          sentence: "Ruth Kim holds no calling the app recognises. Release their Ward Secretary calling?",
          isRelease: true,
          releasedCallingLabel: "Ward Secretary",
        }),
      ],
      reviewedByBishopric: false,
    });

    const group = groupTitled("Calling releases");
    expect(within(group).getByRole("button", { name: "Tick all" })).toBeDisabled();
  });

  it("puts the release of somebody this paste leaves off inside their move-out, one checkbox", () => {
    renderChecklist(
      {
        rows: [
          callingRow({
            id: "release:c2",
            sentence: "Ruth Kim is no longer on the ward list. Release their Ward Secretary calling?",
            isRelease: true,
            moveOutId: "moveout:m2",
            releasedCallingLabel: "Ward Secretary",
          }),
        ],
        reviewedByBishopric: false,
      },
      vi.fn(),
      [{ id: "moveout:m2", name: "Ruth Kim", householdName: "Kim" }],
    );

    expect(screen.queryByText("Calling releases")).not.toBeInTheDocument();
    const group = groupTitled("No longer listed");
    expect(within(group).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(group).getByText("and ends their Ward Secretary calling")).toBeInTheDocument();
  });

  it("offers Tick all on calling changes", () => {
    renderChecklist({ rows: [callingRow({})], reviewedByBishopric: false });

    const group = groupTitled("Calling changes");
    expect(within(group).getByRole("button", { name: "Tick all" })).toBeEnabled();
  });

  it("gives a row that cannot be applied a reason and no checkbox", () => {
    renderChecklist({
      rows: [callingRow({ canApply: false, refusal: "This is your own calling." })],
      reviewedByBishopric: false,
    });

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("This is your own calling.")).toBeInTheDocument();
  });

  it("tells an importer outside the bishopric where the changes are reviewed, with no checkbox", () => {
    renderChecklist({ rows: [], reviewedByBishopric: true });

    expect(
      screen.getByText("Calling changes are reviewed by the bishopric on Admin → Users."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows nothing about callings when there are none", () => {
    renderChecklist({ rows: [], reviewedByBishopric: false });

    expect(screen.queryByText(/calling/i)).not.toBeInTheDocument();
  });
});
