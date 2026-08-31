---
name: The season is over
scope: youth
part: 10
tags: [youth, full, close, delete]
prerequisites: none
---

## Purpose

Two things that are the same button.

`/youth` ranks young people on a support percentage computed from **every past home game on a
profile plus the next one**, and until now **nothing ever left that computation**. A basketball
season that finished in February kept contributing to Ethan's number in October, and a ward two
years in would be ranking its youth on games nobody remembers.

`Remove` on an activity deleted **unconditionally**. Migration 009 cascades
`youth_activity_profiles → activity_events → {activity_attendees, activity_logs →
activity_private_notes}`, so one press took a season, every sign-up, every pastoral follow-up **and
the private notes rule 5 calls private forever**. A confirm dialog was added first; a dialog can be
clicked through and is not protection.

They resolve together. Once a season can be **closed**, *"I want this off my list"* has an answer
that destroys nothing — and the destructive path narrows to what it should always have been: an
activity created by mistake with nothing recorded against it.

Seeding is what makes the central check **observable at all**. The refusal has to fire over a
follow-up written by *another organization's* leader — precisely the row the person pressing Remove
is not entitled to read, and therefore cannot check for. And a season worth closing means twelve
games already played with a real percentage attached, which is an afternoon of clicking and wrong
the moment the clock moves.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `cross_org_visibility: false`, `home_venues: ["Lincoln High School"]` |
| Users | `bishop@…`, `ym-president@…` (**the account to sign in as**), `yw-president@…`, `ward-council@…` (**no organization**) |
| Households | Brooks, Diaz, Kim |
| Members | 3 youth — Ethan Brooks, Josh Kim (Young Men), Maya Diaz (**Young Women**) |
| Activity profiles | 5 — one already closed, one ward-wide, one empty |
| Events | 21 |
| Attendees | 5 rows |
| Follow-ups | 1, written by the **Young Women** president |

The five activities, and what each is for:

| Activity | Whose | Owner | State | What it is for |
|---|---|---|---|---|
| **Varsity basketball** | Ethan | **Young Women**, entered by the **Young Men** president | 12 played, 1 attended → **8%** | the season to close, **and the one Remove must refuse** |
| **Track and field** | Ethan | Young Men | 2 played, 1 attended, 1 upcoming with nobody down | a **live** percentage that must not move when basketball closes |
| **Concert choir** | Maya | Young Women | **already closed**, 4 concerts, 2 attended → **50%** | the fully-closed card — she must **not vanish** |
| **Debate club** | Josh | Young Men | **no events at all** | the only activity that may be removed |
| **Community service crew** | Josh | **ward-wide** (`org_id` null), entered by `ward-council` | 1 past event, 1 follow-up owed | the null-org close, and decision 3 |

**The fixture that looks like a typo and is not:** Ethan's basketball profile has `org_id` =
**Young Women** and `entered_by` = the **Young Men** president. That is the only state in which the
two policies diverge — 054d's DELETE admits `entered_by = auth.uid()`, and 057c's log SELECT scopes
by the **event's** organization and never mentions `entered_by`. So the Young Men president **may
delete it** and **cannot read one word written on it**. It is the shape a release and a recall
leave behind, and it is what makes migration 060b's `security definer` counter load-bearing rather
than decorative.

**Sign in with:** `ym-president@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-060-the-season-is-over`
2. `npm run dev`, then open http://localhost:3000 and sign in as `ym-president@…`
3. Open **/youth**. Read every card before touching anything — Ethan's two pills, Maya's card, and
   the *"Waiting on your follow-up"* panel at the top.
4. Note Ethan's basketball percentage and his track percentage, and note where he sorts under
   **Priority**.
5. Open **/youth/profiles**. Read the controls on each of the five activities: which offer
   **Remove**, and which do not.
6. Press **Close the season** on Ethan's **Varsity basketball**. Read the dialog before accepting.
7. Go back to **/youth** — *without reloading if you can*. Ethan's basketball pill should be gone,
   his track pill unchanged, and a history link should have appeared.
8. Open **See Ethan Brooks's history**. Read the closed season's final percentage.
9. Go back and read **Maya Diaz's** card: no pills, a sentence, a history link. Then sort by
   **Priority** and reverse the direction.
10. Return to **/youth/profiles** and press **Reopen** on Varsity basketball. Watch `/youth` again.
11. Close it once more, then try to **Remove** it. (The control should not be there — see step 12
    for how to press it anyway.)
12. With the dev tools console open on `/youth/profiles`, call the API directly:
    `await fetch('/api/youth/profiles/<basketball id>', { method: 'DELETE' }).then(r => r.status)`
13. Press **Remove** on Josh Kim's **Debate club** and accept the dialog.
14. Sign in as `ward-council@…` and close **Community service crew**, then reopen it.
15. Sign back in as `ym-president@…` and read *"Waiting on your follow-up"* with the service crew
    closed.
16. Read **/youth** and **/youth/history/<Ethan's member id>** at 375px, in both light and dark.

## Verification Checklist

### Machine-checkable

- [ ] Before step 6, Ethan's card shows **two pills** — *Varsity basketball · 8%* and
      *Track and field · …* — and **no history link**.
- [ ] Closing a season removes its pill from the young person's `/youth` card **without a reload**.
- [ ] `closed_at` is **non-null** in `youth_activity_profiles`, and an audit row
      `youth_activity_profile_closed` exists carrying `profileId`, `orgId`, `memberId` and
      `closedAt`.
- [ ] Ethan's **track** percentage is **unchanged** by closing basketball, and his upcoming-event
      count drops by exactly the closed season's share.
- [ ] **See Ethan Brooks's history** appears on his card once he has one closed season — while he
      still has a running one.
- [ ] **Maya Diaz still appears on `/youth`** with a **dashed pill reading *"Concert choir ·
      Finished"***, the line *"No activity running just now."*, and a history link. She does not
      vanish, and she does not read as **0%**.
- [ ] **A finished season renders as a NAMED pill, not as an absence.** The card has the same shape
      as every other card — one pill per activity — and the difference is the pill's dashed border
      and the word *Finished*. A card whose only sign of an activity is a sentence is defect
      **060-D1** (below), and the finished pill must carry **no percentage**: the closed season's
      number lives on the history page and nowhere else.
- [ ] Maya sorts **last** under Priority, and **still last** when the direction is reversed.
- [ ] The history page shows the closed season's final percentage — **50%** for Maya, **8%** for
      Ethan's basketball.
- [ ] **The clock is `closed_at`, not `now`, and a RELOAD CANNOT PROVE THIS.** Every seeded event
      is already in the past, so both clocks give the same answer and the check could not fail as
      originally written (corrected during the 2026-08-31 walk). Prove it instead by inserting one
      home event on Maya's **closed** Concert choir dated **between `closed_at` and now** — say ten
      days ago, against a season closed twenty days ago. Judged against `closed_at` that event is
      still in the FUTURE, so the sentence must continue to read **"2 of 4 home games played"**.
      If it reads **"2 of 5"**, the page is computing against `now` and the number is not frozen.
      Delete the probe row afterwards.
- [ ] Maya's history page shows **four concerts**; Ethan's basketball history shows **twelve games**
      — a closed season's events are still listed.
- [ ] Reopening restores the pill and writes `youth_activity_profile_reopened`, and `closed_at` is
      **null** again.
- [ ] Expanding Ethan's card with basketball CLOSED still shows the **basketball games** in the
      schedule — the ranking excludes them, the record does not.
- [ ] **`Remove` is not rendered** on Varsity basketball (12 events), on Track and field (3), on
      Concert choir (4) or on Community service crew (1).
- [ ] `DELETE` on Varsity basketball **by direct API call** → **409**; the sentence names **Close**
      as the alternative and discloses **neither the number of follow-ups nor any of their text**.
- [ ] After that 409, the profile, its **12 events** and its **1 follow-up** are all still present
      when re-read with the service client.
- [ ] **No audit row** was written for the refused delete.
- [ ] `Remove` **is** rendered on Josh Kim's **Debate club**, removing it succeeds, and the audit
      detail carries `activityName: "Debate club"` and `eventCount: 0`.
- [ ] The `yw-president`'s follow-up blocks the delete **even though `ym-president` cannot read
      it** — confirm the invisibility by opening `/youth/feed` as `ym-president` and finding no
      trace of that note.
- [ ] The `ward-council` account (**no organization**) can close and reopen the **ward-wide**
      Community service crew. This is 054d's explicit `org_id is null` branch.
- [ ] A closed season's unwritten follow-up **still appears** in *Waiting on your follow-up* — the
      food-bank shift is still owed after the service crew is closed.
- [ ] Neither **Close** nor **Remove** renders on another organization's activity — check Maya's
      Concert choir as `ym-president`.
- [ ] Every activity card that is closed carries a **Season closed** chip, so the state is stated
      rather than inferred from a button reading *Reopen*.
- [ ] No horizontal overflow at 375px, and every button and form control is at least 44×44.

### Needs a human eye

- [ ] **Does "Nothing running. 1 closed season." read as deliberate, or as a young person the app
      has lost track of?** This is the judgement the whole of ITER-028 turns on.
- [ ] **Does the 409 sentence make the alternative obvious, or does it read as a dead end?** A
      leader who wanted this activity gone has to finish the sentence knowing what to do next.
- [ ] **Is it clear that Close is the ordinary action and Remove the exception?** They sit side by
      side on four cards and only one of them is red — is that enough?
- [ ] Does the history page answer *"how well was he supported last season"* **at a glance**, or
      does the number need explaining?
- [ ] Is *"Close the season"* the right words for a **choir** and a **service crew**, or does it
      read as sports-only vocabulary applied to everything?
- [ ] Does the close dialog feel proportionate — mild enough that closing is easy, clear enough
      that nobody presses it thinking it deletes?

## Failure Behavior

- [ ] Closing with the dev server stopped mid-tap shows a **sentence** rather than failing
      silently.
- [ ] `PATCH /api/youth/profiles/<id>/close` with `{ "closed": "yes" }` → **400** with a sentence.
- [ ] `PATCH …/close` on **Maya's Concert choir** as `ym-president` → **404**, and `closed_at` is
      unchanged when re-read.
- [ ] Signed in as an **org secretary** (`youth_activities.view` and `.log`, not `.manage`),
      **Close**, **Reopen**, **Edit** and **Remove** are all **absent** — not present and refusing
      — and `PATCH …/close` called directly answers **403**.
- [ ] Reopening an activity that is already open, or closing one already closed, is harmless: the
      route answers 200 and the audit records what was asked.

## Walkthrough record

**2026-08-31 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every write was read back with the **service client**. Signed in as `ym-president`, then
`ward-council`, then `bishop`. Evidence in `.walk060/` (git-excluded).

**The seed, read back from the database.** 5 profiles, 21 events, 5 attendee rows, 1 follow-up.
Concert choir already `closed_at = 2026-08-11T03:57Z`; every other profile null. Basketball's 12
games at −96.1d … −19.1d with **one** confirmed attendance (game 4) and one *unanswered* attendee
row (game 8). Track at −12.2d (confirmed), −5.2d, +3.8d. The `yw-president`'s follow-up on
basketball game 12.

**THE HEADLINE RESULTS.**

| Check | Observed |
|---|---|
| Baseline pills | Josh `Community service crew · 0%` + `Debate club · —`; Ethan `Track and field · 33%` + `Varsity basketball · 8%`; Maya **`Nothing running. 1 closed season.`** |
| Maya on `/youth` | **present, no pills, history link** — she does not vanish, and never renders `0%` |
| Priority ascending | Josh (0%), Ethan (8%), **Maya last** |
| Priority **reversed** | Ethan, Josh, **Maya still last** — null last in both directions |
| Ethan before closing | two pills, **no history link** |
| Close (Track and field) | `Season closed` chip + button → `Reopen`, **no reload**; `closed_at` written |
| `/youth` after | track pill gone, basketball pill unchanged at 8%, `1 closed season.`, **history link appeared on a card that still has a running season** |
| Reopen | **no confirm dialog**, chip gone, `closed_at` null |
| Audit rows | `..._closed` (closedAt stamped), `..._reopened` (`closedAt: null`), `..._deleted` — all carrying `profileId`, `orgId`, `memberId` |
| Ward-wide close by `ward-council` (**no org**) | **succeeded**; audit detail `"orgId": null` — 054d's explicit null branch, live |
| `Remove` rendered on | **Debate club only** (0 events). Absent on basketball (12), track (3), choir (4), service crew (1) |
| Delete of Debate club | 200; audit detail **`eventCount: 0`, `activityName: "Debate club"`** |
| Expanded card, closed season | Food bank shift **still listed in full**, with `Waiting on your follow-up`, `Going: Miguel Cortez` and its controls |
| Decision 3 | Food bank shift **still in *Waiting on your follow-up*** after its season was closed |
| Console | **no React #418 hydration mismatch** anywhere, on a brand-new page carrying three date formatters |
| 375px | `scrollWidth == clientWidth` on `/youth`, `/youth/profiles` and `/youth/history/[id]`; every profile button **44px** tall |

**THE ITER-031 REFUSAL, PROVED END TO END.** `DELETE` on Varsity basketball → **409**, sentence
*"This activity has follow-ups recorded against it, so it cannot be removed. Close it instead — its
history stays readable and it leaves the support ranking."* Re-read with the service client
afterwards: **profile present, 12 events present, 1 follow-up present, `notes` still null, and NO
audit row written.** The follow-up belongs to `yw-president` and is invisible to the caller, so the
`security definer` counter is what fired.

**THE FROZEN NUMBER, PROVED PROPERLY — AND THE CHECKLIST WAS WRONG.** The original line said to
reload and confirm the number did not move. **That check could not fail:** every seeded event is
already past, so `closed_at` and `now` give identical answers. Replaced with a decisive probe — one
home event inserted on Maya's *closed* choir dated **ten days ago against a season closed twenty
days ago**, i.e. future relative to `closed_at` and past relative to `now`. The page continued to
read **"2 of 4 home games played"** rather than "2 of 5". **The clock is `closed_at`.** Probe row
deleted afterwards.

**Refusals, each with a re-read showing nothing moved:** `{closed: "yes"}` → **400**
*"Invalid input: expected boolean, received string"*; Maya's choir as `ym-president` → **404**
*"…may belong to another organization…"*; the ward-wide crew as `ym-president` → **404**.
An unknown member id on `/youth/history/` → **404**.

**STEP 6 WAS NOT WALKED AS WRITTEN, and that is defect D2.** The step says to close **Varsity
basketball** as `ym-president`; that returns **500**. The close flow was walked on **Track and
field** instead, and basketball was later closed as **`bishop`** to reach the 12-game history
(**8%**, *"Somebody went to 1 of 12 home games played."*, 12 events listed). Both substitutions are
stated rather than ticked.

**NOT WALKED:** the `org_secretary` case in *Failure Behavior* — no such account exists in this
seed. It is covered by `tests/routes/youthProfileClose.test.ts` (`eqSecretary` → 403, row unchanged)
and by `tests/components/youth/ActivityProfileList.test.tsx` (no control renders when
`canManageActivityProfile()` is false), and the equivalent was observed live: as `ym-president`,
Maya's choir and the ward-wide crew carried **no Edit, Close or Remove at all**.

**THREE DEFECTS FOUND. None is in the data layer; all three are reported unfixed.**

**D1 — the close dialog said "how well he or she is supported". FIXED 2026-08-31.** Clumsy, and it
excluded anybody who is neither. `ActivityProfile` carries no gender — nothing in this module does —
so the app has no pronoun for a member and must not imply one. Now reads **"how well they are
supported"**, asserted as an ABSENCE in `ActivityProfileList.test.tsx` (`not.toContain("he or she")`)
so the phrase cannot come back.

**D2 — closing an activity whose `org_id` is not yours but which you entered returned 500.
FIXED 2026-08-31, both halves.**
Migration 054d's UPDATE has `entered_by = auth.uid()` in **USING** but not in **WITH CHECK**, so the
row is admitted and the result is refused — and a failed WITH CHECK *raises* rather than returning
zero rows. `closeActivityProfile()` rethrows, and the route answers 500 with
*"Could not close that activity. Please try again."*, which is untrue: trying again cannot work.
**Pre-existing, not introduced here** — `PATCH /api/youth/profiles/[id]` (Edit) 500s identically on
the same row, and has since `youth-a`. What is new is that **Close inherits it**, and that the
**409's advice becomes unfollowable**: on precisely the row where Remove is refused with *"Close it
instead"*, Close is the control that fails. The bishopric path works (`is_bishopric()` satisfies
WITH CHECK), and `tests/rls/youth-profile-close.test.ts` missed it because it seeded only
`org_id = null` and matching-org rows, never `entered_by = me AND org_id = another organization`.
**Fixed two ways, because the UI gate and the route are two expressions of one rule and neither is
the boundary on its own (CLAUDE.md rule 2).**

1. **`canManageActivityProfile()` now mirrors BOTH halves of 054d**, not just USING. An UPDATE has
   to satisfy USING *and* WITH CHECK, and the only shape where they disagree is
   `org_id = another organization AND entered_by = me`. `Edit`, `Close the season` and `Remove` are
   now **absent** there — this file's whole purpose, applied to the bug it had itself. Its test was
   rewritten as an **inversion** rather than deleted, so the reversal reads as a decision.
   *Note:* the DELETE policy has no WITH CHECK, so the database would still permit a delete on such
   a row; hiding `Remove` too is the conservative direction and is recorded as deliberate.
2. **A raised WITH-CHECK refusal is now a 404 with a sentence, never a 500.** `isPolicyRefusal()`
   in `lib/youth/queries.ts` maps SQLSTATE **42501** onto the same `null` return the zero-row
   refusal already used, so both kinds of "not yours" produce the caller's existing sentence.
   Applied to `closeActivityProfile()` **and** `updateActivityProfile()` — leaving one of two
   identical paths returning 500 is how it would come back. Narrow on purpose: only 42501, so
   "the policy said no" and "the database is broken" stay different messages (rule 7).

Verified in the browser afterwards: as `ym-president`, Varsity basketball carries **no Edit, Close
or Remove at all**, and calling both routes directly answers **404** with *"It may belong to another
organization"* — with `closed_at` and `notes` unchanged on re-read.

Reproduced before the fix as: as `ym-president`, press `Close the season` on Varsity basketball.

**D3 — a closed season's final number counts a game that can never be supported.** The horizon
rule is *"every past home game plus the next one"*, which is right on a live card where the next
game is actionable. Frozen at `closed_at` it keeps counting a fixture nobody can now sign up for:
Ethan's track reads **33%** with *"Somebody went to 1 of 2 home games played, **and nobody is down
for the next one**"* on a page headed *"Seasons that have been closed out"*. The probe above showed
the same effect drop Maya's choir from 50% to 40%. Basketball, which has no fixture after its
closing instant, reads cleanly: *"Somebody went to 1 of 12 home games played."* Whether the plan
half should drop out of a closed season's number is a **product decision**, not a coding slip —
40% is a faithful snapshot of the closing instant, and 50% is the honest answer to *"how often was
somebody there"*, which is the question the page's own subheading asks.

**JUDGEMENT 1 CAME BACK "NO", AND THE CARD WAS REDESIGNED — 2026-08-31.** Asked whether
*"Nothing running. 1 closed season."* read as deliberate or as a young person the app had lost
track of, the user answered **no**. The diagnosis: a fully-closed card was **the only card on the
page with no pills at all**, so beside its neighbours it read as data that had failed to load — and
it never said WHICH activity the young person does.

**A finished season is now a pill like any other**, marked with a dashed border and the word
*Finished*, so the card keeps its shape and the difference is carried by the pill's TREATMENT
rather than by the absence of one. `YouthNeed.closedCount` became `closedActivities`, carrying the
NAMES, and `describeClosedSeasons()` became `describeNothingRunning()` returning
*"No activity running just now."* — **the count is gone from the sentence** because the pills name
themselves, and a number beside a list it duplicates is this codebase's oldest defect. The finished
pill deliberately carries **no percentage**: putting a closed season's number back on `/youth` is
exactly what ITER-028 removed.

Verified in the browser afterwards. Mixed card: `Track and field · 33%` beside
`Varsity basketball · Finished`, with the upcoming count and no sentence. Fully-closed cards:
`Concert choir · Finished` plus *"No activity running just now."* The dashed border was confirmed
to have COMPILED (`borderStyle: "dashed"` read off the live element) rather than silently dropping,
which is Tailwind's whole-class-string trap. No overflow at 375px.

**Judgements 2, 3 and 4 came back "yes".** In particular **D3 is settled as WORKING AS INTENDED**:
a closed season's number **should** keep counting the game that was next when it closed, because
that is a faithful snapshot of the closing instant. The clause *"and nobody is down for the next
one"* stays, since it is what explains the denominator — remove it and the counts on the card stop
adding up.

**Checklist corrections made during this walk:** the frozen-number line was replaced (it could not
fail); the tap-target line was read as written — it names *buttons and form controls*, and every
profile button measures 44px. The new *"See … history"* links are **18px inline text links**, which
matches the three inline links already at the top of `/youth` (20px) rather than any button.
