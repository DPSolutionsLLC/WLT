---
name: The QR page a visitor sees
scope: program-c-public-pages
part: 1
tags: [program, public, privacy, smoke, iter-004]
prerequisites: none
---

## Purpose

The application's only unauthenticated page, and **the single most likely privacy incident in this
app**. Everything else can be wrong and be fixed. This can be wrong and be indexed — the app is
live at `wlt-iota.vercel.app` and there is no staging gate between a merge and the open internet.

Machine tests prove a great deal here: `tests/lib/publicProjection.test.ts` scans the projection
for the fixture's phone number, address, surname and member id; `tests/rls/public-program-anon.test.ts`
proves the anon key reaches two views and no base table; `tests/routes/public-page.test.ts` renders
the page with no session and scans the HTML. What none of them can do is **look at the page**. A
field can be absent from every assertion and present on the screen, because the assertion only
knows what somebody thought to name.

**This scenario was walked on 2026-08-24 and the walk changed the feature twice.** Both speakers
are now named in full, and an empty slot now renders instead of vanishing. The checklist below is
the corrected one; the reasoning is in the Walkthrough record, and both original questions are kept
there rather than deleted.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward. `leadership_contacts` — **three names with phone numbers**. `missionaries` — a name, **a phone number and an apartment address** |
| Users | `bishop@…` (bishop, Mark Andersen), `secretary@…` (ward_secretary, Ruth Delgado) |
| Household | **Whitfield, 2201 Canyon Road** — a real street address for a leak to carry |
| Members | Sarah Whitfield (**555-0142**), David Brooks (555-0143) |
| Sunday | **2026-09-20**, `standard`, 3 speaking slots |
| Slot 1 | Sarah Whitfield, ward member, stage `notify` — must read **"Sarah Whitfield"**, in full |
| Slot 2 | **President Mark Andersen**, external speaker, contact waiver set — must read in full too, title intact (ITER-004) |
| Slot 3 | Empty — must render as an **open slot**, not vanish |
| Organist / chorister | Both filled, so the empty-line case is checked on slot 3 rather than here |
| Hymns | Opening 19, sacrament 193, closing 152 — all three present, unlike 028 |
| Musical number | "I Am a Child of God", The Primary children, with an internal note **containing a phone number** |
| Program | `status = 'distributed'`, `public_data` written, approved and distributed stamps set |
| Public page | `page_type = 'program'`, **active**, slug **`harness-ward-program`** |

The stored `draft_data` carries the contacts, the missionary block and the musical number's
internal note. `public_data` carries none of them. That difference is the thing being checked.

**No sign-in.** This scenario is walked signed OUT — that is the point of it.

## Steps

1. `npm run seed -- program/scenario-032-the-qr-page-a-visitor-sees`
2. `npm run dev`
3. Open a **private/incognito window** — a normal window may still hold a session, and a page that
   works only because you are signed in is the exact failure this scenario exists to catch.
4. Go to **http://localhost:3000/public/harness-ward-program**
5. Read the whole page. Then **view source** and read that too.
6. Change the slug to something made up and load it again.

## Verification Checklist

### Machine-checkable

- [ ] The page renders **signed out** — no redirect to `/login`, no login prompt, no app chrome
- [ ] There is no sidebar, no top nav, no notification bell and no theme toggle
- [ ] The heading reads "Sacrament Meeting" with "Harness Test Ward" and "Sunday, September 20, 2026"
- [ ] Slot 1 reads **"Sarah Whitfield"** in full
- [ ] Slot 2 reads **"President Mark Andersen"** in full, title intact (ITER-004)
- [ ] Both are named the **same way** — no shortened name anywhere on the page
- [ ] Slot 3 renders as an **open slot** ("Third speaker — Nobody yet"), not omitted and not "TBD"
- [ ] The page source contains `noindex` (view source, or check the response headers)
- [ ] **No phone number appears anywhere in the rendered source** — search it for `555-`
- [ ] No street address: search the source for "Canyon" and "Meadow"
- [ ] No leadership contacts panel, no missionary block, no email address
- [ ] The musical number reads "I Am a Child of God — The Primary children" with **no** sound-check note
- [ ] All three hymns appear with number and title
- [ ] Announcements and ward business appear — those are written to be read aloud to everyone
- [ ] `/public/definitely-not-a-real-slug` gives a **404**, not an empty program
- [ ] No raw uuid anywhere on the page or in the source
- [ ] No horizontal overflow at 375px

### Needs a human eye

- [ ] Read the page as a visitor who has never seen this ward. Is there **anything at all** on it you would not want a stranger to have?
- [ ] The page now carries a full ward roster of names. Does anything about seeing them all together change that answer?
- [ ] The open third slot sits between a named speaker and the closing hymn. Does it read as *a slot nobody has filled*, or as *something broken*?
- [ ] Is it legible one-handed at 375px, in **both** light and dark?
- [ ] The 404 says only that the link is not active. Does it give away whether the slug exists?

## Failure Behavior

- [ ] An unknown slug, a **deactivated** slug and a ward with no distributed program all give the **same** 404. Automated: `tests/routes/public-page.test.ts`.
- [ ] A program whose stored projection cannot be parsed 404s rather than rendering a partial page. Automated: same suite.
- [ ] The anon key cannot read `programs`, `members`, `sundays`, `wards`, `households` or `public_pages` directly. Automated: `tests/rls/public-program-anon.test.ts`.
- [ ] Sending the program back to `draft` clears `public_data` and the page goes dark. Covered by scenario 033.

## Walkthrough record

**2026-08-24 — driven by Claude in a real Chromium browser at 375x812, screenshots reviewed by the
user.** This is agent-driven evidence, not a person using the app on a phone; the five
"needs a human eye" items were answered from screenshots rather than from a device in a chapel.

**A finding about the walk itself, recorded because it nearly invalidated it.** The first render
was taken with a **live Supabase session cookie** still in the browser profile
(`secretary@harness.wardleadershiptools.test`, left over from an earlier walk). The page looked
correct — but "renders signed out" had not been tested at all. Cookies and localStorage were
cleared and every check below was re-run with `document.cookie === ""`. This is exactly the trap
the Steps section warns about, and it caught a real agent, not a hypothetical tester. **Verify
`document.cookie` is empty before believing anything on this page.**

Observed values, signed out:

| Check | Observed |
|---|---|
| Final URL | `/public/harness-ward-program`, no redirect |
| `document.cookie` | `""` |
| Header | "Harness Test Ward" / "Sacrament Meeting" / "Sunday, September 20, 2026" |
| Meeting order labels | Presiding, Conducting, Organist, Chorister, Opening hymn, Invocation, Sacrament hymn, Musical number, Closing hymn, Benediction |
| Names rendered | Mark A., Mark A., Ruth D., Anna W., David B., Sarah W. |
| Speakers | "First speaker — Sarah W. — Charity Never Faileth"; "Second speaker — President Mark Andersen" |
| Third speaker | **absent** — the string "Third speaker" occurs 0 times in the HTML |
| Musical number | "I Am a Child of God — The Primary children" — the sound-check note absent |
| `Whitfield` / `555-` / `Canyon` / `Meadow` / `Elder Kim` / `Sound check` / `Lindqvist` / `Delgado` | **0 occurrences each** in `outerHTML` |
| `leadershipContacts` / `printedName` / `missionaries` / `sundayType` / `kind` | 0 occurrences each |
| Email regex over the HTML | no matches |
| UUID regex over the HTML | no matches |
| Phone regex `\d{3}[-.\s]\d{4}` | no matches |
| `<a>` elements | **0** — no PDF link (program-d), no login link, nothing to enumerate |
| `<img>` elements | 0 |
| `nav` / `aside` / `[role=navigation]` | 0 |
| Horizontal overflow at 375px | none — `scrollWidth` 360 vs viewport 375 |
| Unknown slug | HTTP **404**, body "Page not found / This link is not active…" |
| Deactivated slug (`is_active=false`) | HTTP **404**, body string **identical** to the unknown-slug 404 |

**Proven at the data layer, not just the render** (service-role read-back):

- `draft_data` 1698 bytes, holds `Whitfield`, `555-0100`, `555-0142`, `Elder Kim`, `Meadow`,
  `Sound check`, `leadershipContacts`, `missionaries`, `printedName`, `sundayType`, `missing`.
- `public_data` 810 bytes, holds **none** of them, and exactly the 17 declared keys.
- `members` really does store `phone: 555-0142`, and the household really does store
  `2201 Canyon Road` — the data existed to leak.
- `wards.settings.leadership_contacts` holds all three names with phone numbers.
- The anon view returns exactly 6 columns: `distributed_at, pdf_url, public_data, slug,
  sunday_date, ward_name`.

**Contrast, measured rather than eyeballed.** Dark: worst 7.72:1 (muted label `#a1a1aa` on
`#0a0a0a`). Light: worst **4.76:1** (muted label `#64748b` on white) — passes AA (4.5) with little
headroom. That is the app's shared `--muted` token, identical on every other screen, so it is not
a regression from this plan; noted so nobody re-measures it.

**Checklist corrections made during this walk:**

- The seed summary said the speaker's household carries "a phone number and a street address". The
  phone is on the MEMBER row and the address on the HOUSEHOLD row; neither is in `draft_data` at
  all (a program never carries an address). The claim that a leak had something to leak is
  accurate, but the address sits one join further away than the line implied.

**Not walked:** `revalidate = 300` is not exercised by `npm run dev` — Next.js does not apply the
ISR cache in development, and every change above appeared immediately. The five-minute TTL and
`program-d`'s `revalidatePath()` still need a check against a production build.

**Not walked:** the page has no PDF link because `program-d` has not shipped `pdf_url`. The
`pdfUrl !== null` branch of `ProgramPanel` has never rendered in a browser.

### What the walk changed

Two of the five judgements came back as changes, and both reversed a decision this plan had made
deliberately. Recorded in full because the original reasoning was not stupid — it was just wrong
about how the page reads.

- **Names are published IN FULL now, everybody, first and last.** The page shortened a ward member
  to "Sarah W." while naming the visiting stake president in full one line below. Read on a real
  screen that did not look like a privacy rule, it looked like a bug nobody had noticed. A
  sacrament programme names the people taking part and names all of them the same way.
  `publicNameFor()` no longer shortens. The pair of name fields is KEPT, and now means what it
  says: `printedName` is the paper, `publicName` is the web, they default to the same text, and the
  bishopric can make them differ for one person on one programme. `toPublicProgram()` still reads
  only `publicName`, so the boundary did not move — what crosses it did.
- **An empty slot renders instead of vanishing.** A slot that disappears LOOKS CORRECT: nobody can
  tell "this meeting has two speakers" from "nobody filled in the third", so nothing ever prompts
  anyone to fix it. The right fix for a permanently empty slot is for the bishopric to set that
  Sunday's speaking-slot count to two on the calendar — and the page showing the gap is what sends
  them there. This also puts the public page back in step with `ProgramPreview`, which reached the
  same conclusion walking scenario 031.
- **The page is now served `noindex`** (`app/public/layout.tsx`). A full-name roster reachable by
  anyone holding the link is what was asked for; the same roster gathered into a search index is
  not, and only the first was intended. Not an access control — the view and the projection are.

The other three judgements passed unchanged: the privacy read, both themes at 375px, and the 404
giving nothing away.

## Notes

- **Read the page source, not only the rendered page.** A leak can sit in an attribute, a `title`,
  or a component that renders nothing visible. The checklist says "search the source" for that
  reason, and a tester who only looks at the rendered text has done the weaker half of the check.
- The slug is fixed (`harness-ward-program`) rather than randomised, so the URL can be typed on a
  phone without copying it across from a laptop.
- `program-d` has not shipped, so there is **no PDF link** on the page and no QR code anywhere yet.
  That is expected, not a gap — the link appears once `pdf_url` is filled in.
- A **slug identifies a ward's program page, not a program**: the view joins on `ward_id`, so the
  page serves whichever distributed program has the latest Sunday. With one program seeded there is
  nothing to notice here, but it matters when reading the code.
