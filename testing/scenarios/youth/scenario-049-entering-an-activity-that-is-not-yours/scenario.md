---
name: Entering an activity for a youth who is not yours
scope: youth
part: 1
tags: [youth, full, permissions, org-scope]
prerequisites: none
---

## Purpose

Migration 054 makes **reads ward-wide and writes org-scoped**, and that asymmetry is the one
decision in this slice that cannot be seen from a single account. From one login the two rules look
like one rule: whatever you can see, you can probably also change. It takes four people signing in
at different times, three differently-owned activities, and a youth who has two of them — which is
exactly what seeding is for.

It also covers the phase plan's **"ward council member scope confusion"** pitfall, which it
describes as *two different rules that must both be checked*. The ward council member here has
`org_id` deliberately null, which is the `talks-d` hole seen from the outside: they write a
ward-wide activity, the write succeeds, and the only thing that proves the policy is right is
whether it then appears in their own list.

A route test proves each of these against the database. What it cannot answer is whether an org
leader who cannot edit somebody else's activity is **told why in a sentence**, or is simply handed a
control that fails — and whether "Ward-wide" reads as a deliberate state rather than as missing
data.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop@harness.wardleadershiptools.test` (bishop) · `ym-president@…` (Young Men president) · `yw-president@…` (Young Women president) · `council-member@…` (**ward council member, no organization**) |
| Households | Brooks (2201 Canyon Road) · Tuione (148 Larkspur Lane) |
| Members | 3 youth — Ethan Brooks (Young Men), Malia Tuione and Sela Tuione (Young Women), all `active` |
| Activity profiles | 4 — Ethan's *Varsity basketball* (Young Men) · Malia's *Chamber choir* **and** *Debate team* (Young Women) · Sela's *Community orchestra* (**ward-wide**, entered by the council member) |
| Events | 4 — three upcoming across the profiles, one completed in December 2025 |

Malia has **two** activities and Ethan has **one**, so both the grouping and the plural wording
have something to be wrong about.

**Sign in with:** each of the four accounts in turn.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-049-entering-an-activity-that-is-not-yours`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `ym-president@…`. Open **Youth Activities** from the sidebar, then follow
   **Activities and schedule** to **/youth/profiles**.
   CORRECTED 2026-08-29: slice `youth-e` moved the activity list off `/youth`, which is now the
   ranked list of young people. Every step below named `/youth` and was written before that move.
4. Note which activities are listed, who each belongs to, and **which ones carry Edit and Remove**.
   CORRECTED 2026-08-29: this step used to read "Press **Edit** on *Chamber choir* (the Young
   Women's) and try to save a change." That state is NO LONGER REACHABLE — the control is absent
   on another organization's activity, which is the fix for `youth-a-D1`. What this step checks now
   is the ABSENCE; that the write is still refused underneath is proved against the API, because a
   hidden button is not a security boundary (CLAUDE.md rule 2).
5. Sign in as `yw-president@…` and do the mirror: confirm Edit and Remove are present on
   *Chamber choir* and *Debate team* and absent on *Varsity basketball*.
6. Sign in as `bishop@…`. Press **Add an activity** and look at the form.
7. Sign in as `council-member@…`. Press **Add an activity**, enter one for Ethan, and save.

## Verification Checklist

### Machine-checkable

- [ ] All four accounts see **all four** activities on `/youth/profiles`, grouped under three
      youth. They also appear as pills on `/youth`, which is a different page since `youth-e`.
- [ ] **The Edit and Remove controls are ABSENT on an activity this account may not change** —
      not present and failing. RESTORED 2026-08-27 during the walk: this line was in the source
      plan ("is told why in a sentence — *not shown a control that fails*") and was weakened when
      this file was first written. The walk found it FAILING; see the Walkthrough record.
- [ ] The Young Men president's attempt to save a change to *Chamber choir* does not change the
      stored row — check `youth_activity_profiles.activity_name` in Supabase.
- [ ] The Young Women president's mirror attempt on *Varsity basketball* likewise changes nothing.
- [ ] The bishop's **Add an activity** form contains an organization select; the Young Men
      president's and the council member's do **not** — the control is absent, not disabled.
- [ ] The council member's new activity appears in **their own list** immediately, without a
      reload. (This is the `talks-d` hole: the write succeeding proves nothing on its own.)
- [ ] That row carries `org_id = null` in the database and reads **Ward-wide** on screen.
- [ ] Each activity card names the organization that owns it.
- [ ] Malia renders as **one** heading with **two** activity cards beneath it, not twice.
- [ ] The heading beside Ethan reads "1 activity", not "1 activities".
- [ ] An `audit_log` row exists with action `youth_activity_profile_created` for the council
      member's new activity.
- [ ] Creating an activity **owned by an organization** writes a `youth_activity_added`
      notification to that organization's OTHER leaders, and not to the person who created it.
      ADDED 2026-08-27: the seed as written cannot reach this — each organization has exactly one
      leader and `notifyOrgLeadership` excludes the actor, so zero recipients resolve and nothing
      emits. Seed a second Young Women leader to walk it. (Walked once by hand; see the record.)
- [ ] Creating a **ward-wide** activity writes NO notification — there is no org leadership to
      tell.
- [ ] The past event (*Game against Jefferson*) is absent until **Show past events** is pressed.
- [ ] No horizontal overflow at 375px. Every button is at least 44×44.
- [ ] No raw uuid appears anywhere on screen.

### Needs a human eye

- [ ] REPLACED 2026-08-29. This asked whether the refusal MESSAGE says why. There is no longer a
      message, because there is no longer a control to press — `youth-a-D1` was fixed by removing
      it. The question that matters now: **does the absence explain itself?** A Young Men president
      sees Edit and Remove on *Varsity basketball* and nothing at all on the other three, with no
      sentence anywhere saying why. Does that read as "not yours to change", or as buttons that
      failed to load?
- [ ] Does **Ward-wide** read as a deliberate state ("this belongs to no one presidency") rather
      than as a field somebody forgot to fill in?
- [ ] Is it obvious at a glance which activities are *yours* and which you are only reading? Or do
      four accounts see four identical-looking pages?
- [ ] Does the empty-state sentence (sign in before seeding, or remove every activity) explain what
      the page is for, or does it read as a page that failed to load?
- [ ] Legible one-handed at 375px, in both light and dark mode?

## Failure Behavior

- [ ] Editing another organization's activity returns 404 with a sentence naming the likely cause
      ("It may belong to another organization"), not a silent no-op and not a 500.
  Automated: `tests/routes/youthProfiles.test.ts` → *"returns 404 rather than editing another
  organization's profile"*.
- [ ] An org leader whose request body names a different organization is refused with
      *"You can only enter activities for your own organization"* — refused, not silently
      corrected. Automated: same suite.
- [ ] An org secretary sees the list and no buttons at all. Automated: same suite.
- [ ] A user in another ward sees none of this. Automated:
      `tests/rls/youth-activity-scope.test.ts`.

## Walkthrough record

**2026-08-29 — driven by Claude in a real browser (Playwright), against the hosted project.**
Re-walked after slices `youth-e`, `youth-f` and `youth-g` moved this module's furniture. Every
machine-checkable line was performed in the running app and verified by re-reading the row with the
service client. The "needs a human eye" lines are NOT walked — they were captured for review.

**`youth-a-D1` IS FIXED, and this walk is the confirmation.** The 2026-08-27 record found Edit and
Remove offered on every organization's activity. They are now offered on exactly the rows
`canManageActivityProfile()` permits, and the mirror proves it is not an artifact of seed order:

| Account | Varsity basketball (YM) | Chamber choir (YW) | Debate team (YW) | Community orchestra (ward-wide) |
|---|---|---|---|---|
| `ym-president` | **Edit · Remove** | — | — | — |
| `yw-president` | — | **Edit · Remove** | **Edit · Remove** | — |
| `bishop` | **Edit · Remove** | **Edit · Remove** | **Edit · Remove** | **Edit · Remove** |
| `council-member` (org_id null) | — | — | — | **Edit · Remove** (its author) |

The council member's row is the null-equals-null guard doing its job: they reach it through the
`enteredBy` arm, not through a null `org_id` matching a null `org_id`.

**No defects found.**

Observed values:

- **The list moved, and three checklist lines described the old page.** `/youth` is now `youth-f`'s
  ranked list of young people; the activities live at `/youth/profiles`. Corrected in Steps and in
  the checklist — see the CORRECTED / REPLACED notes above.
- **A hidden control is not a boundary, so the API was probed directly.** As `ym-president`:
  `PATCH /api/youth/profiles/{Chamber choir}` → **404** *"That activity could not be changed. It may
  belong to another organization. Reload and try again."*; `DELETE` on the same row → **404**;
  `PATCH` on the ward-wide row → **404**. As `yw-president`, the mirror on *Varsity basketball* →
  **404**, and `POST` naming another organization's `orgId` → **403** *"You can only enter
  activities for your own organization."* Service-client re-read after all of it: still exactly
  **4 rows**, names unchanged (`Chamber choir`, `Community orchestra`, `Debate team`,
  `Varsity basketball`), `org_id` unchanged. A control the account DOES own still worked
  (`PATCH` on *Varsity basketball* → 200), so the 404s are a scope refusal rather than a dead route.
- **DELETE was exercised across every row, not just one.** As `yw-president`, deleting all six
  profiles then present returned 200 for her own three and 404 for the other three.
- **The organization select is absent, not disabled.** `#activity-org` missing entirely for
  `ym-president`, `yw-president` and `council-member`; present for `bishop` with 8 options
  (`The whole ward`, Bishopric, Elders Quorum, Primary, Relief Society, Sunday School, Young Men,
  Young Women), defaulting to *The whole ward*.
- **The `talks-d` hole stays closed.** As `council-member`, added *Ward youth service project* for
  Ethan Brooks. Heading went **"Activities (4 activities)" → "(5 activities)"** with no reload, the
  row appeared under Ethan (now "2 activities") reading **Ward-wide** and carrying Edit · Remove.
  Stored row: `org_id = null`, `entered_by = 7bc6d140…` (Dana Okonkwo).
- **Audit.** `youth_activity_profile_created`, module `youth_activities`, `user_id 7bc6d140…`,
  detail `{"orgId":null,"memberId":"f1792107…","profileId":"3ed58c9e…","activityType":"community"}`.
  Ids only — no member name in the row (rule 8). The refused writes left **no** audit rows, which is
  correct: nothing happened.
- **Notification, both directions.** The ward-wide profile emitted **zero**. Adding a second Young
  Women leader (`yw-counselor`, `org_counselor`, `3d70362b…`) and creating *Track and field* as
  `yw-president` emitted **exactly one**: `trigger_key youth_activity_added`, recipient
  `3d70362b…` — the counselor, **not** the actor `30ce4b01…` — title *"A youth activity was added"*,
  body *"Sela Tuione — Track and field (Sport)"*. The seed STILL cannot reach this on its own; a
  second organization leader must be added by hand, as the checklist line says.
- **Grouping and plurals.** Ethan "1 activity", Malia ONE heading with TWO cards "2 activities",
  Sela "1 activity". Empty state reads "Activities (0 activities)".
- **Past events.** Default "Schedule (3 upcoming events)", *Game against Jefferson* absent; after
  **Show past events**, "Schedule (4 events)" with Jefferson first.
- **Layout.** 375px: `scrollWidth === clientWidth` (360 = 360), zero elements past the viewport,
  **all 19 buttons ≥ 44×44**, no uuid in `main`. Desktop 1420px: no overflow.

Two things recorded for a human rather than settled here:

1. **Six text links are 20px tall at 375px** — "Back to the young people", "Open the ward activity
   calendar", "Import a schedule", and the three event-title links. The checklist line says
   "every **button** is at least 44×44" and every button is; inline links are conventionally exempt
   from the 44px target. But the event-title links are the ONLY route from this page to
   `/youth/events/[id]` (`youth-g`), so on a phone the main navigation into the event detail is a
   20px target. Not called a defect; put to the user.
2. **Events have no ownership gate at all, and that is deliberate.** Every account is offered
   **Edit** and **Cancel** on every organization's event. `lib/youth/activityOwnership.ts` says so
   explicitly ("THERE IS DELIBERATELY NO canManageActivityEvent()") because `activity_events` keeps
   migration 019's ward-wide write policies. **Verified rather than assumed:** as `ym-president`,
   `PATCH /api/youth/events/{Winter concert}` (a Young Women event) → **200**. So the UI and the
   policy agree and this is NOT `youth-a-D1` again. It is still a product asymmetry worth a
   decision: you cannot rename another presidency's activity, but you can cancel their concert.

**The "needs a human eye" lines WERE answered, by the user, on 2026-08-29** — reviewing the
screenshots rather than using the app. Four passed outright:

- **Does the absence explain itself?** Yes. "Looks good."
- **Does "Ward-wide" read as deliberate?** Yes — "lands as a real state".
- **Do the empty states explain, or look broken?** They explain.
- **Legible one-handed at 375px, both themes?** Yes.

**"Is it obvious which activities are yours?" passed on the words and raised two enhancements**:
*"the label makes it obvious. However it could be more easily browsed for your own if the labels
were colour coded. Maybe a filter to show only your own organization's youth would be good too?"*
Neither is a defect — the page answers the question, it is the BROWSING that is being asked about.
Recorded as ITER-029 rather than fixed here, because the colour half is not the small change it
looks like (see that scope: `ACTIVITY_TYPE_TONES` and `ORGANIZATION_TYPE_TONES` draw from the same
seven tones, and `young_men` and `sport` are BOTH teal — so an organization chip added to
*Varsity basketball* would sit beside the type chip in the same colour meaning something else).

The ward was **re-seeded at the end of this walk**, so it is clean — unlike the 2026-08-27 walk,
which left it dirty.

---


**2026-08-27 — driven by Claude in a real browser (Playwright), against the hosted project.** Every
machine-checkable line below was performed in the running app and verified by re-reading the row
with the service client, not from the screen. The "needs a human eye" lines are NOT walked — they
were captured as screenshots for review.

**One defect found: `youth-a-D1`, Edit and Remove are offered on every organization's activity.**
See below.

Observed values:

- **Reads are ward-wide.** All four accounts saw all four seeded activities. Confirmed for
  `ym-president` and `yw-president` explicitly by reading the rendered cards: *Varsity basketball*
  (Young Men), *Chamber choir* (Young Women), *Debate team* (Young Women), *Community orchestra*
  (Ward-wide).
- **Writes are refused, and nothing is stored.** As `ym-president`, edited *Chamber choir* to
  "Hijacked by Young Men" and saved → message *"That activity could not be changed. It may belong
  to another organization. Reload and try again."* Service-client re-read: `activity_name` still
  `Chamber choir`, `org_id` still `…a5`. Pressed **Remove** on the same row → same message; row
  still present, count still 4.
- **Mirror confirmed, so it is not an artifact of seed order.** As `yw-president`, edited
  *Varsity basketball* to "Hijacked by Young Women" → refused; row unchanged.
- **The organization select is absent, not disabled.** `yw-president`'s Add form had no
  `#activity-org` element at all; `bishop`'s had one with 8 options, defaulting to *The whole ward*.
  `council-member`'s had none.
- **The `talks-d` hole is closed, seen from outside.** As `council-member` (`org_id` NULL), created
  *Ward youth service project* for Ethan Brooks. It appeared in their own list immediately with no
  reload — heading moved 4 → 5 activities. Stored row: `org_id = null`,
  `entered_by = f9880bb7…` (Dana Okonkwo, the account with no organization). Audit row
  `youth_activity_profile_created` with `{"orgId":null,…}`.
- **The creator can edit their own ward-wide activity.** Renamed it to "Ward youth service project
  (renamed by its author)"; save succeeded, audit row `youth_activity_profile_updated` written,
  list caught up.
- **Notification.** Walked by adding a second Young Women leader (`yw-counselor`, org_counselor)
  with the harness's own `createTestUser`, then creating *Track and field* as `yw-president`.
  Exactly one `notifications` row: `trigger_key = youth_activity_added`,
  `recipient_user_id = f5317b15…` (the counselor, NOT the actor), title *"A youth activity was
  added"*, body *"Sela Tuione — Track and field (Sport)"*. The ward-wide profile above emitted
  **zero** notifications, which is the deliberate skip. This proves the `triggerKey` parameter
  added to `notifyOrgLeadership` during this slice.
- **Grouping and plurals.** Malia Tuione rendered as ONE heading with TWO cards, labelled
  "2 activities". Ethan Brooks read "1 activity" — the singular is correct.
- **Past events.** Default schedule showed 3 upcoming; *Game against Jefferson* (Dec 2025) was
  absent until **Show past events**.
- **Layout at 375px.** `documentElement.scrollWidth === clientWidth` (360 = 360, no horizontal
  overflow); zero elements extending past the viewport; zero interactive elements under 44×44; no
  uuid matched in `main`'s rendered text. Screenshots captured in both light and dark.

Checklist corrections made during the walk:

1. **Restored a check that had been weakened.** The source plan required *"is told why in a
   sentence — not shown a control that fails"*. When this file was first written that became only
   "the stored row does not change", which the app passes. The stricter line is back, and it FAILS
   — that weakening is what would have let the defect ship as "walked and green".
2. **Added the two notification lines**, and recorded that the seed as written cannot reach the
   positive one (one leader per organization, and the helper excludes the actor). Anyone re-walking
   should seed a second organization leader.

Not walked: every "needs a human eye" line, by design — those are the review questions. The state
of the ward was left dirty by this walk (an extra `yw-counselor` account and two extra activities);
re-seed before re-walking.

## Notes

- `/youth` is at `app/(app)/youth/`. There is a **separate** `app/(youth)/` in the codebase — that
  is the sacrament manager's PIN-only shell at `/sacrament`, a different feature for a different
  kind of account. They are unrelated.
- The navigation item for **Youth Activities** has existed since `auth-a` and pointed at a page
  that did not exist. If you walked an earlier scenario and found it 404, that is what this slice
  fixes.
