---
id: youth-occasions-event-detail
status: best-yet
commit: 43a10c9
date: 2026-08-29
area: youth-occasions
related_retros: [youth-g-occasions-and-event-detail, youth-e-overview-and-cross-navigation, youth-f-support-percentage-and-youth-cards, youth-c-coverage-and-calendar]
supersedes: null
---

## What was tested

**Scenario 059 walked by an AGENT (Claude, via Playwright) against the hosted project, on
localhost:3000. The user reviewed the published walk report, answered four judgement questions,
and directed one code change from them.** No human drove the app.

That is deliberately the same evidence class as the `visits` and `visits-report-feed` records, and
deliberately NOT the class of `role-access-overrides-confirmed`, where the user's own walk found a
step the agent's walk had navigated straight past. This is the first confirmation record for this
area, so it supersedes nothing.

**Every write was read back with the SERVICE CLIENT**, not trusted from the screen — an optimistic
update and a successful save look identical until you reload.

Twenty-five machine-checkable items were driven through the real UI and verified against the
database. Four judgement items were captured as screenshots and put to the user rather than
self-assessed.

### What was NOT verified

- **The deployed build has not been opened.** Everything below is localhost against the hosted
  database. The commit is pushed (`ae86deb`) and Vercel deploys from `main`, so the live page is
  untested by anybody.
- **No real device.** 375px was a resized desktop Chrome viewport. Tap targets were measured
  geometrically, not thumbed.
- **Dark mode was read from computed styles and screenshots**, not viewed by a person on a real
  screen. The user answered "a panel" from the screenshot.
- **Two failure-behaviour checks were not simulated**: joining with the dev server stopped
  mid-tap, and the page with `/api/youth/attendees` failing.
- **The "`away` is never copied onto a new row" case was not driven in the browser.** It is pinned
  by `tests/routes/youthEvents.test.ts` against the hosted project as a genuinely authenticated
  user, which is real evidence — but it is a route test, not a walk.
- **Only one reader role was walked through the full flow** (`org_president`). The bishopric path
  was not walked; `org_secretary` was checked for the permission gate only.
- **The ICS import was not re-run** against an occasion. Nothing should link or unlink on
  re-import, and that is asserted by construction rather than observed.

## Result

**What is working, with observed values rather than ticks.**

| Check | Observed |
|---|---|
| Before the join | two separate Roosevelt cards, marker `null` on both |
| Card titles link out | 5 / 5 → `/youth/events/<id>` |
| Join picker bound to the day | 3 options; the +10.1d Jefferson game absent; the viewed event absent |
| Join creates one occasion | occasion count 1 → 2; both rows `a706cd89`; audit `created: true` |
| Occasion badge, one covered + one not | `Nobody going` — the alert, not `Covered` |
| "I'll go" moves the banner | → `Covered · 1`, `navigationCount` still 1 (no reload) |
| Attendee row shape | `assigned_by` null (self-add) |
| Cross-org add by the Young Men president | 201; Ava's row `org=1a5` (Young Women); occasion count still 2 |
| New row classified from its own location | audit `eventTypeSource: "classified_from_location"`; `event_type=home` |
| Hand-added row is not a feed row | `calendar_id` null, `source_uid` null, no chip; the two imports keep theirs |
| Marker across the calendar | all 3 occasion cards `+2 others at this game` |
| **Filtered to Ethan alone** | 3 cards rendered, **his card still `+2 others at this game`** |
| Cards with no occasion | no marker element at all — never `+0 others` |
| Singular | `+1 other at this game` after unlinking to two rows |
| Past occasion | renders in full at −5.9d, both rows, no coverage badges |
| **Unlink deletes the occasion** | occasion gone; **both** Madison rows `occasion_id: null`; audit `occasionRemoved: true` |
| Nothing cascaded | 8 events before and after, throughout |
| Re-join | restored as a new occasion `c038bd70` |
| Three refusals, each re-read after | 409 same-occasion · 409 different-occasions (**neither row moved**) · 400 self |
| Unknown event id | 404 |
| Permission gate, both directions | `org_secretary`: 0 build controls rendered, rows and "I'll go" still present, `DELETE …/occasion` → **403** |
| Empty picker | renders a sentence naming the alternative, not an empty control |

**The migration 046/047 regression is proved end to end for the first time.** A bare
`on delete set null` on a composite key nulls `ward_id` too, which is `not null`, so the cascade
raises and the parent becomes undeletable — migration 046 shipped exactly that. Here, deleting an
occasion through the UI did not raise, left both games standing, and took nothing with it.

**Three defects were found that 3262 passing tests could not see. All three are fixed and
re-verified in the same session.**

1. **375px horizontal overflow** — `scrollWidth 393` vs `clientWidth 360`. A `<select>` sizes to
   its widest option; `min-w-0` is the actual fix, because a flex item's default
   `min-width: auto` refuses to shrink below its content. `/youth/calendar` measured `360 = 360`
   at the same width, which isolated it to this slice. **Re-measured after the fix: 360 = 360,
   zero offending elements**, with the longer labels from defect 3 in place.
2. **"One of these young people has nobody going" on a group of one** — reproduced on *Track time
   trial* (1 row, +2.9d, uncovered), above a card already carrying the identical badge. Fixed by
   hiding the whole panel below two rows, not just the sentence. **Re-verified: no panel, no
   plural sentence, "Nobody going" appearing exactly once; the two-row banner unchanged.**
3. **The picker option omitted the event's title** — `4:00 PM · Ethan Brooks · Varsity basketball`
   was in fact *Track time trial*. Raised as a judgement call; **the user decided the title should
   be there.** Options now carry all four facts.

**The user's answer to judgement question 1 changed a future scope.** They approved the two-badge
banner and named what it is for: alerting a leader committed to one young person that **another
young person at the same event has nobody committed to them** — the trigger being the coverage gap,
not mere presence. That is materially narrower than what ITER-027 had written, and is recorded in
`.iterate/scopes/ITER-027.md` along with the constraints it implies.

## What would move this to confirmed

Opening the deployed build and working the flow by hand: join two rows, watch the banner, add a
young person from another organization, and read the page on a real phone in dark mode. The
`role-access` precedent is the reason this matters rather than being a formality — the user's own
walk there found a correct behaviour the agent had never navigated to.
