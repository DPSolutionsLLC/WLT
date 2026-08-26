---
name: Cross-org visibility toggle
scope: visits
part: 1
tags: [visits, full, admin, privacy]
prerequisites: none
---

## Purpose

**One tap changes what several dozen people can see.** That deserves a walk rather than only a
route test: the confirmation has to say the true thing, and the true thing has two halves — that
other leaders can now *read* these reports, and that management stays inside each organization
either way. A confirmation that says only the first half reads like handing the Elders Quorum the
run of Relief Society records.

**And the bug it can cause is silent.** `wards.settings` is one jsonb column holding
`role_access`, `timezone`, `default_speaking_slots` and this boolean. A toggle that wrote the
object wholesale would delete the ward's permission overrides, and the write would report success.
Nothing on the visibility screen would look wrong. `tests/routes/crossOrgVisibility.test.ts` pins
the merge at the database; this scenario is what proves the *screens* that read those settings
still show them afterwards. The ward arrives with two non-default settings for exactly that.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, **cross-org visibility OFF** |
| `wards.settings.role_access` | **Non-default** — `ward_secretary` has been granted `visits.view`, which the role does not hold by default |
| `wards.settings.default_speaking_slots` | **5**, not the fallback of 3 |
| Users | bishop (Mark Andersen), counselor 1 (Aaron Pike), counselor 2 (Samuel Rios), ward secretary (Wendy Okafor), EQ president (Miguel Cortez), RS president (Ruth Delacroix) |
| Households | 8, one active member each |
| Visit goals | 2 — one Elders Quorum (annual), one Relief Society (biannual) |
| Visit logs | 8 — 4 Elders Quorum, 4 Relief Society |
| Private note | 1, authored by the **RS president**, text beginning `PRIVATE-CHARLIE` |

**Sign in with:** `bishop@`, `counselor-1@`, `eq-president@`, `ward-secretary@` —
all `…@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- visits/scenario-042-cross-org-visibility-toggle`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the **bishop**. Open `/admin` and read the Cross-organization visit reports card
   before touching it.
4. Turn it **on**. Read the confirmation in full before accepting.
5. Sign in as **counselor 1**. (The notification they received is only readable in the
   `notifications` table until Phase 11 — see the checklist.)
6. Sign in as the **EQ president**. Open `/visits/feed` and `/visits`.
7. Sign in as the **ward secretary** and open `/visits`.
8. Sign in as the **bishop** again and open `/calendar` (or wherever the default speaker count is
   shown when a Sunday is generated).
9. Sign back in as **counselor 1**, open `/admin`, and turn it back **off**.
10. Sign in as the **EQ president** once more and reload `/visits/feed`.

## Verification Checklist

### Machine-checkable

- [ ] Before the toggle, the card states the current mode **in words**, not only by which side a
      control sits on
- [ ] Turning it on asks for confirmation first
- [ ] The confirmation text says, in words, that **management stays inside each organization**
- [ ] The confirmation text says **private notes are never shared**
- [ ] **Counselor 1 and counselor 2 each receive a notification**; the bishop, who made the
      change, does **not**. **Check this in the `notifications` table, not in the app** — the 🔔 in
      the header is an inert placeholder until Phase 11 builds the notification centre
      (`plans/11-notifications-admin.md`), so there is nothing to open. Corrected during the
      2026-08-26 walk; step 5 previously said "open the notification bell".
- [ ] An audit row records the change with the **before and after** values — check
      `/admin` → audit viewer if one exists, or the `audit_log` table for
      `action = 'cross_org_visibility_updated'`
- [ ] With it on, the EQ president's `/visits/feed` shows **8 tiles**, four of them labelled
      **Relief Society**
- [ ] With it on, `PRIVATE-CHARLIE` appears **nowhere** on the EQ president's feed or visit
      tracker — check with the browser's find
- [ ] With it on, the EQ president's `/visits` progress dashboard still offers **only the Elders
      Quorum** — they gain no controls over Relief Society goals or logs
- [ ] With it on, the EQ president sees **no edit or flag control** on a Relief Society report —
      **check BOTH `/visits/feed` and the Recent visits panel on `/visits`.** On `/visits`, every
      Elders Quorum visit keeps its "Flag for ward council" button and every Relief Society visit
      has none. (This FAILED on the first walk and was fixed the same day — see the Walkthrough
      record and `lib/visits/visitOwnership.ts`.)
- [ ] With it on, each tile carries a **coloured chip naming its organization** — Elders Quorum
      and Relief Society are different hues, and the name is in the chip, not only the colour
- [ ] The filter above the feed offers **only organizations that have reports** — not every
      organization in the ward, so there is no option that answers with an empty feed
- [ ] Ticking **"Only Elders Quorum"** narrows the feed to four tiles **and the unread count drops
      to match** — it must not still read 8 over four tiles
- [ ] Choosing **Relief Society** from the dropdown unticks the checkbox and shows the other four
- [ ] Choosing **Every organization** restores all eight
- [ ] With visibility **off**, the filter is **absent entirely** — one organization is not a choice
- [ ] **After the toggle, the ward secretary can still open `/visits`** — the seeded `role_access`
      override survived (if this reads "Not permitted", the settings were clobbered)
- [ ] **After the toggle, a newly generated Sunday still gets 5 speaker slots**, not 3 — the
      seeded `default_speaking_slots` survived
- [ ] A **counselor** can toggle it, exactly as the bishop can — step 9 succeeds
- [ ] Signed in as the **EQ president**, `/admin` is not reachable at all and no toggle is visible
      anywhere
- [ ] Turning it back off removes the four Relief Society tiles from the EQ president's feed
- [ ] No horizontal scrolling on the admin card at 375 px; the toggle button is at least 44 × 44

### Needs a human eye

- [ ] Read the confirmation cold, as a bishop who has not read this plan: does it remove the fear
      that you are giving one organization the run of another's records?
- [ ] Does the card make the **current** state obvious in one glance, without pressing anything?
- [ ] Does the notification the counselors receive say enough that they know what changed and
      whether to worry?
- [ ] With it on, does a Relief Society tile in an Elders Quorum leader's feed read as **someone
      else's work you can see**, or does it read as yours to act on?
- [ ] Does the button label ("Turn it on" / "Turn it off") say what pressing it will do, rather
      than what the current state is? Read it as somebody in a hurry.
- [ ] Dark mode on the admin card: is the current-state line still the first thing you read?

## Failure Behavior

- [ ] With the dev server stopped, pressing the toggle shows a **visible** error message and the
      card keeps showing the state that is actually stored
- [ ] Declining the confirmation changes nothing — no audit row and no notification
- [ ] Pressing the toggle twice at the same value writes **no second notification** (asserted in
      `tests/routes/crossOrgVisibility.test.ts`); an audit row is still written, because somebody
      touched the setting
- [ ] With visibility on, an EQ leader attempting to edit a Relief Society visit directly is
      refused by the policy, not only by a missing button — asserted in
      `tests/rls/visit-cross-org.test.ts`

## Walkthrough record

**2026-08-26 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every machine-checkable item was performed in the running app and verified by re-reading
`wards.settings`, `audit_log`, `notifications` and `visit_logs` with the service-role client.
**One check failed — see the defect below.** Screenshots in `walk-visits-c/`.

**Observed values**

- Ward seeded with the merge canary in place:
  `{timezone, role_access:{ward_secretary:{add:["visits.view"]}}, cross_org_visibility:false,
  default_speaking_slots:5}`.
- The admin card stated the mode **in words** — "**Currently off.** Visit reports are visible to
  their own organization's leaders, and to the bishopric." — with the button reading **"Turn it
  on"**. At 375 px: no overflow, toggle 93×44.
- Confirmation on turning it on, verbatim: *"Turn cross-organization visibility ON? / Every
  organization's leaders can read every organization's visit reports. / Management stays inside
  each organization either way: turning this on lets other leaders READ these reports, and never
  edit, create or delete them. / Private notes are never shared, in either mode."*
- **THE MERGE HELD, twice.** After the bishop's toggle and again after the counselor's, the
  settings read `cross_org_visibility` flipped with `role_access`, `default_speaking_slots: 5`
  and `timezone` **unchanged**. Confirmed on screen too: the ward secretary — who only holds
  `visits.view` through that seeded override — could still open `/visits` afterwards.
- **Audit:** 2 rows of `cross_org_visibility_updated`, module `visits`, carrying
  `{crossOrgVisibility, previousCrossOrgVisibility}` — `{true, false}` attributed to the bishop,
  `{false, true}` attributed to counselor-1.
- **Notifications:** the bishop's change notified **counselor-1 and counselor-2 only** (not the
  bishop). Counselor-1's change notified **the bishop and counselor-2** (not counselor-1). The
  notification body carries the same scope sentence as the confirmation.
- With it **on**, the EQ president's feed showed **8 tiles — 4 Elders Quorum + 4 Relief
  Society** — and the page's mode line changed to "Every organization's leaders can read every
  organization's visit reports." `PRIVATE-CHARLIE` was absent, as was the word "private".
- The **Relief Society goal stayed invisible** to the EQ president in both modes, as designed
  (`visit_goals_select` has no cross-org branch). Only the Elders Quorum goal was listed.
- A **counselor** turned it back off, exactly as the bishop turned it on. Turning it off removed
  the four Relief Society tiles and reverted the mode line.
- The EQ president got **"Not permitted"** at `/admin`, with no toggle card and no Admin link in
  the navigation.

**DEFECT FOUND AND FIXED — a control offered that the policy refuses**

With cross-org visibility **on**, the Recent visits panel on **`/visits`** (not the feed) shows
another organization's visits — correct — **each with a "Flag for ward council" button**. As the
EQ president, pressing it on the Relief Society Ellsworth visit
(`1a1d18df-275e-4385-846e-272ac4d3fe2d`) produced the full confirmation *"Flag Ellsworth for ward
council? The executive secretary will be notified…"*, then failed with *"That visit could not be
saved. Reload and try again."*

**RLS held and the data is safe**: `flagged_for_ward_council` stayed `false`, `flag_sent_at`
stayed `null`, and no notification was written. This is a UI-offers-what-the-policy-refuses bug,
not a leak — `visit_logs_update` has no cross-org branch, exactly as intended.

The button lives in `app/(app)/visits/page.tsx`, which rendered `VisitFlagButton` whenever the
caller held `visits.create`, without asking whether the visit was their organization's. That code
is `visits-a`'s and was not touched by the first `visits-c` pass — but `visits-c` ships the switch
that makes the state reachable for the first time. Evidence of the failure:
`walk-visits-c/042-defect-flag-on-other-org.png`.

**Fixed 2026-08-26**, same day, in `lib/visits/visitOwnership.ts`: `canManageVisitLog()` mirrors
`visit_logs_update`'s org clause, and the page now gates the button on it as well as on the
permission. Re-verified in the browser as the EQ president with visibility on — all four Elders
Quorum visits keep the button, all four Relief Society visits have none.

The helper carries an explicit null guard because **JavaScript and SQL disagree**: `org_id = null`
marks a bishopric-authored visit, and SQL's `null = null` is NULL where JavaScript's is `true`, so
a naive port would have handed edit controls on every bishopric visit to any leader with no
organization. `tests/lib/visitOwnership.test.ts` pins both directions.

**Checklist corrections made during the walk**

- Step 5 and its check asked the tester to open the notification bell. The 🔔 in the header is an
  inert placeholder until Phase 11 builds the notification centre, so there is nothing to open;
  both now say to check the `notifications` table.
- The "no edit or flag control" check did not say *where* to look. It now names both surfaces,
  and records that the feed passes while Recent visits fails.

**Left unwalked**

- All wording judgements and dark-mode legibility were left for a person — screenshots supplied.
- "Toggling twice at the same value writes no second notification" is not reachable from the UI
  (the button always flips the value); it stays covered by
  `tests/routes/crossOrgVisibility.test.ts`.

## Notes

- **The Relief Society GOAL stays invisible to the EQ president in both modes**, and that is
  correct rather than a bug. `visit_logs_select` has a cross-org branch and `visit_goals_select`
  does not (migration 019). The consequence is that a cross-org "X of Y" is not computable — which
  is why a feed tile carries no denominator. This is recorded as an open item at the end of
  Phase 7; do not add the policy branch speculatively.
- Scenario 041 is the "off" half of this pair and seeds the same shape of ward without the
  settings overrides. Either can be run alone.
