// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotPermitted } from "@/components/ui/NotPermitted";

// The second link was added for /visits/all-organizations (walking scenario 099): a leader refused
// there is sent to their own Visits page as well as the dashboard. Every other caller passes no
// link and must render exactly as before.

describe("NotPermitted", () => {
  it("offers only the dashboard when no other link is given", () => {
    render(<NotPermitted detail="Not for you." />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/dashboard");
  });

  it("offers the given link beside the dashboard", () => {
    render(
      <NotPermitted
        detail="Not for you."
        alternativeLink={{ href: "/visits", label: "Your Visits page" }}
      />,
    );

    expect(screen.getByRole("link", { name: "Your Visits page" })).toHaveAttribute(
      "href",
      "/visits",
    );
    expect(screen.getByRole("link", { name: "Back to the dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
