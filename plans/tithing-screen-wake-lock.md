# Plan: Keep the screen on in the tithing calculator

**Created:** 2026-10-30
**Type:** feature
**Scope refs:** ITER-043

## Overview

While the tithing calculator (`/tithing`) is open **and visible**, the phone's screen stays on
instead of dimming and locking — the way a phone's own calculator app behaves. Tithing is counted
on a phone that is often set down between envelopes; today the screen locks mid-count and the
counter has to unlock it and find the page again.

This uses the browser's **Screen Wake Lock API** (`navigator.wakeLock.request("screen")`). No new
dependency: TypeScript 5's `lib.dom.d.ts` (already in `tsconfig.json`'s `lib`) declares `WakeLock`
and `WakeLockSentinel`.

### Requirements

- Automatic: nothing to tap, no setting.
- Only while the calculator is open and visible. Leaving the calculator, switching to another app
  or tab, or locking the phone by hand returns the phone to normal sleep behaviour.
- Coming back to the calculator (switching back from another app) turns it back on with no action.
- Tithing calculator only. No other page keeps the screen on.
- Nothing is stored or written — no schema, no audit row, no permission change. This keeps the
  module's "nothing here is saved anywhere" design (header of `TithingCounter.tsx`) intact.

### Decision (settled with the user 2026-10-30, the scope's one open question)

**D1 — A phone or browser that cannot keep the screen on: quietly do nothing.** The calculator
works exactly as it does today there; no note is shown. Reasoning: the counter cannot act on it.
This is NOT a silent failure in code:
- **Unsupported** (no `navigator.wakeLock`) is a missing capability, not an error — return without
  requesting, no log.
- **A request the browser refuses** (the promise rejects — e.g. battery saver, a permissions
  policy, the page not visible at the instant of the request) IS an error: catch it and
  `console.warn` it with a sentence, never `catch {}`. Nothing is shown to the user (D1).

### Success criteria

- [ ] On a real iPhone and a real Android phone, the calculator can sit untouched past the phone's
      normal screen timeout and the screen stays on.
- [ ] Switching to another app and back, the screen again stays on with nothing tapped.
- [ ] Every other page of the app still dims normally, including the dashboard reached via the
      calculator's "← Dashboard" link.
- [ ] Unit tests cover request, re-request on return, release on leave, the unmount race, the
      unsupported browser and a refused request.
- [ ] Lint, typecheck, the tithing tests and the production build pass.

## Relevant Files

- `app/(tithing)/tithing/useScreenWakeLock.ts` — **create** — the hook that holds the wake lock
  while mounted and visible.
- `app/(tithing)/tithing/TithingCounter.tsx` — **modify** — call `useScreenWakeLock()` once, and add
  one line to the header comment.
- `tests/components/tithing/useScreenWakeLock.test.ts` — **create** — unit tests for the hook.
- `tests/components/tithing/TithingCounter.test.tsx` — **modify** — one test proving the calculator
  asks for the lock (the wiring, not the hook's rules).
- `FEATURES.md` — **modify** — one bullet under Module 13 → Controls (or a short "On the phone"
  line) saying the screen stays on while the calculator is open.

Five files. Per CLAUDE.md §10 / global §4, the executing agent shows this list and waits for
confirmation before editing.

## Dependencies

- **No new libraries.** Screen Wake Lock is a browser API; its types ship with TypeScript.
- Existing pattern to follow: `components/layout/useCollapsingHeader.ts` — a `"use client"` hook,
  named export, effect with listener cleanup — and its test
  `tests/components/layout/useCollapsingHeader.test.ts`.
- **No configuration change.** Checked 2026-10-30: `next.config.ts`, `middleware.ts` and
  `vercel.json` send no `Permissions-Policy` header, so `screen-wake-lock` is allowed by default.
  The site is HTTPS in production (required — the API exists only in a secure context);
  `localhost` also counts as secure, so `npm run dev` works on a desktop browser.

### Browser support (what to expect on the real-device check)

- **Android Chrome:** supported since Chrome 84.
- **iPhone Safari:** supported since iOS 16.4. **Opened from a home-screen icon** it was reported
  broken in older iOS versions (fixed around iOS 18.4) — this is why the scope asks for both. If it
  fails only from a home-screen icon on an older iPhone, that is D1's "quietly do nothing" case,
  not a defect to work around.
- **Firefox:** supported since 126. Older browsers fall into D1.
- **The browser releases the lock itself** whenever the page becomes hidden (another app, another
  tab, the phone locked by hand). It is NOT reacquired automatically — the hook must request again
  on `visibilitychange` back to `visible`. This is the one easy-to-miss rule of this API.

## Known Pitfalls (from retro context)

- **design-system-tokens-and-primitives / scenario 070 (`useCollapsingHeader`)** — that hook's header
  records that jsdom has no layout, so a real-browser behaviour could not be caught by a unit test,
  only reproduced by hand once found. Same here, more strongly: **no jsdom test can show a phone
  staying awake.** The unit tests prove the hook's *rules* (when it requests and releases); only the
  real-device check in Testing Strategy proves the *feature*. Do not mark ITER-043 done on green
  tests alone.
- No retro touches the tithing module's own files.

## Tasks

### Task 1: Create the wake lock hook

**File:** `app/(tithing)/tithing/useScreenWakeLock.ts` (create)
**Action:** A `"use client"` hook, `export function useScreenWakeLock(): void`, that holds a screen
wake lock while the calling component is mounted and the page is visible.
**Details:**

- Live beside the calculator, not in a shared folder: tithing is the only user (scope: "tithing
  calculator only"), and the project rule is to generalise the second time something is needed.
- One `useEffect` with an empty dependency array. Inside it:
  - **Unsupported:** if `!("wakeLock" in navigator)`, return immediately (D1 — no log). Use the
    `in` check rather than `navigator.wakeLock === undefined`, because TypeScript types the property
    as always present.
  - Local state inside the effect (not React state — nothing renders from it):
    - `let sentinel: WakeLockSentinel | null = null`
    - `let requestInFlight = false`
    - `let active = true` (set to `false` in cleanup)
  - `async function acquire()`:
    - Return early if `!active`, `requestInFlight`, `document.visibilityState !== "visible"`, or
      `sentinel !== null && !sentinel.released`.
    - Set `requestInFlight = true`; `try { const lock = await navigator.wakeLock.request("screen"); … }`.
    - **Unmount race:** if `!active` once the promise resolves, call `lock.release()` (catch and
      warn) and return — the component left while the request was pending, and keeping that lock
      would hold the screen on across the rest of the app.
    - Otherwise store it as `sentinel`, and add a `"release"` listener that sets `sentinel = null`
      (the browser fires it when it drops the lock on hide).
    - `catch (error)`: `console.warn("The screen could not be kept on for the tithing calculator", error)`.
      No rethrow, no UI (D1). Never an empty catch (CLAUDE.md rule 7).
    - `finally { requestInFlight = false; }`
  - `function handleVisibilityChange()`: if `document.visibilityState === "visible"`, call
    `void acquire()`. Nothing to do on `hidden` — the browser releases the lock itself.
  - Call `void acquire()` once on mount, and
    `document.addEventListener("visibilitychange", handleVisibilityChange)`.
  - **Cleanup:** `active = false`; remove the listener; if `sentinel` is held and not released,
    `sentinel.release().catch((error) => console.warn(…))`; set `sentinel = null`. This is what
    makes "leaving the calculator returns the phone to normal" true: the "← Dashboard" link is a
    client-side `next/link` navigation, so the page stays visible and the browser would NOT release
    the lock by itself.
- A short header comment saying **why** (CLAUDE.md §6 allows "why" comments): the browser drops the
  lock on hide and never reacquires it; the cleanup release is what stops the lock outliving the
  calculator on a client-side navigation; the unmount race; and D1. No "what" comments.
- No `any`. `navigator.wakeLock.request("screen")` returns `Promise<WakeLockSentinel>` with the
  existing DOM types.

### Task 2: Use the hook in the calculator

**File:** `app/(tithing)/tithing/TithingCounter.tsx` (modify)
**Action:** Call `useScreenWakeLock();` near the top of `TithingCounter()` (after the state
declarations, beside the other effects), and import it with the project's `@/` alias:
`import { useScreenWakeLock } from "@/app/(tithing)/tithing/useScreenWakeLock";`
**Details:**

- Unconditional: the lock is wanted whenever the calculator is on screen, empty or not (the scope
  says "opening the calculator"). Do NOT tie it to `hasCountInProgress`.
- In the large header comment, add one sentence after point 2 (the phone-going-to-sleep risk):
  the screen is now kept on while this screen is visible (`useScreenWakeLock`), which makes that
  loss less likely but does not remove it — a phone can still be locked by hand or a browser may
  refuse. Keep the rest of the comment unchanged.
- Touch nothing else in this file.

### Task 3: Unit tests for the hook

**File:** `tests/components/tithing/useScreenWakeLock.test.ts` (create)
**Action:** Table-free, behaviour-named tests using `renderHook` from `@testing-library/react`
(already a dependency) and Vitest. Follow the setup/teardown style of
`tests/components/layout/useCollapsingHeader.test.ts`.
**Details:**

- **Fake API** (jsdom has no `navigator.wakeLock`). A small helper in the test file:
  - `createFakeSentinel()` returning an object with `released` (boolean), `release: vi.fn()` that
    sets `released = true` and dispatches a `"release"` event, and `addEventListener` /
    `removeEventListener` — simplest is to extend `EventTarget`.
  - `installWakeLock(request)` using `Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true })`;
    `afterEach` deletes it so other suites keep seeing an unsupported browser.
  - `setVisibility(state)` using `Object.defineProperty(document, "visibilityState", { value: state, configurable: true })`
    then `document.dispatchEvent(new Event("visibilitychange"))`. Restore `"visible"` in `afterEach`.
  - Await pending promises with `await act(async () => {})` (or `waitFor`) before asserting.
- **Cases:**
  1. Requests `"screen"` once on mount when the page is visible.
  2. Does not request on mount when the page is hidden; requests once it becomes visible.
  3. **Re-requests after returning:** the browser releases (call the fake sentinel's `release()`),
     page goes `hidden` then `visible` → `request` called a second time.
  4. Does not request again on `visible` while the current lock is still held (no duplicate locks).
  5. Does not start a second request while one is still pending (two `visible` events before the
     first promise resolves → one call).
  6. **Releases on unmount** — the held sentinel's `release` was called.
  7. **Unmount race:** `request` returns a promise resolved only after `unmount()`; once it resolves,
     that late sentinel's `release` is called and nothing is held.
  8. **Unsupported browser:** with no `navigator.wakeLock`, mount and unmount throw nothing and
     `console.warn` is not called (D1).
  9. **Refused request:** `request` rejects with a `DOMException("…", "NotAllowedError")` → no throw,
     no unhandled rejection, `console.warn` called once (spy with `vi.spyOn(console, "warn")`).
  10. After unmount, a `visibilitychange` to `visible` triggers no new request (listener removed).
- **Negative-path rule (global CLAUDE.md):** cases 8 and 9 must each reach the branch they test —
  case 9 must have a *supported* API whose request rejects, not a missing API that never gets that
  far; assert `request` was actually called in case 9.

### Task 4: One wiring test in the calculator suite

**File:** `tests/components/tithing/TithingCounter.test.tsx` (modify)
**Action:** Add one `describe("screen wake lock")` block with a test: with a fake
`navigator.wakeLock` installed (same `Object.defineProperty` approach, removed in that block's
`afterEach`), rendering `<TithingCounter />` calls `request("screen")`, and `cleanup()` / unmount
releases it.
**Details:**

- The existing tests run with no `navigator.wakeLock` in jsdom, so they exercise D1's unsupported
  path already and must keep passing unchanged — that itself is evidence the hook fails quietly.
- Do not re-test the hook's rules here; Task 3 owns those.

### Task 5: Document it

**File:** `FEATURES.md` (modify)
**Action:** Under `## Module 13: Tithing Calculator`, add one line, e.g. in **Controls** or as a
short **On the phone** subsection: "While the calculator is open and on screen, the phone's screen
stays on. It goes back to sleeping normally when you leave the calculator or switch apps. Phones
that cannot do this behave as before."
**Details:** Plain language; no API names in FEATURES.md. SPEC.md and CLAUDE.md need no change —
nothing about schema, routes, permissions or a project rule moves.

## Testing Strategy

- **Create:** `tests/components/tithing/useScreenWakeLock.test.ts` (Task 3, 10 cases).
- **Modify:** `tests/components/tithing/TithingCounter.test.tsx` (Task 4, 1 case).
- Approach: unit tests in jsdom with a fake Wake Lock API. Pure client code — no database, no
  route, no RLS involved, so the hosted-database suites are untouched.
- **Real-device check (required, by the user — the scope's done criterion):** after deploy, on the
  live site over HTTPS:
  1. iPhone, Safari tab: open `/tithing`, set the phone down untouched past its auto-lock time →
     the screen stays on.
  2. iPhone, opened from a home-screen icon (Share → Add to Home Screen): same check. A failure only
     here on an older iOS is D1, not a bug (see Browser support).
  3. Android Chrome, tab and home-screen icon: same check.
  4. On each: switch to another app for a few seconds, come back, set it down → still stays on.
  5. On each: tap "← Dashboard" (confirm if asked), set it down → the screen dims as normal.
  6. Optional on Android: battery saver on → the calculator still works; the screen may dim (D1).
  A desktop browser can only show that a request happened (DevTools console, no warning) — it
  cannot show a phone staying awake.

## Test Scenarios (Harness)

**None.** Nothing needs seeding: the calculator reads and writes no data, and any bishopric
account in a ward with Tithing released reaches it. The verification is a real-device check of
something no seeded state can produce — it is listed above under Testing Strategy instead.

## Validation Commands

Run in this order. **Memory is tight on this machine (7.7 GB): stop `npm run dev` before the build.**
Check port 3000 first: `Get-NetTCPConnection -LocalPort 3000`.

```bash
# Linting
npm run lint

# Type checking
npm run typecheck

# Tests — the tithing suites (pure client; no hosted database involved)
npx vitest run tests/components/tithing tests/lib/tithingMoney.test.ts tests/lib/tithingTotals.test.ts tests/lib/tithingNoFloat.test.ts

# Source-reading guards worth keeping green (cheap)
npx vitest run tests/lib/explicitTimeZone.test.ts tests/lib/navigationRoutesExist.test.ts tests/lib/releasedRoutesCovered.test.ts

# Production build (dev server stopped first)
npm run build
```

The full suite (`npm test`, ~50–75 min against the hosted database) is **not required** for this
change: no file it reaches beyond the tithing component changes. Run it only if the user asks.

## Integration Notes

- **Connects to:** only `TithingCounter.tsx`. The tithing layout, access check, released-module
  bounce and RLS are untouched.
- **Breaking changes:** none. Unsupported browsers behave exactly as today.
- **Migration:** none. Nothing is stored.
- **Battery:** the lock is held only while the calculator is visible and is released on leave and
  dropped by the browser on hide, so a phone left on a table with another app open is not kept awake.
- **Docs:** FEATURES.md Module 13 (Task 5). Retro written by `/execute`. Close ITER-043 with
  `/commit` only after the user has done the real-device check.
