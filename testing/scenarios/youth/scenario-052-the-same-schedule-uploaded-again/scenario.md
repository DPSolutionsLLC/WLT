---
name: The same schedule, uploaded again in March
scope: youth
part: 3
tags: [youth, import, idempotency, full]
prerequisites: none
---

## Purpose

Proves the three things a re-import must not do — **duplicate, revive, or destroy**.

A school publishes its schedule in November and republishes it in March with two games added, one
moved and one dropped. In between, a leader cancelled a game and corrected another to *Away*, and
typed in a team dinner by hand. Every one of those is work the import must leave alone.

`tests/lib/icsIdempotent.test.ts` asserts the diff and
`tests/routes/youthCalendarImport.test.ts` asserts the writes. What neither answers is whether a
leader, **reading only the preview**, can tell that nothing they did by hand is at risk. That is a
question about the words on the screen and it is the reason this scenario exists.

Seeding is what makes it cheap: the "already imported, then edited by hand" state takes several
minutes to reach through the UI, and a tester reaching it by hand does something slightly different
every run.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `ym-president@harness.wardleadershiptools.test` (Young Men president) |
| Households | Brooks (2201 Canyon Road) |
| Members | 1 youth — Ethan Brooks, `active`, in Young Men |
| Activity profiles | 1 — *Varsity basketball*, Lincoln High School, owned by Young Men |
| Calendars | 1 — `ics_upload`, `last_synced_at` 2 Jan 2027 |
| Events | **12** — 11 already imported, 1 hand-entered |

The eleven imported rows carry the same `source_uid` / `source_recurrence_id` values the January
file produces, so the March file matches them rather than duplicating them:

| Event | State in the app | In the March file |
|---|---|---|
| vs Roosevelt, 15 Jan 7:30pm | **`cancelled` by hand** | unchanged |
| at Jefferson, 22 Jan 7:30pm | **`event_type = away` by hand** | **moved to 29 Jan** |
| vs Madison, 29 Jan 6:00pm | `upcoming` | **absent** |
| District Tournament, 5 Feb | all day | unchanged |
| practice × 7, 4:00pm | `upcoming` | unchanged |
| **Team dinner, 20 Jan 6:00pm** | **hand-entered** — null `calendar_id`, null `source_uid` | n/a |
| vs Central, 5 Mar 7:30pm | — | **new** |
| at Washington, 12 Mar 7:00pm | — | **new** |

**Fixture file:** `lincoln-basketball-march.ics`, committed in this directory. Every `VEVENT`
states in its own `DESCRIPTION` what is expected of it.

**Sign in with:** `ym-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-052-the-same-schedule-uploaded-again`
2. `npm run dev`, then open http://localhost:3000
3. Sign in and open **/youth**. Press **Show past events** if the season is behind you. Note the
   cancelled game, the *Away* game and the hand-entered team dinner.
4. Note the `id` of the *at Jefferson* row in Supabase — you will check it did not change.
5. Follow **Import a schedule**, choose *Ethan Brooks — Varsity basketball* and
   `lincoln-basketball-march.ics`.
6. **Read the preview carefully before confirming.** This is the step the scenario is for.
7. Confirm, then return to `/youth` **without reloading**.
8. Check the rows in Supabase: `activity_events`, `activity_calendars`, `audit_log`.
9. Import **the identical file a third time** and read the preview.

## Verification Checklist

### Machine-checkable

- [ ] The preview reports **2 to create, 1 to update, 9 already correct, 1 in the app and not in
      this file**.
- [ ] The one to update is *at Jefferson*, and the preview names **which fields change** — the
      date and time, and nothing else.
- [ ] The "in the app, not in this file" entry is *vs Madison*, described as **unchanged by this
      import** — not as something about to be deleted or cancelled.
- [ ] **The hand-entered team dinner is not listed under "not in this file"**, even though it is
      inside the file's window.
- [ ] Confirming creates **exactly 2** rows. The total event count goes from 12 to 14 and by
      nothing else.
- [ ] The moved game has the **new** date (29 Jan, 7:30pm) and **the same `id`** as in step 4 — it
      was updated, not replaced.
- [ ] **The hand-cancelled Roosevelt game is still `cancelled`.**
- [ ] **The hand-corrected Jefferson game is still `event_type = 'away'`**, not reset to `tbd`.
- [ ] **The hand-entered team dinner is untouched** — same title, same date, `calendar_id` and
      `source_uid` both still null.
- [ ] *vs Madison* is still present, still `upcoming`, on its original date.
- [ ] `last_synced_at` moved forward, and a **second `activity_calendars` row was not created**.
- [ ] The result screen shows the **same four numbers under the same labels** as the preview.
- [ ] **The result screen pluralises**: "1 event updated", never "1 events updated". ADDED
      2026-08-28 during the walk, where it FAILED as defect `youth-b-D3`; fixed the same day.
- [ ] **"last imported" reads like every other date on the screen** — `Sat, 2 Jan 2027`, not
      `1/2/2027`. ADDED 2026-08-28, where it FAILED as defect `youth-b-D2`; fixed the same day.
      Regression test: `tests/lib/icsIdempotent.test.ts` → *"formats the last-imported date the
      same way as every other date on the screen"*.
- [ ] A second `youth_calendar_imported` audit row exists carrying this import's counts.
- [ ] Importing the identical file a third time reports **0 to create, 0 to update**, and creates
      nothing.
- [ ] No horizontal overflow at 375px, and every **button and form control** at least 44×44.
      CORRECTED 2026-08-28, for the reason recorded in scenario 051: inline text links in prose
      are ~20px throughout this app and are exempt.

### Needs a human eye

- [ ] **Reading only the preview, can a leader tell that nothing they did by hand is at risk?**
      This is the question the scenario exists for.
- [ ] Does "1 in the app and not in this file — nothing will change for it" read as a **statement**
      rather than as a warning or as a pending deletion?
- [ ] Does the update row make it clear what is moving *from* and *to*, rather than only what it
      will become?
- [ ] After a third import that changes nothing, does the screen read as *"there was nothing to
      do"* rather than as *"something went wrong"*?

## Failure Behavior

- [ ] Confirming twice in quick succession (double-click) creates nothing extra. Migration 055's
      unique index `activity_events_source_idx` is what refuses the second write; the button
      disabling is a courtesy, not the guarantee.
- [ ] Previewing `lincoln-basketball-march.ics` against a **different activity** offers a first
      import of that file into that activity, not a diff against this one — a calendar belongs to
      a profile.
- [ ] Editing the .ics on disk between preview and confirm gives *"The file changed since you
      previewed it. Preview again."*

## Walkthrough record

**2026-08-28 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every value below was read from the database with the service client, never from the screen. Row
ids were captured **before** the import so "updated, not replaced" could be proved rather than
assumed.

**All three guarantees hold — duplicate, revive and destroy are all prevented.** Two copy defects
found (`youth-b-D2`, `youth-b-D3`).

Ids before the re-import:

| Row | id | State |
|---|---|---|
| at Jefferson | `10ab84dc-80e2-4433-81b7-3a3ef1a5b468` | 22 Jan 19:30, `upcoming/away` |
| vs Roosevelt | `cefb06ce-2d1b-4a7e-882b-3e6ae846f745` | `cancelled/tbd` |
| vs Madison | `9ff30d87-2684-4146-821c-853275c862bb` | 29 Jan 18:00, `upcoming/tbd` |
| Team dinner | `7cbb2aff-00b4-457c-8381-d158290e8242` | hand-entered, `source_uid` null |

- **Preview: 2 to create, 1 to update, 9 already correct, 1 in the app and not in this file.**
  Exactly as specified. The update names *at Jefferson* and says *"Was Varsity Basketball at
  Jefferson, Fri, 22 Jan 2027, 19:30 — changing date and time"*.
- **The "not in this file" entry is *vs Madison* alone.** The hand-entered team dinner is inside
  the file's window and is correctly **absent** from that list.
- **Confirmed: 12 → 14 rows, +2 and nothing else.**
- **`10ab84dc-…` is still `10ab84dc-…`** — moved from `2027-01-23T02:30:00+00:00` to
  `2027-01-30T02:30:00+00:00`. Updated in place, not replaced.
- **It is still `upcoming/away`.** The hand correction survived an update that touched the same
  row. This is the single most important assertion in this scenario.
- **Roosevelt is still `cancelled`.** Not revived.
- **Madison is untouched** — same id, same instant, still `upcoming`. Not destroyed.
- **Team dinner untouched**, `source_uid` and `calendar_id` still null.
- **One calendar row throughout** — same id `fd87cc41-…`, `last_synced_at` moved
  `2027-01-03T01:00:00+00:00` → `2026-08-28T04:39:48.812+00:00`.
- **Audit:** `{created:2, updated:1, unchanged:9, notInFile:1, problems:0}` — counts, no titles.
- **Third import of the identical file: 0 to create, 0 to update, 12 already correct, 1 not in
  file.** The confirm button reads **"Nothing to import"** and is disabled.
- **No reload anywhere.** A `window.__walkSentinel` planted on `/youth` before the import survived
  the navigation to `/youth/import`, the confirm, and the navigation back — and the schedule read
  **"Schedule (14 upcoming events)"** having been cached at 12. `youth-a-D2` is genuinely fixed.

Failure paths:

- **Two concurrent confirms** (what a double-click does) → exactly **one** row created; the second
  returned `created: 0`. But being precise: the two requests **serialised**, so in this run the
  diff prevented the duplicate and the unique index was never exercised. So the index was proved
  **directly** instead, with the service client:

  | Insert attempted | Result |
  |---|---|
  | duplicate `source_uid`, **NULL** `source_recurrence_id` | **REFUSED** `23505` — proves `nulls not distinct` is load-bearing; the default would have allowed it |
  | duplicate `source_uid` + same `source_recurrence_id` | **REFUSED** `23505` |
  | same `source_uid`, **new** `source_recurrence_id` | allowed — a series does not collapse to one row |
  | **two** hand-entered rows (`calendar_id` and `source_uid` both null) | **both allowed** — the partial `WHERE` works; without it a ward could enter one manual event ever |

- **The same file against a different activity** offers a first import, not a diff. Verified by
  creating a second profile temporarily: `calendarExists: false`, 2 to create, 0 unchanged, 0 not
  in file — against the original activity the same file gave `calendarExists: true` and a diff.
  The probe profile was deleted afterwards and the seed state restored to exactly 12 events.
- **File edited between preview and confirm** → *"The file changed since you previewed it. Preview
  again."* (walked in detail in scenario 051).

Checklist correction made during the walk:

1. **Reworded the 44×44 line**, for the reason recorded in scenario 051.
2. The *"same file against a different activity"* line **could not be performed with this seed as
   written** — the ward has one activity. It was walked by creating a second profile with the
   service client and removing it afterwards; the line is left as it is because the guarantee is
   worth checking, but a tester doing this by hand must add an activity first.

Not walked: every "needs a human eye" line — gathered on the review page.

**Database left in the exact seeded state**: 12 events, one calendar with
`last_synced_at = 2027-01-03T01:00:00+00:00`.

### Addendum — 2026-08-28, the defects this scenario found are fixed

**`youth-b-D2` — the ambiguous date.** The preview's "last imported" line was a bare
`new Date(...).toLocaleDateString()` in the client, rendering `1/2/2027` beside a dozen dates
reading `Sat, 2 Jan 2027`. On the one screen whose entire job is that dates are unambiguous, that
is the only ambiguous string on it — an en-GB reader takes it for 1 February.

Fixed by formatting it on the SERVER, through the same function every other date on the screen
goes through: `IcsImportPreview` gained `lastSyncedLocal`, and `IcsPreviewStep` renders it rather
than re-deriving from the ISO value. Re-verified in the browser: **"last imported Sat, 2 Jan
2027"**, and no all-numeric date anywhere on the page.

**`youth-b-D3` — "1 events updated".** The result screen did not pluralise, while the preview
(labelled counts) and the confirm button (*"Import 1 event"*) both did — so the one screen that
got it wrong was the one a leader reads last. Fixed with `countOfEvents()` in `IcsImportWizard`.
Re-verified in the browser:

```
2 events created
1 event updated
9 events already correct
1 event in the app and not in this file — unchanged by this import
```

**The fixes changed words only.** Re-running this scenario end to end after them produced exactly
the same database: 14 events, Roosevelt still `cancelled`, Jefferson `away` at
`2027-01-30T02:30:00+00:00`, Madison untouched at `2027-01-30T01:00:00+00:00`, the tournament still
`all_day`, the hand-entered row still there, 0 notifications.

## Notes

- **Nothing is ever deleted or cancelled by an import, and that is a decision rather than an
  omission.** A feed that briefly publishes a short file must not be able to cancel a season, and
  a re-import must never destroy something a leader typed or cancelled by hand. The preview names
  the absent events precisely so the guarantee is visible rather than theoretical.
- **"Absent from the file" is computed within the window the file covers**, never against all time.
  Recurrence is expanded roughly twelve months ahead, so over all time every past game a feed ever
  produced would qualify — and a leader reading "47 events are not in this file" would reasonably
  assume something had broken.
- The March fixture deliberately contains **no UID-less entry**, unlike scenario 051's. A
  synthesised UID is derived from the summary and the raw DTSTART, so a seed reproducing one by
  hand would encode a hash — and would go quietly stale the day the derivation changed. Scenario
  051 covers the synthesised path from a genuine import instead.
