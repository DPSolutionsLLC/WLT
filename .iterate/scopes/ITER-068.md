# ITER-068: A clear (✕) button in every typing field, app-wide

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-11-16

## Summary
Every field a person types into, across the whole app and the Sacrament Planner, shows a **✕ at its
right edge once it has text**. Tapping it clears the field so the person can start over.

## Context
Raised by the user (2nd counselor) on 2026-11-16. Clearing a field on a phone means holding
backspace or selecting the text by hand. A ✕ makes starting over one tap, everywhere, and the same in
every module.

## Current Behavior
- **Search boxes already have it.** The shared `SearchBox` (`components/ui/SearchBox.tsx`) shows a
  clear button only when the box has text, with a real accessible name.
- **Ordinary typing fields have none:**
  - the shared `Input` primitive (`components/ui/Input.tsx`, used in roughly 48 files)
  - about 40 hand-written `<input>`s across some 36 files
  - multi-line `<textarea>`s in about 26 files
- **The Sacrament Planner** (`lib/sacramentPlanner/assets/`, imported code) has its own inputs and
  text areas, with no clear button.

## Desired Outcome
- **Where:** every field the person **types into**, in every module **and in the Sacrament Planner**:
  - one-line fields (names, titles, phone, email, topics, references, goes-by…)
  - multi-line boxes (notes, messages)
- **Not on:** dates, times, number fields or dropdowns.
- **Only when there is something to clear:** an empty field shows no ✕, matching `SearchBox` today.
- **One tap clears the whole field**, multi-line boxes included:
  - **no** "Clear this?" prompt
  - **no** undo

  This is the user's decision. They were told that on a phone a mis-tap on a long message or note
  cannot be got back, and that an undo could be added later if that ever happens.
- **Clearing counts as editing.** Whatever happens when the text is deleted by hand also happens on ✕.
  For example, validation re-runs and a required field shows its message, a dirty/unsaved marker
  appears (such as a Planner Sunday card), and live filters update.
- **It must not get in the way:**
  - the ✕ is a 44px tap target
  - it does not cover the text being typed
  - it does not cause phone-width overflow
  - it has a spoken label naming the field ("Clear name"), not a bare glyph
  - it does not take a tab stop when it is not shown
- **Done looks like:** typing in a name field on Visits, a note on To Do, a topic in the Planner and
  a message in the Planner's Messages window each shows a ✕. Tapping it empties the field and behaves
  exactly as deleting the text would. Empty fields and date pickers show nothing.

## Scope Notes
- **One mechanism, not many** (CLAUDE.md §12): the app side should gain the ✕ through the shared field
  primitives, reusing `SearchBox`'s existing clear pattern rather than a second one. Hand-written
  inputs then need either moving onto the primitive or the same pattern applied. Planning decides; it
  is a broad, mechanical change across many files.
- **Controlled inputs:** most app fields hold their value in React state or a form library. Clearing
  must go through the same change path (the value setter or onChange), or the screen and its stored
  value disagree.
- **The Planner is imported code**, changed only for deliberate, user-requested reasons (GROUP-04 /
  GROUP-06 precedent). This is one. Its inputs are plain DOM driven by its own event handlers, so its
  ✕ must fire the same input events those handlers listen to (for example, so a card still marks
  itself dirty).
- **Browser-native clear buttons:** some browsers already draw their own ✕ on `type="search"`.
  Planning must avoid showing two.
- **Large surface:** this touches many files across modules, so it is planned on its own. It may be
  split by area (shared primitives, then hand-written fields module by module, then the Planner).
- **Accessibility polish** belongs with P13 (`plans/P13-polish.md`); planning may read it for the
  tap-target and labelling rules.

## Open Questions
- Should **read-only and disabled** fields ever show the ✕? The assumption is no.
- Fields with a **leading icon or a trailing unit** (a phone prefix, a "minutes" suffix) need a set
  place for the ✕. Planning confirms the layout at 375px.
