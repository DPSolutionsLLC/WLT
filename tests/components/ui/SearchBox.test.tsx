// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchBox } from "@/components/ui/SearchBox";

// The clear button only existing when there is something to clear is the assertion worth having:
// a permanently visible × on an empty box is a control that does nothing, and it takes a tab stop
// to say so.
//
// min-w-0 on the input is asserted too. It looks like decoration and it is not — a flex item's
// default `min-width: auto` refuses to shrink below its content, and an input carries an
// intrinsic width, so this row overflows at 375px without it
// (plans/retros/youth-g-occasions-and-event-detail.md). A jsdom test cannot measure the overflow,
// but it can pin the class that prevents it.

function renderBox(value: string, onValueChange = vi.fn()) {
  render(
    <SearchBox id="roster-search" label="Search the roster" value={value} onValueChange={onValueChange} />,
  );
  return onValueChange;
}

describe("SearchBox", () => {
  it("gives the input an accessible name even once something is typed into it", () => {
    renderBox("");

    expect(screen.getByRole("searchbox", { name: "Search the roster" })).toBeInTheDocument();
  });

  it("renders NO clear button when the box is empty", () => {
    renderBox("");

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a named clear button once there is a value", () => {
    renderBox("brooks");

    expect(
      screen.getByRole("button", { name: "Clear Search the roster" }),
    ).toBeInTheDocument();
  });

  it("clears the value through the parent when the clear button is pressed", () => {
    const onValueChange = renderBox("brooks");

    fireEvent.click(screen.getByRole("button", { name: "Clear Search the roster" }));

    expect(onValueChange).toHaveBeenCalledWith("");
  });

  it("also calls onClear when one is given", () => {
    const onClear = vi.fn();
    render(
      <SearchBox
        id="s"
        label="Search"
        value="brooks"
        onValueChange={vi.fn()}
        onClear={onClear}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear Search" }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("reports what was typed to the parent", () => {
    const onValueChange = renderBox("");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "kim" } });

    expect(onValueChange).toHaveBeenCalledWith("kim");
  });

  // THE 375px TRAP, pinned as a class because jsdom cannot measure it.
  it("lets the input shrink inside its flex row", () => {
    renderBox("");

    expect(screen.getByRole("searchbox")).toHaveClass("min-w-0");
  });

  // iOS zooms the whole page when a focused input's font is under 16px, and 44px is the tap
  // target this mobile-first app holds everywhere.
  it("keeps the tap target and the non-zooming font size", () => {
    renderBox("");

    expect(screen.getByRole("searchbox")).toHaveClass("text-base");
    expect(screen.getByRole("searchbox").parentElement).toHaveClass("min-h-11");
  });
});
