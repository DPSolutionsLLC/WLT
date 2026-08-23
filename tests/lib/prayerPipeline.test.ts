import { describe, expect, it } from "vitest";
import {
  canTransitionPrayer,
  isBackwardPrayerTransition,
  nextPrayerStage,
  prayerStageIndex,
  type PrayerTransitionContext,
} from "@/lib/prayers/prayerPipeline";
import { PRAYER_STAGES, type PrayerStage } from "@/types/domain";

// All sixteen (from, to) pairs, exhaustively. Three forward moves are legal, four same-stage
// pairs are refused, and the six backward moves are legal only for the bishopric with a reason —
// so the table below is the whole machine, not a sample of it.

const MEMBER_ID = "00000000-0000-4000-8000-000000000001";

const READY: PrayerTransitionContext = {
  memberId: MEMBER_ID,
  askedAt: "2026-06-01T12:00:00.000Z",
  confirmedAt: "2026-06-02T12:00:00.000Z",
  actorIsBishopric: true,
  reason: "Their circumstances changed.",
};

function context(overrides: Partial<PrayerTransitionContext> = {}): PrayerTransitionContext {
  return { ...READY, ...overrides };
}

describe("prayer stage order", () => {
  it("orders the four stages assign, ask, confirm, done", () => {
    expect(PRAYER_STAGES).toEqual(["assign", "ask", "confirm", "done"]);
    expect(prayerStageIndex("assign")).toBe(0);
    expect(prayerStageIndex("done")).toBe(3);
  });

  it("returns the next stage, and null past the end", () => {
    expect(nextPrayerStage("assign")).toBe("ask");
    expect(nextPrayerStage("ask")).toBe("confirm");
    expect(nextPrayerStage("confirm")).toBe("done");
    expect(nextPrayerStage("done")).toBeNull();
  });

  it("recognises a backward move in both directions", () => {
    expect(isBackwardPrayerTransition("done", "assign")).toBe(true);
    expect(isBackwardPrayerTransition("assign", "done")).toBe(false);
    expect(isBackwardPrayerTransition("ask", "ask")).toBe(false);
  });
});

describe("every (from, to) pair", () => {
  const FORWARD: ReadonlyArray<[PrayerStage, PrayerStage]> = [
    ["assign", "ask"],
    ["ask", "confirm"],
    ["confirm", "done"],
  ];

  function isForward(from: PrayerStage, to: PrayerStage): boolean {
    return FORWARD.some(([left, right]) => left === from && right === to);
  }

  it("covers all sixteen pairs with a bishopric actor who supplied a reason", () => {
    let checked = 0;

    for (const from of PRAYER_STAGES) {
      for (const to of PRAYER_STAGES) {
        checked += 1;
        const verdict = canTransitionPrayer(from, to, context());

        if (from === to) {
          expect(verdict.ok, `${from} -> ${to} should be refused as the same stage`).toBe(false);
          continue;
        }

        if (isBackwardPrayerTransition(from, to)) {
          expect(verdict.ok, `${from} -> ${to} is a legal bishopric backward move`).toBe(true);
          continue;
        }

        if (isForward(from, to)) {
          expect(verdict.ok, `${from} -> ${to} is the next stage`).toBe(true);
          continue;
        }

        // Everything left is a forward SKIP.
        expect(verdict.ok, `${from} -> ${to} skips a stage and must be refused`).toBe(false);
      }
    }

    expect(checked).toBe(16);
  });

  it("refuses every forward skip by name", () => {
    const skips: ReadonlyArray<[PrayerStage, PrayerStage]> = [
      ["assign", "confirm"],
      ["assign", "done"],
      ["ask", "done"],
    ];

    for (const [from, to] of skips) {
      const verdict = canTransitionPrayer(from, to, context());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.message).toContain("one stage at a time");
      }
    }
  });
});

describe("forward gates", () => {
  it("refuses assign -> ask without somebody to ask", () => {
    const verdict = canTransitionPrayer("assign", "ask", context({ memberId: null }));

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain("Choose who is praying");
  });

  it("allows assign -> ask once a member is chosen", () => {
    expect(canTransitionPrayer("assign", "ask", context({ memberId: MEMBER_ID })).ok).toBe(true);
  });

  it("refuses ask -> confirm before the prayer was marked asked", () => {
    const verdict = canTransitionPrayer("ask", "confirm", context({ askedAt: null }));

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain("asked first");
  });

  it("refuses confirm -> done before they agreed", () => {
    const verdict = canTransitionPrayer("confirm", "done", context({ confirmedAt: null }));

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain("agreed");
  });

  it("refuses moving on from done at all", () => {
    for (const to of PRAYER_STAGES) {
      if (to === "done") continue;
      // Every remaining target from `done` is backward, so a non-bishopric actor is the case
      // that proves nothing walks off the end.
      const verdict = canTransitionPrayer("done", to, context({ actorIsBishopric: false }));
      expect(verdict.ok).toBe(false);
    }
  });
});

describe("backward moves", () => {
  it("refuses a non-bishopric actor", () => {
    const verdict = canTransitionPrayer(
      "done",
      "confirm",
      context({ actorIsBishopric: false }),
    );

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain("Only the bishopric");
  });

  it("refuses the bishopric without a reason", () => {
    for (const reason of [undefined, "", "   "]) {
      const verdict = canTransitionPrayer("confirm", "ask", context({ reason }));

      expect(verdict.ok, `reason ${JSON.stringify(reason)} should be refused`).toBe(false);
      if (!verdict.ok) expect(verdict.message).toContain("Say why");
    }
  });

  it("allows the bishopric with a reason, and does NOT re-check the forward gates", () => {
    // Deliberate: a prayer that never had a member can still be walked back. The gates guard
    // what a stage needs to be ENTERED going forward, and a retreat is undoing, not entering.
    const verdict = canTransitionPrayer(
      "ask",
      "assign",
      context({ memberId: null, askedAt: null, confirmedAt: null }),
    );

    expect(verdict.ok).toBe(true);
  });
});
