# Plan: Calendar B — Month View & Rotation UI

**Created:** 2026-08-18
**Type:** feature
**Phase:** 3 of 13 — part 2 of 2 ([plans/03-calendar.md](03-calendar.md))
**Structure:** Sequential — **depends on `calendar-a-rules-and-api.md` being complete and committed**

---

## Overview

The month view every later planning module hangs off, plus the two editing surfaces behind
it. `calendar-a` landed the rules, the migration and the five routes; this slice is the
first time any of it is visible.

**Key requirements**

1. A month grid on desktop and a vertical card list at 375px — same data, two layouts
2. Each Sunday cell shows date, type badge, conducting counselor and notes, with **space
   already designed in** for the pipeline status, speaker names and goal alerts Phase 4 adds
3. Pipeline-stage colour tokens defined once, in both themes, ready for Phase 4 to consume
4. A Sunday detail page — a stub for assignments, a real editor for type, notes, conducting,
   slots and the Fast Sunday pin
5. The 409 Fast Sunday collision surfaces as a confirmation the user can read and act on,
   never as a generic error
6. A rotation editor that states plainly that changes apply forward only

**Success criteria**

- `/calendar` renders for every role holding `calendar.view`; `NotPermitted` for the rest
- Marking the first Sunday of a month as Stake Conference moves Fast Sunday to the second,
  visibly, without a reload of the wrong data
- Doing that when the second Sunday holds assignments shows the warning text with the real
  count and applies only on confirm
- Grid at `md:` and up, cards below, light and dark, checked at 375px
- Harness scenario 010 walked end to end with its results recorded
- `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` all pass

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `app/globals.css` | modify | Nine pipeline-stage colour tokens, light and dark, plus `@theme inline` mapping |
| `types/domain.ts` | modify | `PIPELINE_STAGE_LABELS` beside the existing `PIPELINE_STAGES` |
| `app/(app)/calendar/page.tsx` | create | Server Component — month resolution, generation-on-load, permission gate |
| `app/(app)/calendar/MonthNavigation.tsx` | create | Client — previous/next/today, month in the URL |
| `app/(app)/calendar/ConductingRotationPanel.tsx` | create | Client — reorder, `effective_from`, the forward-only sentence |
| `app/(app)/calendar/sunday/[id]/page.tsx` | create | Server Component — detail, with the Phase 4 assignment stub |
| `app/(app)/calendar/sunday/[id]/SundayEditor.tsx` | create | Client — the patch form and the 409 confirmation dialog |
| `components/calendar/MonthGrid.tsx` | create | `md:` and up — 7-column grid |
| `components/calendar/SundayCell.tsx` | create | One cell in the grid, with the Phase 4 placeholder regions |
| `components/calendar/SundayCard.tsx` | create | Mobile list item — same data, stacked |
| `components/calendar/SundayTypeBadge.tsx` | create | Type → token colour + label |
| `components/calendar/ConductingLabel.tsx` | create | User id → "Bro. Smith", or "Not set" |
| `lib/calendar/queries.ts` | modify | `listBishopricUsers()` for the conducting select |
| `tests/lib/calendarMonth.test.ts` | create | Month-parameter parsing and grid-padding maths |
| `tests/components/calendar/SundayCell.test.tsx` | create | Badge, conducting fallback, notes truncation |
| `testing/scenarios/calendar/scenario-010-fast-sunday-shift/` | create | Seed + walkthrough — the phase's one manual scenario |
| `plans/03-calendar.md` | modify | Tick the Definition of Done; record what scenario 010 found |

---

## Dependencies

- **`calendar-a` must be committed first.** This slice imports its `Sunday` type,
  `FastSundayCollision`, `SUNDAY_TYPE_LABELS`, the date helpers, and the five routes.
- **No new packages.** `components/ui/Modal.tsx` (native `<dialog>`, from `roster-b`),
  `Card`, `Button`, `Input`, `FormError` and `NotPermitted` all already exist. TanStack Query
  is wired via `components/providers/QueryProvider.tsx` if a client component needs it —
  though most of this slice is Server Components with `router.refresh()`.
- **No new dependency for virtualization.** A month is at most six rows.

---

## Known Pitfalls (from retro context)

1. **A `ForbiddenError` escaping a Server Component becomes a 500 whose message Next.js
   strips in production.** Pages use `can()` + `<NotPermitted />`, never `assertCan()`. Only
   route handlers use `assertCan()`. `app/(app)/roster/page.tsx` carries this comment at the
   exact line — copy the pattern (`plans/retros/auth-b-invites-admin.md`).

2. **`searchParams` and `params` are Promises in Next 16, and must be typed explicitly.** Do
   not reach for the generated `PageProps` helper — it only exists after a build, so a fresh
   checkout fails to typecheck (`plans/retros/foundation-a-scaffold.md`). `roster/page.tsx`
   shows the explicit form.

3. **Timezone drift reaches the UI, not just the data layer.** `calendar-a` keeps every date
   a `YYYY-MM-DD` string; the moment a component calls `new Date(sunday.date)` and formats it
   for display, a browser west of UTC renders Saturday. **Format from the string** using the
   `parseDateOnly` + explicit `timeZone: "UTC"` option on `Intl.DateTimeFormat`. This is the
   phase's headline pitfall and the UI is where it will actually bite a user.

4. **No hardcoded hex values in components** (conventions.md §Styling) — they break dark
   mode. Every colour comes from a token in `app/globals.css`. The nine new stage tokens must
   be defined in *both* the `:root` and `.dark` blocks; a token defined only in one renders
   as nothing in the other.

5. **A frozen controlled component is the established fix for a picker that loses focus.**
   `roster-b` hit this and `components/roster/MemberPicker.tsx` records the pattern. If the
   conducting select or the rotation editor needs a search, follow it rather than rediscover
   it.

6. **A disabled button needs `aria-describedby` tying it to the reason it is disabled.**
   `roster-c` shipped a disabled Continue button whose explanation lived in a separate
   `role="status"` region, so a screen-reader user met a dead control and an unconnected
   announcement. Do not repeat it in the confirmation dialog.

7. **A `catch` that maps every throw to one message will eventually be wrong about the
   common case** (`roster-c`). The 409 here is a *successful* response with a meaningful
   body, not a network failure — check `response.status === 409` explicitly and read
   `collision` before falling through to any generic handler.

8. **Restart a dev server that has been up for hours before believing a 500.** Next 16's dev
   log is at `.next/dev/logs/next-development.log` (`plans/retros/roster-c-csv-import.md`).

---

## Tasks

### Task 1: Pipeline-stage colour tokens

**File:** `app/globals.css` (modify)

**Action:** Add nine stage tokens to `:root`, nine overrides to `.dark`, and nine entries to
`@theme inline`. Follow the existing block's exact shape — `--stage-plan` in `:root`,
`--color-stage-plan: var(--stage-plan)` in `@theme inline`.

The nine names come from `PIPELINE_STAGES` in `types/domain.ts` and must match it exactly:
`plan`, `review`, `approve`, `request`, `confirm`, `notify`, `speak`, `appreciate`,
`complete`.

**Details**

- 03-calendar.md asks for these to be "defined in the Tailwind config". There is no
  `tailwind.config.ts` — this project is Tailwind v4 and its theme is CSS-first in
  `app/globals.css`. Note the correction in `plans/03-calendar.md`.
- Design them as a **progression**, not nine unrelated hues: cool and muted at `plan`,
  warming through the middle, resolved green at `complete`. A reader should be able to tell
  roughly how far along a Sunday is without consulting a legend.
- Check contrast against `--surface` in both themes. A token that is legible on white and
  invisible on `#141414` is the failure this project's dark-mode rule exists to prevent.
- **Comment that Phase 4 owns the semantics and may retune the values, but not the names.**
  The names are the contract between the two phases; the hexes are not.
- Nothing in this slice renders a stage colour — Phase 4 does. Defining them now is the whole
  point: it stops Phase 4 rebuilding the cell layout to fit a palette that did not exist.

Also add `PIPELINE_STAGE_LABELS: Record<PipelineStage, string>` to `types/domain.ts`, beside
`PIPELINE_STAGES`, for the same reason `ROLE_LABELS` sits beside `ROLES`.

---

### Task 2: The month page

**File:** `app/(app)/calendar/page.tsx` (create)

**Action:** Server Component. Model it closely on `app/(app)/roster/page.tsx` — that file is
the reference for permission gating, explicit `searchParams` typing, and the two-layout
structure.

```ts
export type CalendarPageProps = {
  searchParams: Promise<{ month?: string }>;   // YYYY-MM
};
```

**Sequence**

1. `requireSessionUser()`, `createServerSupabaseClient()`, `resolveRoleAccess()`.
2. `can(user, "calendar.view", roleAccess)` → `<NotPermitted detail="The ward calendar is limited to ward leadership." />`.
   **Never `assertCan()` here** (Pitfall 1).
3. `const canManage = can(user, "calendar.manage", roleAccess)` and
   `const canManageRotation = can(user, "admin.manage_ward", roleAccess)` — two different
   gates, per `calendar-a` Decision 5.
4. Resolve the month: a valid `YYYY-MM` from the URL, otherwise the current month. Parse it
   with a helper in `lib/calendar/` (see Task 8), **not** with `new Date()` in the component.
5. `ensureMonthGenerated(user.wardId, monthStart, supabase)` — this is the on-demand
   generation path, and it is why the deferred cron is redundancy rather than a requirement.
   Only call it when `canManage`; a music coordinator opening an ungenerated month must see
   an empty month with an explanation, not a write attempt that RLS happens to allow but the
   route layer would refuse. Comment that reasoning.
6. Read the conducting rotation and the bishopric user list for the labels.
7. Render `<MonthGrid>` inside `hidden md:block` and the card list inside `md:hidden`.

**Details**

- The month is in the URL so the page stays a Server Component and the view is linkable —
  the same reasoning that keeps `?view=` the source of truth on `/roster`.
- An invalid `month` parameter falls back to the current month rather than erroring. A
  mistyped URL should show a calendar.
- Empty month (generation not run, no `calendar.manage`) gets an explicit message naming who
  can generate it, not a blank grid.

---

### Task 3: Month navigation

**File:** `app/(app)/calendar/MonthNavigation.tsx` (create)

Client component. Previous / Today / Next, each pushing `?month=YYYY-MM`. Month arithmetic
uses `addMonths` from `lib/calendar/dates.ts` — **never** `new Date(year, month + 1)`, which
is local-time and rolls over wrong at the year boundary in some zones.

Touch targets `min-h-11`, matching the roster pages.

---

### Task 4: `MonthGrid` and `SundayCell`

**Files:** `components/calendar/MonthGrid.tsx`, `components/calendar/SundayCell.tsx` (create)

**`MonthGrid`** — a 7-column grid with weekday headers. Only Sundays carry content; the other
six columns are inert spacers that give the month its familiar shape. Leading blanks before
the first Sunday come from a pure padding function (Task 8) so the arithmetic is testable
without a DOM.

**`SundayCell`** — the component 03-calendar.md asks to design *now* so Phase 4 does not
rebuild it:

```
┌─────────────────────────────┐
│ 8          [Fast Sunday]    │  ← date + SundayTypeBadge
│ Conducting: Bro. Andersen   │  ← ConductingLabel
│ "High Council visit"        │  ← notes, clamped to two lines
├─────────────────────────────┤
│ ░ speakers (Phase 4)        │  ← reserved region, renders nothing today
│ ░ pipeline status (Phase 4) │
│ ░ goal alerts (Phase 4)     │
└─────────────────────────────┘
```

**Details**

- The three reserved regions are **real optional props** (`speakers?`, `pipelineStatus?`,
  `goalAlerts?`), typed as `ReactNode` and rendering nothing when absent — not comments
  promising a future refactor. Phase 4 passes them in and changes no layout.
- The cell has a fixed minimum height so a month with one noted Sunday does not have one
  giant row. That minimum must already accommodate the reserved regions.
- Whole cell is a `<Link>` to `/calendar/sunday/[id]`.
- Notes clamp with `line-clamp-2`; the full text is on the detail page.
- No hardcoded colours (Pitfall 4).

---

### Task 5: `SundayCard`, `SundayTypeBadge`, `ConductingLabel`

**Files:** `components/calendar/SundayCard.tsx`, `SundayTypeBadge.tsx`, `ConductingLabel.tsx` (create)

- **`SundayCard`** — the same fields stacked, with the date spelled out (`Sunday, March 8`)
  since a card has no grid position to give it context. Same reserved-region props as the
  cell, so Phase 4 fills both layouts from one change.
- **`SundayTypeBadge`** — `SUNDAY_TYPE_LABELS[type]` plus a token background. `standard`
  renders **no badge at all**; badging the default state is noise on 46 Sundays a year to
  distinguish the 6 that matter.
- **`ConductingLabel`** — takes a user id and a lookup map, renders the name or a muted
  "Not set". Never renders a raw uuid. Reads first/last name from `users`, which migration
  020 makes ward-readable — no extra grant needed.

---

### Task 6: Sunday detail page and editor

**Files:** `app/(app)/calendar/sunday/[id]/page.tsx`, `SundayEditor.tsx` (create)

**Page** — Server Component. `const { id } = await params` (Pitfall 2). `notFound()` when the
Sunday does not exist or belongs to another ward. Shows the full record, and an **assignment
stub**: a section headed "Speakers" reading "The talk pipeline arrives in Phase 4." Gate the
stub on `talks.view` so it is bishopric-only from the start rather than being narrowed later
— exactly what `roster-a` did with the assignment-history tab.

**`SundayEditor`** — client component, rendered only when `canManage`.

Fields: type (select over `SUNDAY_TYPES`), notes, conducting user (select over bishopric
users), speaking slots, presiding override, and a **"Pin as Fast Sunday"** checkbox bound to
`fastSundayPinned`.

**Speaking slots is a free number input, 0 to `MAX_SPEAKING_SLOTS` (15) — never a
three-option select.** The bishopric sets the count per Sunday, and a testimony-style meeting
or a farewell with the whole family speaking is a real Sunday. Ward default aside, 3 is only a
starting value. Import the cap from `lib/validation/calendar.ts`; do not retype it.

The pin needs one line of help text under it, because it is the least obvious control in the
phase: *"Keeps this Sunday as Fast Sunday even if a conference is added earlier in the
month."*

**The 409 flow — the part worth getting right:**

1. `PATCH /api/sundays/[id]`.
2. `response.status === 409` → read `warning` from the body and open a `Modal` showing
   `warning.message` verbatim. The server owns that sentence; the client must not
   reconstruct it from the counts, or the two will drift the way `roster-c`'s preview and
   result screens did.

   `warning.reason` is one of `fast_sunday_moved`, `meeting_cancelled`, `fast_sunday_set` or
   `slots_reduced`. Use it for the dialog TITLE and nothing else — "This cancels a meeting"
   reads very differently from "Fast Sunday is moving", and a single generic heading over four
   different consequences is how somebody confirms the wrong thing. `warning.date` names the
   Sunday whose work is at risk, which on `fast_sunday_moved` is **not** the Sunday being
   edited.
3. Confirm → re-`PATCH` with `?confirm=true`.
4. On success where `assignmentsReverted > 0`, say so plainly: *"3 speakers moved back to
   the planning stage."* A silent success after that warning is worse than the warning. Those
   assignments still exist and do not count as talks that were given (04-talks-pipeline.md
   §Step 2) — say "moved back to planning", never "removed" or "cancelled".
5. Cancel → close, change nothing, leave the form as the user left it.
6. `router.refresh()` after a successful patch — the page is a Server Component and the grid
   behind it must re-read.
7. Any other non-OK status → the body's `error` string via `FormError`. Check 409 **before**
   any generic handler (Pitfall 7).
8. The confirm button in the dialog is `aria-describedby` the warning text (Pitfall 6).

---

### Task 6b: Default speaker count control

**File:** `app/(app)/calendar/CalendarSettingsPanel.tsx` (create)

The ward's default number of speakers, editable in the app rather than in code. `calendar-a`
built the whole API for this; nothing here is new logic.

- `GET /api/ward-settings/calendar` returns `{ defaultSpeakingSlots, maxSpeakingSlots }`.
- `PATCH` the same route with `{ defaultSpeakingSlots }`. It returns a `note` sentence — render
  it verbatim, the same rule the 409 dialog follows. It says the change applies to Sundays
  generated from now on and does not rewrite the calendar already on screen, which is the one
  thing a bishopric will otherwise assume wrong.
- Gate the control on `admin.manage_ward`, not `calendar.manage`. A `ward_secretary` may edit
  any individual Sunday but does not set what every future Sunday starts as. Show the current
  value read-only to anyone with `calendar.view`.
- Number input bounded 1 to `maxSpeakingSlots` from the response — not a hard-coded 15.
- Collapsed in a `<details>` beside the rotation panel; this is a set-once setting, not a
  daily control.

**Phase 11 renders the same setting on the admin settings page** through this same route. Do
not duplicate the rule into a second module — record the sibling in
`plans/11-notifications-admin.md` when this ships.

---

### Task 7: Conducting rotation panel

**File:** `app/(app)/calendar/ConductingRotationPanel.tsx` (create)

Rendered on `/calendar`, collapsed in a `<details>` like the roster's add-household panel,
and only when `canManageRotation` (`admin.manage_ward`).

- Three position selects over the bishopric user list, plus an `effectiveFrom` date input
  defaulting to the next Sunday.
- **A sentence that is not optional**, shown above the form, because 03-calendar.md Step 3
  requires the UI to say it: *"Changing the rotation applies from the effective date forward.
  Sundays already assigned keep their current conductor."*
- `PATCH /api/conducting-rotation`. On the unique-constraint 409 ("A rotation already takes
  effect on that date"), show the server's message — do not translate it.
- After success, note that the other bishopric members have been notified. The notification
  is a product requirement (CLAUDE.md §7); telling the user it happened is what makes shared
  authority feel shared rather than surprising.
- Read-only roles do not see the panel at all.

---

### Task 8: Month helpers

**File:** `lib/calendar/dates.ts` (modify — extend `calendar-a`'s module)

```ts
export function parseMonthParam(value: string | undefined, today: DateOnly): DateOnly;
export function monthLabel(monthStart: DateOnly): string;        // "March 2026", UTC-formatted
export function leadingBlankDays(monthStart: DateOnly): number;  // 0–6, for the grid
export function formatSundayLabel(date: DateOnly): string;       // "Sunday, March 8"
```

`today` is a **parameter, not a call to `new Date()` inside the function** — that is what
makes these testable without freezing the clock, and it matches how the rest of this codebase
keeps pure functions pure.

Every formatter passes `timeZone: "UTC"` to `Intl.DateTimeFormat` (Pitfall 3).

---

### Task 9: Close out the phase

**File:** `plans/03-calendar.md` (modify)

Tick the Definition of Done, note the Tailwind-v4 token correction, and record what scenario
010 actually found — including anything that failed. `roster-c`'s walkthrough found two real
bugs in 45 checks; a scenario recorded as "walked, all passed" when it was not is worse than
one not walked at all.

---

## Testing Strategy

Component tests here are thin on purpose: the valuable logic is already unit-tested in
`calendar-a`, and this slice's real verification is the harness walkthrough. Test what a
scenario cannot see cheaply, and let the browser cover the rest.

### `tests/lib/calendarMonth.test.ts`
- `parseMonthParam` accepts `2026-03`, rejects `2026-13`, `march`, `2026-3`, `undefined`,
  each falling back to the month containing `today`
- `leadingBlankDays` for a month starting on a Sunday (0) and on a Saturday (6)
- `monthLabel` and `formatSundayLabel` produce the UTC day, not the local one — assert
  against a date that differs between UTC and a US timezone
- `parseMonthParam` never reads the system clock

### `tests/components/calendar/SundayCell.test.tsx`
Testing Library, matching the existing `tests/components/roster/` suites.
- A `standard` Sunday renders **no** badge; a `fast_sunday` renders "Fast Sunday"
- A null `conductingUserId` renders "Not set", never a uuid
- The three reserved regions render nothing when their props are absent, and render their
  content when passed — this is the assertion that proves Phase 4 can fill them without a
  layout change
- Notes longer than two lines are clamped and the cell keeps its minimum height

### Not tested here, and why
- **Route handlers** — no local server, sixth phase running (`roster-c` retro). Scenario 010
  drives them by hand, including the 403 and 409 paths.
- **Colour token values** — a hex is not a behaviour. Contrast is checked by eye in the
  scenario, in both themes.

---

## Test Scenarios (Harness)

### Scenario 010: Move Fast Sunday with a conference

**Path:** `testing/scenarios/calendar/scenario-010-fast-sunday-shift/`
**Tags:** `[calendar, full, fast-sunday]`
**Prerequisites:** none

**Purpose**

The Fast Sunday rule is the phase's highest-risk logic and its failure mode is quiet: a
calendar that looks right and has silently orphaned three speakers. The unit tests prove the
rule; only a walkthrough proves the *warning reaches a human in words they can act on*, and
that confirming it moves the assignments rather than deleting them. The reverse direction —
clearing a conference and watching Fast Sunday move back **earlier** — is the case
03-calendar.md names as the easiest to forget, and it is invisible in a single-direction test.

**Seed data summary**

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) — holds `calendar.manage` **and** `admin.manage_ward` |
| | `secretary` (ward_secretary, Ruth Kaufman) — holds `calendar.manage`, **not** `admin.manage_ward` |
| | `music` (music_coordinator, Elena Vasquez) — holds `calendar.view` only |
| | `eqpres` (org_president, Tomas Ruiz) — holds **no** calendar permission |
| | `counselor1` (counselor, position 1) and `counselor2` (counselor, position 2) — rotation targets and notification recipients |
| Sundays | One month generated: 2026-03-01, 03-08, 03-15, 03-22, 03-29 |
| | 03-01 is `fast_sunday`, `speaking_slots = 0`; the rest `standard`, `speaking_slots = 3` |
| Members | 3 active adults, for the seeded assignments |
| Assignments | 3 on **2026-03-08**, `pipeline_stage = 'approve'` — the collision |
| Conducting rotation | Three positions effective 2026-01-04: bishop, counselor1, counselor2 |
| Notification triggers | all, including `admin_setting_changed` |

March 2026 is chosen deliberately: it contains the 2026-03-08 US DST transition, so a
timezone bug in the grid shows up as a visibly wrong date rather than as a subtle off-by-one
somewhere else.

**Tester action**

Sign in as `bishop`, open `/calendar?month=2026-03`, and work through: reading the month,
marking 03-01 as Stake Conference, meeting the warning, cancelling it, re-doing it and
confirming, checking what happened to the three assignments, clearing the conference again,
pinning a Fast Sunday, reordering the rotation, then re-checking the whole page as
`secretary`, `music` and `eqpres`.

**Verification checklist**

Reading the month
- [ ] Grid renders at desktop width with March 1, 8, 15, 22, 29 in the correct week rows
- [ ] At 375px the grid is replaced by a card list — no horizontal scrolling anywhere
- [ ] **March 8 reads "March 8", not "March 7"** — the DST check
- [ ] March 1 shows a "Fast Sunday" badge; the other four show no badge at all
- [ ] Conducting shows a name on every Sunday, cycling bishop → counselor1 → counselor2
- [ ] Dark mode: every badge and token is legible against the surface

The collision warning
- [ ] Marking March 1 as Stake Conference opens a warning, not a generic error
- [ ] The warning names March 8, names Fast Sunday, and says **3** speakers
- [ ] Cancelling leaves March 1 as Stake Conference **unapplied** — reload and confirm March 1
      is still `fast_sunday` and March 8 still has 3 slots
- [ ] Confirming moves Fast Sunday to March 8 and sets its speaking slots to 0
- [ ] The success message says the 3 speakers moved back to planning
- [ ] **The three assignments still exist**, at `pipeline_stage = 'plan'` — check the database,
      not just the screen. Deletion is the failure this scenario exists to catch
- [ ] March 1 shows a "Stake Conference" badge

The reverse direction
- [ ] Clearing March 1 back to Standard moves Fast Sunday **back to March 1**
- [ ] March 8's speaking slots return to 3
- [ ] The three assignments are **still** at `plan` — moving Fast Sunday back does not undo
      the revert, and should not pretend to

The pin
- [ ] Pinning March 15 as Fast Sunday clears the fast marker from March 1
- [ ] Marking March 1 as Stake Conference now changes nothing about March 15
- [ ] Clearing the pin lets the rule take over again

Rotation
- [ ] The rotation panel shows the forward-only sentence before any control
- [ ] Reordering with an effective date of 2026-03-15 leaves March 1 and 8 unchanged
- [ ] March 15, 22 and 29 follow the new order
- [ ] `counselor1` and `counselor2` each receive an `admin_setting_changed` notification;
      the bishop who made the change does **not**
- [ ] An `audit_log` row exists for `conducting_rotation_updated` and for each `sunday_updated`

Permissions
- [ ] `secretary` sees the calendar and can edit a Sunday, but the rotation panel is **absent**
      rather than disabled
- [ ] `music` sees the calendar read-only — no editor, no rotation panel
- [ ] `eqpres` sees no Calendar link in the sidebar, and `/calendar` shows `NotPermitted`
- [ ] `eqpres` PATCHing `/api/sundays/[id]` directly gets a 403 — this is the check that
      matters, because migration 019 grants the underlying UPDATE to every ward member

**Seed file:** `seed.ts` following `testing/scenarios/_templates/seed-template.ts`. Register
in the manifest with `npm run manifest`.

---

## Validation Commands

```bash
# Linting
npm run lint

# Type checking
npm run typecheck

# Tests
npm run test

# Harness typecheck + seed for scenario 010
npm run harness:typecheck
npm run manifest
npm run seed -- scenario-010-fast-sunday-shift

# Production build
npm run build
```

Then walk scenario 010 in a browser — at 375px and at desktop width, in both themes. And on
a real phone if convenient: the app is live at `https://wlt-iota.vercel.app`, which is why
deployment was done out of order.

---

## Integration Notes

- **`/calendar` stops 404ing.** `NAVIGATION_ITEMS` already points at it; no change to
  `lib/auth/navigation.ts` is needed, which is the payoff of that file's one-entry-per-module
  design.
- **No breaking changes.** All new files except three additive edits (`globals.css`,
  `types/domain.ts`, `lib/calendar/dates.ts`) and the phase-plan close-out.
- **Hands forward to Phase 4:** `SundayCell` and `SundayCard`'s three reserved props, the
  nine stage colour tokens, and the `/calendar/sunday/[id]` route whose Speakers section is
  Phase 4's landing spot. Phase 4 should need to change no layout in this slice.
- **Hands forward to Phase 6:** `slot_config` is now validated on write, so the program
  builder can trust its shape.
- **Known gap to carry into the retro:** the revert-to-`plan` path notifies nobody.
  03-calendar.md asks for the planner to be notified and there is no trigger key for it in
  `supabase/seed/notification_triggers.sql`. Adding one that fires into nothing would be
  worse than the gap — Phase 4 owns the pipeline and should add the key with the feature.
- **Also carry forward:** `scenario-008` (roster-b) is still unwalked, handed forward twice
  now, and `roster-c`'s CSV alias table is still unverified against a real LCR export.
  Neither belongs in this phase, but both are still open.
