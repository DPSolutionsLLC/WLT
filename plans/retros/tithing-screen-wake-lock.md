---
id: tithing-screen-wake-lock
type: feature
iter: [ITER-043]
commits: []
date: 2026-10-30
files:
  - app/(tithing)/tithing/useScreenWakeLock.ts
  - app/(tithing)/tithing/TithingCounter.tsx
  - FEATURES.md
related: [design-system-tokens-and-primitives]
---

## What was done
While the tithing calculator is open and visible, the phone's screen stays on, using the browser's
Screen Wake Lock API through a new `useScreenWakeLock()` hook that `TithingCounter` calls
unconditionally. Nothing is stored, so the module still saves nothing anywhere. 10 hook tests and
1 wiring test cover the hook's rules. Only a real phone can prove the feature itself (see Pitfall).

## Key decisions
- **The lock is requested again on every return to `visible`.** The browser drops it on hide and
  never takes it back, which is the one easy-to-miss rule of this API.
- **Unmounting releases the lock, and a lock that arrives after unmount is released at once.**
  "← Dashboard" is a client-side navigation, so the page stays visible and the browser would
  otherwise keep the screen on across the whole app.
- **D1: an unsupported browser does nothing and logs nothing; a refused request is
  `console.warn`ed and never shown.** The person counting cannot act on either one.
- The `release` listener clears the held lock only if it is still the current one. That way a
  late release event from an old lock cannot orphan a newer one and cause a duplicate request.

## Pitfall
No jsdom test can show a screen staying on. Close ITER-043 only after the plan's real-device
check (iPhone and Android, in a tab and from a home-screen icon).
