# Plan: `/music` becomes a month — closing 072-D1

**Created:** 2026-09-22
**Type:** bugfix
**Phase:** P4 module 1 (Sacrament), slice `a` follow-up. **Not** one of the eight named new
behaviours (`b`–`g`) — this completes `a`.

## Overview

`/music` is a rolling six-Sunday horizon from today with no date parameter
(`HORIZON_SUNDAYS` in [app/(app)/music/page.tsx](app/(app)/music/page.tsx)). The Sacrament hub
shipped in `c39e70f` deep-links a `Music n/3` pill into it, so a pill reporting real, correct
work on a Sunday more than ~6 weeks out lands on a page reading *"The next 0 Sundays that hold a
sacrament meeting"* and *"There are no sacrament meetings on the calendar yet."*

**This is the exact failure the hub was built to prevent** — a pill's count must match the page
behind it — and it is structural, not an artifact of a far-future seed. ~6 weeks is precisely the
horizon a bishopric plans at.

**The fix:** `/music` becomes a month board, exactly like `/prayers`. `?month=YYYY-MM`,
`MonthNavigation`, a `Music — August 2027` heading. The rolling horizon is deleted.

### The decision, and its cost — confirmed with the user 2026-09-22

Two readings of "give `/music` a month parameter" were put to the user and the **full month page**
was chosen over keeping the horizon as a no-parameter default with a month override.

**Why:** `/prayers` is the same thing — a month board with no per-Sunday page — and already works
this way, as do `/assignments`, `/calendar` and `/sacrament`. Two modes in one page would need the
heading *and* the empty state to each say which mode was on, which is
`decisions.md` §1 *"one mechanism, not two"* broken for a page that now has an owner
(the hub) telling it which month to show.

**The cost, named rather than discovered:** late in a month the coordinator's default landing
shows only the Sundays left in it, not the next six. Every sibling page has exactly this property
and `MonthNavigation`'s **Next** is one click. Do not "fix" this later by reintroducing the
horizon alongside the month — that is the option that was considered and rejected.

### Success criteria

- `Music 2/3` on any Sunday, at any distance, opens `/music` showing **that Sunday's month**, with
  that Sunday's card on screen.
- `/music` with no parameter shows the current month.
- A month on the calendar whose every Sunday is a stake conference says so, and does **not** claim
  the month is missing from the calendar.
- `tests/lib/explicitTimeZone.test.ts` and `tests/lib/navigationRoutesExist.test.ts` stay green.

---

## Relevant Files

- `app/(app)/music/page.tsx` — **modify** — take `?month=`, drop `HORIZON_SUNDAYS`, add
  `MonthNavigation`, split the two empty states.
- `app/(app)/music/SundayMusicCard.tsx` — **modify** — carry `id={`sunday-${sunday.id}`}` on the
  `Card` so a hub pill can land on the right card, matching `PrayerBoard`.
- `lib/sacrament/sundayStatus.ts` — **modify** — gain `sundayPillHrefs()`, moved out of the page
  so the href rule becomes testable.
- `app/(app)/sacrament/page.tsx` — **modify** — delete the private `hrefsFor()`, call
  `sundayPillHrefs()`, rewrite the stale comment that reasons about *not* sending a month.
- `tests/lib/sacramentSundayStatus.test.ts` — **modify** — add the href cases.
- `testing/scenarios/talks/scenario-072-one-sunday-six-pills/scenario.md` — **modify** — close
  072-D1, re-arm the checklist item.
- `testing/scenarios/music/scenario-036-choosing-hymns-for-a-sunday-with-topics/scenario.md` —
  **modify** — its checklist asserts the horizon that is being deleted.

**No migration. No route handler. No RLS policy. No new dependency.** `listSelections`,
`listMusicalNumbers` and `listSundayTopicTitles` already take an arbitrary `sundayIds` array and
need no change.

## Dependencies

All existing:

- `parseMonthParam`, `monthStart`, `lastDayOfMonth`, `monthLabel`, `monthOf` from
  [lib/calendar/dates.ts](lib/calendar/dates.ts)
- `MonthNavigation` from [app/(app)/calendar/MonthNavigation.tsx](app/(app)/calendar/MonthNavigation.tsx)
- `holdsSacramentMeeting` from [types/domain.ts](types/domain.ts)

## Known Pitfalls (from retro context)

- **`p4-sacrament-a-hub-and-reskin`** — the module-map's correction (c): the prototype's *Topics*
  pill maps to `/assignments/[sunday_id]`, **not** `/talks/topics`. `hrefsFor` has this right
  today; moving the function must not quietly change it. The existing comment saying so moves with
  the code.
- **`roster-b-picker-and-orgs`** — a parameter the destination silently ignores. The current
  `/sacrament` comment invokes this rule to justify sending nothing; after this change `/music`
  **does** read `?month=`, so the comment is not merely stale, it argues for the wrong thing.
  Rewrite it, don't delete it.
- **`calendar-b-month-view` / `calendar-c-rotation-cadence`** — half-generated months. `/music`
  reads only; generating a month is a calendar **write** and stays on `/calendar`. Do not let the
  new empty state grow a "create this month" button.
- **`ai-b-knowledge-and-retrieval`** — the plural bug. The current page has a hand-written
  singular branch (*"The next Sunday…"* vs *"The next N Sundays…"*). The replacement count
  sentence must keep a singular branch; copy `/prayers`' `{n} {n === 1 ? "Sunday" : "Sundays"}`.
- **CLAUDE.md rule 12** — every formatter names its zone. `monthLabel` and
  `formatSundayLabelWithYear` already pass `timeZone: "UTC"`; add no new `Intl` call. These are
  `date` columns, so **UTC is the correct zone** — not the ward's.
- **`youth-a-D1` / `p4-sacrament-a`** — offering a link that refuses on arrival. Unchanged here:
  `/music` gates on `music.view`, the hub gates on `talks.view`, and a `music_coordinator` holds
  both. The Music pill is already offered to everyone who reaches the hub and that does not move.

---

## Tasks

### Task 1: Move the hub's href rule into the pure module

**File:** `lib/sacrament/sundayStatus.ts` (modify)
**Action:** Add an exported `sundayPillHrefs()` and lift the two comment blocks that explain it.

**Details:**

```ts
export function sundayPillHrefs(
  sundayId: string,
  date: DateOnly,
): Record<SundayPillKey, string>
```

- Body is `hrefsFor()` from `app/(app)/sacrament/page.tsx` verbatim, with **one change**:
  `music: `/music?month=${monthOf(date)}#sunday-${sundayId}`` — the same shape `prayer` already
  uses.
- Import `monthOf` and `type DateOnly` from `@/lib/calendar/dates`. This module's header says it
  imports `@/types/domain` only and has **no clock**; `monthOf` takes a `DateOnly` string and calls
  no `new Date()`, so the no-clock guarantee holds. Amend the header to say
  `@/types/domain` + pure date helpers rather than leaving it contradicting the imports —
  `visits-c`'s rule about a comment that outlives what it describes.
- Move both existing comment blocks from the page with the function: the *"EVERY PILL LANDS ON
  THIS SUNDAY, NOT ON THE NEAREST ONE"* note (the prototype's `openProgram(key)` bug) and the
  *"TOPICS AND TALKS BOTH GO TO `/assignments/[id]`"* correction.
- **Replace** the third paragraph — the one beginning *"`/music` takes no date: it is a rolling
  six-Sunday horizon"* — with a note recording that `/music` is now a month board and that this
  href is what closes 072-D1.

### Task 2: Call it from the hub

**File:** `app/(app)/sacrament/page.tsx` (modify)
**Action:** Delete the private `hrefsFor()`; import and call `sundayPillHrefs`.

**Details:**

- Add `sundayPillHrefs` to the existing `@/lib/sacrament/sundayStatus` import.
- `hrefs: sundayPillHrefs(sunday.id, sunday.date)` in the `cards` map — the call site is otherwise
  unchanged.
- `monthOf` becomes unused in this file **only if** nothing else uses it. Check before removing it
  from the `@/lib/calendar/dates` import; lint will catch it either way.
- `groupBySunday` stays where it is. It is about this page's data shaping, not about hrefs.

### Task 3: `/music` takes a month

**File:** `app/(app)/music/page.tsx` (modify)
**Action:** Replace the rolling horizon with a month, following `app/(app)/prayers/page.tsx`.

**Details:**

- Add above the component, matching the four sibling pages verbatim in shape:
  ```ts
  // searchParams is a Promise in Next 16, typed explicitly rather than with the generated PageProps
  // helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
  export type MusicPageProps = {
    searchParams: Promise<{ month?: string }>;
  };

  export default async function MusicPage({ searchParams }: MusicPageProps) {
  ```
- **Delete** `const HORIZON_SUNDAYS = 6` and its comment, the `addDaysUtc(today, HORIZON_SUNDAYS * 7 * 2)`
  widening with its comment, and the `.slice(0, HORIZON_SUNDAYS)`. Drop `addDaysUtc` from the
  `@/lib/calendar/dates` import; add `lastDayOfMonth`, `monthLabel`, `monthStart`, `parseMonthParam`.
- Resolve the range:
  ```ts
  const today = formatDateOnly(new Date());
  const params = await searchParams;
  const month = parseMonthParam(params.month, today);
  const range = { from: month, to: lastDayOfMonth(month) };

  const sundays = await listSundays(user.wardId, range, supabase);
  ```
  `parseMonthParam` already falls back to the current month for a missing **or malformed** value,
  so `/music?month=banana` is the current month and never a crash. No Zod schema — this is a page
  read, not a route body, and the parser is the boundary.
- **Keep the meeting filter exactly as it is**, comment included — sundays that hold no sacrament
  meeting are absent entirely, not greyed out:
  ```ts
  const meetingSundays = sundays.filter((sunday) => holdsSacramentMeeting(sunday.type));
  ```
- Header block replaces the `<div>` wrapper with the two-column flex the siblings use:
  ```tsx
  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
    <div className="min-w-0">
      <h1 className="text-xl font-semibold text-foreground">Music — {monthLabel(month)}</h1>
      <p className="mt-1 text-sm text-muted">
        {meetingSundays.length} {meetingSundays.length === 1 ? "Sunday" : "Sundays"}
      </p>
    </div>

    <MonthNavigation
      monthStart={month}
      currentMonthStart={monthStart(today)}
      basePath="/music"
    />
  </div>
  ```
  **The count is `meetingSundays.length`, not `sundays.length`** — and that is a deliberate
  departure from `/prayers` and `/sacrament`, which count every Sunday. This page renders only the
  Sundays that hold a meeting, so counting the others would be a number that disagrees with the
  list beneath it. That is ITER-022 exactly, and it is worth a comment saying so.
- Keep the existing `TOPICS ONLY — NOT THE ASSIGNMENTS` header block untouched. Amend the
  `HORIZON_SUNDAYS` reasoning out and add a short note that the page is a month because the
  Sacrament hub deep-links a date into it (072-D1).

### Task 4: Two empty states, because the month view creates a second one

**File:** `app/(app)/music/page.tsx` (modify)
**Action:** Split the single empty `Card` in two.

**Details:**

The horizon had one way to be empty. A month has two, and the existing sentence is **wrong** for
the second — it tells the reader to add a month that is already there.

```tsx
{sundays.length === 0 ? (
  <Card>
    <p className="text-sm text-muted">
      This month is not on the calendar yet. Open it on the calendar first — a member of the
      bishopric or the ward secretary creates a month by viewing it.
    </p>
  </Card>
) : meetingSundays.length === 0 ? (
  <Card>
    <p className="text-sm text-muted">
      No Sunday this month holds a sacrament meeting.
    </p>
  </Card>
) : (
  <ul className="flex flex-col gap-4">…</ul>
)}
```

- The first sentence is copied **verbatim** from `/prayers` and `/sacrament`, so the three pages
  give one answer to one situation.
- The second is reachable: a month whose only Sundays are a stake conference and a ward
  conference. It states a fact and offers no action, because there is no action —
  `decisions.md` §1 *"refuse, and name the alternative"* does not apply when nothing is refused.

### Task 5: A card a pill can land on

**File:** `app/(app)/music/SundayMusicCard.tsx` (modify)
**Action:** Put `id={`sunday-${sunday.id}`}` on the card's root `Card`.

**Details:**

- `PrayerBoard.tsx:197` is the precedent, one line, same spelling: `<Card key={…} id={`sunday-${sunday.id}`}>`.
- Confirm `Card` forwards `id` to its root element before relying on it. If it does not, add
  `id?: string` to `CardProps` and spread it — `components/ui/Card.tsx` is shared, so change
  nothing else about it.
- The `<li>` in `page.tsx` keeps its `key`; the anchor target is the `Card`, matching `/prayers`.
- **Why it matters:** without it the Music pill lands on the right month and the reader still has
  to find the Sunday. `/prayers` already solved this and the hub already relies on it.

### Task 6: Test the href rule

**File:** `tests/lib/sacramentSundayStatus.test.ts` (modify)
**Action:** Add a `sundayPillHrefs` describe block.

**Details:**

Cases — each one is a rule that has already been got wrong once, here or in the prototype:

- `topics` and `talks` both resolve to `/assignments/<id>`, and **neither** resolves to
  `/talks/topics`. Assert the negative explicitly; the two names are one word apart and the module
  map calls this the single most likely thing to get backwards.
- `music` carries **both** the month and the Sunday anchor:
  `/music?month=2027-08#sunday-<id>` for a `2027-08-15` Sunday.
- `prayer` is unchanged: `/prayers?month=2027-08#sunday-<id>`.
- The month comes from the **Sunday's own date**, not from anything ambient — pass a
  `2027-01-31` date and assert `month=2027-01`, so a future clock cannot make this test pass by
  accident.
- Every value contains the `sundayId` passed in. This is the prototype's `openProgram(key)` bug as
  an assertion.

**What this test does and does not buy.** It catches an href that stops carrying the date. It
cannot catch the destination being unable to honour it — which is what 072-D1 actually was, and
why the walk found it and 3841 tests did not. The walk in Task 8 is the part that proves the fix.

### Task 7: Re-arm scenario 072

**File:** `testing/scenarios/talks/scenario-072-one-sunday-six-pills/scenario.md` (modify)
**Action:** Close 072-D1 and restore the checklist item to a plain check.

**Details:**

- In **Defects found**, mark 072-D1 **FIXED** with this plan's commit, keeping the original
  description. `youth-h`'s convention: a closed defect keeps its text so the reasoning survives.
- In the checklist, delete the ⚠️ block under *"Every pill on 08-15 opens THAT Sunday"* and add a
  dedicated line:
  `- [ ] The Music pill on 08-15 lands on **/music showing August 2027**, scrolled to the 08-15
  card — not the current month, and not an empty page`
- Add one line the original could not have had:
  `- [ ] `/music` opened from the **nav** with no month shows the **current** month`
- The seed needs **no change**. August 2027 is already outside any plausible horizon, which is
  what makes it the right fixture for this.

### Task 8: Correct scenario 036

**File:** `testing/scenarios/music/scenario-036-choosing-hymns-for-a-sunday-with-topics/scenario.md` (modify)
**Action:** Its checklist asserts the behaviour being deleted.

**Details:**

- Line ~80 reads `- [ ] Six Sundays or fewer are listed, and every one of them holds a sacrament
  meeting`. Replace with:
  `- [ ] The heading names a month, and every Sunday listed holds a sacrament meeting`
- Scan the rest of the file for other horizon wording before editing — `notification-trigger-drift`
  is this repo's standing lesson that one fact hand-maintained in several places will disagree with
  itself. Leave the 375px and hymnbook checks alone.

---

## Testing Strategy

**Unit — `tests/lib/sacramentSundayStatus.test.ts`** (Task 6). Pure, no database, no clock.

**Not written, deliberately:**

- **No route test.** No route handler changes. `tests/helpers/routeClient.ts` mocks the server
  client for handlers; a Server Component page is not one.
- **No RLS test.** No policy moves and no table is read that was not read before. `/music` already
  gates on `music.view` and `tests/rls/music-access.test.ts` covers it unchanged.
- **No page-render test.** There is none for `/music` today and adding one here would assert the
  layout rather than the fix. The seam this bug lived in — a page's real data under a real
  layout — is what `p3-shell-and-tile-dashboard` recorded that route tests never see, and the
  scenario walk is the instrument for it.

**Regression suites that must stay green and are relevant, not incidental:**

- `tests/lib/explicitTimeZone.test.ts` — reads source; a new bare `Intl` call fails it (rule 12).
- `tests/lib/navigationRoutesExist.test.ts` — `/music` stays `built: true` with a page present.
- `tests/lib/calendarMonth.test.ts` — already covers `parseMonthParam`; no change needed.
- `tests/components/sacrament/SundayCard.test.tsx` — takes `hrefs` as a prop, so moving the
  builder must not touch it. If it goes red, the move was not behaviour-preserving.

## Test Scenarios (Harness)

**No new scenario.** Two existing ones cover this and both need editing rather than replacing —
see Tasks 7 and 8. Scenario 072 already seeds August 2027, five Sundays in deliberately different
states, with 08-15 at `Music 2/3`; that is precisely the fixture this fix needs, and it is the
scenario whose walk found the defect. A third scenario asserting the same thing is the
hand-maintained-in-three-places shape `notification-trigger-drift` exists to warn about.

**Walk after implementing** — this is the step that proves the fix, not the unit test:

```
npm run seed -- talks/scenario-072-one-sunday-six-pills
npm run dev
```

1. Sign in as the bishop, open `/sacrament`, navigate to **August 2027**.
2. Click `Music 2/3` on 08-15. It must show **Music — August 2027**, five cards, scrolled to
   08-15 — the two hymns already chosen visible on it.
3. Press **Previous**, **Next**, **Today** and confirm each lands where it says.
4. Open `/music` from the nav with no parameter: the **current** month.
5. Try `/music?month=banana` — the current month, no crash.
6. Check 375px: no horizontal overflow, `MonthNavigation`'s three buttons ≥ 44×44.
7. Both themes; zero console errors.

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Run the build. `p3-shell-and-tile-dashboard` and `foundation-a-scaffold` both record that lint,
typecheck and tests pass while a production build fails — static generation runs code the dev
server never does, and this change adds `searchParams` to a page that did not have it, which is
exactly the kind of thing that moves a page's rendering mode.

## Integration Notes

- **`/music` gains a URL shape it did not have.** Bare `/music` still works and still means the
  current month, so the nav item, any bookmark and `NAVIGATION_ITEMS` are all unaffected.
- **Breaking change, and it is the point:** the coordinator's default view is a month, not the
  next six Sundays. Named and accepted above. Say it plainly in the commit message — somebody who
  uses this page daily will notice on the first Sunday of a month.
- **Nothing else reads `HORIZON_SUNDAYS`.** `grep` confirms one definition and one pair of uses,
  both inside `app/(app)/music/page.tsx`.
- **This closes P4 slice `a`.** After it, module 1 moves to `b` (Topics finalize) — and `f`/`g`
  remain blocked on **P5**.
- **Documentation:** update `plans/P4-module-reskins.md` §1 (the slice-note line naming this as
  *"one the walk of scenario 072 found and the roadmap did not anticipate"*) to mark it shipped,
  and add the retro entry at `/execute` time as usual.
