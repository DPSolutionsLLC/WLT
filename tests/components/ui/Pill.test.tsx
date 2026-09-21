// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Pill } from "@/components/ui/Pill";

// THE ASSERTION THIS FILE EXISTS FOR IS THE `toneClassName` PASSTHROUGH.
//
// Ten badges migrated onto this primitive in P1, and nine of them carry palettes of their own —
// nine measured pipeline-stage tokens, six coverage tones, four visit bands. Every one reaches
// the DOM through `toneClassName`. If this component ever grew a filter, a normaliser or a
// tone-name lookup over what it is handed, all nine would silently render unstyled: Tailwind
// emits no CSS for a class string it cannot find in the source, and nothing anywhere throws.
//
// Colour token VALUES are not asserted — a hex is not a behaviour, and the contrast numbers live
// in app/globals.css where they were measured. What is asserted is that the class strings
// survive the journey, because that is the part code can get wrong.

describe("Pill", () => {
  it("renders its children", () => {
    render(<Pill>Overdue</Pill>);

    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("emits the shared shape classes on every pill", () => {
    render(<Pill>Draft</Pill>);

    const pill = screen.getByText("Draft");

    expect(pill).toHaveClass("inline-flex", "items-center", "rounded-full", "border");
  });

  it.each([
    ["ok", ["border-success", "text-success"]],
    ["pending", ["border-warning", "text-warning"]],
    ["missing", ["border-danger", "text-danger", "font-semibold"]],
    ["neutral", ["border-border", "text-muted"]],
  ] as const)("gives the %s tone its own static classes", (tone, expected) => {
    render(<Pill tone={tone}>Label</Pill>);

    expect(screen.getByText("Label")).toHaveClass(...expected);
  });

  // THE ONE THAT PROTECTS THE NINE STAGE TOKENS. A caller's own measured palette must arrive at
  // the DOM byte for byte.
  it("passes toneClassName through verbatim and filters nothing", () => {
    render(<Pill toneClassName="text-stage-appreciate border-stage-appreciate">Thank</Pill>);

    const pill = screen.getByText("Thank");

    expect(pill).toHaveClass("text-stage-appreciate", "border-stage-appreciate");
  });

  // A DEFINED PRECEDENCE RATHER THAN A THROW. A runtime throw in a presentational component turns
  // a styling slip into a blank page.
  it("lets toneClassName win over tone when both are given", () => {
    render(
      <Pill tone="ok" toneClassName="border-stage-plan text-stage-plan">
        Planned
      </Pill>,
    );

    const pill = screen.getByText("Planned");

    expect(pill).toHaveClass("border-stage-plan", "text-stage-plan");
    expect(pill).not.toHaveClass("border-success");
    expect(pill).not.toHaveClass("text-success");
  });

  it("appends className without dropping the shape or the tone", () => {
    render(
      <Pill tone="missing" className="relative overflow-hidden">
        Nobody going
      </Pill>,
    );

    const pill = screen.getByText("Nobody going");

    expect(pill).toHaveClass("rounded-full", "border-danger", "relative", "overflow-hidden");
  });

  it("carries a title when one is given, and none when it is not", () => {
    const { rerender } = render(<Pill title="Due 3 March">Overdue</Pill>);

    expect(screen.getByText("Overdue")).toHaveAttribute("title", "Due 3 March");

    rerender(<Pill>Overdue</Pill>);

    expect(screen.getByText("Overdue")).not.toHaveAttribute("title");
  });

  // COLOUR IS NEVER THE ONLY SIGNAL: Pill adds no dot, glyph or marker of its own. Whatever the
  // caller passed is the whole of what is rendered.
  it("adds no colour-only affordance of its own", () => {
    render(<Pill tone="missing">Overdue</Pill>);

    expect(screen.getByText("Overdue").textContent).toBe("Overdue");
  });
});
