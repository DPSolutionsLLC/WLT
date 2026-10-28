import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteControlPanel } from "@/app/(app)/zoom/RemoteControlPanel";

// The reader's own stream remote (ITER-051). The component takes no link at all, so the URL can
// never reach the page's HTML; the button points at the redirect route instead.

afterEach(cleanup);

describe("RemoteControlPanel", () => {
  it("renders the Remote control link to the redirect, opening a new tab", () => {
    const { container } = render(<RemoteControlPanel state="live" />);
    const link = screen.getByRole("link", { name: /remote control/i });
    expect(link.getAttribute("href")).toBe("/api/zoom/remote-control");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(container.innerHTML).not.toContain("https://");
  });

  it("asks the bishopric when there is no link", () => {
    render(<RemoteControlPanel state="none" />);
    expect(screen.getByText("No remote link set — ask the bishopric.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says the calling has no remote", () => {
    render(<RemoteControlPanel state="no_position" />);
    expect(screen.getByText("Your calling has no stream remote.")).toBeTruthy();
  });

  it("says the link went away when the redirect came back empty", () => {
    render(<RemoteControlPanel state="none" linkWentAway />);
    expect(
      screen.getByText("That link is no longer set. Ask the bishopric for a new one."),
    ).toBeTruthy();
  });
});
