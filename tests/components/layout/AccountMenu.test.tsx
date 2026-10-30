// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/layout/AccountMenu";
import type { SessionUser } from "@/types/domain";

// ITER-041. The chrome bar's "Admin view" pill has no room at phone width, so the account menu
// carries the same notice — for a super admin in a ward with a released-modules list, and nobody
// else.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const USER: SessionUser = {
  id: "00000000-0000-4000-8000-0000000000aa",
  wardId: "00000000-0000-4000-8000-000000000001",
  homeWardId: "00000000-0000-4000-8000-000000000001",
  activeWardId: null,
  callingId: "00000000-0000-4000-8000-00000000ca11",
  role: "counselor",
  orgId: null,
  orgType: null,
  counselorPosition: 1,
  firstName: "Dana",
  lastName: "Whitmore",
  username: null,
  themePreference: "system",
  isActive: true,
  releasedModules: null,
  isSuperAdmin: false,
};

// jsdom has no <dialog>. The same minimal shim as QuickLinksButton.test.tsx, for its reason: this
// menu has no life outside its modal, and what the native dialog does is the harness's job.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

function openMenu(user: SessionUser) {
  render(<AccountMenu user={user} callingLabel="Counselor" wardName="Buffalo Ward" />);
  fireEvent.click(screen.getByRole("button", { name: "Your account" }));
}

beforeEach(() => {
  // The ward switcher inside the menu loads its list; one calling means an empty list.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ wards: [] }) } as Response),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ITER-047 D1: moved, not copied. One theme control, on the chrome bar.
describe("AccountMenu", () => {
  it("no longer carries a theme control", () => {
    openMenu(USER);
    expect(screen.queryByRole("button", { name: /Change theme/ })).toBeNull();
    expect(screen.queryByText("Appearance")).toBeNull();
  });
});

describe("AccountMenu admin view notice", () => {
  it("tells a super admin in a narrowed ward that they see more than its leaders do", () => {
    openMenu({ ...USER, isSuperAdmin: true, releasedModules: ["tithing"] });
    expect(screen.getByText(/You see modules\s+this ward has not released\./)).toBeInTheDocument();
  });

  it("says nothing to a super admin in a ward with no list", () => {
    openMenu({ ...USER, isSuperAdmin: true, releasedModules: null });
    expect(screen.queryByText(/this ward has not released/)).toBeNull();
  });

  it("says nothing to anybody else", () => {
    openMenu({ ...USER, isSuperAdmin: false, releasedModules: ["tithing"] });
    expect(screen.queryByText(/this ward has not released/)).toBeNull();
  });
});
