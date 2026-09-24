---
id: p5-c-schedule-and-my-appointments
type: feature
iter: null
commits: ["6ae159b"]
date: 2026-09-24
files:
  - app/(app)/todos/ScheduleDialog.tsx
  - app/(app)/todos/TodoCard.tsx
  - app/(app)/todos/SmallButton.tsx
  - lib/todos/scheduleInstant.ts
  - lib/todos/viewState.ts
  - lib/todos/queries.ts
  - lib/appointments/myAppointments.ts
  - lib/appointments/queries.ts
  - lib/appointments/appointmentsView.ts
  - app/(app)/appointments/page.tsx
  - app/(app)/appointments/AppointmentList.tsx
  - app/(app)/appointments/CalendarSyncCard.tsx
  - lib/users/userSettings.ts
  - lib/validation/pageView.ts
  - app/api/session/page-view/route.ts
  - components/roster/MemberPicker.tsx
  - lib/auth/navigation.tsx
  - app/(app)/sacrament/page.tsx
  - types/domain.ts
related: [p5-a-todo-core, p5-b-agenda-link-two-keys, youth-b-ics-import, sacrament-references-over-pgvector]
---

## What was done
The last P5 slice of [plans/todo-and-my-appointments.md](../todo-and-my-appointments.md). It closes P5.
- **"Schedule this" on a to-do.** A window reads a day and time as the **ward's** wall clock,
  converted through `wallClockToInstant`. It can name a member from anywhere in the ward, and its
  optional note becomes a timeline line.
- **`/appointments` (My Appointments).** One pure function, `buildMyAppointments()`, aggregates
  visit appointments you made, scheduled to-dos and youth events you signed up for. P6's meeting
  invites join it as a fourth source.
- **After walking scenario 077, the user reshaped the page:**
  - grouped by the ward's day, with every other day on a gold band
  - each day collapsible, plus Expand all / Collapse all
  - an item moves to Past only once its ward day has ended, and is greyed once its time has passed
  - the page reopens exactly as it was left, stored on the account (`users.settings.page_views`,
    through a generic `PUT /api/session/page-view`)

Walked twice by an agent. The user passed the judgement checks.

## Key decisions
- **Every page remembers how it was left.** This is a standing user rule, now saved as a memory.
  The view is stored on the ACCOUNT, not in the browser, so it follows the person between devices
  and the server renders it correctly on first paint.
  - The stored shape is a **default plus exceptions** (`collapsed` + `toggledDays`), so "Collapse
    all" also covers next week's new days.
  - `toggledDays` is pruned to the days on screen, which keeps the view inside the column's 4 KB
    ceiling.
  - A page joins by adding one entry to `lib/validation/pageView.ts`.
- **One audit row per save**, following rule 6 and the quick-links precedent. The page waits
  500ms, so a burst of clicks is one row. Walked: three clicks 50ms apart gave one row.
- **A scheduled time counts like a do date on the ward's day**, except that a passed, undone one is
  **Overdue**. `todoViewState()` and `compareTodos()` now take `wardZone`.
- **`MemberPicker` gained an opt-in `wholeWard`.** Off by default, so no other caller changed. Org
  leaders' pickers otherwise open on their own organization.
- **Icon-only `SmallButton`** (`label` optional, `min-w-11`) on the to-do card. Three labelled
  buttons crushed the title to 36px at 375px.
- **Deviations from the plan, recorded in code:**
  - `TodoSummary.scheduledWithMemberName`, via the ward-scoped member embed (rule 9, same change)
  - `lib/todos/scheduleInstant.ts`, the pure ward-clock ↔ instant pair
  - My Appointments' reads filter to the caller on visits and youth, because that is the question,
    not a second copy of a policy. The to-do read does not, since RLS is owner-only.
  - The Sacrament shortcut row carries no `?from=`, so `/todos` shows no contextual back link from
    there.
- **module-map §6.5 changed by the user.** My Appointments was "flat list + showPast". The table
  now records the new shape and the date.

## What broke, and the pattern behind it
- **077-D1: adding a third labelled button squeezed to-do titles to a word per line at 375px.** The
  scenario line "buttons stay on one row" passed while the title was crushed.
  **Pattern:** a layout check must name what gives way, not only what holds. It now also requires
  the title to keep a readable width.
- **077-D2: a scheduled to-do read "Someday" beside its own time.** p5-a's state function predated
  the column it ignored. **Pattern:** when a slice starts writing a field that already existed,
  re-read every computed state over that entity.
- **The seed hid a real product question.** Samuel was in no organization, so the org leader's
  picker showed "There are no members in the roster yet", which was untrue. The walk turned it into
  a decision (whole ward) rather than a quiet seed fix.
- **Greying first applied inside Past too**, where an all-day row is never "started", so the past
  list was half grey. Now it applies to the upcoming list only. **Pattern:** a visual state that is
  meaningful in one section should be scoped to that section.
- **`react-hooks/refs` rejected a ref-based debounce used from click handlers.** Replaced with a
  change counter plus an effect whose cleanup clears the previous timer.
- **`navigation.test.ts`'s exact list changed deliberately:** `/appointments` joins `/todos` as
  un-removable, because `personal_tools.use` is non-overridable.
- **Environment, not defects:**
  - A reseed failed with `fetch failed`, and a full run had 4 `Gateway Timeout` failures in an
    untouched file (20/20 alone): hosted-DB load again.
  - Stopping a background `npm run dev` orphaned its Next.js child on :3000; it was found with
    `Get-NetTCPConnection` and stopped.
  - One hydration warning was Playwright's screenshot caret-hiding style on the header's textarea.
  - The build was held until the user's dev server was stopped (the
    `sacrament-references-over-pgvector` lesson, applied).
