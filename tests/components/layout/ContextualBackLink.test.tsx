// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextualBackLink } from "@/components/layout/ContextualBackLink";

// ---------------------------------------------------------------------------
// TWO RULES, AND BOTH HAVE ALREADY BEEN GOT WRONG ONCE
// ---------------------------------------------------------------------------
// 1. `from` IS ATTACKER-SUPPLIED. It is a URL parameter, so it must never be rendered or
//    navigated to as free text. It selects an allowlisted origin or it selects nothing.
// 2. NO ORIGIN MEANS NO LINK. The component first shipped falling back to "Back to Dashboard",
//    copying the prototype — and because WLT's chrome bar already carries an unconditional
//    "← Dashboard" on every page, a page reached from the navigation rendered two stacked back
//    links to the same place. Found by walking scenario 072; changed on the user's decision.
//
// A component test rather than a route test, because both rules are about what is RENDERED.

describe("ContextualBackLink", () => {
  it("names the origin it was given", () => {
    render(<ContextualBackLink from="sacrament" />);

    const link = screen.getByRole("link", { name: /Back to Sacrament Calendar/ });
    expect(link).toHaveAttribute("href", "/sacrament");
  });

  it("renders nothing when no origin is given", () => {
    const { container } = render(<ContextualBackLink from={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an origin it does not know", () => {
    const { container } = render(<ContextualBackLink from="somewhere-else" />);

    expect(container).toBeEmptyDOMElement();
  });

  // THE NEGATIVE THAT MATTERS: never a fallback link. This is the assertion that fails if
  // somebody restores the "Back to Dashboard" default, which is the thing the user removed.
  it("never falls back to a dashboard link", () => {
    for (const from of [undefined, "", "dashboard", "unknown"]) {
      const { container } = render(<ContextualBackLink from={from} />);
      expect(container.querySelector("a"), `"${String(from)}" rendered a link`).toBeNull();
    }
  });

  // An attacker-supplied value must not reach `href`, and must not reach the page as text either.
  it("never renders or navigates to the raw parameter", () => {
    const hostile = "https://evil.example.com";
    const { container } = render(<ContextualBackLink from={hostile} />);

    expect(container).toBeEmptyDOMElement();
    expect(container.textContent).not.toContain("evil.example.com");
  });

  // `?from=toString` returns a TRUTHY value from a plain object literal —
  // Object.prototype.toString — and the link would then render with href={undefined}. The
  // component uses a Map, which has no inherited keys, so the trap cannot exist. Pinned here so
  // that a later "simplification" back to an object literal fails rather than ships.
  it("is not fooled by an inherited object property", () => {
    for (const from of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      const { container } = render(<ContextualBackLink from={from} />);
      expect(container.querySelector("a"), `"${from}" rendered a link`).toBeNull();
    }
  });
});
