# ITER-069: Installable app — one window, and an install option anytime

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-11-16

## Summary
Make WLT a proper installable PWA that always reopens in a single window, and let anyone signed in
install it from inside the app after a short, friendly explanation of why they would want to.

## Context
Leaders open WLT from texts, emails and to-do links, so tabs pile up and the app reads as "a
website". Installed, it opens from the home screen like any other app, full screen, in one window.
Today the app has no manifest, no service worker and no app icons (only `favicon.ico`), and no
theme colour is set, so nothing about it is installable. Pages already remember how they were left
(stored on the account), so an installed app reopening "where you left off" comes for free.

## Desired Outcome

**Part 1 — installable, one window**
- A web app manifest linked in the `<head>`: name, short_name, start_url, scope,
  `display: "standalone"`, theme_color, background_color, 192×192 and 512×512 PNG icons plus a
  maskable icon, and
  `"launch_handler": { "client_mode": ["focus-existing", "navigate-existing", "auto"] }`.
  Icons are **placeholders generated from the existing favicon** until a real logo exists — say so
  when they are made.
- A minimal service worker with a fetch handler, registered on load. There is no existing
  caching or offline behaviour to preserve.
- A `window.launchQueue` consumer that routes to `params.targetURL` through the app's router (no
  full reload) when the installed app is relaunched.
- In an ordinary browser tab, a `BroadcastChannel` check: a second tab shows a small, non-blocking
  notice — "This app is already open in another tab" — with an option to keep using it anyway.

**Part 2 — install anytime**
- One reusable install hook (e.g. `useInstallPrompt`) that:
  - catches `beforeinstallprompt`, calls `preventDefault()`, and keeps the event for our own button;
  - knows when the app is already installed or running standalone
    (`matchMedia('(display-mode: standalone)')`, `navigator.standalone` on iOS) and listens for
    `appinstalled` — **all install UI hides once installed**;
  - tells three platforms apart: Chrome/Edge/Android (native prompt), iPhone/iPad Safari (manual
    Share → Add to Home Screen steps), and unsupported browsers (suggest Chrome or Safari);
  - falls back to manual browser-menu instructions ("Install app" / "Add to Home screen") when the
    native prompt is not available yet or was dismissed.
- **Entry points (decided with the user):**
  - a permanent **"Install app" button in the account window** (the account button on the chrome
    bar opens a window, not a dropdown);
  - a **dismissible banner on the dashboard only**, from the **3rd visit**, never on first load and
    never over a page somebody is working in. One dismissal hides it ~30 days; a second dismissal
    hides it for good. Remembered in `localStorage`.
  - **No header icon** — the chrome bar already carries four icon buttons at 375px.
- **A benefits window opens before the native prompt**, short and non-technical: one tap from the
  home screen; full screen with no browser bars and one window that reopens where you left off;
  opens quickly; safe — same website, almost no storage, no app store, removable anytime. Then an
  **Install** button (native prompt) or, on iPhone, a simple illustrated Share → Add to Home Screen
  walkthrough. Matches the existing design system (`Modal`, `Button`, tokens) and tone.

**Done looks like:** the production build passes; the app installs on Android/desktop Chrome and on
iPhone; relaunching reuses the one window; a duplicate browser tab shows the notice; install options
are gone once installed. The hand-off summary names where the install options live, reminds the user
to uninstall/reinstall on their devices so the new manifest takes effect, and explains how to test the
flow on Android/desktop Chrome and on iPhone.

## Scope Notes
- **Who is offered install: everyone signed in** — adult leaders AND youth PIN accounts
  (the `(youth)` shell). **Not** the unauthenticated `/public/[slug]` pages (programme, Zoom
  sign-up), which are opened by people outside leadership.
- **The copy must be true.** A minimal service worker does not make the app work offline, and every
  screen needs the network, so "works better with spotty signal" is softened to something accurate
  (e.g. "opens quickly"). Real offline support would be a separate item.
- **iPhone ignores `launch_handler`**; an installed iOS app is single-window anyway, and the
  BroadcastChannel notice covers browser tabs.
- **Firefox cannot install a PWA, and desktop Safari only offers "Add to Dock"** — these land in the
  unsupported / manual-instructions branch.
- **The Sacrament Planner runs in a same-origin `<iframe>`** — the duplicate-tab check must ignore
  frames, or the Planner would report itself as a second tab. The service worker's scope covers the
  frame too; it must not interfere with the Planner's bridge.
- Root layout's existing theme script and `viewport` export are where theme colour and the manifest
  link belong; middleware's matcher must not intercept the manifest, service worker or icons.
- `localStorage` is used only for per-device conveniences (banner dismissal, visit count), wrapped in
  try/catch, with the page working if storage is blocked — as the theme script already does.
- Every new client file follows rule 7 (no silent failures) — a failed service worker registration is
  logged, not swallowed.

## Open Questions
- **Global rule — DECIDED 2026-11-16, written only AFTER this ships.** This item is the proving
  ground: work out the kinks here, then write BOTH halves together as the last step of the item:
  - a short rule in `~/.claude/CLAUDE.md` §2 Core Principles, **triggered when starting any new web
    app**: ask whether it should be a PWA, and if yes, single-window launch + the in-app install flow
    come with it (option "b" — the user wants it part of the conversation at the root of building
    an app, not retrofitted later);
  - a global checklist `~/.claude/memory/pwa-install-and-single-window.md` (indexed in
    `~/.claude/memory/MEMORY.md`), written **stack-agnostic** — behaviours, not Next.js file names —
    because the global file keeps framework details in each project. It must carry what was learned
    here: the iframe/duplicate-tab catch, iPhone and Firefox limits, and "install copy must be true
    for that app" (no offline promise without offline support).
  Draft rule wording proposed in the 2026-11-16 discussion; revise it from the build's lessons.
- A real app icon/logo to replace the favicon-derived placeholders — does one exist?
