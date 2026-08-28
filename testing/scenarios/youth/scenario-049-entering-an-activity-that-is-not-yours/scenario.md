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
3. Sign in as `ym-president@…`. Open **/youth** from the sidebar.
4. Note which activities are listed and who each belongs to. Press **Edit** on *Chamber choir*
   (the Young Women's) and try to save a change.
5. Sign in as `yw-president@…` and do the mirror: try to edit *Varsity basketball*.
6. Sign in as `bishop@…`. Press **Add an activity** and look at the form.
7. Sign in as `council-member@…`. Press **Add an activity**, enter one for Ethan, and save.

## Verification Checklist

### Machine-checkable

- [ ] All four accounts see **all four** activities on `/youth`, grouped under three youth.
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

- [ ] When the Young Men president cannot save somebody else's activity, does the message **say
      why**, in a sentence a leader would understand — or does it read as the app breaking?
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
