// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ScheduleVisitWindow, bookedConfirmation } from "@/app/(app)/visits/ScheduleVisitWindow";
import type { SessionUser } from "@/types/domain";

// The booking window (ITER-055 bv6). It stays open on its confirmation after a booking — defect
// 102-D1, where it closed the moment the save succeeded and the sentence saying whether the
// invites went out was never seen.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LENA: SessionUser = {
  id: "00000000-0000-4000-8000-000000000002",
  wardId: "00000000-0000-4000-8000-0000000000aa",
  homeWardId: "00000000-0000-4000-8000-0000000000aa",
  activeWardId: null,
  callingId: "00000000-0000-4000-8000-00000000ca11",
  role: "counselor",
  orgId: null,
  orgType: null,
  counselorPosition: 2,
  firstName: "Lena",
  lastName: "Ortiz",
  username: null,
  themePreference: "system",
  isActive: true,
  releasedModules: null,
  isSuperAdmin: false,
};

function renderWindow() {
  const onClose = vi.fn();
  const onBooked = vi.fn();
  render(
    <ScheduleVisitWindow
      isOpen
      onClose={onClose}
      onBooked={onBooked}
      title="Book this visit"
      households={[{ id: "house-ellis", label: "The Ellis family" }]}
      initialHouseholdId="house-ellis"
      assignmentId="assignment-1"
      wardTimeZone="America/Denver"
      user={LENA}
      leaders={[
        { id: "user-aaron", label: "Aaron Pike" },
        { id: "user-tom", label: "Tom Reyes" },
      ]}
      memberNames={{}}
    />,
  );
  return { onClose, onBooked };
}

function fillAndBook() {
  fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-11-20" } });
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "19:30" } });
  const leaderSelect = screen.getByLabelText("Add a leader");
  fireEvent.change(leaderSelect, { target: { value: "user-aaron" } });
  fireEvent.change(screen.getByLabelText("Add a leader"), { target: { value: "user-tom" } });
  fireEvent.click(screen.getByRole("button", { name: "Book visit" }));
}

describe("bookedConfirmation", () => {
  it("says how many invites went out", () => {
    expect(bookedConfirmation(0)).toBe("Visit booked.");
    expect(bookedConfirmation(1)).toBe("Visit booked. The invite has been sent.");
    expect(bookedConfirmation(2)).toBe("Visit booked. 2 invites have been sent.");
  });
});

describe("ScheduleVisitWindow", () => {
  it("stays open on the confirmation after a booking, and Done closes it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 201 })));
    const { onClose, onBooked } = renderWindow();

    fillAndBook();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Visit booked. 2 invites have been sent.",
    );
    expect(onBooked).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Book visit" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the form and shows the server's sentence when the booking is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Pick a time on or after today." }), { status: 400 }),
      ),
    );
    const { onClose, onBooked } = renderWindow();

    fillAndBook();

    await waitFor(() => expect(screen.getByText("Pick a time on or after today.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Book visit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(onBooked).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
