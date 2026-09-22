// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WardSwitcher } from "@/components/layout/WardSwitcher";

// THE HEADLINE ASSERTION IS THE EMPTY ONE. listSwitchableWards() returns [] for somebody holding
// ONE calling, which is very nearly everybody — "anyone who belongs to one ward never sees the
// unit layer at all" is a stated requirement (CLAUDE.md §7). A control that rendered an empty
// dropdown, or a dropdown with one option in it, would put the multi-ward machinery in front of
// every ordinary leader in the app.
//
// The refusal sentence is the ROUTE's, surfaced verbatim. A second wording invented here would be
// a second answer to "why was I refused", and the route's is the one that names the real rule:
// you reach a second ward by holding a calling there.

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
}));

const WARD_A = { wardId: "00000000-0000-4000-8000-00000000000a", name: "Maple Ward" };
const WARD_B = { wardId: "00000000-0000-4000-8000-00000000000b", name: "Cedar Ward" };

function mockFetch(handlers: {
  get: () => { ok: boolean; body: unknown };
  patch?: () => { ok: boolean; body: unknown };
}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const result = init?.method === "PATCH" ? handlers.patch?.() : handlers.get();
      if (!result) throw new Error("unexpected request");

      return {
        ok: result.ok,
        json: async () => result.body,
      } as Response;
    }),
  );
}

beforeEach(() => {
  refreshMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WardSwitcher", () => {
  it("renders nothing at all when the list is empty", async () => {
    mockFetch({ get: () => ({ ok: true, body: { wards: [], activeWardId: null } }) });

    const { container } = render(<WardSwitcher />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("offers every ward the route returned", async () => {
    mockFetch({
      get: () => ({
        ok: true,
        body: { wards: [WARD_A, WARD_B], activeWardId: WARD_A.wardId },
      }),
    });

    render(<WardSwitcher />);

    expect(await screen.findByRole("button", { name: /Cedar Ward/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Maple Ward/ })).toBeInTheDocument();
  });

  it("marks the ward being acted in, and does not offer a switch to it", async () => {
    mockFetch({
      get: () => ({
        ok: true,
        body: { wards: [WARD_A, WARD_B], activeWardId: WARD_A.wardId },
      }),
    });

    render(<WardSwitcher />);

    const current = await screen.findByRole("button", { name: /Maple Ward/ });
    expect(current).toBeDisabled();
    expect(screen.getByRole("button", { name: /Cedar Ward/ })).toBeEnabled();
  });

  it("refreshes the tree after a switch, so the frame cannot name the wrong ward", async () => {
    mockFetch({
      get: () => ({
        ok: true,
        body: { wards: [WARD_A, WARD_B], activeWardId: WARD_A.wardId },
      }),
      patch: () => ({ ok: true, body: { wardId: WARD_B.wardId } }),
    });

    render(<WardSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /Cedar Ward/ }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces the route's own refusal sentence", async () => {
    const refused =
      "You do not hold a calling in that ward, so you cannot act in it. Choose one from the list.";

    mockFetch({
      get: () => ({
        ok: true,
        body: { wards: [WARD_A, WARD_B], activeWardId: WARD_A.wardId },
      }),
      patch: () => ({ ok: false, body: { error: refused } }),
    });

    render(<WardSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /Cedar Ward/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(refused);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not swallow a failure to load the list", async () => {
    mockFetch({
      get: () => ({ ok: false, body: { error: "Could not load the wards you may act in." } }),
    });

    render(<WardSwitcher />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load the wards you may act in.",
    );
  });
});
