# Plan: A rolling year of Sundays, and `/music` as the prototype's collapsed list

**Created:** 2026-09-23
**Type:** feature
**Phase:** P4 module 1 (Sacrament), slice `a` follow-up — completing what `06910f8` got
structurally right and shaped wrong.
**Structure:** Unified, two independent slices. **Slice 1 ships on its own and should be
committed before slice 2 starts** — it benefits five modules and slice 2 is easier to walk once
the dates exist.

---

## Overview

Two problems, one root: **a Sunday that does not exist yet.**

**Slice 1 — the clunky loop.** `sundays` rows are created a month at a time, by somebody with
`calendar.manage` opening that month on `/calendar`. So reaching a date further out means: open
the module, see nothing, go to `/calendar`, navigate there, come back. The user hit this and
described it exactly. Generation already accepts arbitrary ranges (its validation guard is
*"Generate 24 months or fewer at a time"*) and `applyConductingReshift`'s own comment already
reads *"a year of Sundays is three round trips rather than fifty-two"* — **the codebase was
written expecting this.** Generate a rolling 12 months instead of one.

**Slice 2 — `/music` is the wrong shape.** The prototype opens it as a **collapsed list of dates
you click into**; WLT ships a flat list of fully-expanded cards with month navigation. See
[plans/prototype/module-map.md](prototype/module-map.md) §6.2.

### This REVERSES the month board shipped in `06910f8`

`plans/retros/p4-sacrament-music-month.md` closed defect 072-D1 by replacing `/music`'s rolling
horizon with a month board. **The defect and the diagnosis were right; the mechanism was not.**
The prototype closes the same defect by keeping a rolling list and **inserting the jumped-to date
into it**. The month decision was confirmed with the user on 2026-09-22 and reversed on
2026-09-23 after they saw it deployed.

**What survives from `06910f8`:** `sundayPillHrefs()` in `lib/sacrament/sundayStatus.ts` (the move
out of the page was right and its tests stay), the `#sunday-<id>` anchor on the card, and the
two-empty-states insight — a month/window has more than one way to be empty.
**What goes:** `MonthNavigation` on `/music`, `parseMonthParam`, and the month range.

### Success criteria

- Opening `/music` shows a **collapsed list**, one card per Sunday, none expanded, and clicking a
  card opens **that one** and closes any other.
- `Music 2/3` on any Sunday at any distance opens `/music` with **that Sunday already expanded**,
  including a Sunday outside the 8-week window, which appears in the list **in date order**.
- A bishopric member opening `/calendar` once leaves **12 months of Sundays** in place, so every
  Sunday-keyed module (`/music`, `/prayers`, `/assignments`, `/sacrament`, `/program`) can reach a
  date a year out with no round trip through the calendar.
- Repeat visits to `/calendar` do **no** extra writes once the horizon is full.
- `tests/lib/explicitTimeZone.test.ts` and `tests/lib/navigationRoutesExist.test.ts` stay green.

---

## Relevant Files

**Slice 1**

- `lib/calendar/queries.ts` — **modify** — add `ensureHorizonGenerated()`. **Do not widen
  `ensureMonthGenerated()`** — see the trap in Known Pitfalls.
- `app/(app)/calendar/page.tsx` — **modify** — call the horizon before the month repair.
- `tests/lib/calendarHorizon.test.ts` — **create** — the pure coverage arithmetic.
- `tests/rls/calendar-access.test.ts` — **modify** — assert a non-manager still triggers no write.

**Slice 2**

- `app/(app)/music/page.tsx` — **modify** — window instead of month; resolve the jump; pass the
  back-link context down.
- `app/(app)/music/MusicSundayList.tsx` — **create** — `"use client"`, owns `openSundayId`.
- `app/(app)/music/SundayMusicCard.tsx` — **modify** — becomes `"use client"`; gains a collapsed
  summary row and a Collapse control.
- `lib/music/sundayWindow.ts` — **create** — the pure window + insert-the-jumped-date rule.
- `lib/sacrament/sundayStatus.ts` — **modify** — the Music href changes shape.
- `app/(app)/sacrament/page.tsx` — **no change** — it calls `sundayPillHrefs()` and does not know
  the shape.
- `components/layout/ContextualBackLink.tsx` — **create** — the first one in the app.
- `tests/lib/musicSundayWindow.test.ts` — **create**.
- `tests/lib/sacramentSundayStatus.test.ts` — **modify** — the Music href cases.
- `testing/scenarios/talks/scenario-072-one-sunday-six-pills/scenario.md` — **modify**.
- `testing/scenarios/music/scenario-036-choosing-hymns-for-a-sunday-with-topics/scenario.md` —
  **modify**.

**No migration. No RLS policy change. No new dependency.**

## Dependencies

All existing:

- `firstSundayOnOrAfter`, `sundaysInRange`, `countSundaysBetween`, `addMonths`, `monthStart`,
  `lastDayOfMonth`, `formatDateOnly` from [lib/calendar/dates.ts](../lib/calendar/dates.ts)
- `generateSundayRange`, `ensureMonthGenerated`, `listSundays` from
  [lib/calendar/queries.ts](../lib/calendar/queries.ts)
- `holdsSacramentMeeting` from [types/domain.ts](../types/domain.ts)
- `HYMNS_PER_SUNDAY` from [lib/sacrament/sundayStatus.ts](../lib/sacrament/sundayStatus.ts)

---

## Known Pitfalls (from retro context)

### 🔴 `ensureMonthGenerated()`'s repair passes ARE month-scoped, and widening them is a real bug

**This is the single most likely thing to get wrong in slice 1.** That function does two jobs:
generate, then **repair a half-generated month**. The repair is deliberately narrow, and its own
comments say why — `calendar-c`'s retro is about exactly this class of bug, a read that re-runs
writes on every page view.

`needsFastSunday` asks *"does **this month** have no Fast Sunday at all?"*. Over a **year** that
question is meaningless: a year always has some Fast Sunday, so a genuinely half-generated month
inside the range would test `false` and never be repaired. Widening the range silently disables
the repair.

**So `ensureHorizonGenerated()` GENERATES AND NEVER REPAIRS**, and `ensureMonthGenerated()` keeps
its month scope and its repair. The calendar page calls both, horizon first. Two functions, two
jobs — do not merge them.

### Other pitfalls

- **`calendar-c-rotation-cadence` / `calendar-b-month-view`** — half-generated months, and a read
  that writes on every view. The coverage check exists to make the horizon a **no-op** once full;
  if it is not exact, this becomes a 52-row upsert on every calendar page load.
- **`p4-sacrament-music-month`** — the retro being reversed. Its "Pattern" section is still
  correct and is worth re-reading: *a deep link is two halves, and a green test suite can only
  ever see one of them.* The unit tests below cover the href and the window arithmetic; **only
  the walk can prove the destination honours the jump.**
- **`roster-b-picker-and-orgs`** — (a) a parameter the destination silently ignores: `?month=` on
  `/music` becomes dead. It is one day old with no real bookmarks, so it is ignored rather than
  redirected — but say so in the code. (b) **A VALUE import of a `queries.ts` from a client
  component pulls in `next/headers` and fails only `npm run build`.** `SundayMusicCard` becomes
  `"use client"` in this slice; its `@/lib/music/queries` import is **already type-only** and must
  stay that way.
- **`ai-b-knowledge-and-retrieval`** — the plural bug. Any count sentence keeps a singular branch.
- **CLAUDE.md rule 12** — every formatter names its zone. These are `date` columns, so **UTC is
  correct**, not the ward's. Add no new bare `Intl` call.
- **`p4-sacrament-a` / `youth-a-D1`** — offering a link that refuses on arrival. Unchanged:
  `/music` gates on `music.view`, the hub on `talks.view`, and a `music_coordinator` holds both.
- **`notification-trigger-drift`** — one fact in several places. The 8 is defined **once**, in
  `lib/music/sundayWindow.ts`, and the scenarios reference it rather than restating it.

---

## Tasks

## SLICE 1 — a rolling year of Sundays

### Task 1.1: `ensureHorizonGenerated()`

**File:** `lib/calendar/queries.ts` (modify)
**Action:** Add an exported function that keeps a rolling horizon of Sundays generated.

```ts
export const CALENDAR_HORIZON_MONTHS = 12;

export async function ensureHorizonGenerated(
  wardId: string,
  today: DateOnly,
  client?: SupabaseClient<Database>,
): Promise<void>
```

**Details:**

- Range is **whole months**: `from = monthStart(today)`,
  `to = lastDayOfMonth(addMonths(from, CALENDAR_HORIZON_MONTHS - 1))`. `generateSundays()` widens
  to whole months anyway (its own comment says so), so matching that here keeps the coverage
  arithmetic exact.
- **The coverage check comes first and must be cheap.** Count the ward's existing `sundays` rows
  in the range with a `head: true, count: "exact"` select — no rows fetched — and compare against
  `sundaysInRange(from, to).length`. **Equal means return immediately, doing nothing.** This is
  what stops it becoming a write on every calendar page view.
  - The comparison is exact and safe: every Sunday date gets a row whatever its type — a
    cancelled Sunday and a stake conference both have one — and `(ward_id, date)` is unique, so
    the count can never exceed the expected number.
- If short, call `generateSundayRange(wardId, from, to, supabase)` **once for the whole range**.
  It is `INSERT ... ON CONFLICT DO NOTHING` (`ignoreDuplicates: true`), so it fills only the gaps
  and cannot overwrite a bishopric edit. That line is described in its own comment as the most
  dangerous in the phase — do not touch it.
- **NO REPAIR PASSES.** No `resolveMonth`, no `populateConducting`, no `populateOrgConducting`.
  Those are `ensureMonthGenerated()`'s and they are month-scoped for the reason in Known Pitfalls.
  Write that as a comment on this function, naming `needsFastSunday` specifically, because the
  next reader's instinct will be to "finish the job" here.
- **Returns `void`, deliberately.** It is a side effect, not a read. The caller re-reads what it
  actually needs. Returning a year of Sundays would invite a page to render off it.
- **No audit row.** Generation triggered by a page view writes none today (`ensureMonthGenerated`
  does not), and only the explicit `POST /api/sundays` `mode: "generate"` does. Keep that split;
  an audit row per calendar visit is noise, and this one is idempotent.

### Task 1.2: Call it from the calendar page

**File:** `app/(app)/calendar/page.tsx` (modify)
**Action:** Run the horizon before the month, under the existing `canManage` gate.

```ts
const sundays = canManage
  ? await ensureHorizonGenerated(user.wardId, today, supabase).then(() =>
      ensureMonthGenerated(user.wardId, month, supabase),
    )
  : await listSundays(user.wardId, range, supabase);
```

**Details:**

- **Order matters and both calls are needed.** The horizon creates rows across the year; the month
  call then finds the viewed month already present, skips generation, and does its **repair**
  checks on it. Drop either and you lose the year or the repair.
- **The `canManage` gate does not move.** The comment above it is the rule — generation is a
  WRITE, and a read-only page that quietly writes is a surprise. RLS would happily let a music
  coordinator generate by opening a page; this check is the boundary. Extend that comment to say
  the horizon runs under the same gate and for the same reason.
- **Named limitation, to be written into the comment:** the horizon rolls forward only when
  somebody with `calendar.manage` opens `/calendar`. If only a coordinator uses the app for three
  months the year quietly becomes nine, and it self-heals on the next calendar visit. Making it
  self-maintaining needs a scheduler, which this project does not have — **this joins P12's list,
  which already holds seven clock-driven items and should settle the mechanism once for all of
  them.** Do not invent an eighth here.
- **Measure the first run.** One ward's first call creates ~52 Sundays plus conducting resolution.
  Note the wall time in the retro; if it is bad enough to hurt the page, the fix is to move it
  behind the existing `POST /api/sundays` route and a button — not to shrink the horizon silently.

### Task 1.3: Tests

**File:** `tests/lib/calendarHorizon.test.ts` (create)

The horizon range arithmetic is pure and is what the coverage check compares against:

- `monthStart(today)` → `lastDayOfMonth(addMonths(from, 11))` spans 12 whole months for a date
  mid-month, on the 1st, and on the 31st.
- `sundaysInRange()` over that span returns 52 or 53, never 51 — a year contains at least 52
  Sundays, and the off-by-one here would make the coverage check permanently short and generate
  on **every** page view. Assert across several start months, including a leap year.
- Crossing a year boundary (`today = 2026-12-15`) lands in December 2027.

**File:** `tests/rls/calendar-access.test.ts` (modify)

- A user **without** `calendar.manage` opening the calendar creates **no** Sunday rows. Count
  before and after with the service client. This is the gate, asserted at the boundary rather
  than trusted.

---

## SLICE 2 — `/music` as a collapsed list

### Task 2.1: The window rule, as a pure module

**File:** `lib/music/sundayWindow.ts` (create)
**Action:** The one place that decides which Sundays `/music` shows and in what order.

```ts
export const MUSIC_WINDOW_SUNDAYS = 8;

export function musicSundayWindow<T extends { id: string; date: DateOnly; type: SundayType }>(
  candidates: readonly T[],
  openSundayId: string | null,
): readonly T[]
```

**Details:**

- Takes Sundays **already filtered to those holding a sacrament meeting** and already date-sorted;
  returns the first `MUSIC_WINDOW_SUNDAYS`, **plus the jumped-to Sunday inserted in date order if
  it is not already among them**.
- **The insert is the whole point of this slice** — it is the prototype's own fix for 072-D1 and
  the reason a month board is not needed. A Sunday a year out is reachable because the link puts
  it in the list, not because the reader navigated to its month.
- Pure: no `new Date()`, no clock, no database. The caller supplies the candidates. This mirrors
  `lib/sacrament/sundayStatus.ts`'s no-clock rule and is why it can be tested exhaustively.
- **8 is defined here and nowhere else.**

### Task 2.2: `/music` takes a Sunday, not a month

**File:** `app/(app)/music/page.tsx` (modify)

**Details:**

- Props become:
  ```ts
  export type MusicPageProps = {
    searchParams: Promise<{ sunday?: string; from?: string }>;
  };
  ```
- **Delete** `parseMonthParam`, `monthLabel`, `monthStart`, `lastDayOfMonth`, the `month` local,
  the `range`, and the `<MonthNavigation>` block. Keep `formatDateOnly`.
- Query a **wider** range than 8 Sundays and filter, exactly as the pre-`06910f8` code did and for
  its stated reason: Sundays holding no sacrament meeting are filtered out, so asking for exactly
  8 weeks yields fewer than 8 cards in a stretch containing general conference. Ask for ~16 weeks
  from `firstSundayOnOrAfter(today)`, filter, then call `musicSundayWindow()`.
- **Resolve the jump separately.** If `?sunday=` names a Sunday outside that range, read it by id
  in its own query and merge it into the candidates before windowing. A Sunday a year out is the
  case this exists for, so it must not depend on the window query's range.
  - If `?sunday=` names a Sunday that does not exist or is in another ward, **ignore it** and
    render the ordinary window. RLS already scopes the read, so a foreign id returns nothing; the
    page must not 404 on a stale link.
  - If it names a Sunday that holds **no** sacrament meeting, ignore it too — there is no music
    for a meeting that is not held, which is this page's existing rule.
- **`?month=` is now dead.** Ignore it silently — it is one day old and nothing links to it — but
  leave a comment saying so, because `roster-b`'s rule is that a silently ignored parameter is a
  trap and the next reader deserves to know this one was deliberate.
- **Empty states — keep both, reworded for a window:**
  - no Sundays in the window at all → *"No sacrament meetings are coming up."* The
    `06910f8` sentence about opening the month on the calendar is **wrong now**: slice 1 means the
    year is already generated, and `/music`'s reader may not hold `calendar.manage` anyway.
  - the window has Sundays but none holds a meeting → the existing sentence.

### Task 2.3: The collapsed list

**File:** `app/(app)/music/MusicSundayList.tsx` (create) — `"use client"`

**Details:**

- Owns `const [openSundayId, setOpenSundayId] = useState(initialOpenSundayId)`. **One value, never
  a `Set`** — module-map §6.1's rule: single-open ⇔ jump target, and this page is a jump target.
- Renders one `<SundayMusicCard>` per Sunday, passing `isOpen` and `onToggle`.
- Clicking a collapsed card opens it **and closes whatever was open**.
- Follows `PrayerBoard`'s shape: page is a Server Component, the board is `"use client"` and takes
  serializable props. **Type-only imports** from any `queries.ts` (see Known Pitfalls).

**File:** `app/(app)/music/SundayMusicCard.tsx` (modify) — becomes `"use client"`

- Every prop is already serializable and its `@/lib/music/queries` import is already type-only, so
  this is a directive and a summary row, not a rewrite.
- **Collapsed:** the date (`formatSundayLabelWithYear`, UTC), the `SundayTypeBadge`, and a
  completion pill — `n/3 chosen`, from `HYMNS_PER_SUNDAY`, so the hub's Music pill and this card
  cannot disagree. The whole card is the control.
- **Expanded:** today's content, plus a **Collapse** button at the top.
- Keep `id={`sunday-${sunday.id}`}` on the root `Card`.
- **Accessibility:** the collapsed card is a real `<button>` (or carries `role="button"`,
  `tabIndex=0` and key handling) with `aria-expanded` and `aria-controls`. `p4-sacrament-a` found
  every pill was a 19px tap target; the summary row is ≥44px. **Do not nest the expanded card's
  own controls inside the summary button** — that is the nested-interactive bug `SundayCard`
  already avoided with a stretched pseudo-element.

### 🚫 Task 2.4 is NOT in this slice: "Topics pending"

Module-map §6.2 item 4 — a dimmed card reading `Topics pending` — **cannot be built yet, and must
not be approximated.**

`grep` confirms **no `topicsFinalized` / `topics_finalized` anywhere in WLT**. It is P4 slice `b`
(Topics finalize). And `decisions.md` §1.15 is explicit that finalize is *"a conductor's
deliberate click, **not** derived from every slot happening to have a topic"* — so inferring it
from "this Sunday has topics assigned" would be the exact thing that rule forbids, and would tell
a coordinator the topics were settled when nobody had said so.

**Build the card without the dimmed state. Slice `b` adds it**, in the same change that adds the
concept. Record this in the module-map §6.2 entry so the next reader does not think it was missed.

The prototype's **workflow** pill (`Draft` / `Pending approval` / `Approved`) is likewise §2.2
behaviour 1 and unbuilt — the collapsed card carries the completion pill alone.

### Task 2.5: The Music href carries the Sunday and the origin

**File:** `lib/sacrament/sundayStatus.ts` (modify)

```ts
music: `/music?sunday=${sundayId}&from=sacrament#sunday-${sundayId}`,
```

**Details:**

- `?sunday=` is what opens the card; `#sunday-` is what scrolls to it **without JavaScript**.
  Both, deliberately — note in the comment that they are not redundant.
- `&from=sacrament` drives the back link (Task 2.6).
- **`prayer` does not change.** `/prayers` is a month board in both the prototype and WLT.
- Replace the paragraph `06910f8` added about `/music` being a month board with one recording the
  reversal, so the file does not end up asserting the opposite of what it does.

### Task 2.6: The contextual back link — the first in the app

**File:** `components/layout/ContextualBackLink.tsx` (create)

**Details:**

- Renders *"Back to Sacrament Calendar"* for `?from=sacrament`, else *"Back to Dashboard"*.
- **`from` is resolved through an allowlist — a `Record<string, {href, label}>` — never rendered
  or navigated to as free text.** An arbitrary `?from=` value must fall back to Dashboard. This is
  the whole security surface of the feature and it is one object.
- **This does not conflict with the chrome bar, and the reasoning is already written down.**
  `components/layout/ChromeBar.tsx`'s header keeps its own link unconditionally `/dashboard`
  because the prototype's **global** dynamic one was broken (it tracked one step and lost the path
  home), and then says in as many words that **per-page contextual back links are safe precisely
  because the chrome bar's is not**, and that P3 built none. This is the first. Quote that header
  in the new component so the two stay reconciled.
- **A query parameter, not history.** No `router.back()`, no `document.referrer`, no stored
  previous page — those are how the prototype's version broke. The origin is in the URL, so it is
  correct on a refresh, a shared link and a restored tab.

### Task 2.7: Tests

**File:** `tests/lib/musicSundayWindow.test.ts` (create) — the important one:

- Returns at most 8 when no jump is given.
- A jump **inside** the window changes nothing — no duplicate, still 8.
- A jump **outside** the window is **inserted in date order**, not appended, and the result is 9.
  Assert the position, with a date that sorts into the middle.
- A jump a **year** out still appears — the 072-D1 case as an assertion.
- A jump matching nothing is ignored.
- Fewer than 8 candidates returns them all.
- `null` jump with an empty candidate list returns empty, no throw.

**File:** `tests/lib/sacramentSundayStatus.test.ts` (modify)

- Music href carries `sunday=<id>`, `from=sacrament` and `#sunday-<id>`.
- It no longer carries `month=` — assert the negative, since that is what is being reversed.
- The existing `topics`/`talks`/`prayer` cases and the "every href contains the id" case are
  unchanged and must stay green; if they go red the move was not behaviour-preserving.

---

## Testing Strategy

**Unit** — `tests/lib/calendarHorizon.test.ts`, `tests/lib/musicSundayWindow.test.ts`,
`tests/lib/sacramentSundayStatus.test.ts`. All pure, no database, no clock.

**RLS** — `tests/rls/calendar-access.test.ts` gains the "a non-manager's visit writes nothing"
assertion. `tests/rls/music-access.test.ts` is unchanged and must stay green: no policy moves and
no table is read that was not read before.

**Not written, deliberately:**

- **No route test.** No route handler changes in either slice.
- **No page-render test for `/music`.** There is none today, and one here would assert the layout
  rather than the behaviour. The seam this lives in — a real page under a real layout — is what
  `p3-shell-and-tile-dashboard` recorded that route tests never see.
- **No component test for the expand/collapse.** jsdom can assert `aria-expanded` flips, which is
  worth having eventually, but the thing that actually needs proving — that a card opens
  *scrolled to* and *already expanded* after a cross-page jump — is a browser behaviour. The walk
  is the instrument.

**Regression suites that are relevant, not incidental:**

- `tests/lib/explicitTimeZone.test.ts` — reads source; a new bare `Intl` call fails it.
- `tests/lib/navigationRoutesExist.test.ts` — `/music` stays `built: true` with a page present.
- `tests/components/sacrament/SundayCard.test.tsx` — takes `hrefs` as a prop, so the href change
  must not touch it.
- `tests/lib/calendarMonth.test.ts`, `tests/lib/calendarDates.test.ts` — slice 1 leans on these
  helpers without changing them.

## Test Scenarios (Harness)

**No new scenario.** Two existing ones cover this and both need editing — and one of them is the
scenario whose walk found the original defect.

### Scenario 072 (modify) — `testing/scenarios/talks/scenario-072-one-sunday-six-pills`

Already seeds **August 2027**, five Sundays in deliberately different states, 08-15 at `Music 2/3`
— a date far outside any 8-week window, which is precisely the fixture this needs. **Seed
unchanged.** Update the checklist:

- [ ] The Music pill on 08-15 opens `/music` with the **08-15 card already expanded**, its two
      chosen hymns visible — not a list to scroll, and not an empty page
- [ ] That card sits **in date order** among the ordinary upcoming Sundays, not pinned to the top
- [ ] The page shows *"Back to Sacrament Calendar"*, and it returns to `/sacrament`
- [ ] Opening `/music` from the nav shows the list **collapsed, nothing expanded**, and the back
      link reads *"Back to Dashboard"*
- [ ] Clicking a second card **closes the first**
- [ ] `/music?sunday=<a uuid that does not exist>` renders the ordinary list, no crash

Re-open 072-D1's entry: it was marked FIXED by `06910f8`; append that the fix was **reshaped**
here, keeping both records.

### Scenario 036 (modify) — `testing/scenarios/music/scenario-036-…`

Its steps were edited for the month board and are wrong again. It seeds **2026-11-01** and
**2026-11-08** — roughly 6 weeks out, so both now fall **inside** the 8-Sunday window and the
navigation step disappears entirely. Revert step 4 to a plain *"Open **Music** from the sidebar"*,
add *"expand Sunday, November 1"*, and replace the month-heading checklist item with one asserting
the collapsed list and that every Sunday listed holds a sacrament meeting.

### A slice-1 check, added to scenario 072

- [ ] As the bishop, open `/calendar` **once**. Then confirm in the database that Sundays exist
      **12 months out**: `select count(*) from sundays where ward_id = … and date > current_date`
      returns ≥ 50
- [ ] Re-open `/calendar`. `select max(created_at) from sundays where ward_id = …` is
      **unchanged** — the second visit wrote nothing

**Walk after implementing** — this is the step that proves it, not the unit tests:

```
npm run seed -- talks/scenario-072-one-sunday-six-pills
npm run dev
```

1. Sign in as the bishop, open `/calendar`, confirm the 12-month horizon in the database.
2. Open `/sacrament`, navigate to August 2027, click `Music 2/3` on 08-15.
3. Confirm: expanded, in date order, back link reads *"Back to Sacrament Calendar"*.
4. Open `/music` from the nav — collapsed, nothing open, *"Back to Dashboard"*.
5. 375px: no horizontal overflow, the summary row ≥ 44×44, Collapse reachable by keyboard.
6. Tab to a collapsed card and press Enter — it must open.
7. Both themes; zero console errors.

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

**Run the build.** `SundayMusicCard` becomes a client component in this plan, which is exactly the
change that turns a stray value import of a `queries.ts` into a `next/headers` failure that lint
and typecheck both pass (`roster-b-picker-and-orgs`).

## Integration Notes

- **Slice 1 is independently valuable and should be its own commit.** It fixes the round trip for
  `/music`, `/prayers`, `/assignments`, `/sacrament` and `/program` at once, and it makes slice 2
  walkable.
- **Slice 1 changes no UI.** Its only visible effect is that months further out already have
  Sundays.
- **Youth Support and the future Ward Calendar need nothing.** `activity_events.event_date` is a
  plain `timestamptz` with no link to a Sunday, so an activity can already be created on any date
  years out. The clunkiness was only ever in the Sunday-keyed modules. Do not widen this plan to
  them.
- **Breaking change, and it is the point:** `/music` no longer has month navigation and no longer
  reads `?month=`. Say so in the commit message.
- **This closes P4 slice `a`.** Module 1 then moves to `b` (Topics finalize), which owns the
  `Topics pending` state deferred in Task 2.4. `f`/`g` remain blocked on **P5**.
- **Documentation:** update `plans/prototype/module-map.md` §6.2 to record that items 4 (Topics
  pending) and the workflow pill are slice `b`'s; update `plans/P4-module-reskins.md` §1 to mark
  this shipped; amend `plans/retros/p4-sacrament-music-month.md`'s reversal banner to point at the
  new retro; and add the P12 note that the horizon is the eighth clock-driven item.
