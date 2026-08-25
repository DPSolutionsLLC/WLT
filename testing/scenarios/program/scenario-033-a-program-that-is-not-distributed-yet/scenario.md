---
name: A program that is not distributed yet
scope: program-c-public-pages
part: 1
tags: [program, public, full]
prerequisites: none
---

## Purpose

The gate, and the product decision behind it.

FEATURES.md says the public page "always reflects the most current **approved** version", which
reads as though approval were what publishes a program. It is not, and the difference is the whole
subject of this scenario: **distribution is the act of publishing**. A program the bishopric has
signed off and not yet handed to anybody is not yet the congregation's, and a QR code that showed
it would publish it before the ward had it.

This is the one state that is genuinely awkward to reach by hand — build, submit, approve, and stop
exactly there — so it is seeded rather than clicked. The seed writes `public_data` and leaves the
public page **active**: every ingredient is present except the status. If the page rendered anyway,
the gate would not exist.

**Walk this after 032**, which shows what the page looks like when it *is* published. This one is
about what it looks like when it is not.

## Seed Data

Identical to scenario 032 in every respect except three, and the three go together:

| Entity | Detail |
|---|---|
| Program | `status = 'approved'` — **not** `distributed` |
| Program | `distributed_at` — **null** |
| Program | `public_data` — **written**, exactly as the approve route writes it |
| Public page | slug `harness-ward-program`, **active** |

Everything else — the ward, the two users, the Whitfield household and its address, both speakers,
all three hymns, the leadership contacts and the missionary block — is as scenario 032 seeds it.

**Sign in with:** `bishop@harness.wardleadershiptools.test` (only for the last two checks — the
first is walked signed out).
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- program/scenario-033-a-program-that-is-not-distributed-yet`
2. `npm run dev`
3. In a **private window**, open **http://localhost:3000/public/harness-ward-program**
4. Sign in as the bishop in a normal window and open the program for **20 September 2026**.
5. Press **Reopen as a draft**. The button sits under the meeting order; it was added on
   2026-08-24 after this walk found the screen telling people to reopen a program while giving
   them no way to do it.
6. Load the public URL again in the private window.

## Verification Checklist

### Machine-checkable

- [ ] The slug **404s**. It does not render an empty program, a header with nothing under it, or a "coming soon" page
- [ ] The 404 is the **same page** an unknown slug gives — compare it with `/public/definitely-not-a-real-slug`
- [ ] Nothing from the program appears in the 404's source: search it for "Sarah", "Whitfield", "Andersen" and `555-`
- [ ] The program itself is visible and **approved** inside the app to the bishop — this is a public-page gate, not a broken program
- [ ] Every field is read-only while approved, and a **Reopen as a draft** button is present
- [ ] After reopening, the fields become editable and the badge reads Draft
- [ ] The confirmation says the program is no longer on the public page — not merely that it reopened
- [ ] After step 5 (reopen as draft), `programs.public_data` for that row is **null**
- [ ] After step 5, the public URL still 404s
- [ ] After step 5, `draft_data` is **untouched** — reopening withdraws the program, it does not erase it

### Needs a human eye

- [ ] The bishop can see an approved program in the app while the public page shows nothing. Is it obvious **why** — or does it look like the public page is broken?
- [ ] Does the 404 tell a visitor anything about whether this ward has a program waiting? It should not.

## Failure Behavior

- [ ] An approved-but-undistributed program is absent from `public_program`. Automated: `tests/rls/public-program-anon.test.ts`.
- [ ] The page 404s for a ward whose only program is approved. Automated: `tests/routes/public-page.test.ts`.
- [ ] Moving a program back to `draft` clears `public_data` in the same UPDATE that moves the status, so no reader can see one without the other. `setProgramStatus` in `lib/program/queries.ts`.
- [ ] A distributed program whose projection was somehow never written also 404s, rather than rendering half a page. Automated: `tests/rls/public-program-anon.test.ts`.

## Walkthrough record

**2026-08-24 — driven by Claude in a real Chromium browser, screenshots reviewed by the user.**
Agent-driven evidence, not a person using the app.

Observed values:

| Check | Observed |
|---|---|
| `programs.status` | `approved` |
| `approved_at` | `2026-09-17T18:00:00+00:00` |
| `distributed_at` | `null` |
| `public_data` | **written**, 17 keys — the projection exists and is still withheld |
| `public_pages.is_active` | `true`, slug `harness-ward-program` |
| Anon view rows for that slug | **0** — the status is the only thing withholding it |
| `/public/harness-ward-program` | HTTP **404** |
| 404 body | "Page not found / This link is not active. Check the address, or ask your ward for a current one." — **identical** to the unknown-slug 404 |
| Leaks in the 404 HTML | none: `Sarah`, `Whitfield`, `Andersen`, `555-`, `Harness Test Ward`, `I Stand All Amazed`, `Charity` all absent |
| Program inside the app, as bishop | visible, badge reads **Approved**, all **45** form fields `disabled`, **0** buttons inside `<main>` |
| After `approved -> draft` | `status` `draft`; `public_data` **null**; `draft_data` intact at 1698 bytes; anon view 0 rows; public URL still **404** |

The gate is isolated exactly as intended: every ingredient the view needs is present — an active
slug, a written projection — and the page is dark **solely** because the status is `approved`.

**A defect found here, and FIXED on 2026-08-24.** Step 5 said "reopen the program as a draft", and
the app provided no way to do it. `ProgramBuilder.tsx` printed "This program is approved. Reopen it
as a draft to change it." inside its `{locked && …}` block, while every action button sat inside
`{canBuild && !locked && …}` — so in the locked state the instruction rendered and the control did
not. Confirmed in the browser at the time: 0 buttons inside `<main>`.

The rule underneath was always sound; only the button was missing. `POST /api/programs` with
`action: "status", to: "draft"` returned **200** and moved the program, and
`tests/routes/program-approval.test.ts` already covered it.

**A Reopen as a draft button now exists**, behind `program.build`, and only for `approved` — there
is no path out of `distributed` (`LEGAL_TRANSITIONS`), because an emailed PDF cannot be recalled.
The distributed state gets its own sentence saying so, instead of the old one telling people to do
something impossible. The confirmation reads "Reopened as a draft. It is no longer on the public
page," because "reopen" does not sound like "unpublish" and it does both.

**Not walked:** the original last line, "after distribution the same slug renders", still cannot be
walked from the UI: `program-d` has not built the distribute route. Scenario 032 seeds the
distributed state directly and checks it there.

**Observation for `program-d`:** reopening as a draft leaves `approved_by` and `approved_at`
stamped, so a draft carries the stamps of an approval that has been withdrawn. Harmless today —
nothing reads them on a draft — but `program-d` re-approves and re-distributes, and a "who approved
this" line would read the stale pair.

## Notes

- **The last line of the original checklist is deferred.** It read "after distribution, the same
  slug renders" — but `program-d` builds the distribute route and it has not shipped, so there is
  no button that moves this program to `distributed`. Scenario 032 seeds the distributed state
  directly and checks exactly that, which is why it is not repeated here. Re-add the transition
  check to this scenario when `program-d` merges; do not tick it before then.
- `public_data` being present on an approved program is **correct**, not a seeding mistake. The
  approve route writes it. Seeding it null would make this scenario pass for the wrong reason — it
  would exercise migration 039's `is not null` guard and say nothing about the status gate.
- Step 5 uses the existing "reopen as a draft" path on the builder screen (`program-b`), which is
  the same `approved -> draft` transition a post-approval edit uses.
