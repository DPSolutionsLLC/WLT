import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkHandoff } from "@/app/(app)/zoom/LinkHandoff";

// Text it / Share / Show QR for somebody's own Zoom link (ITER-053, z2b).

const props = {
  displayName: "Ann Lee",
  phone: "555-123-4567",
  wardName: "Buffalo Ward",
  joinUrl: "https://example.org/j/guest07",
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "share");
  vi.restoreAllMocks();
});

function defineShare(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
}

describe("LinkHandoff", () => {
  it("offers no Share button where the browser cannot share", () => {
    render(<LinkHandoff {...props} />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.getByRole("button", { name: "Text it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show QR code" })).toBeTruthy();
  });

  it("draws the QR code as a PNG image with the scan caption", async () => {
    render(<LinkHandoff {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Show QR code" }));
    const image = await screen.findByRole("img", { name: /QR code for Ann Lee/ });
    expect(image.getAttribute("src")?.startsWith("data:image/png")).toBe(true);
    expect(screen.getByText("Have them scan this with their phone camera.")).toBeTruthy();
  });

  it("puts the link in the message under Text it", () => {
    render(<LinkHandoff {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Text it" }));
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
  });

  it("says this person, not this speaker, when there is no phone", () => {
    render(<LinkHandoff {...props} phone={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Text it" }));
    expect(screen.getByText(/no phone number on file for this person/)).toBeTruthy();
  });

  it("shares the message, and treats a cancelled share sheet as no error", async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(() =>
      Promise.reject(new DOMException("cancelled", "AbortError")),
    );
    defineShare(share);
    render(<LinkHandoff {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0]?.[0]).toEqual({ text: expect.stringContaining(props.joinUrl) });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so when the share sheet fails for another reason", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    defineShare(() => Promise.reject(new Error("blocked")));
    render(<LinkHandoff {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByText(/would not open its share sheet/)).toBeTruthy();
  });
});
