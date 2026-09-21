---
id: design-system-tokens-and-primitives
type: feature
iter: null
commits: ["797672e"]
date: 2026-09-20
files:
  - app/globals.css
  - app/layout.tsx
  - components/ui/Pill.tsx
  - components/ui/StatusTag.tsx
  - components/ui/Chip.tsx
  - components/ui/Tile.tsx
  - components/ui/SearchBox.tsx
  - components/ui/SectionHeader.tsx
  - components/ui/ConfirmDeleteButton.tsx
  - components/assignments/StageBadge.tsx
  - components/program/ProgramStatusBadge.tsx
  - components/youth/YouthAbsenceChip.tsx
  - app/(app)/visits/GaugePill.tsx
  - app/(app)/visits/bandStyles.ts
  - eslint.config.mjs
  - plans/conventions.md
related:
  - youth-follow-up-controls
  - talks-b-month-planner
  - calendar-b-month-view
  - youth-c-coverage-and-calendar
  - youth-g-occasions-and-event-detail
  - roster-b-picker-and-orgs
---

## What was done

P1: the prototype's visual language brought into WLT once, at the token and primitive level, so
every existing page changed appearance with **no page file edited**. `app/globals.css` took P1's
palette and both fonts moved to `next/font` (Inter body, Fraunces display). Seven new primitives
were built with tests — `Pill`, `StatusTag`, `Chip`, `Tile`, `SearchBox`, `SectionHeader`,
`ConfirmDeleteButton` — and all **10 existing badge components** were migrated onto `Pill`, so
exactly one pill implementation exists before P4 begins.

## Key decisions

- **WLT's token NAMES kept, P1's VALUES adopted — and that is what stopped `--surface`
  inverting.** P1's table calls the CARD `--surface`; here `--surface` is the RECESSED tone across
  140 usages and `--surface-raised` is the card across 85. Pasting P1's value in would have
  flipped every one of them. The mapping (`--bg`→`--background`, P1 `--surface`→`--surface-raised`,
  `--ink`→`--foreground`, `--ink-soft`→`--muted`, `--line`→`--border`) also preserved P1's own
  promise of no page edits — renaming meant rewriting ~1,400 `className` usages.

- **The elevation ladder was measured, not assumed, and it ascends in BOTH themes**
  (`light 0.9320 < 0.9579 < 1.0000`, `dark 0.0121 < 0.0157 < 0.0199`). `--surface` is both an
  inset panel and the secondary `Button`'s rest state whose hover is `bg-surface-raised`, so an
  inversion in one theme sends hover the wrong way there — the defect
  [[youth-follow-up-controls]] §6 shipped. A side effect worth knowing: the new ladder makes
  `--surface` unambiguously recessed in both themes, where the old palette's `--background` was
  pure white and a card was invisible against the page.

- **`Pill` owns the SHAPE; every caller keeps its own SEMANTICS.** The escape hatch
  (`toneClassName`) is the whole reason this migration did not flatten nine measured stage tokens,
  six coverage tones and four visit bands into four generic ones. Flattening would have failed
  nothing — the badges would simply have stopped telling things apart. `Pill` never inspects or
  filters what it is handed, and `tests/components/ui/Pill.test.tsx` exists mainly to pin that.

- **Two existing tests assert on class names ON PURPOSE, and P1's phase file was corrected for
  saying otherwise.** `StageBadge.test.tsx` (`text-stage-${stage}`) is the only thing between the
  codebase and nine invisible badges, because an interpolated Tailwind class compiles fine and
  emits no CSS. `YouthAbsenceChip.test.tsx` (`not.toContain("warning")`) guards `youth-i`'s rule
  that two different facts must not read as one tone. Both passed unchanged. P1 Step 3's *"if one
  fails, the test is what needs fixing"* was wrong for these two and now carries a correction —
  as does its assumption that `components/ui/*` had tests at all. It had none.

- **`--gold` was retuned and nothing else was.** `#A8791F` measures **3.62** on `--background`
  and 3.87 on `--surface-raised`, below AA; `#8F6718` measures **4.77 / 5.10**. P1 predicted this
  token would need the nudge. All nine `--stage-*` and all seven `--tone-*` tokens kept their hex
  and still clear AA against the warmer backgrounds — recorded in the comment so a later reader
  does not hunt for a change that was not made. This is [[talks-b-month-planner]]'s retune applied
  a second time, and [[calendar-b-month-view]]'s eyeballing avoided.

- **The stale measured-ratio comments were corrected, not left.** `ProgramStatusBadge`'s header
  cited `--surface #f8fafc` / `--surface-raised #ffffff` — backgrounds that no longer exist — and
  `distributed` moved from blue 6.41 to pine **7.34**. `FollowUpForm.tsx:356` named
  `--border (#e2e8f0 / #2e2e2e)` and claimed `--surface` inverts between themes; P1 fixed that
  premise, so the note now records that the decision survives its reason changing. A comment
  stating a measured fact and being wrong is worse than no comment.

- **The tithing exception needed ZERO work, and was verified rather than assumed.** Its palette is
  `--t-`-prefixed and defined on a `.root` class inside a CSS Module, so it cannot reach `:root`
  by construction; the file's own header says nothing there inherits from the app tokens, which is
  also why P1's palette change cannot move that screen. Verified and left untouched.

- **No radius scale was invented.** P1 specifies a palette and a type pairing but no radius, so
  `Button`, `Card` and `Input` changed **no class at all** — the re-skin arrives through the
  tokens moving underneath, which is the phase's whole premise. A shape changed from no source is
  the one way this phase breaks a layout. The only sourced type change was `font-display` on the
  two primitive titles (`Modal`, `NotPermitted`).

- **`Tile`'s hover strengthens the hairline instead of moving the fill.** A card rests at
  `--surface-raised`, the top of the ladder in light mode, so there is nowhere lighter to go and a
  darkening hover would recede where a secondary `Button`'s advances. `hover:border-muted` is
  [[youth-follow-up-controls]]'s own prescription — a neutral border at partial strength, never a
  louder fill.

- **`ConfirmDeleteButton` reads `onConfirm` in the handler, never through a ref.** The first draft
  cached it in a ref to keep it out of the timer effect's deps; `react-hooks/refs` rejected the
  render-time write, and the ref turned out to be unnecessary — the effect depends on `isArmed`
  alone and never reads the callback. The rule it protects is still real: adding `onConfirm` to
  the deps would restart the 4 seconds on every parent re-render, leaving a busy list armed
  indefinitely.

## What was found that the plan did not anticipate

- **`npm run lint` was already red — 237 errors, all in the gitignored `prototype/WLT.jsx`.**
  Proved pre-existing by stashing. A design source with 622 `useState` hooks is not code this
  repo builds, imports or deploys, so `prototype/**` was added to `globalIgnores`, following the
  precedent the same file already sets for `.walk*/**` ("a walk must not be able to break lint").
  One line, reversible; flagged rather than done quietly.

- **Task 8's sweep found 16 more files carrying one-off pill markup, and they were LEFT.** They
  live in page files, and this phase's success criteria forbid editing any page for appearance;
  the Integration Notes also state the only cross-module edit is `bandStyles.ts`. They are P4's,
  module by module — the inventory is in the execution summary. Migrating them here would have
  turned a token phase into twelve module re-skins.

- **The plan's claim that the outgoing `--border` measured 1.32:1 against `--surface-raised` was
  wrong** — it measured **1.23** (light) / **1.25** (dark). The conclusion strengthens rather than
  weakens: the new hairline (1.38 / 1.39) is slightly *more* visible than what it replaces, so it
  is not a regression by an even clearer margin.
