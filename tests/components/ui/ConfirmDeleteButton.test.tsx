// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";

// THE SELF-CLEAR IS THE ASSERTION NO WALK WOULD EVER CATCH. A button left reading "Confirm?" is a
// trap: the next person to touch that row deletes something while believing they are opening it.
// Nobody waits four seconds in front of a screenshot to find that out, so it is pinned here.
//
// This is an AFFORDANCE, not a security boundary (youth-h). The server refusal is the gate; this
// stops a misplaced thumb. Nothing in this file should ever be read as testing protection.

afterEach(() => {
  vi.useRealTimers();
});

describe("ConfirmDeleteButton", () => {
  it("does NOT delete on the first click, and says so in the label", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDeleteButton onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm?" })).toBeInTheDocument();
  });

  it("deletes exactly once on the second click", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDeleteButton onConfirm={onConfirm} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("returns to its resting label after confirming, so the row cannot be armed by accident", () => {
    render(<ConfirmDeleteButton onConfirm={vi.fn()} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  // THE HEADLINE ASSERTION.
  it("disarms itself after the timeout, leaving no armed button behind", () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<ConfirmDeleteButton onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("button", { name: "Confirm?" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("stays armed until the timeout actually elapses", () => {
    vi.useFakeTimers();
    render(<ConfirmDeleteButton onConfirm={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByRole("button", { name: "Confirm?" })).toBeInTheDocument();
  });

  // A row removed mid-arm must not fire its timer against a component that is gone.
  it("clears its timer on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ConfirmDeleteButton onConfirm={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(4000);
      });
    }).not.toThrow();
  });

  it("blocks both clicks when disabled", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDeleteButton onConfirm={onConfirm} disabled />);

    const button = screen.getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  it("honours custom labels", () => {
    render(
      <ConfirmDeleteButton
        onConfirm={vi.fn()}
        label="Delete the season"
        confirmLabel="Really delete it?"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete the season" }));

    expect(screen.getByRole("button", { name: "Really delete it?" })).toBeInTheDocument();
  });

  // The arming must be ANNOUNCED, not merely seen — a word swap on screen does not exist at all
  // for a screen-reader user, and they are exactly who most needs to know the meaning changed.
  it("announces the label change through a live region", () => {
    render(<ConfirmDeleteButton onConfirm={vi.fn()} />);

    expect(screen.getByRole("button").querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
