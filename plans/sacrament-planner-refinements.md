# Plan: Sacrament Planner refinements (GROUP-04)

**Created:** 2026-10-30
**Type:** feature (ITER-057 is a bugfix inside it)
**Scope refs:** ITER-057 ITER-056 ITER-048 ITER-049 ITER-050
**Structure:** Unified — one plan, **four commits** (slices `pa` → `pd`), because every item edits the
same imported file, `lib/sacramentPlanner/assets/body.html`, and two of them share one placement rule.

## Overview

Five changes the bishopric asked for while using the Sacrament Planner (ITER-045). All five are
edits to the Planner's **own imported code**, which CLAUDE.md §9 (ITER-045 entry) says is edited
"only for the reasons listed". These are user-requested reasons, and this plan **is** their list
(edits **G1–G5** below). Nothing server-side changes: no migration, no route, no RLS, no type in
`types/`. The Planner's rules run in the browser only (ITER-045 D1), and these do too.

| Slice | Commit | Items | What the bishopric gets |
|---|---|---|---|
| `pa` | 1 | ITER-057 + ITER-056 | Who's Next panel no longer hides the last names on a phone, folds to one line, and gains **Place on Sunday** for every ticked person at once |
| `pb` | 2 | ITER-048 | Fast & Testimony Sundays start with no speaker slots and no rest hymn; switching type adds/removes only **empty** slots |
| `pc` | 3 | ITER-049 | Pray About cards show "2 of 3 speaking slots filled", warn instead of silently adding a slot, offer + / −, and a month card opens **See the month** |
| `pd` | 4 | ITER-050 | Calls gains a **Past Sundays** view (window, sort, name search), editable for 9 days after a Sunday, read-only after |

Order rationale: `pa` is the daily phone pain raised most recently and it creates the shared
placement function `pc` builds on; `pb` changes slot counts that `pc` displays; `pd` is independent.

### Decisions (settled with the user, 2026-10-30)

| # | Decision |
|---|---|
| D1 | Remembered view state (panel folded/open, Calls past-view window and sort) is **per device**, in `localStorage` under `planner:` keys — the same as every other view state the Planner keeps. Not on the account. |
| D2 | **Saved** Fast & Testimony Sundays that already have empty speaker slots are **left alone**. Only new Sundays start empty; nothing writes on load. |
| D3 | In the Calls past view, a Sunday already in the **agenda history** (`DATA.meetings`) is **shown read-only**, even inside its 9 days. |
| D4 | The ITER-049 "full" warning appears **on pressing Place on Sunday**; the fill line is always visible. |
| D5 | A speaker slot with a topic or references but no name **counts as work** and is never removed automatically. A Rest Hymn with a number or title also counts as work. |
| D6 | A meeting-type switch changes the **card on screen** as unsaved edits (marked dirty), saved with the card's Save — like every other card edit. |
| D7 | Only two type transitions adjust slots: **→ Fast & Testimony** (remove empty speakers; remove an empty rest hymn if no speakers remain) and **Fast & Testimony → Regular** (add two empty speakers and an empty rest hymn, only if the card has no speaker slot). Every other transition leaves slots alone. |
| D8 | Who's Next → Place on Sunday: History reads the same as a normal placement; a Sunday with unsaved edits on the Sundays tab refuses **the whole batch**. Works only with a specific Sunday chosen. |
| D9 | The panel starts **open** the first time on a phone. |
| D10 | ITER-049: the month-card control is labelled **See the month**; each Sunday in the summary has its own + / − (talk cards). |
| D11 | ITER-050: search matches **names only** (the slot's person, plus names in its decline and swap records). An emptied slot shows its decline/removal record ("Needs someone · X declined Mar 1 · reason"). |
| D12 | The 9-day grace: a past Sunday is editable while `daysSince(date) <= 9` and it is not in `DATA.meetings`. So 5 days past is editable, 10 days past is not. |

### Success criteria

- [ ] At 375px, tick one result of a searched Who's Next list: the last result scrolls fully above the panel, open **and** folded.
- [ ] The folded panel is one line: "N selected · Place on Sunday · Add to Pray About · ▸", and stays folded after a reload.
- [ ] Tick three people, choose a talk and a specific Sunday, press Place on Sunday: all three are penciled in, no Pray About cards are created, and one Undo removes all three.
- [ ] A person who cannot be placed (already on the Sunday, on the do-not-ask list, both prayers filled) is skipped and named; the rest are placed.
- [ ] A new first-Sunday card shows no speaker slots and no rest hymn; switching it to Regular and back adds and removes only empty slots; a named speaker survives every switch.
- [ ] A Pray About talk card for a full Sunday shows "3 of 3 speaking slots filled" and, on Place, warns with **Add a speaker anyway** and **See who's speaking** instead of adding silently.
- [ ] + / − change only empty slots; − does nothing (and says so) when every slot has someone.
- [ ] A month card's **See the month** lists every remaining Sunday of the month with its slots; **Place here** lands the person on that Sunday.
- [ ] Calls opens on the upcoming view exactly as today; **Past Sundays** shows passed Sundays with outcomes; window, sort and search narrow or reorder it.
- [ ] A Sunday within 9 days of its date has the usual call controls in the past view; one older than 9 days, or in the agenda history, has none.
- [ ] Lint, typecheck, the full suite and the production build pass.

## Relevant Files

- `lib/sacramentPlanner/assets/body.html` — modify — every slice (details per task).
- `lib/sacramentPlanner/assets/extra.css` — modify — `pa` (panel reserve + folded line), `pc` (fill line, slot popup), `pd` (past-view controls, read-only rows).
- `tests/lib/sacramentPlanner/assetEdits.test.ts` — modify — storage-key count (10 → 14), pins for G1–G5.
- `tests/lib/sacramentPlanner/slotRules.test.ts` — create — runs the extracted pure slot rules (see Task 1).
- `tests/helpers/plannerSlotRules.ts` — create — loads the delimited rules block out of `body.html` and evaluates it (used by the test above).
- `testing/scenarios/talks/scenario-096-planner-refinements/scenario.md` + `seed.ts` — create — one harness scenario covering all four slices.
- `testing/scenarios/manifest.json` — regenerated by `npm run manifest`.
- `CLAUDE.md` — modify — §9 ITER-045 entry: one sentence naming GROUP-04's edits G1–G5 and this plan.
- `plans/sacrament-planner-adapter.md` — modify — add a short "Later edits" note under Task 2 pointing here.
- `plans/retros/…` — `/execute` writes the retro.

No change to `lib/sacramentPlanner/*.ts`, the bridge, the routes, `types/`, migrations or RLS.

## Dependencies

- No new libraries. `ResizeObserver` is native in every browser the Planner already supports.
- Existing Planner helpers to reuse, never duplicate: `placeConsider()`, `blankSunday0()`,
  `withMusic()` (rest-hymn midpoint rule), `insertItem()`, `itemRow()`, `musicRow()`, `readCard()`,
  `markDirty()`, `fillSummaries()`, `write()`, `updateSlot()`, `holdState()`, `whenOptions()`,
  `sundaysIn()`, `considerTarget()`, `callItems()`, `renderCalls()`, `isFolded()`, `saveFold()`,
  the `#overlay` / `.modal` pattern used by `openProgram()`, and the existing `data-gotoplan`
  click handler (opens the Sundays tab on a date).
- `dis()` disables writes for read-only viewers and must stay on every new write control.

## Known Pitfalls (from retro context)

- **sacrament-planner-adapter — "Placeholders change behaviour."** A cosmetic-looking edit to the
  Planner broke identity because code ran before data arrived. Here: `renderPray()`, `renderBulk()`
  and `renderCalls()` all run before `state.sundays` loads. Every new helper must cope with
  `state.sundays[date]` being undefined (fall back to `blankSunday(date)`, as `placeConsider` does).
- **sacrament-planner-adapter — the tests read the HTML.** `assetEdits.test.ts` counts storage keys
  (exactly 10 today). Adding keys without updating it fails the suite; update the count
  **deliberately** and pin each new key by name.
- **sacrament-planner-adapter — full suite on this 2-core machine** loses files to "spawn UNKNOWN"
  if a dev server or build runs alongside. Stop `npm run dev` before the full suite; rerun a failed
  file alone before believing it.
- **HANDOFF gotcha (Windows):** if editing with a Python script, open files with `newline=''` —
  the repo is LF and a CRLF rewrite of `body.html` would show as a whole-file diff.
- **Writing in a loop loses names** (ITER-056 scope note): `placeConsider()` reads
  `state.sundays[date]`, which updates only when the realtime snapshot arrives. Placing several
  people by calling it in a loop would let the second write overwrite the first. Build **one**
  Sunday document with every placement applied, then write it **once** (Task 3).

## Tasks

### Task 1: A tested block of pure slot rules (foundation for `pa`–`pd`)
**File:** `lib/sacramentPlanner/assets/body.html` (modify), `tests/helpers/plannerSlotRules.ts` (create), `tests/lib/sacramentPlanner/slotRules.test.ts` (create)
**Action:** Add one clearly delimited block of **pure** functions that the UI code calls. These hold
every rule this plan adds, so they can be unit-tested even though the Planner itself cannot be rendered in a test.
**Details:**
- Place the block directly after `blankSunday0()` (around line 339), between two exact marker lines:
  `// ---------- slot rules (read by tests/helpers/plannerSlotRules.ts) ----------` and
  `// ---------- end slot rules ----------`.
- The block may use only `isTalk`, `isPrayer`, `rid` and its own functions — no `state`, no DOM,
  no `TODAY`. Anything else is passed in as an argument.
- Functions (built up slice by slice; Task 1 lands the first two, later tasks add theirs):
  - `isEmptyWork(sl)` → `true` when nothing has been written into the slot: a talk slot with no
    `name`, no `topic` (trimmed) and no `refs`; a Rest Hymn with no `number` and no `title`.
    Prayers and other roles → `false` (never removed by these rules). (D5)
  - `placeIntoSlots(slots, name, kind, topic, whenFull)` → returns
    `{ok:true, slots}` (a **new** array; never mutate the input) or
    `{ok:false, reason}` where `reason` is `"already"` (name already on the Sunday with a status
    other than `open` — keep `placeConsider`'s exact test), `"prayersFull"`, or `"talksFull"`.
    Talk: fill the first `isTalk` slot with no `name`; when none, if `whenFull === "add"` splice a
    new Speaker before the first Closing Hymn/Closing Prayer (today's exact index rule) and fill it,
    else return `"talksFull"`. Prayer: Opening then Closing, else `"prayersFull"`. A filled slot gets
    `name`, `status:"tentative"`, and `topic` only when a topic was given (today's `fill()`).
- `tests/helpers/plannerSlotRules.ts`: read `body.html`, slice between the two marker lines (throw
  a clear error if either is missing), and evaluate it with
  `new Function("isTalk", "isPrayer", "rid", block + "\nreturn { isEmptyWork, placeIntoSlots, … };")`,
  passing `r => /Speaker/.test(r)`, `r => /Prayer/.test(r)` and a counter-based `rid`. Export a
  typed `loadPlannerSlotRules()`. Type the slot shape locally (`PlannerSlot`); no `any`.
- `slotRules.test.ts` (`// @vitest-environment node`): cases for `placeIntoSlots` — fills the first
  open speaker; keeps the topic only when given; refuses `already`; `talksFull` with `whenFull` not
  `"add"`; adds before Closing Hymn with `"add"`; opening then closing prayer; `prayersFull`;
  input array unchanged. `isEmptyWork` — topic-only and refs-only slots are work; a named slot is
  work; an empty Rest Hymn is empty, one with a number is work. **Prove the test can fail** once
  (break a rule locally, see red, restore) before believing it.
- Refactor `placeConsider()` to call `placeIntoSlots(s.slots, c.name, c.kind, topic, "add")` and
  keep its toasts and refusals word for word. Behaviour is unchanged in this slice (`pc` changes it).
- Also make `placeConsider()` refuse a person on the do-not-ask list (`holdState(c.name)`) with the
  same toast `doSwap()` uses. Today it would write a Sunday that `savePlan()` then refuses to save.

### ITER-057 + ITER-056 Tasks (slice `pa`, commit 1)

#### Task 2: Reserve room for the panel, and fold it to one line (ITER-057, edit G1)
**Files:** `body.html`, `extra.css`
**Action:** Fix the hidden last rows and make the panel collapsible at phone width only.
**Details:**
- **Reserve space.** In boot (near the other one-time listeners), create one `ResizeObserver` on
  `$("bulk")` that sets `document.documentElement.style.setProperty("--bulkh", px)` where
  `px = bulk.hidden ? 0 : bulk.offsetHeight + 8` (the 8 matches the panel's gap above the tab bar).
  Also call that update from `renderBulk()` after toggling `hidden`, because an element going
  `hidden` may not fire a resize in every browser.
- In `extra.css`, inside the same `@media` block that pins `.bulk` (line ~130), change
  `main`'s bottom padding there to `calc(70px + var(--bulkh, 0px) + env(safe-area-inset-bottom,0px))`
  (it is `calc(70px + env(…))` today at line ~100 — edit that rule, do not add a second one).
  Desktop is untouched because the variable is only read inside the phone media block.
- **Fold.** Add to the panel markup (line ~51) a fold button as the panel's first child, visible
  only on a phone (`phoneonly` class already exists): `▾` / `▸`, `aria-expanded`, `aria-label`
  "Fold the selection panel" / "Open the selection panel", 44×44 tap target.
  Wrap the When / kind / topic fields, the Defer row and Clear selection in one
  `<div class="bulkmore">`. Folded = the panel gets class `folded`; CSS hides `.bulkmore` and lays
  out one line: count · **Place on Sunday** · **Add to Pray About** · fold button. Both buttons
  act on the panel's current (hidden) kind / When / topic.
- State: `state.bulkFolded`, loaded from `localStorage.getItem("planner:bulkFold") === "folded"`,
  default open (D9); written with `setItem("planner:bulkFold", …)` in the toggle handler. Wrap both
  in `try {} catch {}` exactly as `loadFold()`/`saveFold()` do.
- On desktop (`!isPhone()`), never apply `folded` (ignore the stored value) so nothing changes there.
- The ResizeObserver keeps `--bulkh` right when the panel folds or opens.

#### Task 3: Place on Sunday from Who's Next (ITER-056, edit G2)
**Files:** `body.html`
**Action:** Add a **Place on Sunday** button beside **Add to Pray About** that places every ticked
person on the chosen Sunday in one write.
**Details:**
- Markup: `<button class="btn" id="bulkPlace">Place on Sunday</button>` immediately before
  `#bulkConsider`. Also shown on the folded line (Task 2).
- Enabled only when `$("bulkWhen").value` starts with `"d:"` (a specific Sunday). Otherwise
  `disabled` with `title="Pick a Sunday under When to place directly. For a month, use Add to Pray About."`
  Update this in `renderBulk()` and in the `change` listener when `t.id === "bulkWhen"`.
- Add `async function placeMany(names, kind, date, topic)`:
  1. `needMe()`; refuse the whole batch if `.pcard.dirty[data-date="${date}"]` exists (same toast
     wording as `placeConsider`, naming the Sunday) (D8); refuse if `DATA.meetings[date]`.
  2. `let slots = (state.sundays[date] || blankSunday(date)).slots` deep-copied. For each name **in
     the order shown on Who's Next** (the order of `#dueBody input[data-sel]` that are in
     `state.selected`): if `holdState(name)` → skipped "on the do-not-ask list"; else
     `placeIntoSlots(slots, name, kind, topic, "add")` → on `ok` take the new slots, otherwise record
     skipped with a reason in plain words ("already on Mar 8", "both prayers are filled").
     (`"add"` keeps today's placement rule; slice `pc` changes both entry points together.)
  3. If nobody was placed: toast the skipped list and stop. Otherwise build the document exactly as
     `placeConsider` does (`s.slots = slots; s.owner = ownerOf(date)`) and call `write(…set(s), msg)`
     **once** — one write is one Undo step.
  4. Toast: `"3 penciled in on Mar 8"` plus `" · Skipped: Ann Lee (already on Mar 8)"` when any.
  5. Clear the placed names from `state.selected`; leave skipped names ticked so they can be sent
     elsewhere. Clear `#bulkTopic` only if everyone was placed. `renderDue()`.
- Click handler beside `bulkConsider` (line ~1971), same `t.disabled = true … false` guard.
- No Pray About document is created or deleted. History reads the same as a normal placement (D8).

### ITER-048 Tasks (slice `pb`, commit 2)

#### Task 4: Slot rules for meeting types (edit G3, part 1)
**File:** `body.html` (inside the slot-rules block), `slotRules.test.ts`
**Details:** add to the block, and to the test:
- `withoutEmptySpeakers(slots)` → removes every `isTalk` slot where `isEmptyWork`; then, if no
  `isTalk` slot remains, removes an empty `Rest Hymn` (never a Musical Number, never a hymn with
  work in it). Returns a new array.
- `withDefaultSpeakers(slots)` → if any `isTalk` slot exists, returns the slots unchanged; else
  inserts `Speaker`, `Rest Hymn` (only if no Rest Hymn and no Musical Number exists), `Speaker`
  before the first Closing Hymn / Closing Prayer — the layout `blankSunday0` uses for Regular.
- `withRestHymnIfTwoSpeakers(slots)` → if there are ≥2 `isTalk` slots and no Rest Hymn and no
  Musical Number, insert an empty Rest Hymn after talk number `ceil(n/2)` — `withMusic()`'s
  midpoint rule. Otherwise unchanged.
- Tests: named speaker survives `withoutEmptySpeakers`; topic-only slot survives (D5); rest hymn
  with a number survives; `withDefaultSpeakers` is a no-op when a speaker exists; round trip
  Regular → Fast → Regular on an empty Regular layout returns the same roles in the same order.

#### Task 5: Fast & Testimony starts empty, and the type switch adjusts the card (edit G3, part 2)
**File:** `body.html`
**Details:**
- `blankSunday0(date)`: when the computed type is `"Fast & Testimony"`, return the slot list run
  through `withoutEmptySpeakers` (so: hymns and prayers only). Regular is unchanged.
- **Type switch** (the `change` listener at line ~2191, `t.dataset.type !== undefined`):
  keep the existing `metaText` update, then:
  - Read the previous type from `t.dataset.prev` (set `data-prev="${s.type}"` on the `<select
    data-type>` in `renderPlan()`); set `t.dataset.prev = t.value` at the end.
  - Only when the transition is → `"Fast & Testimony"` or `"Fast & Testimony"` → `"Regular"` (D7):
    `const s = readCard(date)`; `s.slots = withoutEmptySpeakers(s.slots)` or
    `withDefaultSpeakers(s.slots)`; re-render that card's list:
    `list.innerHTML = s.slots.map(sl => itemRow(date, sl)).join("")`, `fillSummaries(list)`,
    `markDirty(date)` (D6). `readCard` already captures typed-but-unsaved values, so nothing typed
    is lost.
  - If a named speaker remains on a Fast card, do nothing else (the scope says the bishopric
    handles it by hand).
- **+ Add speaker** (line ~2039): after the existing insert, if the card's type select reads
  `"Fast & Testimony"`, run `readCard` → `withRestHymnIfTwoSpeakers` → re-render as above **only if
  the slot list changed**, then re-open/focus the new speaker row (find it by its `data-sid`).
  Regular cards keep today's behaviour exactly — a rest hymn somebody removed deliberately is not
  put back.
- Already-saved Fast Sundays are not touched (D2). Do not add any load-time write.
- Grep `body.html` for code that assumes speaker slots exist (`isTalk(` uses in `sumHtml`, messages,
  the exec/music message builders around lines 720–810) and confirm each copes with zero; the
  rest-hymn message line at ~725 already handles "no rest hymn".

### ITER-049 Tasks (slice `pc`, commit 3)

#### Task 6: Fill counts, and "full" stops the silent extra slot (edit G4, part 1)
**File:** `body.html` (slot-rules block + Pray About), `slotRules.test.ts`
**Details:**
- Add `slotFill(slots, kind)` to the block → `{filled, total, people:[{role, name, status}]}`.
  Talk: `isTalk` slots; prayer: `isPrayer` slots. **Filled = has a `name` and `status !== "open"`**
  — the Planner's existing definition (`planEntries`, the Calls counts), so the numbers agree.
  Tests: 0 of 0 on a Fast layout; tentative and accepted both count; an open slot does not.
- Change **both** entry points to call `placeIntoSlots(…, "warn")` by default:
  - `placeConsider(c, date, topic, {addAnyway})` passes `addAnyway ? "add" : "warn"`. On
    `talksFull` / `prayersFull`, do not toast; render the warning inside the card (Task 7).
  - `placeMany()` passes `"warn"`; a person refused for `talksFull` is skipped as "no open speaking
    slot". Then, if anyone was skipped for that reason, the toast adds: "Add speaking slots on the
    Sunday, or use + on a Pray About card." (No second dialog for the batch — keep it one press.)

#### Task 7: The fill line, the full warning, and + / − on a Pray About card (edit G4, part 2)
**Files:** `body.html` (`renderPray()` card, click/change handlers), `extra.css`
**Details:**
- In each **talk** or **prayer** card (not deferral cards), under the `<select data-placedate>` row,
  add `<div class="fillline" data-fillline>`: "2 of 3 speaking slots filled" / "1 of 2 prayers
  filled", computed from `slotFill((state.sundays[date] || blankSunday(date)).slots, c.kind)` for the
  selected date. Recompute on `change` of `[data-placedate]` and on every `renderPray()`. Zero total
  reads "No speaking slots on Mar 1" (a Fast & Testimony Sunday).
- **Talk cards only:** the count is a button (`data-fillopen`) that toggles an inline group:
  `+ slot` (`data-slotadd`) and `− slot` (`data-slotsub`), small buttons, `dis()` on both.
  - `+ slot`: refuse if the Sunday has unsaved edits (same toast as `placeConsider`) or is in
    `DATA.meetings`; otherwise write the Sunday with a new empty Speaker spliced at today's index and
    `withRestHymnIfTwoSpeakers` applied when the Sunday's type is Fast & Testimony.
  - `− slot`: remove the **last** `isTalk` slot where `isEmptyWork`; if none, do not write — show
    "Every speaking slot has someone. Open the Sunday to change it." with the Open link below. Apply
    `withoutEmptySpeakers`' rest-hymn half (remove an empty Rest Hymn when no speakers remain) only
    on Fast & Testimony.
  - Both use `write(db => db.collection("sundays").doc(date).set(s), "Mar 8: 4 speaking slots")`;
    an unsaved Sunday is created from `blankSunday(date)` first, exactly as `placeConsider` does.
- **On Place when full** (D4): replace the card's action row content with a warning line inside the
  card, `role="alert"`:
  - talk: "Mar 8 has no open speaking slot." + **Add a speaker anyway** (`data-placeanyway="<cid>"`,
    calls `placeConsider(c, date, topic, {addAnyway:true})`) + **See who's speaking**
    (`data-slotpeople="<date>|talk"`) + **Cancel**.
  - prayer: "Both prayers on Mar 8 are filled." + **See who's praying** + Cancel.
- **See who's speaking / praying** popup: reuse `#overlay` + `.modal` like `openProgram()`; title
  "Mar 8 · Speakers" (or "Prayers"); one line per slot of that kind — role, name (or "Open"),
  status chip using `STATUS_CLASS`/`STATUS_LABEL`; an **Open this Sunday** button carrying
  `data-gotoplan="<date>"` (the existing handler opens the Sundays tab — close the overlay first);
  a Close button that gets focus on open; Escape closes (reuse whatever `openProgram` uses). The
  popup fits its content (compact-UI preference).

#### Task 8: See the month, for an "Any Sunday in <month>" card (edit G4, part 3)
**Files:** `body.html`, `extra.css`
**Details:**
- On a card whose target is a month (`!considerTarget(c).date`), show a **See the month** button
  (`data-seemonth="<cid>"`) in the place of the fill line (D10).
- It opens the same `#overlay` modal, titled "Any Sunday in March · Talk for Ann Lee" (or Prayer),
  with one block per date from `sundaysIn(t.ym).filter(d => d > TODAY)`:
  - date heading and type; the slots of that kind with names and status chips; `slotFill` count;
  - **Place here** (`data-placehere="<cid>|<date>"`) → `placeConsider(c, date, topic)` where topic is
    the card's `[data-ctopic]` value; on success close the popup; on full show the same warning
    inside that date's block (talk: Add a speaker anyway);
  - talk cards: the same + / − as Task 7 for that date;
  - **Open this Sunday** (`data-gotoplan`).
  - A date in `DATA.meetings` shows "In the agenda history" and no controls. A date with unsaved
    edits on the Sundays tab shows "Unsaved edits on the Sundays tab" and no controls.
- After any write from the popup, re-render the popup from `state` when the snapshot arrives
  (listen in the existing render path: if the overlay holds a month summary, rebuild it in
  `renderPray()`), so counts stay true.
- Practice mode needs nothing: `write()` already targets the practice layer.

### ITER-050 Tasks (slice `pd`, commit 4)

#### Task 9: Which Sundays, and which are editable (edit G5, part 1)
**File:** `body.html` (slot-rules block), `slotRules.test.ts`
**Details:**
- `callEditable(date, today, inHistory)` → `!inHistory && (date >= today || daysBetween(date, today) <= 9)`
  with the day difference computed by UTC date parsing inside the block (D12). Tests: today
  editable; 5 days past editable; 9 days editable; 10 days not; in history never.
- `callMatches(slot, query)` → case-insensitive match of `query` against `slot.name`, every
  `slot.history[].name`, every `slot.past[].name`; empty query matches. Tests for each source.

#### Task 10: The Past Sundays view on Calls (edit G5, part 2)
**Files:** `body.html` (markup at line ~93, `callItems()`, `renderCalls()`, click/change handlers), `extra.css`
**Details:**
- **Controls** (in `#p-calls .controls`), the first one marked `keep` so it shows on a phone without
  opening filters: `View` select `#callView` (Upcoming / Past Sundays). Shown only when Past is
  chosen: `From` and `To` (`type="date"`, blank = everything), `Sort` (`Newest first` / `Oldest
  first`, default newest), `Find` (`type="search"`, placeholder "Name").
- **State** `state.callsPast = {on:false, from:"", to:"", sort:"desc", q:""}`. Persist
  `{on, from, to, sort}` (not `q`) to `localStorage` key `planner:callsPast` on change, loaded at
  boot — `try/catch` like `loadFold()` (D1).
- **`callItems()`** gains the view:
  - Upcoming (default) — **unchanged**: `!DATA.meetings[date] && date >= TODAY`.
  - Past — `date < TODAY || DATA.meetings[date]`, and only Sundays that have a `state.sundays`
    document (the Planner's own record; imported history rows have no calls to show). Same slot
    filter as today. Apply the window (`from <= date <= to`, blank sides open), then
    `callMatches` per slot (keep a Sunday if any of its slots match, and show only matching slots
    while a query is typed), then sort by date in the chosen direction.
  - `matchOwner("calls", …)` (Whose calls) applies in both views.
- **`renderCalls()`**: compute `const editable = callEditable(s.date, TODAY, !!DATA.meetings[s.date])`
  per Sunday.
  - Editable → today's row, controls and Message button exactly as now.
  - Read-only → no buttons at all (no Accepted/Declined/Left message/Undo/Swap/Remove/Fill/Remove
    slot/Message). Show the outcome instead: accepted → chip "Accepted · <answeredBy>"; calling with
    `msgAt` → chip "Left message Mar 3" plus dim "Never marked accepted"; calling without → chip
    "Not marked"; emptied slot → today's "Needs someone" with its `why` line (D11). Under any slot,
    list earlier records as dim lines: each `history` entry ("Ann Lee declined Mar 1 · Out of town")
    and each `past` entry ("Swapped out: Ann Lee (was accepted)"). Note: `past` is deleted when a
    passed Sunday is saved again (`readCard`, `updateSlot`), so it shows only while it survives.
  - A read-only card carries a small chip "Read only" with a `title` explaining why ("More than 9
    days ago" / "In the agenda history").
  - The header counts and the "All set" chip work in both views. The "tentative names" banner and
    the `#callCount` badge stay **upcoming-only**.
  - Empty past result: "No past calls match these filters."
- **Refuse stale clicks.** In every call-action handler (`data-callacc`, `data-calldec`,
  `data-callmsg`, `data-callundo`, `data-swapopen`, `data-swapto`, `data-slotremove`,
  `data-slotdrop`, `data-declsave`), read the date from the key and, if
  `!callEditable(date, TODAY, !!DATA.meetings[date])`, toast "This Sunday can no longer be changed
  here." and return. A screen left open overnight must not edit a Sunday that has just locked.
- Update the Calls `<p class="note">` to add: "Use View → Past Sundays to look back. Calls stay
  editable for 9 days after the Sunday."

### Docs and pins (in the commit of the slice that makes them true)

#### Task 11: Pin the edits in `assetEdits.test.ts`
- Storage keys: the count assertion becomes **14** (10 + `planner:bulkFold` get/set + `planner:callsPast`
  get/set). Add an explicit assertion that both new keys appear, so the count is not the only guard.
  (`pa` takes it to 12; `pd` to 14 — update it in each slice's commit.)
- G1: `--bulkh` is set in `body.html` and read in `extra.css`.
- G2: `id="bulkPlace"` exists and `placeMany(` calls `placeIntoSlots(`.
- G3: `blankSunday0` calls `withoutEmptySpeakers(`.
- G4/G5: `placeConsider` and `placeMany` both call `placeIntoSlots(` (one rule, two callers); the
  call handlers reference `callEditable(`.
- The slot-rules markers exist exactly once each.

#### Task 12: Documentation
- `CLAUDE.md` §9, ITER-045 entry, after "Do not 'improve' it.": add one sentence — "GROUP-04
  (2026-10-30) added user-requested edits G1–G5, listed in `plans/sacrament-planner-refinements.md`;
  its pure slot rules sit between marked lines and are unit-tested by reading the file."
- `plans/sacrament-planner-adapter.md`, end of Task 2: "Later edits: see
  `plans/sacrament-planner-refinements.md` (G1–G5)."

## Testing Strategy

- **`tests/lib/sacramentPlanner/slotRules.test.ts`** (new): the rules themselves, through
  `tests/helpers/plannerSlotRules.ts`. Covers `isEmptyWork`, `placeIntoSlots` (add vs warn,
  already, prayers full, ordering, no mutation), `withoutEmptySpeakers`, `withDefaultSpeakers`,
  `withRestHymnIfTwoSpeakers`, `slotFill`, `callEditable` (the 9/10-day boundary), `callMatches`.
  Each case's data passes every earlier check so it is refused **for the reason under test**
  (e.g. the "already on" case uses a Sunday with an open slot, so it is not `talksFull`).
- **`tests/lib/sacramentPlanner/assetEdits.test.ts`** (modify): the pins in Task 11.
- **Why no component test:** the Planner is one HTML document run in an iframe; nothing renders it
  in Vitest. The UI wiring is covered by the harness scenario below, walked at 375px and desktop.
- Guards that must stay green: `explicitTimeZone`, `navigationRoutesExist`, every
  `tests/lib/sacramentPlanner/*`, `tests/rls/realtime-isolation.test.ts`.

## Test Scenarios (Harness)

### Scenario 096: Sacrament Planner refinements
**Folder:** `testing/scenarios/talks/scenario-096-planner-refinements/` (`scenario.md`, `seed.ts`),
modelled on `scenario-093-sacrament-planner-in-the-app` — copy its seed's users, ward list, settings
documents and history-line shape; dates computed from today, as 093 does.
**Tags:** sacrament, planner, full, phone
**Purpose:** Every change here is a screen state that takes many clicks to reach by hand (a full
Sunday, a month card, a Sunday 2 weeks past with a decline on it). Seeding makes each one a single
page load, at phone width and desktop.
**Seed data summary:**
- Users — 3 — bishop (Mark Andersen), counselor (Dana Whitmore), and the 2nd counselor placeholder as in 093.
- Members — ~10 — including three with a shared last name ("Okafor") so a Who's Next search returns 3 rows; one on the do-not-ask list (`holds`).
- `planner_documents` `sundays` — **S1**: the next Sunday that is **not** a first Sunday, Regular, all 3 speaker slots named (tentative), both prayers open. **S2**: the following Sunday, Regular, 2 open speaker slots, both prayers named. **First Sunday of next month**: **no document** (renders from the blank layout). **P1**: the most recent past Sunday (0–6 days ago) with one accepted speaker, one "calling" with `msgAt`, and one emptied slot carrying a `history` decline. **P2**: the Sunday three weeks back, same shape. **P3**: a past Sunday also listed in the history's `meetings` (agenda history).
- `planner_documents` `considers` (Pray About) — Mark's: a talk targeting **S1** (full); a talk targeting "any Sunday in" S2's month; a prayer targeting **S2** (both prayers filled).
- `planner_history` — the 093-style lines, plus P3's date in `meetings`.
**Tester action:** At 375px: Who's Next → search "Okafor" → tick one → scroll; fold and reload; tick
three → Talk → S2 → Place on Sunday. Sundays → first Sunday of next month; switch type Regular ↔
Fast. Pray About → each card's line, Place, + / −, See the month. Calls → View: Past Sundays; window,
sort, search; open P1 and P2. Repeat the Pray About and Calls checks on desktop.
**Verification checklist:**
- [ ] With one Okafor ticked, the last search result scrolls fully above the panel, open and folded
- [ ] The folded panel is one line with the count, Place on Sunday, Add to Pray About and ▸; it is still folded after a reload; desktop shows no fold button
- [ ] Place on Sunday is disabled while When is "Any Sunday in …"
- [ ] Ticking the do-not-ask member plus two others, Talk, S2, Place on Sunday: two are penciled in on S2, the toast names the third as skipped and why, no Pray About card was created, and one Undo removes both
- [ ] The first Sunday of next month shows hymns and prayers only; switching to Regular adds two empty speakers and a rest hymn; typing a topic in one, switching back to Fast removes only the other
- [ ] The S1 talk card reads "3 of 3 speaking slots filled"; Place shows the warning; See who's speaking lists three names and opens S1; Add a speaker anyway places them in a fourth slot
- [ ] + / − on S2 change the slot count by one; − on S1 (all named) says every slot has someone and writes nothing
- [ ] The prayer card for S2 reads "2 of 2 prayers filled" and Place shows "Both prayers … are filled"
- [ ] See the month lists each remaining Sunday of that month; Place here puts the person on the chosen one and removes the card
- [ ] Calls opens on upcoming, unchanged; Past Sundays shows P1, P2 and P3 newest first; Oldest first reverses them; a window excluding P2 hides it; searching the decliner's name finds P1
- [ ] P1 has the usual controls; P2 and P3 have none and show outcomes, the decline line and a "Read only" chip
- [ ] Both themes; no horizontal scroll at 375px; every new button at least 44px tall on a phone

## Validation Commands

Run in this order, with **no dev server running** during the suite or the build:

```bash
# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Focused tests first
npx vitest run tests/lib/sacramentPlanner

# Full suite (≈50–75 min on the shared hosted DB; rerun a failed file alone before believing it)
npm test

# Production build
npm run build

# Harness
npm run manifest
```

## Integration Notes

- **Nothing outside the Planner moves.** The bridge, `planner_documents`, its routes, RLS and the
  realtime keying are untouched. Every new write is an ordinary `sundays` document `set` through
  the existing `write()`, so audit rows, practice mode and Undo work with no change.
- **One placement rule, two buttons.** After `pc`, Pray About and Who's Next both call
  `placeIntoSlots`; a later change to placement changes both. The "full" warning lives in that one
  function's `"warn"` result.
- **Client-side only, on purpose.** The 9-day lock and the empty-slot rules run in the browser like
  every other Planner rule (ITER-045 D1). A hand-built request to the documents route could still
  edit an old Sunday; that is the same exposure every Planner rule has today, and it is the
  adapter-versus-rebuild decision's to settle, not this plan's.
- **Rule 12:** the Planner renders only in the browser on the device's date (`TODAY`). The new
  date math (`callEditable`, `sundaysIn`) stays browser-side and must not be moved into a Server
  Component.
- **No breaking changes, no migration.** Already-saved Sundays read exactly as before (D2). The
  `pa`→`pd` commits can each be deployed alone.
- **Docs:** CLAUDE.md §9 and the adapter plan (Task 12). SPEC.md and FEATURES.md describe the
  Planner only as stored documents, so they need nothing.
