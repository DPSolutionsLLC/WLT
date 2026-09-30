import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SpeakerCountStepper,
  type SpeakerCountStepperProps,
} from "@/components/sacrament/SpeakerCountStepper";

// "SPEAKERS THIS WEEK" (Topics rebuild t3). − stops at a slot with a speaker in it, with the
// prototype's hint; the count stays within 1–6; Save waits for a change; a save that would cancel
// work goes through the server's warn-then-confirm protocol; and only somebody who may change the
// ward's settings is offered to make a new count the default.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function renderStepper(overrides: Partial<SpeakerCountStepperProps> = {}) {
  return render(
    <SpeakerCountStepper
      sundayId="sunday-1"
      count={3}
      wardDefault={3}
      slotHasSpeaker={[true, false, false]}
      canSetDefault={true}
      {...overrides}
    />,
  );
}

const lower = () => screen.getByRole("button", { name: "One fewer speaker" });
const raise = () => screen.getByRole("button", { name: "One more speaker" });
const save = () => screen.getByRole("button", { name: "Save" });

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("SpeakerCountStepper", () => {
  it("names the ward default", () => {
    renderStepper();
    expect(screen.getByText("Speakers this week (default)")).toBeInTheDocument();
  });

  it("stops − at a slot with a speaker in it, and says why", () => {
    renderStepper({ slotHasSpeaker: [true, true, true] });

    expect(lower()).toBeDisabled();
    expect(screen.getByText("Clear one speaker slot to go lower.")).toBeInTheDocument();
  });

  it("lowers past an empty last slot", () => {
    renderStepper({ slotHasSpeaker: [true, false, false] });

    fireEvent.click(lower());
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("Clear one speaker slot to go lower.")).not.toBeInTheDocument();

    // Slot 1 has a speaker, so it stops there.
    fireEvent.click(lower());
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(lower()).toBeDisabled();
  });

  it("never goes below one", () => {
    renderStepper({ count: 1, slotHasSpeaker: [false] });
    expect(lower()).toBeDisabled();
  });

  it("never goes above six", () => {
    renderStepper({ count: 6, slotHasSpeaker: [false, false, false, false, false, false] });
    expect(raise()).toBeDisabled();
  });

  it("keeps Save disabled until the count changes", () => {
    renderStepper();
    expect(save()).toBeDisabled();

    fireEvent.click(raise());
    expect(save()).toBeEnabled();
  });

  it("shows the server's warning and resends only when the change is applied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "x", warning: { message: "Talk 3 will be cancelled." } }),
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderStepper({ slotHasSpeaker: [false, false, false] });

    fireEvent.click(lower());
    fireEvent.click(save());
    expect(await screen.findByText("Talk 3 will be cancelled.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sundays/sunday-1");

    fireEvent.click(screen.getByRole("button", { name: "Apply the change" }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[1][0]).toBe("/api/sundays/sunday-1?confirm=true");
  });

  it("offers to make a new count the default, to somebody who may", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    renderStepper();

    fireEvent.click(raise());
    fireEvent.click(save());

    expect(
      await screen.findByText("Make 4 the default for Sundays added from now on?"),
    ).toBeInTheDocument();
  });

  it("does not offer the default to somebody who may not change it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    renderStepper({ canSetDefault: false });

    fireEvent.click(raise());
    fireEvent.click(save());

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText(/the default for Sundays/)).not.toBeInTheDocument();
  });

  it("does not offer the default when the new count already is the default", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    renderStepper({ count: 2, wardDefault: 3, slotHasSpeaker: [false, false] });

    fireEvent.click(raise());
    fireEvent.click(save());

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByText(/the default for Sundays/)).not.toBeInTheDocument();
  });

  // Defect 083-D1: after a Delete the page brought a new count and the stepper kept its old one,
  // with Save lit — pressing it would have put the removed slot back.
  it("follows a new count from the page", () => {
    const { rerender } = renderStepper({ count: 4, slotHasSpeaker: [true, false, false, false] });
    expect(screen.getByText("4")).toBeInTheDocument();

    rerender(
      <SpeakerCountStepper
        sundayId="sunday-1"
        count={3}
        wardDefault={3}
        slotHasSpeaker={[true, false, false]}
        canSetDefault={true}
      />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("keeps the default offer through the refresh its own save causes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    const { rerender } = renderStepper();

    fireEvent.click(raise());
    fireEvent.click(save());
    await screen.findByText("Make 4 the default for Sundays added from now on?");

    rerender(
      <SpeakerCountStepper
        sundayId="sunday-1"
        count={4}
        wardDefault={3}
        slotHasSpeaker={[true, false, false, false]}
        canSetDefault={true}
      />,
    );

    expect(screen.getByText("Make 4 the default for Sundays added from now on?")).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });
});
