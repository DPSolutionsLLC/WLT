import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConductingLabel } from "@/components/calendar/ConductingLabel";

// Three states, and the distinction between the last two is the reason this component was
// changed at all:
//
//   a name        somebody is conducting, and the reader can act on that
//   "Not set"     the rotation reaches this Sunday and nobody is in the position — a GAP
//   "No meeting"  there is no meeting to conduct — not a gap, and nothing to fix
//
// Rendering "Not set" for the third case is indistinguishable from an unfilled rotation position,
// which is the ambiguity ITER-002 exists to remove.

const BISHOP_ID = "00000000-0000-4000-8000-000000000001";
const NAMES = { [BISHOP_ID]: "Mark Andersen" };

describe("ConductingLabel", () => {
  it("renders the conductor's name", () => {
    render(<ConductingLabel conductingUserId={BISHOP_ID} names={NAMES} holdsMeeting />);

    expect(screen.getByText("Mark Andersen")).toBeInTheDocument();
  });

  it("renders 'Not set' when the position is unfilled", () => {
    render(<ConductingLabel conductingUserId={null} names={NAMES} holdsMeeting />);

    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("renders 'No meeting' when the Sunday holds none", () => {
    render(
      <ConductingLabel conductingUserId={null} names={NAMES} holdsMeeting={false} />,
    );

    expect(screen.getByText("No meeting")).toBeInTheDocument();
    expect(screen.queryByText("Not set")).not.toBeInTheDocument();
  });

  // The id is ignored entirely rather than checked first. A Sunday with no meeting has no
  // conductor by construction (migration 027's CHECK); if a stale id survived anyway, naming
  // somebody who is not conducting would be worse than saying nothing.
  it("says 'No meeting' even when an id is somehow still stored", () => {
    render(<ConductingLabel conductingUserId={BISHOP_ID} names={NAMES} holdsMeeting={false} />);

    expect(screen.getByText("No meeting")).toBeInTheDocument();
    expect(screen.queryByText("Mark Andersen")).not.toBeInTheDocument();
  });

  // A uuid on screen tells a bishop nothing they could act on. The id belongs to a deactivated or
  // removed account, which the admin pages surface properly.
  it("never renders a raw uuid for an id it cannot name", () => {
    const strangerId = "00000000-0000-4000-8000-00000000dead";

    render(<ConductingLabel conductingUserId={strangerId} names={NAMES} holdsMeeting />);

    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.queryByText(strangerId)).not.toBeInTheDocument();
  });
});
