# P6 — Conducting Sheet & Ward Calendar

**Depends on:** P4 (reads Sacrament's data), P5. **Size:** Large. **Status:** Stub — flesh out with `/planning` when approached.

**Load with this:** [prototype/module-map.md](prototype/module-map.md) §2.3 and §2.6, and build-notes-raw.md §`conducting`, §`conducting-sheet-standalone-rows`, §`calendar`, §`calendar-recurring-series-public-link`, §`calendar-orgs-spaces-youth-overlay`.

> **This is a stub on purpose.** It carries the scope, the dependencies and the known traps, so
> `/planning` can write the real plan against what the code actually looks like by then rather
> than against a guess made on 2026-09-20. Do not treat the absence of detail as absence of scope.

## Settle the name collision first

WLT's `/calendar` is the **Sunday/sacrament calendar** with conducting rotation. The prototype's
Ward Calendar is a **full ward event calendar**. They are different modules with one name.
**Decide the routes before either is built.**

## Conducting Sheet

Sections **and standalone rows** — invocation, benediction and each speaker are individually
placeable anywhere in the sequence. A box you can only reorder *within* cannot represent a real
meeting, which is the mistake the prototype made and had to undo.

Reflow text sizing in four steps via a root font-size driving rem wrapping, **never a zoom
transform**. Read-only during the meeting, deliberately; check-off is a separate post-meeting
flow that fires once the computed end time passes.

> **Open, and not to be guessed at:** a real Church conducting script is a richer object than a
> label-or-value line item — spoken lines with blanks ("Our opening hymn is number ___"),
> director's notes, conditional sections. Whether a line stays a plain value or becomes scripted
> text with a blank the value fills is an undecided design fork. See decisions.md §6.

## Ward Calendar

Month/week/day. Creator owns edit; everyone else can attach a note. Ward Secretary/Admin get a
**separate, narrower marking authority** — putting an event on an agenda or the program — not
general edit power over someone else's event.

Multi-org tagging (cross-posting, not duplication). **Space reservation** with soft same-day
conflict notices, never blocking. A `cancelsSacrament` flag that makes the Sunday calendar say
"No sacrament meeting" rather than showing planning pills. **Recurring series with
`patternHistory`** — each version effective-from, so a past date keeps resolving against what was
true then, and a change can be entered weeks ahead. A stable public series link. A read-only
youth-activity overlay coloured home/away.

## Known traps

- **Placeholder generation needs a floor at today**, or a pattern change repaints the past. The
  prototype fixed this twice; the first fix was incomplete and `patternHistory` is the real one.
- **One occurrence form, not two.** Separate "fill in" and "reschedule" forms read as a bug.
- Zero blending with Youth Support. A Wednesday activity is a normal calendar event tagged
  `youth`; the youth module tracks activities **outside** church.
