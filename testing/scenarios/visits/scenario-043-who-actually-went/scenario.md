---
name: Who actually went
scope: visits
part: 1
tags: [visits, full, participants]
prerequisites: none
---

## Purpose

Three kinds of participant, and the split between the person who **went** and the person who
**typed it in**, are all invisible until somebody looks at a rendered visit. Until this slice a
visit had one column for both, so a secretary writing up their presidency's round was recorded as
having made it.

The state that makes the distinction checkable is a visit the recorder did **not** attend, and it
is tedious to reach by hand — you have to be two people. So it is seeded, and the walk is about
what the screen says about it.

The other half is the empty case. A visit with no participants at all is a legitimate record, and
it has to read **"Nobody recorded as visiting"** in words. A blank reads as a page that failed to
load; the recorder's name would be an invention. Only a person looking at it can say which it
reads as.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, cross-org visibility OFF |
| Users | bishop (Mark Andersen), EQ president (Miguel Cortez), EQ secretary (Peter Nakamura), EQ counselor (Tomas Reyes), RS president (Ana Delgado) |
| Households | Brooks, Whitfield, Okonkwo, Halvorsen, Tuiasosopo — each with active members |
| Household with nobody in it | Ferreira — one moved-out member, must NOT be offered anywhere |
| Visit 1 (Brooks, 8 Feb) | **Recorded by the secretary. Conducted by the president and Ruth Brooks.** The recorder is not a participant |
| Visit 2 (Whitfield, 15 Feb) | Recorded by the secretary. **No participants at all** |
| Visit 3 (Okonkwo, 1 Mar) | Recorded by the president, who went with **"Bill from next door"** — a typed name |
| Visit 4 (Halvorsen, 8 Mar) | Relief Society. The EQ president should not see it |
| Appointment (Tuiasosopo) | 3 March 2026, still `scheduled` — a MISSED one |
| Goal | EQ: visit every household this year |

**Sign in with:** `eq-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-043-who-actually-went`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the EQ president and go to **Visits**.
4. Read the **Recent visits** list before touching anything. Note what each row says about who
   went and who recorded it.
5. In **Log a visit**, choose the Tuiasosopo household.
6. In **Who went**, remove yourself.
7. Add a member (**A member** → Lani Tuiasosopo), a leader (**A leader** → Tomas Reyes), and a
   typed name (**Someone else** → "the missionaries").
8. Keep adding leaders and typed names until the form stops you.
9. Remove one, confirm you can add again, then log the visit.
10. Reload and find the visit you just logged in the list.

## Verification Checklist

### Machine-checkable

- [ ] The **Who went** field starts with the signed-in leader's own name on it
- [ ] Removing yourself leaves the field reading "Nobody recorded as visiting."
- [ ] A member, a leader and a typed name can each be added, and each shows as a name — no raw
      uuid anywhere on the page
- [ ] The **sixth** person is accepted (you plus five companions) and the **seventh** is refused
- [ ] The refusal is **visible text on the page**, not a tooltip and not a `title` attribute
- [ ] The Ferreira household is absent from the **Household** dropdown, and Joana Ferreira is
      absent from the member picker inside **Who went**
- [ ] Visit 1 (Brooks) shows **Miguel Cortez and Ruth Brooks** as having visited, and
      **Peter Nakamura** as having recorded it
- [ ] Visit 2 (Whitfield) shows **"Nobody recorded as visiting"** — not Peter Nakamura's name,
      and not a blank
- [ ] Visit 3 (Okonkwo) shows **Bill from next door** alongside Miguel Cortez
- [ ] The Halvorsen (Relief Society) visit does not appear at all
- [ ] No participant name appears in any `audit_log` row: run
      `select detail from audit_log where action = 'visit_logged'` and confirm it carries
      `participantCount` and no names
- [ ] No horizontal scrolling at 375px; every tap target including the chip **×** is ≥ 44×44

### Needs a human eye

- [ ] Does "Nobody recorded as visiting" read as a **deliberate statement about the visit**, or
      as something that failed to load?
- [ ] Reading visit 1 cold, is it obvious that Peter did not go and Miguel did? Or do the two
      lines blur into one?
- [ ] When the seventh person is refused, does the sentence explain **why** and what to do about
      it, or does it just say no?
- [ ] Is the **×** on a chip obviously a remove control, or does it read as decoration?
- [ ] At 375px in dark mode, is the chip list legible, and does the recorder's line stay
      quieter than the visited-by line without disappearing?
- [ ] Does "Who went" sit in the right place in the form, or would you look for it somewhere else?

## Failure Behavior

- [ ] Adding the same leader twice says "That person is already on this visit." rather than
      silently adding a duplicate
- [ ] Pressing **Add name** with an empty box says "Type a name first."
- [ ] With the form at six people, the add controls are replaced by the capacity sentence rather
      than sitting there disabled with no explanation
- [ ] Covered by automated tests rather than by hand: a seventh participant sent straight to
      `POST /api/visits` is refused **and nothing is written**
      (`tests/routes/visitParticipants.test.ts`), and a `recordedBy` in the request body is
      ignored in favour of the session (same file)

## Walkthrough record

**2026-08-25 — driven by Claude in a real browser (Playwright), signed in as the EQ president.**
Screenshots reviewed by the user separately. This is agent-driven evidence, not a person using
the app.

### Observed

- The **Who went** field opened with one chip, `Miguel Cortez`. Removing it left exactly the
  string `Nobody recorded as visiting.`
- A leader and a typed name both added and rendered as names. **The member path could not be
  walked** — see Defect 1 below.
- The **sixth** person was accepted; the add controls were then replaced by the capacity
  sentence, verbatim: *"This visit already lists 6 people, which is the most a visit can record —
  the person writing it up plus 5 companions. Remove somebody to add another."* Removing one
  brought the controls back and the sentence disappeared.
- **A visit was logged with the recorder removed.** Read back from the database with the service
  client: `recorded_by = Miguel Cortez`, participants = `the missionaries, Tomas Reyes,
  Mark Andersen, Ana Delgado, Peter Nakamura` — **five rows, none of them the recorder.** That is
  the state visits-a could not express.
- Audit row for that visit: `{"orgId":"…a2","outcome":"completed","visitDate":"2026-08-26",
  "visitType":"in_home","visitLogId":"231d2e5e-…","arrangement":"drop_in","householdId":"52d7a829-…",
  "appointmentId":null,"participantCount":5}` — **`participantCount` present, no participant
  name anywhere.**
- Rendered rows: Brooks → *"Visited by Miguel Cortez and Ruth Brooks"* / *"Recorded by Peter
  Nakamura"*. Whitfield → *"Nobody recorded as visiting"* / *"Recorded by Peter Nakamura"*.
  Okonkwo → *"Visited by Miguel Cortez and Bill from next door"*.
- The Relief Society (Halvorsen) visit did **not** appear. Ferreira was absent from the household
  dropdown.
- 375px: `scrollWidth === clientWidth` (0px horizontal overflow). No raw uuid in the rendered
  text.

### Defects found

1. **The member picker cannot be used, and says something false.** For an org leader,
   `MemberPicker` defaults to `filter.organizationId = user.orgId` (roster-b Decision 4). This
   ward's members have **no `member_organizations` rows**, so the picker fetches zero and renders
   *"There are no members in the roster yet."* — while `GET /api/members?statuses=active` returns
   **6**. Two separate problems: the message is wrong for a *filtered*-empty result (the
   component's own comment at `MemberPicker.tsx:463` says exactly this must not happen), and it
   is an open product question whether a **companion** picker should be org-scoped at all — a
   spouse who came along is usually in a different organization, and the frozen props table has
   no way to opt out of the default.
2. **The chip remove button is 32×32**, below this app's 44×44 floor
   (`VisitParticipantsField.tsx`, `h-8 w-8`). Every other control on the page passes.

### Fixed and re-walked, same day

- **Defect 2 fixed.** The chip remove control is now `h-11 w-11`. A full sweep at 375 px found
  **zero** tap targets under 44×44.
- The user reviewed the screenshots and confirmed the two judgement calls this scenario turns on:
  "Nobody recorded as visiting" **reads as a deliberate statement**, and the `×` **reads as a
  remove control** with "Who went" in the right place in the form.
- **Defect 1 is NOT fixed** — it needs a product decision on whether a companion picker should be
  organization-scoped at all. Raised with the user; still open.

### Checklist corrections

None. Every check describes a reachable state; two of them failed, which is a finding about the
app rather than about the checklist. One is now fixed; the other is open pending a decision.

### Left unwalked

- "A member … can be added" — blocked by Defect 1.
- Dark mode was captured for the participants field but the full list was reviewed in light only.

## Notes

- The member picker inside **Who went** is roster-b's frozen `MemberPicker` in `inline` mode. It
  is used as a **chooser** only — the chips above it are where the list actually lives — so it
  will always look empty after a selection. That is deliberate, not a bug.
- The appointment on the Tuiasosopo household is here so the missed state is visible in passing.
  Scenario 044 is where it is actually checked.
