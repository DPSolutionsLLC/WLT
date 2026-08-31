---
id: youth-followup-feed
status: best-yet
commit: 99af99f
date: 2026-08-29
area: youth-followup-feed
related_retros: [youth-d-followup-and-report-feed, youth-follow-up-controls, visits-c-report-feed-and-cross-org]
supersedes: null
---

## What was tested

**Scenarios 055 and 056 walked by an AGENT (Claude, via Playwright) against the hosted project on
2026-08-28, and BOTH re-walked on 2026-08-29 after the ITER-021 and ITER-022 fixes.** The user
reviewed the walk report and the judgement questions; two of them became defects. No human drove
the app.

**Record written 2026-08-30**, from the walkthrough records in the two scenario files and the
screenshots in `walk-youth-d/` and `testing/walk-screenshots/`. The walk happened on 2026-08-28
and 2026-08-29; only this confirmation record is late, for the reason given in
`youth-ics-import-2026-08-28.md`.

**Every value was read back with the SERVICE CLIENT.** The privacy boundary was probed from the
bishop's own authenticated session by four separate routes, not asserted from a policy reading.

### What was NOT verified

- **The deployed build was not opened during either walk.**
- **No real device.** 375px was a resized desktop viewport.
- **Dark mode was read from computed styles and screenshots**, not viewed by a person. Whether the
  private-note block reads as a box you can type into was put to the user as a judgement.
- **`yw-president`'s own session was not walked** — the policy's mirror image was proven from
  `ym-president`'s session and from the RLS suite.
- **Scenario 055's follow-up loop was not re-walked on 2026-08-29.** The ITER-022 re-walk was
  conducted against scenario 056's ward, because `/youth` renders one `FollowUpForm` per event and
  the checks are component-level. 055's steps 1–8 were walked in full on 2026-08-28 and the change
  does not touch them. **This is a real limitation and is recorded as one.**
- **Clearing a private note to delete it** was not re-walked; it is covered by
  `tests/routes/youthPrivateNote.test.ts`.
- **375px was not re-measured for scenario 056**, which renders the same components 055 measured.

## Result

**Scenario 055 — the follow-up. Every badge correct against the stored row.**

| Event | stored | past | attendee | own log | badge | control |
|---|---|---|---|---|---|---|
| Winter concert | upcoming | −5.74d | secretary, not president | none | **none** | **"Say how it went"** |
| Game against Jefferson | upcoming | −4.74d | president, confirmed | yes | Follow-up recorded | "Change what you wrote" |
| Game against Washington | **cancelled** | −3.74d | president | none | **none** | **absent** |
| Game against Roosevelt | upcoming | −2.74d | president | none | Waiting on your follow-up | "Say how it went" |
| Game against Madison | upcoming | +5.26d | president | none | Covered · 1 | absent |

- **Decision 5 is live.** *Winter concert* — an event the president was never down for — carries a
  **"Say how it went"** button. That is the button a `state !== "not_due"` gate would have hidden,
  and it is why `isFollowUpWritable()` was split out during the build.
- **Two requests, not one.** `POST /api/youth/logs` → 201, then `POST .../private-note` → 200. The
  log POST's body carried **no `loggedBy` and no private text**. Then all three keys refetched.
- **Written and read back.** `activity_logs` row created; `confirmed_attendance = true`;
  `activity_private_notes` gained the president's note. Editing to *I did not go* moved
  `updated_at` and set `confirmed_attendance = false`. **The unchanged private note was not
  re-saved** — one `private_note_saved` audit row, not two.
- **Audit carries ids and keys, never text.** `youth_activity_private_note_saved` →
  `{"activityLogId":"4e7e6750…"}` and nothing else.
- **One notification**, `youth_followup_submitted` → `ym-secretary`, body naming the activity and
  event only. The author was excluded.
- **The 409.** A second POST for the same event → *"You have already recorded a follow-up for this
  event."*, and `activity_logs` still held **1** row.
- **The feed.** Three tiles **newest report first**, deliberately not event-date order. Per-user
  read state: the president went 3 unread → 2 and wrote exactly one `report_read_status` row; the
  bishop then saw **3 unread**, unaffected.
- **The privacy boundary, from the bishop's own session.** He read the secretary's *shared* note
  and reached **neither** private note by any of four routes. `GET .../private-note` answered
  **`200 {"note":null}`**, not a 403 — the policy denies the row, so "not yours" and "none yet"
  are the same answer.
- **375px:** `scrollWidth 360 = clientWidth 360`. Every `<button>` >=44px; the only sub-44px
  targets were two inline prose links, the same pattern `/visits/feed` ships.

**Scenario 056 — the organization boundary. Migration 057c's contrast, read from each account's
own session with the setting OFF.**

| Reader | follow-ups visible | activities visible | events visible |
|---|---|---|---|
| `ym-president` (Young Men) | 2 | **3** | 3 |
| `ward-council` (**no org**) | **1** — their own, ward-wide | **3** | **3** |
| `bishop` | 3 | 3 | 3 |
| `exec-secretary` | **refused** — "Not permitted" | — | — |

That contrast is the decision in one line: the ward council member sees **every activity and every
event, and one follow-up**. The ward-wide activity (`org_id` null) is the branch that proves the
policy's LEFT JOIN and its explicit `profile.org_id is null` arm — without either, that row would
have been invisible to everybody but the bishopric.

- **The flag table, all four transitions**, verified in `activity_logs` and `notifications`:
  false→true stamps and notifies (1); true→true leaves both alone and logs `notified:false`;
  true→false **clears `flag_sent_at` to null**; false→true again re-stamps and notifies (2).
- **One recipient, and a pointer not a note.** Every notification went to `exec-secretary` and
  nobody else, with **no shared-note text and no youth's name**.
- **The recipient cannot open what they were told about.** As `exec-secretary`: `/youth/feed`
  "Not permitted"; three API routes **403**. That is what makes the body rule structural rather
  than remembered.
- **Cross-org visibility, both directions.** ON → `ward-council` saw all 3 tiles and the sentence
  changed. OFF → back to 1 tile. **Wider reads did not widen a write**: with it ON, `ward-council`
  PATCHed the Young Women's follow-up → **404**, all three `shared_notes` re-read unchanged.
- **`/visits/feed` survived the shared-helper move.** 12 tiles, dropdown first option **"Every
  organization"**, `authorLabel` **populated** — the seam working in both directions, since a
  youth tile's `authorLabel` is always null. Flagging a visit logged *No active executive
  secretary to notify* with `triggerKey: 'visit_flagged_for_ward_council'`, which proves the key
  is the caller's rather than hardcoded.

**Three defects found. Two fixed and re-walked; the third was in the harness.**

1. **"Say how it went" offered on another organization's event** (`ITER-021`). As `ym-president`
   the control appeared on a Young Women activity; saving was refused with a sentence and
   `activity_logs` stayed at 3 rows, so **RLS held and nothing leaked** — but the control should
   not have been offered. This is `youth-a-D1` / `visits-d` a **third** time, in the slice whose
   own plan quotes it by name. Fixed by `canWriteFollowUpOn()` mirroring migration 057c's INSERT
   policy, applied at **both** places the control is offered — `EventList` **and** `FollowUpPanel`.
   The panel is not named in ITER-021's scope file and had the defect too; fixing the card alone
   would have shipped the shape a fourth time. **The API was deliberately not narrowed** — the
   route's 403 is what still makes the refusal graceful if the two ever disagree (rule 2).
2. **"Did you go?" conveyed its answer by colour alone** (`ITER-022`). Neither button carried
   `aria-pressed`, `aria-checked`, or a role — a screen reader heard two identical buttons. Both
   now carry `aria-pressed` in **every** state including the unanswered one, and a sentence
   beneath always names the stored answer in words. Verified across all three states off the live
   DOM, and **an unsaved answer is discarded** — pressed *I did not go* on a row seeded `true`,
   reloaded without saving, read the row back: still `true`. No optimistic write.
3. **The harness's notification-trigger list had drifted.** The first flag stamped `flag_sent_at`,
   logged `notified: true`, and delivered **nothing** — `testing/infrastructure/seedUtils.ts` kept
   a third hand-maintained copy of the trigger keys with no row for
   `youth_activity_flagged_for_ward_council`. **Real wards were never affected** (migration 057d
   had inserted it for all 8), which is exactly what let it survive. Fixed in the harness during
   the walk; became **ITER-023**, closed 2026-08-28 by `b2b8aab` with a test that diffs all three
   sources from disk in both directions.

**The ITER-021 re-walk, 2026-08-29 — all three ownership shapes on one screen:**

| Event | Owning org | Control offered |
|---|---|---|
| *Food bank morning* | **null (ward-wide)** | **Say how it went** |
| *Winter concert* | **Young Women** | **none** ← the fixed line |
| *Game against Roosevelt* | Young Men, own log | **Change what you wrote** |

The ward-wide arm and the own-log arm are both present, so the fix narrowed exactly one case. The
panel half was checked too: *Winter concert* appears under *Waiting on your follow-up* with **zero
buttons** and a sentence explaining why. **The policy is still the boundary** — `POST
/api/youth/logs` from that session still answers **403**, and `activity_logs` stayed at 3 rows.

## Open, and raised by the walk rather than by a checklist

**The panel heading reads "Waiting on your follow-up (2)" and one of those two is an event this
reader may not write.** `followUpState()` computes `awaiting` from `(past, not cancelled,
isAttendee, no log)` and knows nothing about organization ownership, so the ownership gate removed
the BUTTON without changing the COUNT. Before the fix every listed row was actionable — wrongly,
since it 403'd — so the inconsistency is **newly visible rather than newly introduced**. Left as
found: the plan chose to show the row with a sentence rather than hide it, and whether the count
should follow the button is a product decision, not a bug to patch mid-walk.

Two structurally unreachable checks were rewritten rather than ticked: the flag control on a
follow-up the reader could not write (the form only opens on the reader's own), and
`/visits/feed` notifying (scenario 041's ward has no executive secretary).

## What would move this to confirmed

Working the follow-up loop by hand on the deployed build, as two different accounts, and reading
the private-note block on a real phone in dark mode — the one judgement the user answered from a
screenshot rather than a screen. Scenario 055's own follow-up loop should also be re-walked in its
own ward, since the 2026-08-29 pass borrowed 056's.
