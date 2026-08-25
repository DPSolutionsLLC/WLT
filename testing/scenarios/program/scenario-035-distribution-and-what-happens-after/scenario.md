---
name: Distribution, and what happens after
scope: program-d-pdf-and-distribution
part: 1
tags: [program, email, full]
prerequisites: none
---

## Purpose

The irreversible step, and the edit that follows it.

Distribution is the only action in this app with **no undo**: `LEGAL_TRANSITIONS` gives
`distributed` no exit, because an email that has gone cannot be recalled. Every refusal in the route
therefore has to happen *before* anything is sent, and every sentence on the screen has to be worded
by consequence rather than by mechanism. Whether that actually reads clearly to a ward secretary at
nine on a Thursday night is not a thing a test can answer.

It is also the moment `/public/[slug]` stops being dark. Scenario 033 showed an approved programme
whose public page 404s; this is the step that lights it up, and it is the first time in the project
that anything can reach `distributed` at all.

## Before you start — read this, it changes what you will see

### 1. Email is OFF unless a sending domain is verified

`plans/retros/deployment.md` records that Resend's shared test sender only delivers to the Resend
account owner. So unless **`RESEND_FROM_ADDRESS`** names an address at a domain verified in Resend,
this app does not send and does not pretend to.

That gives two different walks, and **both are valid** — do the one matching your setup and mark the
other's checks as not applicable:

| `RESEND_FROM_ADDRESS` | Button reads | What happens |
|---|---|---|
| unset (default today) | **Publish to the public page** | No email. Status moves, public page lights up, QR works. |
| a verified address | **Email the program** | Confirm dialog naming the count, then sends. |

### 2. The seeded addresses are placeholders

`program_distribution_list` and `librarian_email` in `seed.ts` are `@example.test` addresses that
exist nowhere — a seed that shipped real addresses would email somebody every time anybody ran it.

**To watch a programme actually arrive, edit those three values in `seed.ts` to addresses you
control before seeding.** Left as they are with email configured, every send fails and you see the
total-failure path instead, which is also worth seeing once.

### 3. The QR needs an address your phone can reach

Same as scenario 034: set `NEXT_PUBLIC_SITE_URL` to a deployed URL or your machine's LAN IP.
`http://localhost:3000` will not work from a phone.

## Seed Data

Scenario 034's ward, plus a distribution list.

| Entity | Detail |
|---|---|
| Ward settings | `program_distribution_list` — 2 addresses |
| Ward settings | `librarian_email` — 1 address, deduped against the list |
| Program | `status = 'approved'`, `pdf_url` **null** |
| Public page | slug `harness-ward-program`, active |

Everything else — the Sunday, three speakers including the external one, both prayers, all three
hymns, the contacts and the missionary block — is exactly as scenario 034 seeds it.

**Sign in with:** `secretary@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- program/scenario-035-distribution-and-what-happens-after`
2. `npm run dev`
3. Sign in as the **secretary** and open the programme for **20 September 2026**
4. Press **Generate the PDF** — the distribute button stays refused until there is a file to attach
5. Press **Email the program** (or **Publish to the public page**). Read the confirm dialog before
   agreeing to anything, then go ahead
6. Open `/public/harness-ward-program` in a private window, and scan the QR on the printed sheet
7. Try to edit the programme — look for what the screen now says
8. Sign in as the **bishop** and check the notification bell

## Verification Checklist

### Machine-checkable

- [ ] Before generating, the distribute button is **disabled** and the screen says "Generate the PDF first — that is the file people receive"
- [ ] `programs.status` moves to `distributed`, and `distributed_at` / `distributed_by` are both stamped
- [ ] `distributed_by` is the **secretary's** user id, not the bishop's
- [ ] An `audit_log` row exists with action `program_distributed`
- [ ] That audit row's `detail` carries a **`recipientCount`** and contains **no `@` and no email address at all** — search the JSON
- [ ] `/public/harness-ward-program` now **renders** the programme. It 404'd in scenario 033
- [ ] The public page shows **no phone number** — search its source for `555-`
- [ ] The public page's "Open the printed program (PDF)" link works and opens the same document
- [ ] The bishop's notification bell has a "The sacrament program has gone out" entry
- [ ] Pressing distribute a second time is refused: "already been distributed. An email cannot be sent twice or recalled"
- [ ] There is **no Reopen as a draft** button on a distributed programme

### With email configured

- [ ] The confirm dialog names the number of recipients — and it says **3**, not 2: the librarian is on the list
- [ ] The confirm is worded by consequence ("Email this program to 3 people?"), not "Confirm distribution?"
- [ ] The dialog says it cannot be undone **before** the button, not after
- [ ] The PDF arrives as an **attachment**, and opens on a phone
- [ ] Each recipient's copy is addressed only to **them** — check the To: header; nobody sees the other addresses
- [ ] If some addresses fail, the result names **both** counts ("Sent to 2 of 3"), not just the successes

### With email NOT configured

- [ ] The button reads **Publish to the public page**, not "Email the program"
- [ ] The screen says why, in words a secretary can act on, **before** they press it
- [ ] The result says the programme was published and **not** emailed — it never claims a send
- [ ] The public page and QR work exactly as they do with email on

### After distributing — the notice

- [ ] A "This program has gone out" notice appears on the programme screen
- [ ] It says **"This will update the online program. The emailed PDF will not change."**
- [ ] It also says that reopening would take the public page dark until re-approval
- [ ] It explains that a distributed programme cannot be reopened, and says what to do instead

### Needs a human eye

- [ ] Did the confirm dialog give you enough to decide? Imagine you are the secretary and the count is 43.
- [ ] Read the post-distribution notice as somebody who wants to fix a misspelled name. Do you understand what would and would not change — and what you are supposed to do instead?
- [ ] **The plan's scenario asked you to edit and re-approve after distributing, and the app gives you no way to do it.** `distributed` has no exit in `LEGAL_TRANSITIONS` (program-a's decision: an email cannot be recalled). Is "you cannot reopen it, build next Sunday's instead" the right answer — or should a distributed programme be reopenable, with the notice as the warning? **This is an open product question and this checkbox is where it gets decided.**
- [ ] Is it clear that distributing did **two** things — emailed and published? Or does "distribute" read as email only?

## Failure Behavior

- [ ] A `draft` programme cannot be distributed. Automated: `tests/routes/program-distribute.test.ts`.
- [ ] A programme with no `pdf_url` is refused with its own sentence. Automated: same file.
- [ ] A `pdf_url` pointing at an object that is not in the bucket is refused with `pdf_missing`, not a 500. Automated: same file.
- [ ] An empty distribution list is a 422 with its own sentence, not a successful send to nobody. Automated: `tests/lib/programDistribution.test.ts`.
- [ ] The list changing between the confirm dialog and the button press is refused. Automated: `tests/routes/program-distribute.test.ts`.
- [ ] When **every** send fails, the programme is **not** marked distributed. Automated: same file.
- [ ] When **some** sends fail, it is, and both counts are reported. Automated: same file.
- [ ] A `music_coordinator` is refused with a 403 and the programme is untouched. Automated: same file.
- [ ] `revalidatePath` failing does not turn a completed distribution into a 500 saying nothing was sent. Guarded in the route — **not automated**, and it is the one that would lie after an irreversible success.

## Walkthrough record

**Not yet walked.**
