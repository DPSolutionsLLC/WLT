---
id: calendar-b-month-view
type: feature
iter: null
commits: []
date: 2026-08-19
files:
  - app/globals.css
  - types/domain.ts
  - lib/calendar/dates.ts
  - lib/calendar/queries.ts
  - app/(app)/calendar/page.tsx
  - app/(app)/calendar/MonthNavigation.tsx
  - app/(app)/calendar/ConductingRotationPanel.tsx
  - app/(app)/calendar/CalendarSettingsPanel.tsx
  - app/(app)/calendar/sunday/[id]/page.tsx
  - app/(app)/calendar/sunday/[id]/SundayEditor.tsx
  - components/calendar/MonthGrid.tsx
  - components/calendar/SundayCell.tsx
  - components/calendar/SundayCard.tsx
  - components/calendar/SundayTypeBadge.tsx
  - components/calendar/ConductingLabel.tsx
  - testing/infrastructure/seedUtils.ts
  - plans/03-calendar.md
  - plans/11-notifications-admin.md
related:
  - calendar-a-rules-and-api
  - roster-c-csv-import
  - roster-b-picker-and-orgs
  - roster-a-data-and-pages
  - auth-b-invites-admin
  - foundation-a-scaffold
---

## What was done

The `/calendar` month view every later planning module hangs off: a seven-column grid from `md:` up
and a card list at 375px, both fed by the same data. Behind it, a Sunday detail page with a real
editor for type, notes, conducting, speaking slots, presiding and the Fast Sunday pin — including
the 409-and-confirm dialog that `calendar-a` built the API for but nothing yet rendered.

Also the nine pipeline-stage colour tokens and `PIPELINE_STAGE_LABELS`, defined now and rendered by
nothing, so Phase 4 does not have to rebuild the Sunday cell to fit a palette that did not exist
when the cell was designed. Scenario 010 walked with 46 checks and no code defects.

## Key decisions

- **The reserved regions are real props, not a promise.** `SundayCell` and `SundayCard` both take
  `speakers`, `pipelineStatus` and `goalAlerts` as optional `ReactNode`s that render nothing when
  absent, and the cell's `min-h-40` already accommodates them. A component test asserts both halves
  — that is what makes "Phase 4 changes no layout" checkable rather than aspirational, and it is
  why both layouts take the same three props: one Phase 4 change fills the grid and the mobile list
  together.
- **Generation only runs for somebody who could write anyway.** `ensureMonthGenerated()` is called
  only when the viewer holds `calendar.manage`. Migration 019 grants INSERT and UPDATE on `sundays`
  to every authenticated ward member, so RLS would happily let a music coordinator generate a month
  by opening it — a read-only page that quietly writes is a surprise nobody asked for. They get an
  empty month naming who can create it.
- **Every date on screen is formatted from the string, in UTC.** `monthLabel`, `formatSundayLabel`
  and `leadingBlankDays` all pass `timeZone: "UTC"` to `Intl`, and the grid slices the day number
  out of `YYYY-MM-DD` rather than calling `getDate()`. `today` is a parameter on every month helper,
  never a `new Date()` inside one, which is what makes them testable without freezing the clock and
  keeps the client components from constructing a date of their own.
- **The server owns the warning sentence; the client owns only the title.** The 409 dialog renders
  `warning.message` verbatim and uses `warning.reason` for the heading and nothing else. Four
  different consequences under one generic "Are you sure?" is how somebody confirms the wrong
  thing, and rebuilding the sentence from the counts is the drift `roster-c` shipped twice.
- **`standard` Sundays get no badge.** Badging the default state is noise on the 46 ordinary Sundays
  a year and drowns out the 6 that matter.
- **`CalendarSettingsPanel` takes its initial values as props rather than fetching.** The page is a
  Server Component that has already read them; a `GET` on mount would only buy a loading state. It
  still `PATCH`es the shared route, so Phase 11's admin page has one write path to reuse.

## Pitfalls hit

- **The plan's rotation expectation contradicted `calendar-a`'s own design.** It expected a rotation
  effective mid-March to rewrite the second half of March. It does not, and must not:
  `conducting_user_id` is stored rather than computed (03-calendar.md Step 3, so a rotation change
  cannot rewrite history), and `populateConducting()` only fills rows that are still null. A new
  rotation therefore reaches months generated *after* its effective date — which is precisely what
  the forward-only sentence promises. Caught while writing the scenario checklist, not while
  running it. The lesson: a checklist item that asserts behaviour nobody has traced through the data
  layer is a guess, and writing it out is when the guess becomes visible.
- **A `<dialog>`-based modal needs its confirm button tied to the warning text.** `roster-c` shipped
  a disabled control whose explanation lived in a separate `role="status"` region, so a screen-reader
  user met a dead button and an unconnected announcement. Here the confirm button is
  `aria-describedby` the paragraph holding the server's sentence.
- **`next/link` renders fine in jsdom** without an App Router context mock, so the cell tests assert
  the real `href`. Worth knowing before reaching for a mock in Phase 4.

## Known gaps

- **The rotation cadence is wrong for this ward.** Conducting advances one step per Sunday, which is
  what 03-calendar.md Step 3 specifies and what shipped. The ward actually rotates **month by
  month** — one bishopric member takes every Sunday in a month. No test could have caught this: the
  code does correctly what the spec asked for, and the spec was wrong. Surfaced by walking scenario
  010. Handed to `calendar-c` along with the same cadence choice for organization presidencies
  conducting their own Sunday meetings, and per-Sunday override for both. Needs a migration.
- **The revert-to-`plan` path still notifies nobody.** Inherited from `calendar-a` and unchanged:
  03-calendar.md asks for the planner to be notified and there is no trigger key for it. Phase 4
  owns the pipeline and should add the key with the feature rather than firing into nothing.
- **`scenario-008` (roster-b) is still unwalked**, handed forward three times now, and `roster-c`'s
  CSV alias table is still unverified against a real LCR export. Neither belongs to this phase, but
  both are still open.
- **Colour token values are unverified against a real palette review.** Contrast was checked by eye
  in both themes during scenario 010, not measured. Phase 4 owns the semantics and may retune the
  hexes; the nine **names** are the contract and must not change.
