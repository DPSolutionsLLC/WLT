---
name: Print it and fold it
scope: program-d-pdf-and-distribution
part: 1
tags: [program, pdf, physical, full]
prerequisites: none
---

## Purpose

**The one check no test can perform.** 06-program-music.md makes it a Definition-of-Done item for
Milestone M4, and this is why: panel imposition is not reading order, and the difference only exists
on paper.

`tests/lib/pdfRender.test.ts` renders the real PDF and extracts its text, so it already proves the
two **outside** panels share the front of the sheet and the two **inside** panels share the reverse.
What it cannot prove is that a sheet printed double-sided and folded once puts the cover on the
outside right — that depends on the printer's duplex flip edge and on physical paper, and it is the
kind of defect that is discovered by a congregation rather than by a suite.

The QR code is the same shape of problem. It is generated, sized and encoded correctly according to
`tests/lib/qrCode.test.ts`; whether it survives being creased and photographed in chapel lighting is
a question for a phone.

## Seed Data

Scenario 028's Sunday with **every gap filled** — the only programme fixture in the harness that has
nothing missing, because four blank panels cannot be checked for a fold.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `primary_color` `#7b1d1d`, `font_family` `serif` |
| Users | `bishop@…` (bishop), `secretary@…` (ward secretary) |
| Sunday | 20 September 2026, standard, 3 speaking slots |
| Speakers | Sarah Whitfield (with topic), **President Mark Andersen** (external), Ellen Moretti |
| Prayers | Invocation and benediction, both assigned |
| Hymns | All three — opening, sacrament, closing |
| Extras | Musical number, ward business, special notes, two paragraphs of announcements |
| Contacts | Four leadership contacts **with phone numbers** |
| Missionaries | Seeded, with a phone and an address |
| Program | `status = 'approved'`, `pdf_url` **null**, `missing` `[]` |
| Public page | slug `harness-ward-program`, active |

**Sign in with:** `secretary@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

> The secretary, not the bishop, on purpose. Generating the PDF is held behind `program.build`,
> which a ward secretary has — if this needed a bishopric account, the feature would be unusable in
> the week it is used.

## Before you start — the QR code needs a reachable address

`NEXT_PUBLIC_SITE_URL` is what the QR encodes. With it unset the programme prints **with no QR at
all** and the generate route says so in a warning — that is deliberate, not a bug, and it is better
than printing a code that scans to a developer's laptop.

For the QR checks below you need an address your **phone** can reach:

- **Simplest and most realistic:** deploy and set `NEXT_PUBLIC_SITE_URL=https://wlt-iota.vercel.app`.
- **Locally:** set `NEXT_PUBLIC_SITE_URL=http://<your-machine's-LAN-IP>:3000` in `.env.local`, run
  `npm run dev`, and confirm the phone can open that address in a browser first.

`http://localhost:3000` will **not** work from a phone. If you cannot arrange either, walk
everything except the four QR checks and mark them **not walked** rather than passed.

## Steps

1. `npm run seed -- program/scenario-034-print-it-and-fold-it`
2. Set `NEXT_PUBLIC_SITE_URL` as above, then `npm run dev`
3. Sign in as the **secretary** and open the programme for **20 September 2026**
4. In the **Print and send** panel, press **Generate the PDF**
5. Open the PDF and read it on screen first
6. **Print it: one sheet, US Letter, landscape, double-sided, flipping on the LONG edge.** Then fold
   it once down the middle.
7. Scan the QR code with a phone — first flat, then with the sheet folded

## Verification Checklist

### Machine-checkable

- [ ] Generating takes a few seconds and the button says so ("Building the PDF…") rather than appearing hung
- [ ] The PDF is **2 pages**, US Letter, **landscape**
- [ ] `programs.pdf_url` is now a **signed URL** beginning `https://` — not a bare storage key like `<ward-id>/2026-09-20.pdf`
- [ ] An object exists in the `programs` bucket at `<ward_id>/2026-09-20.pdf`
- [ ] An `audit_log` row exists with action `program_pdf_generated`, carrying `byteLength`
- [ ] Page 1 carries the **cover** and the **back panel** (missionaries, announcements, QR)
- [ ] Page 2 carries the **contacts** and the **meeting order**
- [ ] No page carries both the cover and the meeting order
- [ ] The four leadership phone numbers appear on the contacts panel
- [ ] The word "TBD" appears nowhere; neither does "Nobody yet", "Not chosen yet", "null" or "undefined"
- [ ] No warning is shown — `#7b1d1d` clears the contrast floor, so the heading colour is the ward's own

### Physical — the reason this scenario exists

- [ ] Folded, the **cover is on the outside right** and the **back panel on the outside left**
- [ ] Opened, **contacts are on the left** and the **meeting order on the right**
- [ ] Nothing is cut off at the fold
- [ ] Nothing is cut off at the outer margins — check the QR code and the last line of announcements specifically
- [ ] The external speaker prints as **"President Mark Andersen"** — in full, with the title (ITER-004)
- [ ] The meeting order reads top to bottom in the order it will actually be conducted
- [ ] The QR scans **on the first try** flat
- [ ] The QR **still scans when the sheet is folded**
- [ ] The web address is printed as text under the QR, so somebody without a working camera can type it

### Needs a human eye

- [ ] Would you hand this to a congregation? Look at it as an object, not as a checklist.
- [ ] Is the type large enough to read in a dim chapel, at arm's length?
- [ ] The QR scans to a **404** in this scenario, because the programme is approved and not yet distributed. Is that the right behaviour to ship — or should the code be absent until distribution? Scenario 035 shows the other half.
- [ ] Set `primary_color` to `#ffee88` in ward settings and generate again. The heading should print in the default dark, with a warning naming the setting. Does the warning make the cause obvious?

## Failure Behavior

- [ ] A sparse draft renders without throwing and prints no placeholder text. Automated: `tests/lib/pdfRender.test.ts`.
- [ ] The outside panels share page 1 and the inside panels share page 2. Automated: `tests/lib/pdfRender.test.ts`.
- [ ] A `draft` or `pending_approval` programme is refused with a 409. Automated: `tests/routes/program-distribute.test.ts`.
- [ ] A `music_coordinator` is refused with a 403. Automated: `tests/routes/program-distribute.test.ts`.
- [ ] A pale `primary_color` falls back to the default and reports why. Automated: `tests/lib/pdfRender.test.ts`.
- [ ] A cover image that is missing, too large, or the wrong format is reported as a warning and does not fail the render. `fetchCoverImage` in `lib/pdf/renderProgram.tsx` — **not automated**, and worth a look if a ward ever configures one.
- [ ] Ward B cannot read ward A's stored PDF. Automated: `tests/rls/program-storage.test.ts`.

## Walkthrough record

**Not yet walked.**

Milestone M4 is reached when the fold check above passes — not when the route returns 200.
