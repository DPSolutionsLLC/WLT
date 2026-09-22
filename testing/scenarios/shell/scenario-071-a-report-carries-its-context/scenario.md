---
name: A report carries its context
scope: P3
part: 1
tags: [shell, admin, full]
prerequisites: none
---

## Purpose

The whole value of Report an issue is in what the reporter does **not** have to type: the page
they were on, and the calling they were acting under, both taken from the session. A report tagged
with the wrong page — or with `/dashboard` because the modal forgot where it was opened — is worse
than one tagged with none, because nobody doubts it.

`tests/routes/issue-reports.test.ts` proves the route takes the role from the session and ignores
one in the body. It cannot prove the **modal** passes the right `page_path`, because a route test
calls the handler directly and never renders a chrome bar. That seam — a component gate and a
route gate disagreeing — is where two of `p2-admin-and-access`'s three walk defects lived.

The second ward is here for the other half: `issue_reports` has the most open INSERT policy in the
app, so ward isolation is the only thing holding, and it is worth seeing it hold.

## Seed Data

| Entity | Detail |
|---|---|
| Wards | Harness Test Ward, Harness Second Ward |
| Users | 3 — see below |

| Sign in as | Ward | Role | Job in this scenario |
|---|---|---|---|
| `rs-president@harness.wardleadershiptools.test` | 1 | org_president (Relief Society) | Files both reports |
| `bishop@harness.wardleadershiptools.test` | 1 | bishop | Confirms the rows exist |
| `ward-b-bishop@harness.wardleadershiptools.test` | 2 | bishop | Must see neither |

**No reports are seeded.** Every row is written through the modal, because where the reporter was
when they pressed it is the fact under test.

**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- shell/scenario-071-a-report-carries-its-context`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the **Relief Society president**.
4. Open `/visits`. Press **Report an issue** in the chrome bar. Submit a report.
5. Open `/youth`. Press **Report an issue** again. Submit a different report.
6. On a third page, press it, leave the box **empty**, and submit.
7. Press **Help** and read what it says.
8. Sign out. Sign in as the **ward 1 bishop** and confirm both rows exist. There is no review
   screen until P12, so read them with the service client:
   ```sql
   select page_path, role, ward_id, body from issue_reports order by created_at desc;
   ```
9. Sign in as the **ward 2 bishop** and confirm neither row is reachable.

## Verification Checklist

### Machine-checkable

- [ ] Each row's `page_path` is **the page the modal was opened from** — `/visits` and `/youth` —
      and **not** `/dashboard`
- [ ] Each row's `role` is `org_president`: the **session's** role, not anything typed
- [ ] Each row's `calling_id` is set, and names the reporter's active Relief Society calling
- [ ] `ward_id` is ward 1 on both
- [ ] Ward 2's bishop can read **neither** row
- [ ] A `writeAuditLog` row exists for each submission: `action = 'issue_reported'`,
      `module = 'admin'`, with the page path and role in `detail` and **not** the body text
- [ ] The empty report is refused, and **the typed text is not lost** — the modal stays open with
      whatever was in the box still in it
- [ ] No chrome-bar control is under 44×44, and the five of them do not overflow at 375px

### Needs a human eye

- [ ] The modal says, before you type, **which page this report will be tagged with** — so the
      automatic context is visible rather than a surprise
- [ ] The refusal on an empty report reads as "say something" rather than as an error
- [ ] After a successful submit, it is obvious the report was sent — not merely that the modal
      closed
- [ ] **Help says plainly that per-page help has not been written yet**, and points at Report an
      issue. It must not invent any help text
- [ ] Both themes: the two icons read as controls rather than as decoration

## Failure Behavior

- [ ] Submitting with the network off keeps the modal open, shows a sentence, and **keeps the
      text**. A report that silently vanished is worse than no button
- [ ] There is no way to edit or delete a report from anywhere in the app — `issue_reports` has
      no UPDATE and no DELETE policy at all, so RLS denies both by default
- [ ] Automated: `tests/rls/issue-reports.test.ts` covers ward isolation, the open insert, and
      that even the bishop cannot edit or delete a row. `tests/routes/issue-reports.test.ts`
      covers the session-supplied role and the empty-body refusal

## Walkthrough record

**2026-09-22 — driven by Claude (agent) in a real browser.** Every row below was read back with the
service client and with each user's own authenticated client; nothing is asserted from the screen
alone.

### Observed — two reports, filed by hand from two different pages

| page_path | role | ward | calling_id resolves to |
|---|---|---|---|
| `/visits` | `org_president` | Harness Test Ward | `org_president`, Harness Test Ward, `is_active: true` |
| `/youth` | `org_president` | Harness Test Ward | the same calling |

- **`page_path` is the page the modal was opened from, not `/dashboard`.** Filed from `/visits`
  and from `/youth`; both stored correctly.
- **`role` is the session's**, not anything typed — the reporter is a Relief Society president and
  never entered a role. `tests/routes/issue-reports.test.ts` covers the stronger case (a body that
  *claims* `bishop` is ignored); this walk covers that the honest path stores the right thing.
- `calling_id` resolves to a real, active Relief Society calling in ward A — which is what P12's
  review screen will read to say which organization the reporter was acting for.
- Two `audit_log` rows, `action: issue_reported`, `module: admin`, carrying
  `pagePath`, `role`, `callingId` and `issueReportId` — and **not the body text**, which is the
  reporter's own words and is deliberately kept out of a row other people read.

### Observed — who can read them

| Signed in as | Reports readable |
|---|---|
| ward A bishop | **2** — `/visits`, `/youth` |
| ward A Relief Society president (**the author**) | **0** |
| ward B bishop | **0** |

**The author reads neither of her own reports**, which is `issue_reports_select` working as
designed — the read is the ward's admins, because a report is typed freely and may name a
household or a colleague. It is also the live confirmation of why
`lib/issues/writeIssueReport.ts` never uses a RETURNING clause: `.insert().select()` would apply
the SELECT policy to the returned row and raise 42501 for exactly the people the feature is for.

### Observed — refusal and Help

- An **empty** report is refused with *"Say what went wrong — a sentence is enough."*; the modal
  stays open. A **whitespace-only** body is refused the same way and **the typed text is still in
  the box afterwards** (`"     "` preserved), which is the half that matters — losing somebody's
  typed report is what guarantees they never use the button again.
- The 400 appears in the browser console as a failed resource load. That is the browser logging a
  deliberate validation refusal, not an app error.
- **Help says plainly there is none yet** and points at Report an issue. No fabricated help text:
  *"There is no written help for this page yet. If something here is confusing or looks wrong, use
  Report an issue — it records which page you were on and what calling you are acting under, so you
  do not have to explain any of that."*
- The modal **names the page before you type** — *"This report records that you were on /youth"* —
  so the automatic context is visible rather than a surprise.

### Observed — at 375px

`scrollWidth 375 === clientWidth 375`, no horizontal scroll, and **no chrome-bar control under
44×44** with all five present. Screenshot: `.walk/scenario-071/01-report-modal-375.png`.

### Defects found

**None.** Both defects fixed during this session were found by scenarios 069 and 070.

### Not walked

- There is **no review screen** — P12 owns it — so step 8 read the table directly, as the scenario
  says to. That is the design, not a gap.
- The offline/network-failure path (*"keeps the modal open, shows a sentence, and keeps the text"*)
  was not exercised; only the 400 path was. The code path is the same `catch`, but it was not
  driven.
- Both-themes reading was not judged here; scenario 069 covered it.

## Notes

**There is no review screen.** P12 owns it. Step 8 reads the table directly and that is expected,
not a gap in the scenario — the capture half is what P3 built, deliberately, so there is a place
to record defects while P4–P13 are walked.

An author **cannot read their own report**, which is why step 8 signs in as the bishop rather than
staying as the reporter. That is also why `lib/issues/writeIssueReport.ts` never uses a RETURNING
clause: PostgreSQL applies the SELECT policy to one, so `.insert().select()` would have failed for
exactly the people this feature is for.
