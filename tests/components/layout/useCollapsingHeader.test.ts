// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCollapsingHeader } from "@/components/layout/useCollapsingHeader";

// The hook is driven by real scroll events, so the test drives real scroll events: jsdom does not
// scroll, so `scrollY` is redefined and a `scroll` event is dispatched, which is exactly the pair
// a browser produces.
//
// requestAnimationFrame is QUEUED AND THEN FLUSHED, rather than run synchronously from inside the
// call. That is what a browser does, and the difference is not cosmetic: the hook assigns the
// frame id AFTER requestAnimationFrame returns, so a stub that ran the callback immediately would
// leave the id set forever and silently drop every scroll after the first — a test artefact that
// looks exactly like a broken throttle.

let pendingFrames: Map<number, FrameRequestCallback>;
let nextFrameId: number;
// A controllable clock. The hook ignores movement for SETTLE_MS after it flips the state — see
// its header — so a test that scrolls twice in the same tick is inside that window and must say
// so deliberately rather than by accident.
let clock: number;

function flushFrames(): void {
  const callbacks = [...pendingFrames.values()];
  pendingFrames.clear();
  for (const callback of callbacks) callback(0);
}

function setScrollY(y: number): void {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
}

// `advanceMs` defaults past the settle window, which is what an ordinary scroll gesture looks
// like. Pass 0 to stay inside it — that is how the rebound is reproduced.
function scrollTo(y: number, advanceMs = 300): void {
  clock += advanceMs;
  setScrollY(y);
  act(() => {
    window.dispatchEvent(new Event("scroll"));
    flushFrames();
  });
}

beforeEach(() => {
  pendingFrames = new Map();
  nextFrameId = 1;
  clock = 1000;

  setScrollY(0);

  vi.spyOn(performance, "now").mockImplementation(() => clock);

  // Spied on `window` rather than stubbed as a global: the hook calls
  // window.requestAnimationFrame, and vi.stubGlobal writes to globalThis, which is not guaranteed
  // to be the same object under the jsdom environment.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(
    (callback: FrameRequestCallback): number => {
      const id = nextFrameId;
      nextFrameId += 1;
      pendingFrames.set(id, callback);
      return id;
    },
  );

  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number): void => {
    pendingFrames.delete(id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useCollapsingHeader", () => {
  it("starts uncollapsed", () => {
    const { result } = renderHook(() => useCollapsingHeader());

    expect(result.current).toBe(false);
  });

  it("collapses once accumulated downward movement passes the threshold", () => {
    const { result } = renderHook(() => useCollapsingHeader(48));

    scrollTo(30);
    expect(result.current).toBe(false);

    scrollTo(120);
    expect(result.current).toBe(true);
  });

  it("does not collapse near the top of the page, however far the accumulator has run", () => {
    const { result } = renderHook(() => useCollapsingHeader(48));

    // 40px of downward movement is under the threshold anyway; 48 is the boundary and scrollY is
    // still inside it, which is the guard being asserted.
    scrollTo(40);
    scrollTo(48);

    expect(result.current).toBe(false);
  });

  // THE HEADLINE ASSERTION — "reveals immediately on any real upward scroll, not just at the very
  // top of the page". A collapsing header that needs the same distance in both directions feels
  // like it is fighting the reader.
  it("reveals on a small upward scroll, far down the page", () => {
    const { result } = renderHook(() => useCollapsingHeader(48));

    scrollTo(500);
    expect(result.current).toBe(true);

    scrollTo(488);
    expect(result.current).toBe(false);
  });

  it("resets the accumulator when the direction changes", () => {
    const { result } = renderHook(() => useCollapsingHeader(48));

    scrollTo(500);
    expect(result.current).toBe(true);

    // Up far enough to reveal, which resets the downward accumulator.
    scrollTo(480);
    expect(result.current).toBe(false);

    // 30px down is under the 48px threshold. If the accumulator had NOT been reset, the earlier
    // 500px of downward movement would still be in it and this would collapse again.
    scrollTo(510);
    expect(result.current).toBe(false);
  });

  it("ignores jitter below the reveal threshold", () => {
    const { result } = renderHook(() => useCollapsingHeader(48));

    scrollTo(500);
    expect(result.current).toBe(true);

    scrollTo(496);
    expect(result.current).toBe(true);
  });

  // The THROTTLE itself: several scroll events inside one frame schedule ONE read, and that read
  // sees the final position. A listener that recomputed on every event is what flips the state
  // faster than the transition can follow, which reads as a stutter rather than as a collapse.
  it("coalesces several scroll events into one frame", () => {
    renderHook(() => useCollapsingHeader(48));

    act(() => {
      setScrollY(100);
      window.dispatchEvent(new Event("scroll"));
      setScrollY(200);
      window.dispatchEvent(new Event("scroll"));
      setScrollY(300);
      window.dispatchEvent(new Event("scroll"));
    });

    expect(pendingFrames.size).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // ⚠️ THE REGRESSION TEST FOR THE FEEDBACK LOOP
  // ---------------------------------------------------------------------------
  // Walking scenario 070 recorded the scroll sequence `900, 876, 900` from ONE downward jump: the
  // collapse removed 24px of document height, the browser clamped scrollY by 24, the hook read
  // that as an upward scroll and revealed, which restored the height and the position. The header
  // settled back open, so a fast flick looked like it simply refused to collapse.
  //
  // NO jsdom TEST COULD HAVE FOUND IT — there is no layout here, so nothing clamps. The rebound is
  // therefore reproduced BY HAND: a small opposite scroll arriving INSIDE the settle window
  // (advance 0), which is exactly when a height-driven adjustment lands.
  it("ignores the scroll its own collapse causes", () => {
    const { result } = renderHook(() => useCollapsingHeader(48));

    scrollTo(900);
    expect(result.current).toBe(true);

    // The browser clamping scrollY by the height the collapse just removed.
    scrollTo(876, 0);
    expect(result.current, "the rebound must not read as an upward scroll").toBe(true);

    // And the height coming back is not a downward scroll either.
    scrollTo(900, 0);
    expect(result.current).toBe(true);
  });

  it("still reveals on a real upward scroll once the header has settled", () => {
    const { result } = renderHook(() => useCollapsingHeader(48));

    scrollTo(900);
    expect(result.current).toBe(true);

    // Past the settle window — a person, not a reflow.
    scrollTo(876);
    expect(result.current).toBe(false);
  });

  it("removes its listener on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useCollapsingHeader());

    unmount();

    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    remove.mockRestore();
  });

  it("stops responding to scroll after unmount", () => {
    const { result, unmount } = renderHook(() => useCollapsingHeader(48));

    unmount();
    scrollTo(500);

    expect(result.current).toBe(false);
  });
});
