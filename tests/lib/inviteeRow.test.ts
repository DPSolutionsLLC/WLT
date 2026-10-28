import { describe, expect, it } from "vitest";
import { describeInviteeRow, matchesInviteeSearch } from "@/lib/zoom/inviteeRow";
import { changedInviteeFields, orderInvitees, type ZoomInvitee } from "@/lib/zoom/invitees";

// The Invitees list's wording, order and the edit's changed-field list (ITER-053, z2b) — all pure.

function invitee(overrides: Partial<ZoomInvitee> = {}): ZoomInvitee {
  return {
    id: "i1",
    displayName: "Ann Lee",
    memberId: null,
    phone: null,
    email: null,
    notes: null,
    assignedByName: "Dana Reyes",
    placeholderName: "Guest 07",
    linkGivenAt: "2026-10-28T23:30:00Z",
    createdAt: "2026-10-28T23:30:00Z",
    lastWatchedOn: null,
    sundaysWatched: null,
    ...overrides,
  };
}

describe("describeInviteeRow", () => {
  it("names the placeholder, who gave it and the UTC date", () => {
    const row = describeInviteeRow(invitee());
    expect(row.linkLine).toBe("Guest 07");
    expect(row.givenLine).toBe("Given by Dana Reyes · 28 Oct 2026");
    expect(row.isWaiting).toBe(false);
  });

  it("dates a late-evening hand-out by its UTC day, never the server's zone", () => {
    expect(describeInviteeRow(invitee({ linkGivenAt: "2026-10-29T03:00:00Z" })).givenLine).toBe(
      "Given by Dana Reyes · 29 Oct 2026",
    );
  });

  it("marks somebody waiting for a link", () => {
    const row = describeInviteeRow(invitee({ linkGivenAt: null, placeholderName: null }));
    expect(row.isWaiting).toBe(true);
    expect(row.linkLine).toBe("Waiting for a link");
    expect(row.givenLine).toBe("Added by Dana Reyes");
  });

  it("shows a dash for attendance until ITER-054 fills it, never 0 or Never", () => {
    const row = describeInviteeRow(invitee());
    expect(row.lastWatchedLine).toBe("—");
    expect(row.sundaysWatchedLine).toBe("—");
  });

  it("marks a roster member", () => {
    expect(describeInviteeRow(invitee({ memberId: "m1" })).isMember).toBe(true);
    expect(describeInviteeRow(invitee()).isMember).toBe(false);
  });
});

describe("matchesInviteeSearch", () => {
  it("matches the name or the placeholder, ignoring case", () => {
    expect(matchesInviteeSearch(invitee(), "ann")).toBe(true);
    expect(matchesInviteeSearch(invitee(), "guest 07")).toBe(true);
    expect(matchesInviteeSearch(invitee(), "zed")).toBe(false);
    expect(matchesInviteeSearch(invitee(), "  ")).toBe(true);
  });
});

describe("orderInvitees", () => {
  it("puts waiting people first (oldest first), then newest given first", () => {
    const ordered = orderInvitees([
      invitee({ id: "given-old", linkGivenAt: "2026-10-01T00:00:00Z" }),
      invitee({ id: "waiting-new", linkGivenAt: null, createdAt: "2026-10-20T00:00:00Z" }),
      invitee({ id: "given-new", linkGivenAt: "2026-10-25T00:00:00Z" }),
      invitee({ id: "waiting-old", linkGivenAt: null, createdAt: "2026-10-10T00:00:00Z" }),
    ]);
    expect(ordered.map((row) => row.id)).toEqual([
      "waiting-old",
      "waiting-new",
      "given-new",
      "given-old",
    ]);
  });
});

describe("changedInviteeFields", () => {
  it("lists only the sent fields that differ", () => {
    expect(
      changedInviteeFields(invitee({ phone: "5551234567" }), {
        phone: "5559999999",
        displayName: "Ann Lee",
        email: null,
      }),
    ).toEqual(["phone"]);
  });

  it("counts clearing a roster match as a change", () => {
    expect(changedInviteeFields(invitee({ memberId: "m1" }), { memberId: null })).toEqual([
      "memberId",
    ]);
  });

  it("ignores fields that were not sent", () => {
    expect(changedInviteeFields(invitee({ notes: "x" }), { displayName: "Ann Lee" })).toEqual([]);
  });
});
