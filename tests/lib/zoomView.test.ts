import { describe, expect, it } from "vitest";
import { initialZoomTab, parseZoomView, visibleZoomTabs } from "@/lib/zoom/zoomView";

describe("visibleZoomTabs", () => {
  it("gives the bishopric every tab, in order", () => {
    expect(
      visibleZoomTabs({ canViewInvitees: true, canManageInvitees: true, canManageRemoteLinks: true }),
    ).toEqual(["remote", "invitees", "registrations", "pool", "links"]);
  });

  it("gives a clerk the remote control, the invitee list and the sign-ups, and nothing else", () => {
    expect(
      visibleZoomTabs({ canViewInvitees: true, canManageInvitees: false, canManageRemoteLinks: false }),
    ).toEqual(["remote", "invitees", "registrations"]);
  });

  it("gives a reader who cannot see invitees only the remote control", () => {
    expect(
      visibleZoomTabs({ canViewInvitees: false, canManageInvitees: false, canManageRemoteLinks: false }),
    ).toEqual(["remote"]);
  });
});

describe("initialZoomTab", () => {
  it("keeps a stored tab the reader can see", () => {
    expect(initialZoomTab("pool", ["remote", "pool", "links"])).toBe("pool");
  });

  it("falls back to remote for a stored tab the reader cannot see", () => {
    expect(initialZoomTab("pool", ["remote"])).toBe("remote");
  });
});

describe("parseZoomView", () => {
  it("accepts the new tabs and falls back on anything else", () => {
    expect(parseZoomView({ tab: "invitees" })).toEqual({ tab: "invitees" });
    expect(parseZoomView({ tab: "registrations" })).toEqual({ tab: "registrations" });
    expect(parseZoomView({ tab: "recipients" })).toEqual({ tab: "remote" });
  });
});
