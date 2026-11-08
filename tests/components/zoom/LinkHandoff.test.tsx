import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkHandoff } from "@/app/(app)/zoom/LinkHandoff";

// Text it / Share / Email it / Show QR for somebody's own Zoom link (ITER-053, z2b;
// plans/zoom-link-email-and-text.md).

const props = {
  inviteeId: "11111111-1111-4111-8111-111111111111",
  displayName: "Ann Lee",
  phone: "555-123-4567",
  email: "ann@example.org",
  wardName: "Buffalo Ward",
  joinUrl: "https://example.org/j/guest07?tk=abc",
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function defineShare(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, "share", { value: share, configurable: true, writable: true });
}

function defineClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("LinkHandoff", () => {
  it("offers no Share button where the browser cannot share", () => {
    render(<LinkHandoff {...props} />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.getByRole("button", { name: "Text it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show QR code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Email it" })).toBeTruthy();
  });

  it("draws the QR code as a PNG image with the scan caption", async () => {
    render(<LinkHandoff {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Show QR code" }));
    const image = await screen.findByRole("img", { name: /QR code for Ann Lee/ });
    expect(image.getAttribute("src")?.startsWith("data:image/png")).toBe(true);
    expect(screen.getByText("Have them scan this with their phone camera.")).toBeTruthy();
  });

  it("splits Text it into a greeting without the link, then the link alone", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    defineClipboard(writeText);
    render(<LinkHandoff {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Text it" }));

    const [greetingStep, linkStep] = screen.getAllByRole("listitem");
    expect(greetingStep?.textContent).toContain("Send the greeting");
    expect(linkStep?.textContent).toContain("Then send the link on its own");

    fireEvent.click(within(greetingStep!).getByRole("button", { name: "Copy message" }));
    fireEvent.click(within(linkStep!).getByRole("button", { name: "Copy message" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

    const [greeting, link] = writeText.mock.calls.map((call) => call[0]);
    expect(greeting).toContain("Hi Ann");
    expect(greeting).not.toContain(props.joinUrl);
    expect(link).toBe(props.joinUrl);
  });

  it("keeps one message, link included, when there is no phone to open", () => {
    render(<LinkHandoff {...props} phone={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Text it" }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Copy message" })).toHaveLength(1);
    expect(screen.getByText(/no phone number on file for this person/)).toBeTruthy();
  });

  it("shares the greeting with the link passed separately, and treats a cancel as no error", async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(() =>
      Promise.reject(new DOMException("cancelled", "AbortError")),
    );
    defineShare(share);
    render(<LinkHandoff {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const shared = share.mock.calls[0]?.[0];
    expect(shared?.url).toBe(props.joinUrl);
    expect(shared?.text).toContain("Hi Ann");
    expect(shared?.text).not.toContain(props.joinUrl);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so when the share sheet fails for another reason", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    defineShare(() => Promise.reject(new Error("blocked")));
    render(<LinkHandoff {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByText(/would not open its share sheet/)).toBeTruthy();
  });

  it("switches Email it off, and says why, when there is no email address", () => {
    render(<LinkHandoff {...props} email={null} />);
    expect(screen.getByRole("button", { name: "Email it" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("No email address on file. Add one with Edit.")).toBeTruthy();
  });

  it("emails by invitee id alone, never sending the link from the browser", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ sent: true }), { status: 200 }));
    render(<LinkHandoff {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Email it" }));

    expect(await screen.findByText("Emailed to them.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Email it again" })).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/zoom/invitees/${props.inviteeId}/email`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
  });

  it("shows the route's sentence when the email is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(new Response(JSON.stringify({ error: "Email isn't set up for this ward yet." }), { status: 409 }));
    render(<LinkHandoff {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Email it" }));
    expect(await screen.findByText("Email isn't set up for this ward yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Email it" }).hasAttribute("disabled")).toBe(false);
  });
});
