// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusTag } from "@/components/ui/StatusTag";

// The icon being aria-hidden is the assertion worth having here. The words carry the meaning, so
// a screen reader announcing a glyph's name before the label reads the same fact twice — or reads
// "black star" where the label says "Overdue".

describe("StatusTag", () => {
  it("renders its children", () => {
    render(<StatusTag>Awaiting reply</StatusTag>);

    expect(screen.getByText("Awaiting reply")).toBeInTheDocument();
  });

  it("hides the icon from assistive technology", () => {
    const { container } = render(<StatusTag icon={<span>★</span>}>Pinned</StatusTag>);

    const hidden = container.querySelector('[aria-hidden="true"]');

    expect(hidden).not.toBeNull();
    expect(hidden?.textContent).toBe("★");
  });

  it("renders no icon wrapper when no icon is given", () => {
    const { container } = render(<StatusTag>Pinned</StatusTag>);

    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("still keeps the label readable when an icon is present", () => {
    render(<StatusTag icon={<span aria-label="ignored">★</span>}>Pinned</StatusTag>);

    expect(screen.getByText("Pinned")).toBeInTheDocument();
  });

  it("inherits Pill's shape and tone rather than forking its own", () => {
    const { container } = render(<StatusTag tone="ok">Done</StatusTag>);

    const tag = container.firstElementChild as HTMLElement;

    expect(tag).toHaveClass("rounded-full", "border", "border-success", "text-success");
  });

  it("passes toneClassName through to Pill verbatim", () => {
    const { container } = render(
      <StatusTag toneClassName="border-stage-notify text-stage-notify">Notify</StatusTag>,
    );

    expect(container.firstElementChild).toHaveClass(
      "border-stage-notify",
      "text-stage-notify",
    );
  });
});
