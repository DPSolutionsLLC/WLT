import { describe, expect, it } from "vitest";
import { initialZoomTab, parseZoomView, visibleZoomTabs } from "@/lib/zoom/zoomView";

describe("visibleZoomTabs", () => {
  it("gives the bishopric the pool and the remote links", () => {
    expect(visibleZoomTabs({ canManageInvitees: true, canManageRemoteLinks: true })).toEqual([
      "remote",
      "pool",
      "links",
    ]);
  });

  it("gives a clerk only the remote control", () => {
    expect(visibleZoomTabs({ canManageInvitees: false, canManageRemoteLinks: false })).toEqual([
      "remote",
    ]);
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
    expect(parseZoomView({ tab: "recipients" })).toEqual({ tab: "remote" });
  });
});
