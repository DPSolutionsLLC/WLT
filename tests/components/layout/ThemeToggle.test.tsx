// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

// ITER-047. The toggle moved onto the chrome bar as an icon button. What must not change: the
// cycle, the instant local apply, the localStorage key the pre-paint script reads, and the save
// to users.theme_preference — local first, so a failed save never undoes the user's choice.

const USER_ID = "00000000-0000-4000-8000-0000000000aa";

const { updateMock, eqMock, fromMock } = vi.hoisted(() => {
  const eqMock = vi.fn();
  const updateMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ update: updateMock }));
  return { updateMock, eqMock, fromMock };
});

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: fromMock,
  }),
}));

beforeEach(() => {
  eqMock.mockResolvedValue({ error: null });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fromMock.mockClear();
  updateMock.mockClear();
  eqMock.mockReset();
  document.documentElement.className = "";
  window.localStorage.clear();
});

function themeButton() {
  return screen.getByRole("button", { name: /Change theme/ });
}

describe("ThemeToggle", () => {
  it("cycles Light → Dark → System → Light, naming the current choice each time", () => {
    render(<ThemeToggle initialPreference="light" />);

    expect(themeButton()).toHaveAccessibleName("Change theme. Currently Light.");
    fireEvent.click(themeButton());
    expect(themeButton()).toHaveAccessibleName("Change theme. Currently Dark.");
    fireEvent.click(themeButton());
    expect(themeButton()).toHaveAccessibleName("Change theme. Currently System.");
    fireEvent.click(themeButton());
    expect(themeButton()).toHaveAccessibleName("Change theme. Currently Light.");
  });

  it("applies the new theme to the page and to localStorage at once", () => {
    render(<ThemeToggle initialPreference="light" />);

    fireEvent.click(themeButton());

    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("saves the new choice to the signed-in user's row", async () => {
    render(<ThemeToggle initialPreference="light" />);

    fireEvent.click(themeButton());

    await waitFor(() => expect(eqMock).toHaveBeenCalledWith("id", USER_ID));
    expect(fromMock).toHaveBeenCalledWith("users");
    expect(updateMock).toHaveBeenCalledWith({ theme_preference: "dark" });
  });

  it("keeps the new choice and logs the error when the save fails", async () => {
    eqMock.mockResolvedValue({ error: { message: "permission denied" } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ThemeToggle initialPreference="light" />);

    fireEvent.click(themeButton());

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(themeButton()).toHaveAccessibleName("Change theme. Currently Dark.");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("is a single icon button with no visible text", () => {
    render(<ThemeToggle initialPreference="system" />);

    const button = themeButton();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const visibleText = Array.from(button.childNodes)
      .filter((node) => !(node instanceof HTMLElement && node.classList.contains("sr-only")))
      .map((node) => node.textContent)
      .join("");
    expect(visibleText).toBe("");
    expect(button).toHaveAttribute("title", "Theme: System");
  });
});
