---
id: youth-activity-scope-read-wide-write-narrow
status: best-yet
commit: b941089
date: 2026-08-29
area: youth-activity-scope
related_retros: [youth-a-profiles-and-events, youth-e-overview-and-cross-navigation, youth-f-support-percentage-and-youth-cards]
supersedes: null
---

## What was tested

**Scenario 049 re-walked by an AGENT (Claude, via Playwright) against the hosted project, on
localhost:3000. The user reviewed the published walk report and answered all five judgement
questions.** No human drove the app.

Same evidence class as the `visits`, `visits-report-feed` and `youth-occasions` records, and
deliberately NOT the class of `role-access-overrides-confirmed`, where the user's own walk found a
step the agent had navigated straight past. First confirmation record for this area, so it
supersedes nothing.

The re-walk was prompted by `youth-a-D1`, the defect the 2026-08-27 walk of this scenario found:
Edit and Remove offered on every organization's activity.

**NOT verified:**

- **The deployed build — and it is BROKEN on the very page this scenario walks.** See the
  companion `deployed-build-2026-08-29` record: `/youth/profiles` server-renders event times in
  the server's zone, so production shows the wrong day until hydration corrects it. That is a
  rendering defect, not a permission one, and this record's subject is the permission model —
  but the two share a page and a reader should not have to discover that separately.
- **A real device.** 375px was a resized desktop viewport.
- **Dark mode** judged from screenshots only.
- **The two "with the server stopped" failure cases** were not simulated.
- **The `sacrament_manager` (PIN) account** was not walked against this page; it holds no
  `youth_activities` permission, so the expectation is a refusal, and that is untested here.

## Result

**`youth-a-D1` is fixed, and this walk is the confirmation.** `canManageActivityProfile()` now
mirrors migration 054d, and the controls appear on exactly the rows the policy permits:

| Signed in as | Varsity basketball (YM) | Chamber choir (YW) | Debate team (YW) | Community orchestra (ward-wide) |
|---|---|---|---|---|
| `ym-president` | Edit · Remove | — | — | — |
| `yw-president` | — | Edit · Remove | Edit · Remove | — |
| `bishop` | Edit · Remove | Edit · Remove | Edit · Remove | Edit · Remove |
| `council-member` (org_id null) | — | — | — | Edit · Remove (as its author) |

The mirror is what proves it is not an artifact of seed order. The council member reaches their row
through the `enteredBy` arm, not by a null `org_id` matching a null `org_id` — the null-equals-null
guard is holding.

**A hidden button is not a boundary, so the API was probed with the controls out of the picture:**

- As `ym-president`: `PATCH` and `DELETE` on *Chamber choir* → **404**, *"That activity could not be
  changed. It may belong to another organization. Reload and try again."*; `PATCH` on the ward-wide
  row → **404**; `PATCH` on its own *Varsity basketball* → **200**, so the 404s are a scope refusal
  rather than a dead route.
- As `yw-president`: the mirror on *Varsity basketball* → **404**; `POST` naming another
  organization's `orgId` → **403**, *"You can only enter activities for your own organization."*
- Service-client re-read after all of it: **4 rows**, names and `org_id` unchanged on every one.
  **No audit rows for the refused calls** — nothing happened, nothing recorded.
- `DELETE` was exercised across every row, not just one: as `yw-president`, deleting all six
  profiles then present returned **200 for her own three and 404 for the other three**.

**Other observed values:**

- The organization select is **absent**, not disabled, for `ym-president`, `yw-president` and
  `council-member`; present for `bishop` with **8 options**, defaulting to *The whole ward*.
- The `talks-d` hole stays closed. As `council-member`, adding *Ward youth service project* moved
  the heading **"Activities (4 activities)" → "(5 activities)" with no reload**; stored
  `org_id = null`, `entered_by = 7bc6d140…`.
- Audit: `youth_activity_profile_created`, module `youth_activities`, detail
  `{"orgId":null,"memberId":"f1792107…","profileId":"3ed58c9e…","activityType":"community"}` —
  ids only, no member name (rule 8).
- Notifications, both directions: the ward-wide profile emitted **zero**; adding a second Young
  Women leader and creating *Track and field* as `yw-president` emitted **exactly one**, to the
  counselor `3d70362b…` and **not** to the actor `30ce4b01…`.
- Grouping and plurals: Malia one heading, two cards, **"2 activities"**; Ethan **"1 activity"**.
- Past events: **"Schedule (3 upcoming events)"** by default with *Game against Jefferson* absent;
  **"Schedule (4 events)"** after **Show past events**.
- Layout at 375px: `scrollWidth === clientWidth` (360 = 360), zero elements past the viewport,
  **all 19 buttons ≥ 44×44**, no uuid in `main`. Desktop 1420px: no overflow.

**The user's five answers.** Four passed outright: the absence explains itself ("looks good"),
"Ward-wide" *"lands as a real state"*, the empty states explain, and 375px is legible in both
themes. The fifth passed and asked for more — *"the label makes it obvious. However it could be
more easily browsed for your own if the labels were colour coded. Maybe a filter to show only your
own organization's youth would be good too?"* — recorded as **ITER-029**, not built.

**Three checklist corrections**, because the app moved under the scenario in `youth-e`: every step
named `/youth` when the activity list is now at `/youth/profiles`; "press Edit on *Chamber choir*
and try to save" describes a state the app can no longer reach, which is precisely the fix; and the
human-eye question about the refusal message had nothing left to ask.

**Two things surfaced and deliberately not treated as defects:**

1. **Events have no ownership gate at all**, by design — `activity_events` has no `org_id` and
   keeps migration 019's ward-wide write policies. Verified rather than assumed: as `ym-president`,
   `PATCH` on the Young Women's *Winter concert* → **200**. The interface and the policy agree, so
   this is not `youth-a-D1` again. It remains a product asymmetry somebody should confirm is
   wanted: you cannot rename another presidency's activity, but you can cancel their concert.
2. **Six text links are 20px tall at 375px**, three of them the only route from this page to
   `/youth/events/[id]`. Every *button* passes 44×44, which is what the checklist line says.

The ward was **re-seeded at the end of the walk**, so the harness is clean — unlike the 2026-08-27
walk, which left it dirty.
