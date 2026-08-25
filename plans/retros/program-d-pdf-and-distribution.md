---
id: program-d-pdf-and-distribution
type: feature
iter: ITER-004 (printed half; program-c closed the public half, and this closes the scope)
commits: []
date: 2026-08-25
files:
  - lib/pdf/theme.ts
  - lib/pdf/values.ts
  - lib/pdf/qrCode.ts
  - lib/pdf/ProgramDocument.tsx
  - lib/pdf/renderProgram.tsx
  - lib/pdf/panels/CoverPanel.tsx
  - lib/pdf/panels/MeetingOrderPanel.tsx
  - lib/pdf/panels/ContactsPanel.tsx
  - lib/pdf/panels/BackPanel.tsx
  - lib/program/storage.ts
  - lib/program/distribution.ts
  - lib/email/resend.ts
  - app/api/programs/[id]/generate-pdf/route.ts
  - app/api/programs/[id]/distribute/route.ts
  - app/(app)/program/[sunday_id]/ProgramDistribution.tsx
  - app/(app)/program/[sunday_id]/PostDistributionNotice.tsx
  - app/(app)/program/[sunday_id]/ProgramBuilder.tsx
  - app/(app)/program/[sunday_id]/page.tsx
  - lib/program/queries.ts
  - lib/program/gather.ts
  - lib/validation/program.ts
  - supabase/migrations/040_program_storage.sql
  - supabase/migrations/041_program_distributed_trigger.sql
  - supabase/seed/notification_triggers.sql
  - .env.local.example
  - SPEC.md
related:
  - program-a-draft-and-approval
  - program-b-builder-screen
  - program-c-public-pages
  - deployment
  - ai-a-client-and-settings
  - ai-b-knowledge-and-retrieval
  - talks-b-month-planner
  - calendar-b-month-view
---

## What was done

The bifold PDF, its storage, and distribution. Four panels imposed onto one landscape sheet by
`@react-pdf/renderer` (installed since `foundation-a` and never called until now), a QR code
encoding the `/public/[slug]` URL, a private `programs` storage bucket, and the first application
code in this repo to construct a Resend client.

It is also the change that makes `program-c` reachable at all. That plan shipped the projection, the
view and the page; **nothing anywhere created the `public_pages` row all three depend on**, and
nothing could move a program to `distributed`, which the view requires. Both gaps close here.

**Not yet walked.** Scenarios 034 and 035 are written and seeded but unrun — 034's core is physical
(print, fold, scan) and Milestone M4 is reached when that fold check passes, not when the route
returns 200.

## Key decisions

- **Base-14 PDF fonts, no font files.** The plan said register from `public/fonts/`. That directory
  does not exist and SPEC.md's own `font_family` value is `"serif"` — a generic family, not a file.
  `serif`/`sans-serif`/`monospace` map to Times-Roman/Helvetica/Courier, which every reader already
  has and `@react-pdf/renderer` does not require `Font.register()` for. This deletes the failure the
  plan was warning about rather than handling it: there is no font fetch at render time, so there is
  no cold-start network call on Vercel that can fail. A ward wanting its own typeface is the change
  that adds the directory, and it needs a licence, not just a file.

- **`pdf_url` holds a SIGNED URL with a 90-day bound, not a storage key.** `/public/[slug]` renders
  that value straight into an `href` (`ProgramPanel.tsx`), so a bare `{ward_id}/{date}.pdf` is a
  broken link on the one page a congregation opens. A public bucket was the other option and the
  plan rejected it by name — every ward's program at a guessable URL with no policy in front of it.
  The bound is what makes it a decision rather than an omission: it covers the Sunday it was printed
  for and a season afterwards, then expires. A signed URL signs the *path*, so a regenerated program
  is served by a link minted before it, which is the behaviour wanted.

- **Distribution PUBLISHES even when email is off, and says so.** The user chose "ship email
  disabled with an honest message" because Resend's sender is unverified (`deployment`). Read
  literally that would refuse the whole route — and nothing else in the app can reach `distributed`,
  so `program-c`'s page would stay permanently dark and the printed QR would be dead on arrival.
  So the route publishes, the button reads **"Publish to the public page"**, the reason email is off
  is shown *before* it is pressed, and the response never claims a send. Setting
  `RESEND_FROM_ADDRESS` to a verified address turns email on with no code change and no deploy flag.

- **One send per recipient, never one send with every address in `to`.** Two reasons and both are
  load-bearing: a single email addressed to forty people shows all forty addresses to all forty, and
  one result cannot report that three of them bounced. `resend.batch.send()` would be one call and
  carries no attachments — the attachment is the entire feature.

- **Total failure throws; partial failure returns.** `sendProgramEmails` raises when `sentCount` is
  0, so the program is never marked `distributed` with nothing sent — and `distributed` is
  permanent. A partial failure does return, because some people genuinely have the email and that
  cannot be undone.

- **The audit row carries a COUNT and no address**, and the test scans the serialised detail for
  `@` rather than checking named fields — `program-c`'s projection-test shape, reused. A field added
  later that carries an address fails without anybody updating the assertion.

- **Slugs are random (`program-` + 16 hex), not derived from the ward's name.** The public page
  publishes every participant's full name (the 2026-08-24 reversal), and `noindex` plus an
  unpublished URL are the only two things in front of that. `buffalo-ward-program` is guessable in
  one try and would quietly undo both.

- **`qrcode@1.5.4` installed after asking**, with the numbers reported: 25 packages, 21 of them the
  `yargs@15` tree its unused CLI drags in. The zero-dependency alternatives (`@paulmillr/qr`,
  `qrcode-generator`) emit SVG/GIF and `@react-pdf/renderer` renders PNG and JPG only.

## Pitfalls for whoever comes next

- **Panel order on the sheet is NOT reading order**, and no test can check the half that matters.
  `ProgramDocument.tsx` carries the imposition table; `tests/lib/pdfRender.test.ts` renders the real
  PDF and extracts its text with `unpdf`, which proves the two *outside* panels share page 1 and the
  two *inside* panels share page 2 — genuinely useful, and it is not the fold. **The reverse side
  assumes a duplex printer flipping on the LONG edge.** A short-edge flip mirrors it and the program
  opens with the meeting order on the left; if scenario 034 reports that, check the printer setting
  before the code.

- **`revalidatePath` must not be allowed to fail the request.** It threw ("static generation store
  missing") when the handler was called as a plain function in a route test, and the throw fell to
  the 500 fallback whose message reads *"nothing was marked as sent"* — **after** the emails had gone
  and the status had moved. Caught and logged now. `program-c` handed this forward asking for the
  TTL and `revalidatePath` to be checked against a production build; the guard is in, the
  **production-build check is still not done**.

- **`components/ui/Modal.tsx` always renders its children into the DOM.** It is built on the native
  `<dialog>` and `isOpen` drives `showModal()`/`close()`, not whether the markup exists. A
  distributed program was mounting a hidden "Send it to 3 people?" confirm for an action it can no
  longer offer. Not user-visible — a closed `<dialog>` does not render — and caught by the *existing*
  `ProgramBuilder` suite as a duplicate-text query. Mount a Modal inside the branch that can open it.

- **A route test that seeds `pdf_url` without an object in the bucket is testing a broken state.**
  The distribute route re-reads the stored file rather than re-rendering it, deliberately, so the
  emailed PDF is byte-identical to the proofread one. Seed the object with the service client and
  remove it in `afterAll` — `fixtures.cleanup()` knows nothing about storage.

- **Do not build a missing-object test by deleting the object.** Storage's delete is not immediately
  consistent and the first attempt passed a 200. Move the *key* instead: the key is
  `{ward_id}/{draft.date}.pdf`, so a draft dated differently points at a key that never existed.

- **Migration numbering collided again, exactly as `program-c` recorded.** The plan said 039/040;
  039 was taken by `program-c`, which had itself been bumped from 038 by `program-a`. Shipped as
  040/041. **Next free is 042.**

- **`lib/program/gather.ts` grew `readProgramRenderSettings`.** `program-e`'s Task 2 deletes that
  file's inline `hymn_selections` / `musical_numbers` readers — a different part of the same file.
  Do not remove the new export while cleaning up the temporary ones.

- **The plan's Task 9 contradicts `program-a`'s state machine, and it is NOT resolved.** Task 9 and
  scenario 035 both assume a `distributed` program can be edited. `LEGAL_TRANSITIONS` gives
  `distributed` no exit, deliberately, with the reason written down: an email cannot be recalled.
  `distributed -> draft` was **not** opened here — that is `program-a`'s decision to revisit, not
  this plan's to overturn in passing. `PostDistributionNotice` ships with the plan's exact wording
  and renders on the distributed screen as a standing explanation. **Scenario 035's last human-eye
  check is where this gets settled.**

- **`sentCount` is `number | null`, and null is a real third state.** The recipient count lives in
  the audit log, not on the program row, so the page render cannot know it. Collapsing null to 0
  printed *"It was not emailed to anybody"* on a ward that had just emailed forty — caught in review,
  not by a test. Unknown says less rather than something false.

- **A QR needs a site URL a phone can reach.** `resolveSiteUrl()` prefers `NEXT_PUBLIC_SITE_URL`,
  falls back to `VERCEL_PROJECT_PRODUCTION_URL`, and **deliberately never uses `VERCEL_URL`** — that
  is the per-deployment hostname and changes on every push, so a QR encoding it would 404 on paper
  already handed out. With neither set the program prints with **no QR** and a warning, rather than
  encoding a guess at localhost.

- **`jsx-a11y/alt-text` fires on `@react-pdf/renderer`'s `<Image>`.** It is not an HTML `<img>`,
  renders into a PDF with no accessibility tree, and its props do not include `alt` — passing one is
  a type error. Disabled at file level in the two panels, with the reason.

- **The contrast guard is real and untested by a human.** A `primary_color` failing 4.5:1 against
  white paper falls back to the default and reports why. `tests/lib/pdfRender.test.ts` covers it;
  nobody has yet seen the warning on screen.

- **`fetchCoverImage` is not automated.** A cover image that is missing, oversized, or the wrong
  format is a warning and does not fail the render — worth a look the first time a ward configures
  one.
