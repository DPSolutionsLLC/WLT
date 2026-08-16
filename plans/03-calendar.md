# Phase 3 — Sunday Calendar & Conducting Rotation

The month view every planning module hangs off. Small phase, but it is the spine of
Phases 4, 6, and 10.

**Depends on:** Phase 2. **Unlocks:** Phases 4, 6, 10.
**Reference:** [FEATURES.md](../FEATURES.md) §Module 2; [SPEC.md](../SPEC.md) §API Routes → Sunday Calendar.

---

## Goals

1. Sunday records auto-generated ahead of time, editable by the bishopric
2. Conducting rotation that auto-populates and stays editable
3. A monthly calendar view that later phases decorate with pipeline status

---

## Step 1 — Sunday Generation

Sundays should exist before anyone plans against them. Two mechanisms:

- **On demand:** when the calendar loads a month with no Sunday rows, generate them
- **Scheduled:** a Supabase Edge Function keeps 12 months of Sundays ahead

Generation rules:

- Every Sunday date in range gets a row with `type = 'standard'`, `speaking_slots = 3`
- Apply the Fast Sunday resolution rule (Step 2) to each generated month
- General Conference (first weekend of April and October) — pre-mark as
  `general_conference`, since it is predictable and it *shifts Fast Sunday*
- Never overwrite an existing row. Generation is `INSERT ... ON CONFLICT DO NOTHING`

`lib/calendar/generateSundays.ts` is a pure function taking a date range and returning
rows, so it is trivially testable. The route and the cron both call it.

---

## Step 2 — Fast Sunday Resolution

Fast Sunday is **the first Sunday of the month that is not displaced by a conference.**

```
Fast Sunday = the earliest Sunday in the month whose type is NOT
              stake_conference, general_conference, or holiday
```

Normally that is the first Sunday. When a stake conference or general conference falls on
the first Sunday, Fast Sunday moves to the **following** Sunday. General Conference in
April and October triggers this predictably, twice a year.

`lib/calendar/resolveFastSunday.ts` — pure function:

```ts
export function resolveFastSunday(monthSundays: Sunday[]): string | null
```

Returns the `sunday_id` that should be `fast_sunday`, or `null` if every Sunday in the
month is displaced.

**This is a resolution rule, not a generation-time constant.** The bishopric can mark a
Sunday as stake conference weeks after the calendar was generated, and Fast Sunday must
move in response. So the rule re-runs whenever a Sunday's `type` changes:

| Trigger | Action |
|---|---|
| Month generated | Resolve and set `fast_sunday` |
| A Sunday's type set to a displacing type | Re-resolve that month |
| A Sunday's type cleared back to `standard` | Re-resolve that month — Fast Sunday may move back earlier |
| A Sunday manually set to `fast_sunday` | Clear any other `fast_sunday` in that month; treat as a pinned override |

**Setting `fast_sunday` sets `speaking_slots = 0`; clearing it restores the default of 3.**

**Guard against silently discarding work.** If re-resolution would move Fast Sunday onto a
Sunday that already has assignments or prayers, do **not** apply it silently — zeroing the
speaking slots would orphan planned speakers. Return a warning and require confirmation:

> Marking March 2 as Stake Conference moves Fast Sunday to March 9, which currently has
> 3 speakers assigned. Continue?

On confirmation, move the assignments back to `plan` stage rather than deleting them, and
notify the planner. The bishopric can also pin Fast Sunday manually to override the rule
entirely — the pin wins until it is cleared.

---

## Step 3 — Conducting Rotation

`conducting_rotation` holds position 1/2/3 → user, with `effective_from`.

```ts
export function resolveConductingUser(
  sundayDate: Date, rotation: RotationEntry[], anchorDate: Date
): string
```

Default cycle: Bishop → 1st Counselor → 2nd Counselor, advancing one step per Sunday.
Compute from an anchor date and the count of Sundays elapsed, so it is deterministic and
does not depend on prior rows being correct.

**Every Sunday's `conducting_user_id` is stored, not computed at read time.** Auto-populate
it on generation, then let the bishopric override any individual Sunday. A computed value
would silently rewrite history when the rotation changes.

Rules:

- Any bishopric member can edit any Sunday's conducting assignment
- Any bishopric member can reorder the rotation itself
- **Both actions notify the other two** — `admin_setting_changed`
- Changing the rotation does **not** retroactively rewrite Sundays already assigned; it
  applies from `effective_from` forward. Say so in the UI

---

## Step 4 — API Routes

| Route | Method | Auth | Does |
|---|---|---|---|
| `/api/sundays` | GET | Any authenticated | List Sundays in a range. Returns type, notes, conducting, slot config |
| `/api/sundays` | POST | Bishopric | Create a Sunday (or generate a range) |
| `/api/sundays/[id]` | PATCH | Bishopric | Update type, notes, conducting, slots, presiding override |
| `/api/conducting-rotation` | GET | Any authenticated | Current rotation order |
| `/api/conducting-rotation` | PATCH | Bishopric | Reorder. Notifies other bishopric |

The GET routes are readable by all authenticated users — the music coordinator, secretary,
and executive secretary all need the upcoming Sunday list. Only mutations are bishopric-only.

**`PATCH /api/sundays/[id]` re-resolves Fast Sunday for the month whenever `type` changes.**
If the re-resolution would land on a Sunday with existing assignments, the route returns
`409` with the warning payload instead of applying; the client confirms and retries with
`?confirm=true`. This is the one route in the phase with non-obvious side effects — keep
the resolution call in the data layer so it cannot be bypassed by a future caller.

`slot_config` is `jsonb`: an array of `{ slot_number, length_minutes, type }`. Validate
its shape with Zod on write; a malformed blob breaks the program builder in Phase 6.

---

## Step 5 — Calendar View

`/calendar` — monthly grid.

Each Sunday cell shows:

- Date and type badge (Standard / Fast / Stake Conference / Conference / Holiday / Special)
- Conducting counselor
- Notes, if any (e.g. "High Council Visit")
- Placeholder regions for pipeline status, speaker names, and goal alerts — Phase 4 fills
  these. Design the cell now to accommodate them so the layout does not get rebuilt

Colour-coding by pipeline stage comes in Phase 4. Define the colour tokens here in the
Tailwind config so both phases use the same scale, and make sure the palette is legible
in both light and dark mode.

**Mobile:** a month grid at 375px is unusable. Render a vertical list of Sunday cards on
small screens and the grid at `md:` and up. Same data, two layouts.

Clicking a Sunday opens its detail — a stub in this phase, the assignment detail page in
Phase 4.

---

## Tests

| Test | Asserts |
|---|---|
| `generate-sundays.test.ts` | Correct Sundays for a range across month and year boundaries; DST weeks handled |
| `generate-idempotent.test.ts` | Re-running generation over an existing range changes nothing |
| `fast-sunday-default.test.ts` | With no conferences, the first Sunday is fast and has 0 speaking slots |
| `fast-sunday-shift.test.ts` | Stake conference on the first Sunday moves fast to the second; general conference in April and October does the same. **Highest priority in this phase** |
| `fast-sunday-reresolve.test.ts` | Marking the first Sunday as conference *after* generation moves fast forward; clearing it back moves fast earlier again |
| `fast-sunday-collision.test.ts` | Re-resolution onto a Sunday with assignments returns 409 rather than zeroing slots; on confirm, assignments revert to `plan` and the planner is notified |
| `fast-sunday-pinned.test.ts` | A manual `fast_sunday` override survives re-resolution until cleared, and clears any other fast Sunday that month |
| `conducting-rotation.test.ts` | Rotation cycles 1→2→3→1 across weeks; a mid-range rotation change applies forward only |
| `slot-config.test.ts` | Malformed `slot_config` is rejected by the PATCH route |
| `calendar-read-access.test.ts` | Music coordinator and secretary can GET Sundays; only bishopric can PATCH |

---

## Definition of Done

- [ ] Sundays auto-generate for 12 months ahead and on demand
- [ ] Generation is idempotent and never overwrites edits
- [ ] Fast Sunday resolves to the first non-displaced Sunday, and **re-resolves** when a
      Sunday's type changes after generation
- [ ] April and October pre-marked as general conference, with Fast Sunday shifted
- [ ] Re-resolution onto a Sunday with assignments warns and confirms rather than
      silently zeroing speaking slots
- [ ] Conducting auto-populates from the rotation and is editable per Sunday
- [ ] Editing conducting or the rotation notifies the other two bishopric members
- [ ] Calendar renders as a grid on desktop and a card list on mobile, light and dark
- [ ] All authenticated roles can read the calendar; only bishopric can write
- [ ] Pipeline-status and colour tokens are defined and ready for Phase 4
- [ ] All five tests pass

---

## Pitfalls

- **Timezone drift.** `sundays.date` is a `date`, not a `timestamptz`. Constructing it
  from `new Date()` in a browser west of UTC can land on Saturday. Do date math in UTC
  or with `date-fns` date-only helpers, and never round-trip through a local-time string.
- **`UNIQUE` on `date` alone.** Phase 0 fixes this to `(ward_id, date)`. If it was
  missed, a second ward cannot have the same Sunday. Verify before building on it.
- **Computing conducting at read time.** Store it. A computed value rewrites the past
  whenever the rotation changes.
- **Treating Fast Sunday as a generation-time constant.** It is a *resolution rule* that
  must re-run whenever a Sunday's type changes. A stake conference scheduled in February
  for the first Sunday in March has to move March's Fast Sunday — if the rule only ran at
  generation, it will not.
- **Silently zeroing speaking slots.** Moving Fast Sunday onto a Sunday that already has
  speakers orphans them. Warn, confirm, and revert the assignments to `plan` — never
  delete them.
- **Forgetting the reverse direction.** Clearing a conference designation must move Fast
  Sunday back *earlier*, not leave it where it shifted to.
- **Deleting a Sunday.** Assignments, prayers, hymns, and programs all reference it.
  Prefer `type = 'holiday'` over deletion; if a delete is genuinely needed, block it when
  dependent rows exist.
