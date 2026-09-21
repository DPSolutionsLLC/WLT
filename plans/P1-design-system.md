# P1 — Design System

**Depends on:** nothing. **Size:** Medium. **Status:** Not started.

Bring the prototype's visual language into WLT once, at the primitive level, so every existing
page changes appearance without any page being edited.

**Load with this:** [prototype/decisions.md](prototype/decisions.md) §1 (the conventions) and
[prototype/module-map.md](prototype/module-map.md) §2.11 (the one deliberate exception).

---

## Why this is first

It is cheap, it touches no data, and it carries no schema or security risk. It is also the
fastest route to "the whole app feels right" — and doing it per-module instead would mean
rebuilding the same primitives nine times.

---

## The design language

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#FAF7F1` | `#1B1D1F` |
| `--surface` | `#FFFFFF` | `#24272A` |
| `--ink` | `#23262B` | `#EFEDE7` |
| `--ink-soft` | `#6B6D72` | `#93989E` |
| `--line` | `#E2DBCB` | `#3A3E42` |
| `--pine` / `--pine-soft` | `#2C5A4D` / `#E4EEE9` | `#7FCBAA` / `#1E332C` |
| `--rust` / `--rust-soft` | `#A85A34` / `#F4E7DE` | `#E2966B` / `#392920` |
| `--gold` / `--gold-soft` | `#A8791F` / `#F6EEDD` | `#E4C568` / `#392F1C` |

Type: **Fraunces** (display — headings, titles) + **Inter** (body).

Accents carry no semantics of their own — `pine`/`rust`/`gold` label dashboard sections the way
`CONTEXT_TONES` in `types/domain.ts` already labels organizations. Keep `--success`,
`--warning`, `--danger` and the nine `--stage-*` colours as they are; those *do* carry meaning
and were measured.

---

## Step 1 — One stylesheet, measured

Write all of the above into [app/globals.css](../app/globals.css) — **one place**, both themes,
under the existing `:root` / `.dark` structure.

**Measure the contrast, do not eyeball it.** The stage colours in `globals.css` carry their
ratios in a comment against both `--surface` and `--surface-raised`, and two were retuned for
having no headroom. Do the same here and record the numbers the same way. `--gold` at `#A8791F`
on `#FAF7F1` is the one most likely to need a nudge.

> ⚠️ **Do not port the prototype's CSS approach.** It defines these tokens in **27+ per-page
> `<style>` blocks** that have already drifted — `--gold` is `#C9A24B` in one and `#A8791F` in
> another — and its own build notes record that biting it twice: tiles rendering with no card
> because one page's stylesheet lacked `.tile`, and a whole import page rendering unstyled
> because it used another page's class names. One stylesheet. Tailwind utilities stay.

## Step 2 — Fonts

Fraunces and Inter through `next/font/google`, alongside the existing Geist setup in
[app/layout.tsx](<../app/layout.tsx>). **Not** an `@import` in a `<style>` block — that is what
the prototype does, 27 times, and it blocks render.

Keep the existing no-flash theme script exactly as it is.

## Step 3 — Re-skin the existing primitives

[components/ui/](../components/ui/): `Button`, `Card`, `Modal`, `Input`, `FormError`,
`NotPermitted`. Same props, same exports, same behaviour — appearance only. Their existing tests
should pass untouched.

> ⚠️ **CORRECTED DURING EXECUTION, 2026-09-20.** This step used to end *"if one fails, it was
> asserting on a class name and the test is what needs fixing."* **That is wrong for two tests,
> and following it would have deleted a real guard.**
>
> - `tests/components/assignments/StageBadge.test.tsx` asserts `toHaveClass('text-stage-${stage}')`.
>   Tailwind reads class names statically, so an interpolated `text-stage-${stage}` compiles fine
>   and produces **no CSS at all**. That test is the only thing standing between the codebase and
>   nine invisible badges.
> - `tests/components/youth/YouthAbsenceChip.test.tsx` asserts the class string contains no
>   `warning`. It guards `youth-i`'s decision that a young person not taking part must not read as
>   the `Cancelled` chip: two different facts must not read as one.
>
> Both passed unchanged through the `Pill` migration. **If either goes red, a semantic distinction
> was flattened — fix the component, never the test.**
>
> Also corrected: this step assumed `components/ui/*` had tests. **It had none.** The seven new
> primitives carry the phase's test budget instead.

## Step 4 — Add the missing primitives

The prototype leans on six things WLT has no component for. Build them here, once, rather than
letting each P-phase improvise:

| Component | What it is |
|---|---|
| `Pill` | Status pill with `ok` / `pending` / `missing` tones |
| `StatusTag` | Smaller inline variant with an icon slot |
| `Chip` | Removable tag (org filters, planned items, attendees) |
| `Tile` | The dashboard card — icon, label, blurb, accent, locked and pinned states |
| `SearchBox` | Input with a leading icon and a clear button |
| `SectionHeader` | Eyebrow + Fraunces title + optional actions row |

Plus one behavioural primitive:

**`ConfirmDeleteButton`** — two clicks. The first arms with a visible label change
("Confirm?"), the second deletes, and arming self-clears after a few seconds.
**Never `window.confirm`** — it is blocked in sandboxed preview contexts, which the prototype
found the hard way. The prototype audited 16 trash-can buttons that deleted on a single click;
WLT should not grow its own.

> This is an affordance, not a security boundary. `youth-h` is right that a dialog you can click
> through is not protection — the gate belongs on the server. Both are true; they are different
> layers.

## Step 5 — Sweep for drift

`Tile` will be used by P3's dashboard; the rest are used from P4 on. Before closing this phase,
grep `app/` and `components/` for hardcoded hex values and one-off status-pill markup, and route
them through the new primitives. Anything left behind becomes a per-module surprise later.

---

## Deliberate exceptions

**Tithing keeps its own navy/gold palette** — `--navy #1B3A6B`, `--navy-mid #2E5FA3`,
`--gold #C8A951`. The prototype kept it on purpose: that calculator was ported from a
fully-built standalone tool whose palette was already approved, and fidelity mattered more than
template consistency. **Confirm this survives** before P4's tithing slice; if it does, scope the
navy tokens to the `(tithing)` route group rather than letting them into `:root`.

> ✅ **CONFIRMED 2026-09-20, AND IT NEEDED ZERO WORK.** The palette already lives in a **CSS
> Module** with every custom property `--t-`-prefixed and defined on a `.root` class, so it
> cannot reach `:root` by construction. Its own header states that the names would otherwise
> collide (`--muted`, `--border` and `--radius` all exist in `globals.css` with different values)
> and that **nothing there inherits from the app tokens** — which is also why P1's palette change
> cannot move that screen by a pixel. The file was verified and left untouched.

---

## Definition of done

- [ ] Every token defined once, in `globals.css`, both themes
- [ ] Contrast ratios measured against both surfaces and recorded in a comment
- [ ] Fraunces + Inter via `next/font`; no `@import` anywhere
- [ ] Six existing primitives re-skinned, props unchanged
- [ ] Seven new primitives built with tests
- [ ] No hardcoded hex left in `app/` or `components/` outside the tithing group
- [ ] Every existing page still renders at 375px, light and dark
- [ ] `npm run lint` and `npm run typecheck` clean; existing component tests green

## What to verify by eye

Open `/dashboard`, `/visits`, `/youth` and `/agendas` in both themes at 375px and at desktop
width. The pages have not been touched — anything that looks broken is a primitive that changed
shape rather than colour, which is the one way this phase can go wrong.
