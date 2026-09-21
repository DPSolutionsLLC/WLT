# Plan: Design System — Tokens and Primitives

**Created:** 2026-09-20
**Type:** feature
**Phase:** P1 (see [P1-design-system.md](P1-design-system.md) for the *why*; this file is the *how*)

> **Filename note.** This file is deliberately NOT named `p1-design-system.md`. Windows paths are
> case-insensitive, so that name is the same file as `P1-design-system.md` and writing it would
> destroy the phase plan.

---

## Overview

Bring the prototype's visual language into WLT once, at the token and primitive level, so every
existing page changes appearance without any page being edited.

**Two decisions were taken with the user before planning, and they shape everything below:**

1. **Keep WLT's token NAMES, adopt P1's VALUES.** P1's table names roles WLT already has
   (`--bg` → `--background`, `--ink` → `--foreground`, `--ink-soft` → `--muted`, `--line` →
   `--border`, and P1's `--surface` → WLT's **`--surface-raised`**). Renaming would mean
   rewriting ~1,400 `className` usages and would break P1's own promise of no page edits.
2. **The 10 existing badge components ARE migrated in this phase** onto the new `Pill`
   primitive, so exactly one pill implementation exists before P4 begins.

### Success criteria

- Every token defined once in `app/globals.css`, both themes, with measured ratios recorded.
- Fraunces + Inter via `next/font`; no `@import` anywhere.
- Six existing primitives re-skinned with **identical props and behaviour**.
- Seven new primitives built with tests.
- All 10 badge components render through `Pill` **with every semantic distinction intact**.
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all clean.
- No page file under `app/` is edited for appearance. (`GaugePill.tsx` lives under `app/` but is
  a component, not a page — it is in scope.)

---

## ⚠️ The three traps in this phase

Read these before writing a line. Each is drawn from a retro or from the code as it stands.

### Trap 1 — `--surface` INVERTS if P1's table is pasted in literally

P1's table says `--surface: #FFFFFF` (the card). **In WLT `--surface` is the *recessed* tone**
(`#f8fafc`) and `--surface-raised` (`#ffffff`) is the card. There are **140** `bg-surface` and
**85** `bg-surface-raised` usages. Pasting P1's value into `--surface` silently flips every one
of them from recessed to raised.

`plans/retros/youth-follow-up-controls.md` §6 records a shipped defect from exactly this token's
meaning shifting: a fill read *"as an inset panel in one theme and a hole in the other."* Its fix
was **a neutral border at partial strength, never a louder fill** — keep that instinct here.

**The mapping is therefore fixed, and the executing agent must not "simplify" it:**

| P1 name | WLT token to write it into | Role |
|---|---|---|
| `--bg` | `--background` | the page |
| *(no P1 equivalent)* | `--surface` | recessed / secondary-button rest / inset |
| `--surface` | `--surface-raised` | **the card, inputs, hover target** |
| `--ink` | `--foreground` | body text |
| `--ink-soft` | `--muted` | secondary text |
| `--line` | `--border` | hairlines |

### Trap 2 — the elevation ladder must be monotonic in BOTH themes

P1 gives two levels; WLT uses three. `--surface` is used both as an inset inside a card
(`InviteForm.tsx:184`) and as a secondary-button **rest** state whose **hover** is
`bg-surface-raised` (`UserRow.tsx:137`, `Button.tsx` secondary variant).

So `--surface` must sit **between** `--background` and `--surface-raised` in both themes, or
hover goes the wrong direction in one of them. Measured luminance of the values chosen below:

```
light:  background 0.9320  <  surface 0.9579  <  surface-raised 1.0000
dark:   background 0.0121  <  surface 0.0157  <  surface-raised 0.0199
```

Both ascend. **Do not pick a `--surface` darker than `--background` in light mode** — that is
the inversion of Trap 1 reintroduced through the back door.

### Trap 3 — two badge tests assert on class names ON PURPOSE

P1 Step 3 says *"if one fails, it was asserting on a class name and the test is what needs
fixing."* **That is wrong for these two**, and following it would delete a real guard:

- `tests/components/assignments/StageBadge.test.tsx:29` — `toHaveClass('text-stage-${stage}')`.
  Its own header explains why: Tailwind reads class names statically, so an interpolated
  `text-stage-${stage}` *compiles fine and produces no CSS at all*. This test is the only thing
  standing between the codebase and nine invisible badges.
- `tests/components/youth/YouthAbsenceChip.test.tsx:68` — `expect(chip.className).not.toContain("warning")`.
  It guards `youth-i`'s decision that a young person not taking part must **not** read as the
  `Cancelled` chip's `--warning`: two different facts must not read as one.

**Both must still pass, unchanged, after the migration.** If either goes red, the migration
flattened a distinction — fix the component, not the test.

---

## Relevant Files

### Tokens and fonts
- `app/globals.css` — **modify** — all token values, both themes, `@theme inline` additions, measured ratios
- `app/layout.tsx` — **modify** — swap Geist Sans → Inter, add Fraunces as `--font-display`, keep Geist Mono and the theme script untouched

### Existing primitives — re-skin only, props unchanged
- `components/ui/Button.tsx` — **modify**
- `components/ui/Card.tsx` — **modify**
- `components/ui/Modal.tsx` — **modify**
- `components/ui/Input.tsx` — **modify**
- `components/ui/FormError.tsx` — **modify**
- `components/ui/NotPermitted.tsx` — **modify**

### New primitives
- `components/ui/Pill.tsx` — **create**
- `components/ui/StatusTag.tsx` — **create**
- `components/ui/Chip.tsx` — **create**
- `components/ui/Tile.tsx` — **create**
- `components/ui/SearchBox.tsx` — **create**
- `components/ui/SectionHeader.tsx` — **create**
- `components/ui/ConfirmDeleteButton.tsx` — **create**

### Badge migration (10)
- `components/assignments/StageBadge.tsx` — **modify**
- `components/calendar/SundayTypeBadge.tsx` — **modify**
- `components/goals/GoalStatusBadge.tsx` — **modify**
- `components/music/UnverifiedHymnBadge.tsx` — **modify**
- `components/program/ProgramStatusBadge.tsx` — **modify** (+ its stale measured-ratio comment)
- `components/roster/MemberStatusBadge.tsx` — **modify**
- `components/youth/CoverageBadge.tsx` — **modify**
- `components/youth/FollowUpBadge.tsx` — **modify**
- `components/youth/YouthAbsenceChip.tsx` — **modify**
- `app/(app)/visits/GaugePill.tsx` — **modify** (both `GaugePill` and `NeutralPill`)
- `app/(app)/visits/bandStyles.ts` — **modify** — `NEUTRAL_BADGE_CLASSES` loses the shape half

### New tests
- `tests/components/ui/Pill.test.tsx` — **create**
- `tests/components/ui/StatusTag.test.tsx` — **create**
- `tests/components/ui/Chip.test.tsx` — **create**
- `tests/components/ui/Tile.test.tsx` — **create**
- `tests/components/ui/SearchBox.test.tsx` — **create**
- `tests/components/ui/SectionHeader.test.tsx` — **create**
- `tests/components/ui/ConfirmDeleteButton.test.tsx` — **create**

### Deliberately NOT touched
- `app/(tithing)/tithing/tithing.module.css` — the navy/gold exception. See Task 9.

---

## Dependencies

- **No new libraries.** Fraunces and Inter both ship through the existing `next/font/google`.
- No schema change, no migration, no RLS change, no route change, no audit-log change.
- Existing utilities used: `types/domain.ts` label and tone Records (`PIPELINE_STAGE_LABELS`,
  `COVERAGE_STATE_TONES`, `FOLLOW_UP_STATE_TONES`, `VISIT_PRIORITY_BAND_LABELS`), and
  `app/(app)/visits/bandStyles.ts`.

---

## Known Pitfalls (from retro context)

- **[youth-follow-up-controls]** §6 — `--surface` shifting meaning between themes shipped a
  defect. The fix was a neutral border at partial strength, not a louder fill. Trap 1 and Trap 2
  above exist because of this retro.
- **[talks-b-month-planner]** — stage token contrast was **measured** in both themes and two
  tokens retuned for having no headroom. That precedent is why Task 1 records numbers rather
  than asserting the palette is fine, and why `--gold` is retuned below.
- **[calendar-b-month-view]** — colours were *checked by eye* and that is named as the failure
  `talks-b` corrected. Do not eyeball any ratio in this phase.
- **[youth-c-coverage-and-calendar]** — `npm run build` caught what lint, typecheck and 2,982
  tests all missed. The production build is a required validation step, not optional.
- **[youth-g-occasions-and-event-detail]** — a `<select>` overflowed at 375px because a flex
  item's `min-width: auto` refuses to shrink. `SearchBox` and `SectionHeader` are both flex
  rows; give shrinking children `min-w-0`.
- **[roster-b-picker-and-orgs]** — a server import inside a shared constants module made every
  table on the page unbuildable. None of the new primitives may import from `lib/supabase/*`,
  `next/headers`, or anything server-only.
- **[youth-e / ITER-022]** — a gate that hides a control without revisiting the count beside it
  makes the number lie. Relevant to `CoverageBadge`'s `· {attendeeCount}` suffix: it must
  survive the migration exactly.

---

## Tasks

### Task 1: Write the token palette, measured

**File:** `app/globals.css` (modify)

**Action:** Replace the `:root` and `.dark` core token values with the mapped palette. Leave the
nine `--stage-*` and seven `--tone-*` tokens **at their current hex values** — they all still
clear AA against the new backgrounds (numbers below) — but **update their comment blocks** to
record the new backgrounds and the new ratios, or the comments become false.

**Light (`:root`):**

```css
--background: #FAF7F1;   /* P1 --bg */
--surface: #FDFAF4;      /* between background and surface-raised; see the elevation note */
--surface-raised: #FFFFFF;  /* P1 --surface — the CARD */
--foreground: #23262B;   /* P1 --ink */
--muted: #6B6D72;        /* P1 --ink-soft */
--border: #E2DBCB;       /* P1 --line */
--primary: #2C5A4D;      /* pine — the action colour */
--primary-foreground: #FFFFFF;
--success: #15803d;      /* unchanged */
--warning: #b45309;      /* unchanged */
--danger: #b91c1c;       /* unchanged */

--pine: #2C5A4D;  --pine-soft: #E4EEE9;
--rust: #A85A34;  --rust-soft: #F4E7DE;
--gold: #8F6718;  --gold-soft: #F6EEDD;
```

**Dark (`.dark`):**

```css
--background: #1B1D1F;
--surface: #1F2225;
--surface-raised: #24272A;
--foreground: #EFEDE7;
--muted: #93989E;
--border: #3A3E42;
--primary: #7FCBAA;
--primary-foreground: #1B1D1F;
--success: #4ade80;  --warning: #fbbf24;  --danger: #f87171;   /* unchanged */

--pine: #7FCBAA;  --pine-soft: #1E332C;
--rust: #E2966B;  --rust-soft: #392920;
--gold: #E4C568;  --gold-soft: #392F1C;
```

**`--gold` IS RETUNED IN LIGHT MODE, AND THIS IS THE ONE VALUE THAT DEPARTS FROM P1'S TABLE.**
P1 predicted it: *"`--gold` at `#A8791F` on `#FAF7F1` is the one most likely to need a nudge."*
Measured, `#A8791F` gives **3.62:1** against `#FAF7F1` and **3.87:1** against `#FFFFFF` — below
the 4.5:1 AA threshold for text this size. `#8F6718` is the same hue family and measures
**4.77 / 5.10**. This is `talks-b`'s retune applied a second time, for the same reason. The dark
gold `#E4C568` needs no change (8.93 worst).

**Record these measured ratios in the comment block**, in the house style already used for the
stage and tone tokens — worst of the three backgrounds a token can sit on
(`--background`, `--surface`, `--surface-raised`), WCAG AA needing 4.5:1 for text this size:

```
LIGHT — worst of the three surfaces:
  stage-plan 7.09 · review 4.83 · approve 5.88 · request 5.33 · confirm 5.91
  notify 5.88 · speak 4.84 · appreciate 6.41 · complete 4.69
  tone-slate 7.09 · blue 4.83 · violet 5.33 · magenta 5.91 · teal 5.12 · amber 6.41 · rose 5.88
  success 4.69 · warning 4.70 · danger 6.05
  foreground 14.19 · muted 4.84 · primary/pine 7.34 · rust 4.70 · gold 4.77

DARK — worst of the three surfaces:
  stage-plan 5.86 · review 5.91 · approve 5.03 · request 5.52 · confirm 6.10
  notify 5.58 · speak 6.63 · appreciate 8.99 · complete 8.62
  tone-slate 5.86 · blue 5.91 · violet 5.52 · magenta 6.10 · teal 8.07 · amber 8.99 · rose 5.58
  success 8.62 · warning 8.99 · danger 5.43
  foreground 12.82 · muted 5.17 · primary/pine 7.88 · rust 6.30 · gold 8.93
```

Note in the comment that **no stage or tone token was retuned** — all sixteen kept their hex and
still clear AA against the warmer backgrounds — so a later reader does not go looking for a
change that was not made.

**Also record the one thing that does NOT clear a threshold:** `--border` measures 1.38:1
against `--surface-raised` in light and 1.39:1 in dark. That is a hairline, not text, and the
outgoing `--border` was 1.32:1 in the same position — **this is not a regression**, and it is
recorded so nobody "discovers" it later as a new fault.

**Extend `@theme inline`** with the six accent tokens and the display font:

```css
--color-pine: var(--pine);        --color-pine-soft: var(--pine-soft);
--color-rust: var(--rust);        --color-rust-soft: var(--rust-soft);
--color-gold: var(--gold);        --color-gold-soft: var(--gold-soft);
--font-sans: var(--font-inter);
--font-display: var(--font-fraunces);
--font-mono: var(--font-geist-mono);
```

---

### Task 2: Fonts

**File:** `app/layout.tsx` (modify)

**Action:** Replace `Geist` with `Inter` and add `Fraunces`. Keep `Geist_Mono`.

```ts
import { Fraunces, Geist_Mono, Inter } from "next/font/google";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
```

Put all three `.variable` classes on `<html>`.

**Do not touch `THEME_SCRIPT`, `suppressHydrationWarning`, the `<head>` script tag, `metadata`
or `viewport`.** The no-flash theme script must keep working exactly as it does; it is the one
sanctioned `dangerouslySetInnerHTML` in the codebase and its comment explains why it cannot be
componentised.

`font-sans` on `<body>` now resolves to Inter through the `@theme inline` change in Task 1 —
**no className on `<body>` changes.**

---

### Task 3: Re-skin the six existing primitives

**Files:** the six under `components/ui/` (modify)

**Action:** Appearance only. **Every exported name, prop type and behaviour stays identical.**

- `Button` — keep `BASE_CLASSES` including **`min-h-11`**. That is the 44px tap target every
  screen in this mobile-first app depends on, and `auth-c`'s PIN keypad is built on it. Keep the
  three variants; `primary` now reads pine because `--primary` moved, so **no class changes are
  strictly required** — adjust radius/weight only if the prototype's shape demands it, and if so
  say why in a comment.
- `Card` — may take the new radius and a softer border. Keep `bg-surface-raised`.
- `Input` — keep `min-h-11`, `text-base` (iOS zooms a form on anything smaller), the
  `aria-invalid` / `aria-describedby` wiring and the `FormError` composition.
- `Modal` — read it first; it is the largest of the six and wraps a native `<dialog>`. Keep the
  dialog element and its behaviour untouched.
- `FormError` — keep `role="alert"` and the render-nothing-when-empty rule.
- `NotPermitted` — keep the `Card` composition and the link to `/dashboard`.

**There are currently no tests for `components/ui/*`.** P1 Step 3 assumed there were. Do not add
tests for the six here beyond what Task 5 needs — the seven new primitives carry the test budget
for this phase.

---

### Task 4: Build `Pill`, the shape that the 10 badges will share

**File:** `components/ui/Pill.tsx` (create)

This is the keystone of Task 6, so its API is specified exactly. **`Pill` owns the SHAPE. Each
badge keeps its own SEMANTICS.** Flattening the second into the first is the failure mode the
user was warned about when this migration was scoped.

```tsx
import type { ReactNode } from "react";

export type PillTone = "ok" | "pending" | "missing" | "neutral";

export type PillProps = {
  children: ReactNode;
  // The three P1 tones plus neutral, for callers with no palette of their own.
  tone?: PillTone;
  // THE ESCAPE HATCH, and the reason this phase does not flatten ten badges into four tones.
  // A caller with its own measured palette — nine pipeline stages, six coverage tones, four
  // visit bands — passes its own STATIC border/text classes here instead of `tone`.
  // Pass exactly one of `tone` or `toneClassName`.
  toneClassName?: string;
  className?: string;
  title?: string;
};
```

**Shape (the only thing `Pill` hardcodes):**
`inline-flex items-center rounded-full border px-2 py-0.5 text-xs`

**Tone map** (text + border on the surrounding surface, never white on a fill — the rule
`StageBadge`, `bandStyles.ts` and `CoverageBadge` all state, because every token in
`globals.css` was measured against the surfaces and a solid fill would owe a second
measurement per state per theme):

```
ok:      "border-success text-success"
pending: "border-warning text-warning"
missing: "border-danger text-danger font-semibold"
neutral: "border-border text-muted"
```

**Write a header comment covering the three rules this component exists to hold:**

1. **Never an interpolated class name.** `border-${tone}` compiles to nothing and the pill
   renders unstyled. This is stated in four separate files already; state it here too.
2. **Colour is never the only signal.** Every caller passes words. `Pill` renders its children
   verbatim and adds no colour-only affordance.
3. **`toneClassName` wins over `tone`** when both are given, and the type comment says to pass
   one. Do not throw — a runtime throw in a presentational component is worse than a defined
   precedence.

**No `"use client"`.** It holds no state and no handlers, so it renders in a Server Component
and a client one alike (the rule `UnverifiedHymnBadge` and `bandStyles.ts` both record).

---

### Task 5: Build the remaining six new primitives

**Files:** `components/ui/{StatusTag,Chip,Tile,SearchBox,SectionHeader,ConfirmDeleteButton}.tsx` (create)

- **`StatusTag`** — a smaller inline `Pill` variant with an icon slot. Props
  `{ children, tone?, toneClassName?, icon?: ReactNode, className? }`. The icon is decorative:
  wrap it `aria-hidden="true"`, because the words carry the meaning.
- **`Chip`** — a removable tag. `{ children, onRemove?, className? }`. When `onRemove` is given,
  render a real `<button>` with an accessible name (`aria-label={`Remove ${label}`}`), **not** a
  bare `×` glyph. Needs `"use client"` only if it holds state — it should not; the parent owns
  the list.
- **`Tile`** — the dashboard card. `{ href, label, blurb?, icon?, accent?: "pine" | "rust" | "gold", locked?, pinned? }`.
  A **locked** tile must not be a link: render a non-interactive element and say *why* in text,
  never by colour or opacity alone. P3 consumes this; build it to the prop shape above so P3
  does not have to redesign it.
- **`SearchBox`** — input with a leading icon and a clear button. Keep `min-h-11` and
  `text-base`. Give the flex row's input `min-w-0` (the `youth-g` 375px overflow trap). The
  clear button needs an accessible name and only renders when there is a value.
- **`SectionHeader`** — eyebrow + **Fraunces** title (`font-display`) + optional actions row.
  The actions container needs `min-w-0` and the title should wrap rather than overflow at 375px.
- **`ConfirmDeleteButton`** — the behavioural one.

**`ConfirmDeleteButton` specification:**

```tsx
export type ConfirmDeleteButtonProps = {
  onConfirm: () => void;
  label?: string;        // default "Remove"
  confirmLabel?: string; // default "Confirm?"
  disabled?: boolean;
  className?: string;
};
```

- `"use client"` — it holds arming state.
- First click **arms** and changes the visible label. Second click calls `onConfirm`.
- Arming **self-clears after 4 seconds** via `setTimeout`, cleared in a `useEffect` cleanup so an
  unmount mid-arm does not leak or fire.
- **Never `window.confirm`** — it is blocked in sandboxed preview contexts, which the prototype
  found the hard way (decisions.md §1.5).
- `aria-live="polite"` on the label so the arming is announced, not just seen.
- Add a header comment recording that **this is an affordance, not a security boundary**:
  `youth-h` is right that a dialog you can click through is not protection, and the gate belongs
  on the server. Both are true; they are different layers.

**Tests** — one file per primitive under `tests/components/ui/`. Cover at minimum:

| File | Key cases |
|---|---|
| `Pill.test.tsx` | renders children; each `tone` emits its static classes; **`toneClassName` passes through verbatim and is not filtered** (this is what protects the nine stage tokens); `toneClassName` takes precedence over `tone` |
| `StatusTag.test.tsx` | renders children; icon is `aria-hidden`; tone passthrough |
| `Chip.test.tsx` | renders without `onRemove` and shows no button; with `onRemove` the button has an accessible name and calls back once |
| `Tile.test.tsx` | renders label and blurb; **a locked tile renders no link**; each accent emits a static class |
| `SearchBox.test.tsx` | clear button absent when empty, present with a value, clears on click, has an accessible name |
| `SectionHeader.test.tsx` | title renders in `font-display`; actions render when given, nothing when not |
| `ConfirmDeleteButton.test.tsx` | first click does NOT call `onConfirm` and changes the label; second click calls it exactly once; **arming self-clears after the timeout** (use `vi.useFakeTimers()`); `disabled` blocks both clicks |

---

### Task 6: Migrate the 10 badges onto `Pill`

**The rule for every one of them: the SHAPE moves into `Pill`; the Record of tone classes, the
labels, the null-returns and the extra affordances all STAY.** Each badge keeps its existing
header comment — those comments are the record of decisions this migration must not undo.

| Component | Passes as `toneClassName` | What must survive, exactly |
|---|---|---|
| `StageBadge` | `${STAGE_TEXT_CLASSES[stage]} ${STAGE_BORDER_CLASSES[stage]}` | **`text-stage-${stage}` must land on the element carrying the label text** — `StageBadge.test.tsx` asserts it with `getByText(...).toHaveClass(...)`. Keep `font-medium`. |
| `SundayTypeBadge` | `CLASSES[type]` | **`standard` returns `null`** — badging 46 ordinary Sundays drowns the 6 that are not. `fast_sunday` keeps `font-semibold`. |
| `GoalStatusBadge` | `STATUS_CLASSES[status]`, or neutral | The `status === null` branch and its exact wording *"No frequency set"*. |
| `UnverifiedHymnBadge` | `"border-danger text-danger font-medium"` | The `title` attribute (pass through `Pill`'s `title` prop) and the `isPlaceholderTitle` early return. **No `"use client"`.** |
| `ProgramStatusBadge` | `STATUS_CLASSES[status]` | `draft` uses `--foreground` and **not** `--muted`, deliberately. **Its measured-ratio comment is now stale — update it** (see Task 7). |
| `MemberStatusBadge` | `CLASSES[status]` | `moved_out`'s `line-through`, and the `⚠` `aria-hidden` prefix on `do_not_contact`. A member whose only marker is a red dot is a member somebody will phone by mistake. |
| `CoverageBadge` | `TONE_CLASSES[COVERAGE_STATE_TONES[state]]` | `not_expected` returns `null`; **the `· {attendeeCount}` suffix on `covered` only**; and `COVERAGE_EDGE_CLASSES` stays exported and untouched — it is not a pill. |
| `FollowUpBadge` | `TONE_CLASSES[FOLLOW_UP_STATE_TONES[state]]` | `not_due` returns `null`. **Keep its own local `TONE_CLASSES` copy** — its header says the duplication with `CoverageBadge` is deliberate so retuning one does not silently retune the other. Do not "unify" them. |
| `YouthAbsenceChip` | `"border-dashed border-muted text-muted font-medium"` | `null` for `true` and for `null`; the **dashed** border; and **no `warning` anywhere in the class string** — `YouthAbsenceChip.test.tsx:68` asserts this. |
| `GaugePill` / `NeutralPill` | `BAND_CLASSES[band]` | See below. |

**`GaugePill` is the hard one.** It has an absolutely-positioned fill layer, so it needs
`relative overflow-hidden` and a gap. Compose rather than fork:

```tsx
<Pill
  title={dueTitle}
  toneClassName={BAND_CLASSES[band]}
  className="relative gap-1.5 overflow-hidden font-medium"
>
  {/* the fill span, the mark, the words and the sr-only band name, all unchanged */}
</Pill>
```

Everything else in that file stays byte-for-byte: `bandWordIsRequired`, the clamped
`fillPercent` with its unclamped-sort comment, the `formatOverdueFor` wording, the
`aria-hidden` mark, and the `sr-only` band name when the word is dropped.

`NeutralPill` becomes `<Pill tone="neutral">{children}</Pill>`.

**Then trim `bandStyles.ts`:** `NEUTRAL_BADGE_CLASSES` currently carries the shape *and* the
tone (`inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted`).
`Pill` now owns the shape. Either delete the constant (preferred — `tone="neutral"` replaces it)
or reduce it to the tone half. **Check for other importers before deleting**:
`grep -rn NEUTRAL_BADGE_CLASSES app components`.

---

### Task 7: Fix the comments this change makes false

**File:** `components/program/ProgramStatusBadge.tsx` (modify)

Its header records measured ratios against `--surface #f8fafc` and `--surface-raised #ffffff` —
backgrounds that no longer exist. Recompute against the three new surfaces and rewrite the
block. The `distributed` row is the one that moves most, because `--primary` went from blue
`#1d4ed8` to pine `#2C5A4D` (new worst: **7.34**).

Then **grep the whole repo for other comments naming the old hexes** and correct them:

```bash
grep -rn '#f8fafc\|#ffffff\|#141414\|#1c1c1c\|#1d4ed8\|#60a5fa' app components lib types
```

`app/(app)/youth/FollowUpForm.tsx:356` is a known one — it names `--border (#e2e8f0 / #2e2e2e)`.
A comment that states a measured fact and is wrong is worse than no comment.

---

### Task 8: Sweep for drift

**Action:** Confirm no hardcoded hex remains outside the tithing exception:

```bash
grep -rn '#[0-9a-fA-F]\{6\}\b' app components --include='*.tsx' --include='*.ts' --include='*.css' \
  | grep -v 'globals.css' | grep -v 'tithing.module.css'
```

**This is expected to come back empty or near-empty** — the sweep was run during planning and
the only hits outside `globals.css` were the tithing module (the deliberate exception) and one
comment. Any new hit is something Task 6 introduced.

Then grep for surviving one-off pill markup that Task 6 did not catch:

```bash
grep -rn 'rounded-full border' app components --include='*.tsx' | grep -v 'components/ui/Pill'
```

Route anything left through `Pill`.

---

### Task 9: Confirm the tithing exception — expected to be a no-op

**File:** `app/(tithing)/tithing/tithing.module.css` — **verify, do not edit**

P1 says: *"if it does [survive], scope the navy tokens to the `(tithing)` route group rather
than letting them into `:root`."*

**That is already true by construction.** Tithing's palette lives in a **CSS Module** with
`--t-`-prefixed tokens (`--t-navy`, `--t-gold`, …) scoped to a `.page` class — it never touches
`:root` and cannot leak. The exception survives with **zero work**.

Confirm it, record in the retro that the exception was checked and needed nothing, and **leave
the file alone**. Note for P4's tithing slice: the palette is `--t-navy #1b3a6b` /
`--t-navy-mid #2e5fa3` / `--t-gold #c8a951`, which matches the prototype's values.

---

## Testing Strategy

**Unit / component tests (Vitest + Testing Library, `jsdom`):**

- Seven new files under `tests/components/ui/` — see the table in Task 5.
- **Re-run the full existing suite unchanged.** The two class-asserting tests in Trap 3 are the
  acceptance criteria for Task 6: if `StageBadge.test.tsx` or `YouthAbsenceChip.test.tsx` goes
  red, a semantic distinction was flattened. **Fix the component, never the test.**
- The other badge tests (`CoverageBadge`, `ReliabilityFlag`, `SundayCell`, `ContactStagePanel`,
  `TithingCounter`, …) assert on text and behaviour, so they should pass untouched. Any failure
  there is a genuine regression.

**Not tested, deliberately:** token hex values. A hex is not a behaviour, and the contrast
numbers live in `globals.css` where they were measured — the precedent `StageBadge.test.tsx`
states in its own header.

**No RLS, route or permission tests** — this phase touches no data, no route and no policy.

---

## Test Scenarios (Harness)

**No new harness scenario is warranted.** The harness seeds database state, and this phase
changes no data, no route and no policy — there is no state to seed that does not already
exist. Every existing scenario continues to exercise these components.

What this phase needs instead is a **browser walk**, because the failure mode is visual and no
assertion catches it. See *What to verify by eye* below.

---

## Validation Commands

Run in order:

```bash
# Linting
npm run lint

# Type checking
npm run typecheck

# Tests
npm test

# Production build — REQUIRED, not optional
npm run build
```

**The production build is non-negotiable here.** `youth-c` recorded that `npm run build` caught
what lint, typecheck and 2,982 tests all missed — a server-only import pulled into a browser
bundle. Seven new components in `components/ui/` are exactly the shape of module that can do
that. Static generation also runs code the dev server never does.

---

## Integration Notes

### What this connects to

- **P3 (Shell & IA)** consumes `Tile` for the four-section dashboard. Task 5's prop shape
  (`href`, `label`, `blurb`, `icon`, `accent`, `locked`, `pinned`) is written to P3's stated
  needs so P3 does not have to redesign it.
- **P4 (Module re-skins)** consumes `Pill`, `Chip`, `SearchBox`, `SectionHeader` and
  `ConfirmDeleteButton` per module. After Task 6 there is exactly one pill implementation, which
  is what makes each P4 slice a re-skin rather than a rebuild.

### Breaking changes

**None intended.** Every primitive keeps its props; every badge keeps its exported name and
props. The only cross-module edit is `bandStyles.ts`'s `NEUTRAL_BADGE_CLASSES` — grep for
importers before touching it.

### No migration, no type regeneration

No column, no route, no policy. CLAUDE.md rule 9 (*a server route writing a new field updates
the TypeScript type in the same change*) does not apply — nothing is written.

### Documentation to update

- `plans/conventions.md` §Styling — add the elevation ladder (`background` < `surface` <
  `surface-raised` in both themes) and the rule that a tone-bearing component passes
  `toneClassName` to `Pill` rather than inventing its own shape.
- `plans/retros/` — `/execute` writes the retro. It should record: the `--surface` mapping
  decision and why the rename was refused; the `--gold` retune with its numbers; that the
  tithing exception needed no work; and that two tests assert on class names on purpose.
- `plans/P1-design-system.md` — its Step 3 claim that *"existing tests should pass untouched;
  if one fails, the test is what needs fixing"* is wrong for the two named in Trap 3. Correct
  that line in the phase file so the next reader is not misled.

---

## What to verify by eye

Open in **both themes** at **375px** and at desktop width:

`/dashboard` · `/visits` · `/visits/all-organizations` · `/youth` · `/youth/calendar` ·
`/agendas` · `/roster` · `/program` · `/admin/users` · `/tithing`

No page was edited, so **anything that looks broken is a primitive that changed SHAPE rather
than COLOUR** — which is the one way this phase can go wrong.

Specifically check:

- [ ] A secondary `Button` and a `bg-surface` inset are **visibly distinct from the card behind
      them in BOTH themes** — this is the `youth-follow-up-controls` defect, and the elevation
      ladder is what prevents it. Hover on a secondary button should get *lighter*, in both themes.
- [ ] `/visits` gauge pills still fill left-to-right and the `never_visited` pill still carries
      its word.
- [ ] `/youth/calendar` uncovered cards still carry the left edge stripe.
- [ ] A `do_not_contact` member still shows the `⚠` and a `moved_out` member is still struck
      through.
- [ ] `/tithing` is **unchanged** — navy and gold, exactly as before.
- [ ] Headings render in Fraunces and body text in Inter; no flash of unstyled text.
- [ ] No horizontal scroll at 375px on any page.
