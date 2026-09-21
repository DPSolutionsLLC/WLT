// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Chip } from "@/components/ui/Chip";

// THE ACCESSIBLE NAME IS THE POINT. A filter row holds eight of these, and eight buttons all
// announcing "button" — or worse, "times" — give a screen-reader user no way to tell which one
// removes the Relief Society. A bare × glyph on a span is also unreachable by keyboard entirely.

describe("Chip", () => {
  it("renders its children", () => {
    render(<Chip>Relief Society</Chip>);

    expect(screen.getByText("Relief Society")).toBeInTheDocument();
  });

  it("renders NO button when onRemove is not given", () => {
    render(<Chip>Relief Society</Chip>);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the remove button after the thing it removes", () => {
    render(<Chip onRemove={vi.fn()}>Relief Society</Chip>);

    expect(
      screen.getByRole("button", { name: "Remove Relief Society" }),
    ).toBeInTheDocument();
  });

  it("calls onRemove exactly once per click", () => {
    const onRemove = vi.fn();
    render(<Chip onRemove={onRemove}>Elders Quorum</Chip>);

    fireEvent.click(screen.getByRole("button", { name: "Remove Elders Quorum" }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  // A ReactNode has no reliable text form, so a caller passing rich children must name it.
  it("uses removeLabel for the accessible name when children are not a string", () => {
    render(
      <Chip onRemove={vi.fn()} removeLabel="Ethan Brooks">
        <strong>Ethan Brooks</strong>
      </Chip>,
    );

    expect(screen.getByRole("button", { name: "Remove Ethan Brooks" })).toBeInTheDocument();
  });

  it("hides the × glyph from assistive technology", () => {
    render(<Chip onRemove={vi.fn()}>Sunday School</Chip>);

    const button = screen.getByRole("button", { name: "Remove Sunday School" });

    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe("×");
  });

  // type="button" matters: a chip inside a filter form must not submit it.
  it("never submits a surrounding form", () => {
    render(<Chip onRemove={vi.fn()}>Young Women</Chip>);

    expect(screen.getByRole("button", { name: "Remove Young Women" })).toHaveAttribute(
      "type",
      "button",
    );
  });
});
