// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChromeBar } from "@/components/layout/ChromeBar";
import type { SessionUser } from "@/types/domain";

// ---------------------------------------------------------------------------
// THE BACK LINK IS /dashboard FROM EVERY PATHNAME. THAT IS THIS FILE'S REASON TO EXIST.
// ---------------------------------------------------------------------------
// The prototype made this link dynamic — one step of history, overwritten on every navigation —
// and after a couple of hops it ping-ponged between the last two pages and permanently lost the
// path home. Build note §dashboard-back-link-regression-fix calls it a real design flaw rather
// than an edge case, and the phase file names it as the regression most likely to be
// reintroduced. Somebody "improving" this link is the failure this test is here to catch, so it
// asserts from deep, unrelated pathnames rather than from one.

const { pathnameMock } = vi.hoisted(() => ({ pathnameMock: vi.fn<() => string>() }));

vi.mock("next/navigation", () => ({
  usePathname: pathnameMock,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const USER: SessionUser = {
  id: "00000000-0000-4000-8000-0000000000aa",
  wardId: "00000000-0000-4000-8000-000000000001",
  homeWardId: "00000000-0000-4000-8000-000000000001",
  activeWardId: null,
  callingId: "00000000-0000-4000-8000-00000000ca11",
  role: "bishop",
  orgId: null,
  orgType: null,
  counselorPosition: null,
  firstName: "Ada",
  lastName: "Young",
  username: null,
  themePreference: "system",
  isActive: true,
};

function renderAt(pathname: string) {
  pathnameMock.mockReturnValue(pathname);

  return render(<ChromeBar title="Maple Ward" user={USER} callingLabel="Bishop" />);
}

beforeEach(() => {
  pathnameMock.mockReset();
});

describe("ChromeBar back link", () => {
  const DEEP_PATHS = [
    "/visits",
    "/youth/events/abc",
    "/admin/users",
    "/program/xyz",
    "/roster/household/1234/edit",
  ];

  for (const pathname of DEEP_PATHS) {
    it(`points at /dashboard from ${pathname}`, () => {
      renderAt(pathname);

      expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute(
        "href",
        "/dashboard",
      );
    });
  }

  it("points at /dashboard from every one of them in one session", () => {
    // Rendered in turn without remounting the module, which is the shape the prototype's bug
    // needed: a stored "previous page" survives across navigations and is what starts cycling.
    for (const pathname of DEEP_PATHS) {
      const { unmount } = renderAt(pathname);

      expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute(
        "href",
        "/dashboard",
      );

      unmount();
    }
  });
});

describe("ChromeBar", () => {
  // ---------------------------------------------------------------------------
  // ⚠️ THIS ASSERTION REPLACED ONE THAT PINNED A BUG
  // ---------------------------------------------------------------------------
  // It used to read `expect(container).toBeEmptyDOMElement()` — the bar returned null on
  // /dashboard, and this test asserted that and passed. Walking scenario 069 showed what it was
  // protecting: the page sign-in lands on had no Sign out, no theme toggle, no notification bell,
  // no Report an issue and no Help, because returning null took the whole icon row with it. 3795
  // tests were green over it.
  //
  // Changed on the user's instruction, 2026-09-22: "I would like that bar to be present at all
  // times." Only the BACK LINK is conditional now, which is what the original reasoning was
  // actually about — a "← Dashboard" link on the dashboard is a control that does nothing.
  it("still renders on the dashboard, carrying its controls", () => {
    renderAt("/dashboard");

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report an issue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("omits only the back link on the dashboard", () => {
    renderAt("/dashboard");

    expect(screen.queryByRole("link", { name: /Dashboard/ })).toBeNull();
  });

  it("names the ward being acted in", () => {
    renderAt("/visits");

    expect(screen.getByText("Maple Ward")).toBeInTheDocument();
  });

  it("carries the notification bell and the account menu", () => {
    renderAt("/visits");

    expect(screen.getByRole("button", { name: "Your account" })).toBeInTheDocument();
  });
});
