---
name: The program that is not ready
scope: program-b-builder-screen
part: 1
tags: [program, smoke]
prerequisites: none
---

## Purpose

**Proves that missing is not an error state.**

A program is almost never complete when somebody sits down with it. A speaker has not replied, the
music coordinator has not chosen the sacrament hymn, nobody has written the announcements, and
this ward has no organist or chorister recorded at all because neither has a screen until
`program-e`. **That is the normal Thursday, not the broken case.**

Every automated check here already passes: the sentences exist, they are pluralised, they carry no
field names, the panel has no alert role. What none of them can answer is the only question that
decides whether this screen is usable — does a secretary reading six gaps at once feel *behind*,
or feel *broken*? A checklist and a validation summary are made of the same words. What separates
them is tone, ordering and what sits beside them, and those need eyes.

The second thing it proves is that the app does not get in the way. A program with gaps can still
be sent for approval. Blocking that would make the feature unusable in the exact week it is used.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `leadership_contacts` populated with three names and phone numbers |
| Users | `bishop@…` (bishop, Mark Andersen), `counselor@…` (counselor, Peter Lindqvist), `secretary@…` (ward_secretary, Ruth Delgado) |
| Sunday | **2026-09-20**, `standard`, 3 speaking slots, conducted by Mark Andersen |
| Slot 1 | Sarah Whitfield, ward member, topic "Charity Never Faileth" |
| Slots 2 and 3 | **Both empty** — no assignment rows at all |
| Prayers | Invocation — David Brooks. **Benediction absent** |
| Hymns | Opening 19, Closing 152. **Sacrament hymn absent** |
| Program | Already built, stored at `draft`, with six gaps |
| Absent by design | Sacrament hymn, benediction, announcements, organist, chorister, **two** open speaking slots |

**Two** open slots rather than one is the point of the fixture, not an accident: `speaker_slot` is
the only key that can stand for more than one thing, and with one open slot a broken pluraliser
reads as passing.

**Sign in with:** `secretary@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- program/scenario-031-the-program-that-is-not-ready`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the ward secretary.
4. Open **Program** in the sidebar. Read the row for 20 September 2026 before opening it.
5. Open **20 September 2026**.
6. Read the **Still needed** panel without fixing anything.
7. Read the **Preview** below the form.
8. Press **Send for approval**.

## Verification Checklist

### Machine-checkable

- [ ] The list row reads "**6 things still needed**", not "6 errors" and not a bare number
- [ ] With one Sunday in range the list says "The next **Sunday** that holds a sacrament
      meeting." — the count is DROPPED in the singular, never "The next 1 Sunday"
- [ ] Every gap is a sentence naming what to do — never a field name like `sacrament_hymn`
- [ ] No underscore appears anywhere in the panel
- [ ] The two open speaking slots read as **one line** with a count: "2 speaking slots are still open."
- [ ] The panel header count reads "**6 things still needed**", plural
- [ ] Nothing on screen reads "TBD", "Not yet assigned", "None", "required", "invalid" or "error"
- [ ] The panel carries no warning icon, no red, and no `role="alert"`
- [ ] In the **Preview**, the nine fixed meeting-order lines all render — Presiding,
      Conducting, Organist, Chorister, Opening hymn, Invocation, Sacrament hymn, Closing
      hymn, Benediction — with the empty ones greyed and italic
- [ ] An empty person line reads "Nobody yet"; an empty hymn line reads "Not chosen yet"
- [ ] **Announcements** and the other optional blocks are still **absent entirely** from the
      preview when empty. A Sunday with no musical number is not missing one
- [ ] Nothing in the preview reads "TBD", "Not yet assigned" or "None assigned"
- [ ] Slot 1 reads "Sarah Whitfield — Charity Never Faileth"; slots 2 and 3 read as nobody yet
- [ ] Pressing **Send for approval** succeeds. It warns about the gaps, it does not block
- [ ] The confirmation reads exactly "**Sent for approval.**" It does **not** claim the
      bishopric has been notified — this screen cannot know whether a notification was
      emitted, and it must not say so
- [ ] After sending, the status badge reads **Waiting for approval** and the Send control is gone
- [ ] **Save the program** is still offered, and still works. A program waiting for approval is
      NOT locked — `isLocked()` covers `approved` and `distributed` only (program-a), so the
      secretary can still correct a typo while the bishopric reads it
- [ ] No raw uuid appears anywhere on the screen
- [ ] No horizontal overflow at 375px
- [ ] Buttons, inputs and textareas are at least 44px tall. **Inline navigation links are
      not** — "All programs" is 20px, exactly like "Open this Sunday" on `/assignments`
      (same `text-sm text-primary underline underline-offset-4` class). That is the app's
      established text-link pattern, not a program-b regression

### Needs a human eye

- [ ] Read the panel cold. Does it feel like a **checklist of work left**, or like a list of things the app is complaining about?
- [ ] Six gaps at once. Overwhelming, or manageable?
- [ ] Would a secretary looking at this know what to do next without being told?
- [ ] The preview greys the empty organist line rather than dropping it. Does the greyed skeleton read as *a program still being filled in*?
- [ ] The sentence under the panel says the list moves when you check for changes. Does that explain why a field you typed still shows as needed, or does it read as an excuse?
- [ ] The warning above **Send for approval** — does it inform without discouraging? Would you press it?
- [ ] In dark mode, is the panel still legible and still un-alarming?

## Failure Behavior

- [ ] A program with gaps is never refused. Automated: `tests/routes/program-approval.test.ts` builds one with gaps and gets a 201.
- [ ] Every key in `MISSING_FIELD_KEYS` has a written sentence, and a key added without one fails the build. Automated: `tests/components/program/MissingPanel.test.tsx` plus the closed `Record` in `types/domain.ts`.
- [ ] One gap renders the singular sentence and several render the plural. Automated: same suite, both fixtures.
- [ ] A program whose stored draft is corrupt reports that it could not be read rather than opening blank. Automated: `tests/db/program-snapshot.test.ts`.
- [ ] An **organization president** cannot open the program at all. Automated: `tests/rls/program-access.test.ts`.

## Walkthrough record

**2026-08-24 — driven by Claude (agent) in a real browser at localhost:3000, screenshots handed to
Daniel for the judgement calls.** This is agent-driven evidence plus a screenshot review, not a
person using the app on a device.

Signed in as `secretary@harness.wardleadershiptools.test` (Ruth Delgado, ward_secretary).
Program id `30667a1a-4d25-41b8-88af-5caf6fcb5f9d`, Sunday id `b09a261f-b5ee-4fa0-8ef8-f52af858addd`.

### Observed values

| What | Observed |
|---|---|
| `/program` list row | "Sunday, September 20" · badge `Draft` · "6 things still needed" |
| Panel heading count | "6 things still needed" |
| Panel lines, in order | "No sacrament hymn has been chosen." / "Nobody has been asked to give the benediction." / **"2 speaking slots are still open."** / "No organist has been named." / "No chorister has been named." / "No announcements have been written." |
| Underscore anywhere in `<main>` | none |
| `role="alert"` in the panel | none |
| Raw uuid in rendered text | none (the id appears only in the `href`) |
| Banned words scanned | TBD, Not yet assigned, None assigned, required, invalid, error, failed, must be, cannot be, problem — **none present** |
| Preview `<dt>` terms, in order | Presiding, Conducting, Opening hymn, Invocation, First/Second/Third speaker, Closing hymn — sacrament hymn, benediction, organist, chorister and announcements are **absent entirely** |
| Preview speakers | "First speaker / Sarah Whitfield — Charity Never Faileth", "Second speaker / Nobody yet", "Third speaker / Nobody yet" |
| 375px horizontal overflow | 0px (`scrollWidth` 360 = `clientWidth` 360) |
| Tap targets under 44px | one: "All programs" link, 328×20 — see correction below |
| Stored status before send | `draft` |
| Stored status after send | `pending_approval` (re-read with the service client) |
| Audit row | `program_status_changed`, module `program`, detail `{from: "draft", to: "pending_approval", programId, sundayId}`, `2026-08-25T01:29:07.982554+00:00` |
| Notification rows written | **0** — see Defect 1 |
| Save at `pending_approval` | succeeded; `draft_data.announcements` re-read as "WALK TEST: edited while waiting for approval." |

### Defects found

1. **"The bishopric has been notified." is claimed unconditionally.** After pressing Send for
   approval the app printed "Sent for approval. The bishopric has been notified." and **zero rows
   were written to `notifications`**. `emitNotification` is fire-and-forget and returns silently on
   an unknown trigger key, so `ProgramBuilder.submitForApproval` cannot know the claim is true.
   Reproduction: seed this scenario, send for approval, then
   `select count(*) from notifications where ward_id = '11111111-1111-4111-8111-111111111111'`.

2. **The harness trigger list has drifted from the canonical seed.**
   `NOTIFICATION_TRIGGERS` in `testing/infrastructure/seedUtils.ts` contains **no `program_*` keys**,
   while `supabase/seed/notification_triggers.sql` defines three
   (`program_pending_approval`, `program_approved`, `program_changes_requested`). Pre-existing;
   affects scenarios 028 and 029 as well as this one. It means every program notification path is
   currently unwalkable in the harness — the route succeeds, the warning goes to the server console,
   and nothing reaches a bell.

3. **"The next 1 Sunday that holds a sacrament meeting."** on `/program` — a count line that does
   not degrade to the singular. Cosmetic, and exactly the `ai-b` plural category.

### Checklist corrections made during the walk

- **"tap targets are at least 44×44" was unreachable as written.** The "All programs" link measures
  328×20. `/assignments?month=2026-09` — shipped in talks-b — renders "Open this Sunday" at the same
  20px with an identical class string, so 20px inline text links are the app's established pattern
  and the check would fail on every screen. Split into a buttons/inputs check (which passes) and a
  statement of the link pattern.
- **"the Save controls are gone" after sending was wrong.** `isLocked()` covers `approved` and
  `distributed` only, so a program at `pending_approval` is deliberately still editable — verified
  by saving one and re-reading the row. Corrected to say the **Send** control goes and Save stays.

### Judgements answered, and what changed (24 August 2026)

Daniel answered all six. Five needed no change; one did.

| # | Question | Answer |
|---|---|---|
| 1 | Checklist, or the app complaining? | Reads fine |
| 2 | Six gaps — overwhelming? | Manageable |
| 3 | Omitted organist line — "nobody yet" or "failed to load"? | **Failed to load** |
| 4 | Is "Nobody yet" a placeholder to remove? | Keep it |
| 5 | Dark mode legible and un-alarming? | Yes |
| 6 | Is one sentence enough for the stale missing line? | Yes |

**Judgement 3 was a fail and the preview was rebuilt around it.** `ProgramPreview` had OMITTED
every meeting-order line with nobody on it, reading talks-c's "an absence renders as an absence"
as "delete the row". With five lines gone the preview read as a program that had failed to load.
talks-c actually says a missing organist is A BLANK — not "Never", not "None assigned" — which is
a weaker and more literal thing than no line at all.

The nine fixed lines of a sacrament meeting now always render, muted and italic where empty
("Nobody yet" for a person, "Not chosen yet" for a hymn — matching the speakers wording judgement
4 kept). The optional blocks — ward business, special notes, musical number, announcements,
missionary information — are still omitted when empty, which is a different decision: no slot is
standing open for them. Locked in by `tests/components/program/ProgramPreview.test.tsx`.

### Defects fixed after the walk

1. **The notification claim.** Now reads "Sent for approval." Verified live: the sentence no
   longer appears and `/notified/i` does not match anywhere in `<main>`. Regression test in
   `tests/components/program/ProgramBuilder.test.tsx`.
2. **The singular count.** `/program` now reads "The next Sunday that holds a sacrament meeting."
   Verified live after a re-seed.
3. **A race the fix uncovered.** Writing the new status into the TanStack cache could be
   overwritten by a refetch already in flight — the ai-a failure in another costume. Every cache
   write in `ProgramBuilder` now cancels in-flight queries first. Caught by the new
   send-for-approval test, not by a person.

**Defect 2 from the walk is NOT fixed** — `NOTIFICATION_TRIGGERS` in
`testing/infrastructure/seedUtils.ts` still has no `program_*` keys. It is shared harness
infrastructure, pre-existing, and affects scenarios 028 and 029 too, so it wants its own change
rather than riding along in this one.

### Left unwalked

- The notification bell itself, blocked by Defect 2.
- Real-device behaviour. Driven in a desktop browser at a 375px viewport, which is not a thumb on
  glass.
- Scenario 030, the AI editor — not run; it spends money on real Claude calls.

## Notes

- The six gaps are deliberate and are **not** a seeding bug. See the header comment in `seed.ts`.
- `organist` and `chorister` have no upstream table in this schema at all — 06-program-music.md
  sources them from "music coordinator entry or manual", and neither surface exists until
  `program-e`. They will appear as gaps on **every** program until somebody types them in. If that
  reads as noise rather than as work, that is a real finding worth recording here.
- Filling a field in the form does **not** clear its line until the next "Check for changes". That
  is program-a's snapshot rule, said out loud under the panel. Whether the sentence is enough is
  one of the human-eye checks above.
