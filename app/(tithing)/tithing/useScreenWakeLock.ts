"use client";

import { useEffect } from "react";

// Keeps the phone's screen on while the calling component is mounted and the page is visible.
//
// THE BROWSER DROPS THE LOCK WHENEVER THE PAGE IS HIDDEN AND NEVER TAKES IT BACK. Switching apps,
// switching tabs or locking the phone by hand releases it, so the lock is requested again on every
// return to `visible`. Nothing needs doing on `hidden`.
//
// THE CLEANUP RELEASE IS WHAT STOPS THE LOCK OUTLIVING THE CALCULATOR. "← Dashboard" is a
// client-side navigation: the page stays visible, so the browser would keep the screen on across
// the rest of the app if the unmount did not release it.
//
// A request can still be pending when the component unmounts. A lock that arrives after that is
// released at once, for the same reason.
//
// A browser without the API quietly does nothing, and a refused request is warned to the console
// and never shown: the person counting cannot act on either (ITER-043, decision D1).

const REFUSED_MESSAGE = "The screen could not be kept on for the tithing calculator";
const RELEASE_FAILED_MESSAGE = "The tithing calculator's screen wake lock could not be released";

export function useScreenWakeLock(): void {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let requestInFlight = false;
    let active = true;

    function releaseQuietly(lock: WakeLockSentinel): void {
      lock.release().catch((error: unknown) => {
        console.warn(RELEASE_FAILED_MESSAGE, error);
      });
    }

    async function acquire(): Promise<void> {
      if (!active || requestInFlight) return;
      if (document.visibilityState !== "visible") return;
      if (sentinel !== null && !sentinel.released) return;

      requestInFlight = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (!active) {
          releaseQuietly(lock);
          return;
        }
        sentinel = lock;
        lock.addEventListener(
          "release",
          () => {
            if (sentinel === lock) sentinel = null;
          },
          { once: true },
        );
      } catch (error) {
        console.warn(REFUSED_MESSAGE, error);
      } finally {
        requestInFlight = false;
      }
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (sentinel !== null && !sentinel.released) releaseQuietly(sentinel);
      sentinel = null;
    };
  }, []);
}
