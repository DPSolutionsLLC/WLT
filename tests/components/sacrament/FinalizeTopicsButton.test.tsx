import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinalizeTopicsButton } from "@/components/sacrament/FinalizeTopicsButton";

// ITER-038 mc: finalizing topics answers with what happened to the music coordinator, and the
// control says it in one line. On the hub that line goes into a slot under the pill row, so it never
// squeezes the Topics pill (decided walking scenario 088); with no slot it stays beside the control.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function answer(music: { message: string | null; error: string | null }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ sunday: {}, music }), { status: 200 })),
  );
}

const press = () =>
  fireEvent.click(screen.getByRole("button", { name: "Topics are decided — Sunday, October 25" }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("FinalizeTopicsButton's result line", () => {
  it("renders into the slot when the page has one", async () => {
    answer({ message: "Told the music coordinator.", error: null });
    render(
      <div>
        <FinalizeTopicsButton
          sundayId="sunday-1"
          finalized={false}
          sundayLabel="Sunday, October 25"
          resultSlotId="slot-1"
        />
        <div id="slot-1" data-testid="slot" />
      </div>,
    );

    press();

    const line = await screen.findByRole("status");
    expect(line).toHaveTextContent("Told the music coordinator.");
    expect(screen.getByTestId("slot")).toContainElement(line);
  });

  it("stays beside the control when there is no slot", async () => {
    answer({ message: "Told the music coordinator.", error: null });
    render(
      <FinalizeTopicsButton
        sundayId="sunday-1"
        finalized={false}
        sundayLabel="Sunday, October 25"
        resultSlotId="missing-slot"
      />,
    );

    press();

    expect(await screen.findByRole("status")).toHaveTextContent("Told the music coordinator.");
  });

  it("shows a failed handoff as an alert", async () => {
    answer({ message: null, error: "Topics are finalized, but the music coordinator couldn't be told." });
    render(
      <FinalizeTopicsButton sundayId="sunday-1" finalized={false} sundayLabel="Sunday, October 25" />,
    );

    press();

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be told");
  });
});
