import { describe, expect, it } from "vitest";
import { describeRemoteLinkRow } from "@/lib/zoom/remoteLinkRow";
import type { PositionHolder, RemoteLinkRecord } from "@/lib/zoom/remoteLinks";

// One case per state of a Remote links tab row (ITER-051).

const PETER: PositionHolder = {
  callingId: "calling-peter",
  userId: "user-peter",
  firstName: "Peter",
  lastName: "Nakamura",
  email: "peter@example.org",
  position: "counselor_1",
};

const ANNA: PositionHolder = {
  callingId: "calling-anna",
  userId: "user-anna",
  firstName: "Anna",
  lastName: "Ruiz",
  email: null,
  position: "counselor_1",
};

function link(overrides: Partial<RemoteLinkRecord> = {}): RemoteLinkRecord {
  return {
    position: "counselor_1",
    holderCallingId: PETER.callingId,
    holderName: "Peter Nakamura",
    setAt: "2026-10-27T15:00:00Z",
    setByName: "Bishop Smith",
    deactivatedAt: null,
    deactivatedReason: null,
    deactivatedByName: null,
    ...overrides,
  };
}

const describeRow = (holders: PositionHolder[], record: RemoteLinkRecord | null) =>
  describeRemoteLinkRow({ position: "counselor_1", holders, link: record });

describe("describeRemoteLinkRow", () => {
  it("reads vacant with no paste when nobody holds the calling", () => {
    const row = describeRow([], null);
    expect(row).toMatchObject({ state: "vacant", holderLine: "No one called", canPaste: false });
  });

  it("refuses a paste when more than one person holds the calling", () => {
    const row = describeRow([PETER, ANNA], null);
    expect(row).toMatchObject({
      state: "multiple_holders",
      statusLine: "More than one person holds this calling.",
      canPaste: false,
    });
  });

  it("reads no link set for a single holder with no row", () => {
    const row = describeRow([PETER], null);
    expect(row).toMatchObject({ state: "no_link", statusLine: "No link set.", canPaste: true });
  });

  it("reads live with the date and who set it", () => {
    const row = describeRow([PETER], link());
    expect(row).toMatchObject({
      state: "live",
      statusLine: "Link set 27 Oct 2026 by Bishop Smith.",
      canTurnOff: true,
    });
  });

  it("reads needs a new link from the holder-changed stamp", () => {
    const row = describeRow(
      [ANNA],
      link({ deactivatedAt: "2026-10-27T16:00:00Z", deactivatedReason: "holder_changed" }),
    );
    expect(row).toMatchObject({
      state: "needs_new_link",
      statusLine: "Needs a new link — the last one was for Peter Nakamura.",
      canTurnOff: false,
    });
  });

  it("reads needs a new link when a live row is bound to another calling (the computed case)", () => {
    const row = describeRow([ANNA], link());
    expect(row).toMatchObject({ state: "needs_new_link", canTurnOff: true });
  });

  it("says someone no longer in this calling when the old name is gone", () => {
    const row = describeRow(
      [ANNA],
      link({
        holderName: null,
        deactivatedAt: "2026-10-27T16:00:00Z",
        deactivatedReason: "holder_changed",
      }),
    );
    expect(row.statusLine).toBe(
      "Needs a new link — the last one was for someone no longer in this calling.",
    );
  });

  it("reads turned off with the date and who turned it off", () => {
    const row = describeRow(
      [PETER],
      link({
        deactivatedAt: "2026-10-27T16:00:00Z",
        deactivatedReason: "turned_off",
        deactivatedByName: "Bishop Smith",
      }),
    );
    expect(row).toMatchObject({
      state: "turned_off",
      statusLine: "Turned off 27 Oct 2026 by Bishop Smith.",
      canPaste: true,
      canTurnOff: false,
    });
  });

  it("writes the holder line with the email, and without it when there is none", () => {
    expect(describeRow([PETER], null).holderLine).toBe("Peter Nakamura · peter@example.org");
    expect(describeRow([ANNA], null).holderLine).toBe("Anna Ruiz");
  });

  it("dates a stamp in UTC: late on the 26th UTC reads 26 Oct", () => {
    const row = describeRow([PETER], link({ setAt: "2026-10-26T23:30:00Z" }));
    expect(row.statusLine).toBe("Link set 26 Oct 2026 by Bishop Smith.");
  });
});
