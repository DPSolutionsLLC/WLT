"use client";

import { useEffect, useState } from "react";

// Whether the dashboard's secondary header rows should be out of the way right now.
//
// ---------------------------------------------------------------------------
// rAF-THROTTLED AND DIRECTION-ACCUMULATING, AND BOTH HALVES ARE LOAD-BEARING
// ---------------------------------------------------------------------------
// A raw scroll listener with a small threshold fires on every pixel and flips the state faster
// than any CSS transition can follow, which reads as a stutter rather than as a collapse. The
// prototype shipped that twice and plans/prototype/decisions.md §6 still lists it as KNOWN
// UNFIXED, with the advice to re-verify in a real environment and to rebuild on a transform
// rather than on `max-height`. That advice is taken up front: this hook returns a boolean and the
// caller animates with `transform`/`opacity`, which the compositor can run without a layout pass.
//
// ACCUMULATION, NOT A RAW DELTA. Movement is added up only while the direction stays consistent
// and the accumulator is RESET the moment direction changes, so a scroll that wavers by a pixel
// does not toggle anything. A single raw delta past a threshold is what produces the stutter.
//
// THE TWO THRESHOLDS ARE DELIBERATELY ASYMMETRIC. Collapsing takes real intent
// (`collapseAfter`, plus a scroll position past it so the top of the page never collapses); a
// REVEAL happens on any real upward movement at all, because somebody scrolling back up is
// looking for the controls. Requiring the same distance in both directions is what makes a
// collapsing header feel like it is fighting you.
//
// ---------------------------------------------------------------------------
// ⚠️ THE COLLAPSE FEEDS ITS OWN LISTENER, AND THAT IS WHAT THE SETTLE WINDOW IS FOR
// ---------------------------------------------------------------------------
// FOUND BY WALKING SCENARIO 070, 2026-09-22, and it is almost certainly the bug
// plans/prototype/decisions.md §6 still lists as KNOWN UNFIXED in the prototype after two
// attempts.
//
// Collapsing removes the extras' height from the document. A shorter document means the browser
// CLAMPS the scroll position — and that fires another scroll event. The observed sequence from one
// downward jump was `900, 876, 900`: the collapse cost 24px of height, the browser pulled scrollY
// back by 24, this hook read that as a 24px UPWARD scroll, revealed (24 > REVEAL_AFTER), which
// restored the height, which returned scrollY to 900. It settles back open, so a fast flick looks
// like the header simply refusing to collapse — and a header that fights you is exactly the
// stutter the rAF throttle above was meant to prevent.
//
// A SMALL, CONSISTENT SCROLL HID IT: 60px steps outrun a 24px rebound, so the net accumulated
// movement still crosses the threshold. Only a large single delta — a flick — exposes it.
//
// So after the state flips, movement is IGNORED for as long as the caller's transition runs, and
// `lastY` is re-baselined to wherever the browser has put us. The cost is that genuine scrolling
// in that window does not count, which at ~250ms is imperceptible and is the correct trade: the
// alternative is a control that fights the reader.
//
// ⚠️ NO jsdom TEST COULD HAVE CAUGHT THIS. jsdom has no layout, so collapsing changes no height,
// so the browser never clamps and the second event never fires. The unit test below reproduces the
// rebound BY HAND for that reason — it is a regression test, not a discovery tool.
//
// prefers-reduced-motion is NOT read here — it is a CSS concern and the caller carries
// `motion-reduce:transition-none`, so the state still changes and only the animation stops.

// Any real upward movement reveals. Small enough to feel immediate, large enough that the
// sub-pixel jitter a momentum scroll produces at rest does not count as "upward".
const REVEAL_AFTER = 8;

// Long enough to cover the caller's 200ms transition and the reflow that follows it. See the
// header: this is the window in which the collapse's own scroll adjustment is ignored.
const SETTLE_MS = 250;

export function useCollapsingHeader(collapseAfter = 48): boolean {
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    let frame = 0;
    let lastY = window.scrollY;
    let accumulated = 0;
    // Mirrored inside the effect so a flip can be detected without re-subscribing on every render.
    let collapsed = false;
    let settleUntil = 0;

    function apply(next: boolean): void {
      if (next === collapsed) return;

      collapsed = next;
      setIsCollapsed(next);
      // The height is about to change, so whatever scroll event that produces is OURS, not the
      // reader's.
      settleUntil = performance.now() + SETTLE_MS;
      accumulated = 0;
    }

    function read(): void {
      frame = 0;

      const currentY = window.scrollY;

      // Swallow the rebound and re-baseline to wherever the browser has left us.
      if (performance.now() < settleUntil) {
        lastY = currentY;
        accumulated = 0;
        return;
      }

      const delta = currentY - lastY;
      lastY = currentY;

      if (delta === 0) return;

      // The direction changed, so everything accumulated so far was about the other direction.
      if (Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      accumulated += delta;

      if (currentY <= collapseAfter) {
        // At the top of the page there is nothing to get out of the way of.
        apply(false);
        return;
      }

      if (accumulated > collapseAfter) apply(true);
      else if (accumulated < -REVEAL_AFTER) apply(false);
    }

    function handleScroll(): void {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(read);
    }

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [collapseAfter]);

  return isCollapsed;
}
