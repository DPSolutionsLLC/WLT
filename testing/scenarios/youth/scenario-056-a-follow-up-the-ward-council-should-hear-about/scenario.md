---
name: A follow-up the ward council should hear about
scope: youth
part: 6
tags: [youth, full, rls, notifications, cross-org]
prerequisites: none
---

## Purpose

The flag path, and **decision 1's boundary from an account that is on the wrong side of it**.

Migration 057 makes `activity_logs` the **one read Phase 8 narrows**: a follow-up is visible to
its own organization, to the bishopric, to whoever wrote it, and to everybody when the ward has
cross-organization visibility on. The activity **calendar** stays ward-wide, so a leader can see
every organization's games and only some organizations' follow-ups. That is deliberate, and it is
the kind of thing a person calls a bug unless the page says otherwise.

`tests/rls/activity-logs.test.ts` proves the policy on both sides of the setting.
`tests/routes/youthLogs.test.ts` proves all three rows of the flag transition. What neither can
answer is **whether the sentence explaining the narrowing is one a leader accepts**, and whether
the flag confirmation makes clear the executive secretary receives a *pointer* rather than the
note.

Seeding matters because the state — three ownership shapes, five accounts, an executive secretary
who holds no youth permission, and a ward setting toggled mid-walk — is tedious to build by hand
and easy to build wrongly.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, **`cross_org_visibility: false`** |
| Users | `bishop@…`, `exec-secretary@…` (**holds no `youth_activities` permission at all**), `ym-president@…` (Young Men), `yw-president@…` (Young Women), `ward-council@…` (**no organization**) |
| Households | Brooks, Chen |
| Members | 2 youth — Ethan Brooks (Young Men), Ava Chen (Young Women) |
| Activity profiles | 3 — *Varsity basketball* (Young Men), *Concert choir* (Young Women), ***Stake service project* (`org_id` null — ward-wide)** |
| Events | 3, all in the past (−3, −4, −5 days) |
| Attendees | 3, each the author of the follow-up beneath it, all `confirmed_attendance: true` |
| Follow-ups | 3, one per activity, each with shared notes |

Who should see what on `/youth/feed`, **with the setting off**:

| Reader | Basketball | Choir | Service project (ward-wide) |
|---|---|---|---|
| `ym-president` | ✓ | ✗ | ✓ |
| `yw-president` | ✗ | ✓ | ✓ |
| `ward-council` (no org) | ✗ | ✗ | ✓ (**and it is theirs**) |
| `bishop` | ✓ | ✓ | ✓ |

**Sign in with:** `ym-president@harness.wardleadershiptools.test` first.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-056-a-follow-up-the-ward-council-should-hear-about`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `ym-president@…` and open **/youth/feed**. Read the sentence under the heading
   **before** counting the tiles, then count them.
4. Open **/youth**, press **Show past events**, find *Game against Roosevelt* and press **Change
   what you wrote**. Tick **Ask for this to go on the ward council agenda** and save. Read the
   sentence beside the control before you tick it.
5. Sign in as `exec-secretary@…`. The bell in the header is a Phase 11 placeholder, so read the
   `notifications` table filtered to
   `trigger_key = 'youth_activity_flagged_for_ward_council'`. Then try to open `/youth` and
   `/youth/feed` as this account.
6. Sign in as `ward-council@…`, open **/youth/feed**, and read the sentence and the tiles.
7. Sign in as `yw-president@…` and do the same.
8. **Turn cross-organization visibility on.** There is no admin screen for it yet, so in Supabase
   set `wards.settings` `cross_org_visibility` to `true` for the Harness Test Ward — **merge the
   key, do not replace the object**, or you will delete `timezone` with it.
9. Revisit `/youth/feed` as `ym-president@…`, `yw-president@…` and `ward-council@…`. Read the
   sentence again.
10. Back as `ym-president@…`, **untick** the ward council box, save, then tick it again and save.
    Read the `notifications` table after each.
11. Open **/visits/feed** and confirm it still works: the tiles render, the dropdown reads
    *Every organization*, and flagging a visit still notifies the executive secretary.
12. Read every page at 375px, in both themes.

## Verification Checklist

### Machine-checkable

- [ ] With the setting **off**, `ym-president` sees **two** tiles: *Game against Roosevelt* and
      *Food bank morning* (the ward-wide one). **Not** *Winter concert*.
- [ ] `yw-president` sees *Winter concert* and *Food bank morning*, and **not** *Game against
      Roosevelt*.
- [ ] `ward-council` (no organization) sees **only** *Food bank morning* — the ward-wide one, which
      is also theirs — and the page **says in words** why the others are not there.
- [ ] The bishop sees **all three**.
- [ ] Every reader still sees **all three activities** on `/youth` and `/youth/calendar`. The
      calendar is ward-wide and slice D did not narrow it.
- [ ] The filter dropdown offers only the activities that **have** a follow-up this reader can see —
      not every activity in the ward.
- [ ] Flagging emits **exactly one** notification, and its `recipient_user_id` is the executive
      secretary's. Nobody else — not the bishop, not the Young Men presidency.
- [ ] The notification body is the one-liner: the activity, the event, and *"requested for ward
      council discussion"*. It contains **no** shared-note text and no youth's name.
- [ ] `exec-secretary@…` opening `/youth` or `/youth/feed` gets the "not permitted" page — they
      hold **no** `youth_activities` permission, so they cannot read the follow-up they were told
      about. That is the design, not a gap.
- [ ] **Unflagging clears `flag_sent_at`** (check the `activity_logs` row), and the next flag
      notifies **again**.
- [ ] **Flagging twice without unflagging notifies once.** Re-tick and save on an already-flagged
      follow-up and confirm the notification count does not move.
- [ ] **"Say how it went" is absent on another organization's event.** *Currently FAILS — see the
      walkthrough record.* As `ym-president`, `/youth` → Show past events offers the control on
      *Winter concert*, which belongs to the Young Women; saving is then refused with a sentence.
      Nothing is written and RLS holds, but the control should not have been offered. This is
      `youth-a-D1` / `visits-d` a third time.
- [ ] The **ward-council flag** control is absent on a follow-up the reader could not write.
      CORRECTED 2026-08-28: this is **structurally unreachable from `/youth` today** — the form only
      ever opens on the reader's own follow-up or a new one, so `canFlag` cannot currently be false
      there. The gate (`canManageActivityLog`, mirroring migration 057c's UPDATE policy) exists for
      a later screen that shows somebody else's follow-up. Recorded rather than ticked, because a
      check that cannot fail is decoration.
- [ ] With the setting **on**, both presidents and the ward council member see **all three**, and
      the sentence under the heading **changes** to say so.
- [ ] With the setting **on**, `ym-president` still **cannot edit** the Young Women's follow-up —
      wider reads do not widen a write by one row. The **Change what you wrote** control is absent
      on it.
- [ ] **`/visits/feed` still works** after the shared helper moved beneath it: tiles render, the
      dropdown's first option still reads *Every organization*, and `authorLabel` is still
      populated (a visit knows who went; a youth follow-up does not).
      **Check this against a ward that has visits** — scenario 056's ward seeds none, so run
      `npm run seed -- visits/scenario-041-the-feed-and-read-state` for this line alone.
      CORRECTED 2026-08-28: this line also asked to confirm the visits flag still **notifies**.
      Scenario 041's ward has **no executive secretary**, so the correct behaviour there is that
      nothing is sent — which is the no-fallback rule, not a failure. What is observable instead is
      the server log line `No active executive secretary to notify about a flagged record` carrying
      `triggerKey: 'visit_flagged_for_ward_council'` — that message comes only from the shared
      helper, and the key proves it is not hardcoded.
- [ ] `audit_log` holds `youth_activity_flagged` and `youth_activity_unflagged` rows, and neither
      `detail` contains note text.
- [ ] No horizontal overflow at 375px. Every button is at least 44×44.

### Needs a human eye

- [ ] **This is the decision-1 question.** Is *"Follow-ups are visible to their own organization's
      leaders, to the bishopric, and to whoever wrote them. The activity calendar itself stays open
      to everybody."* a sentence a leader **accepts** — or does it read as the app being broken?
      If it reads as broken, the fix is a product decision about the setting, never a role branch
      in a policy.
- [ ] For the **ward council member** specifically: they can see every activity and one follow-up.
      Does the page make that feel like a rule, or like a failure?
- [ ] Does the flag confirmation make clear the executive secretary receives a **pointer**, not the
      note? `visits-c` found a silent star inviting the reader to wonder whether they had summoned
      somebody.
- [ ] Is the difference between the **star** (a private bookmark, nobody notified) and the **ward
      council checkbox** (a person is notified) obvious on the screen, or do they read as two
      versions of the same thing?
- [ ] When the setting is turned **on**, does the changed sentence read as an explanation of what
      just happened, or does a reader have to notice the tile count changed to work it out?
- [ ] Does *"Youth activity follow-up flagged for ward council"* read sensibly to somebody who
      cannot open the record it names?
- [ ] Legible one-handed at 375px, in both light and dark mode?

## Failure Behavior

- [ ] Filing a follow-up against another organization's event is refused with *"That event belongs
      to another organization…"* — a 403 with a sentence, not a 500.
  Automated: `tests/routes/youthLogs.test.ts` → *"answers 403 with a sentence for another
  organization's event"*.
- [ ] Editing another organization's follow-up through the API is refused and **changes nothing** —
      re-read the row rather than trusting the response, because an RLS-denied UPDATE is a zero-row
      success.
  Automated: `tests/rls/activity-logs.test.ts`.
- [ ] A ward with **no executive secretary** gets no notification rather than a fallback to the
      bishopric. Deactivate `exec-secretary@…` in Supabase, flag something, and confirm the
      `notifications` table gains nothing.
  Automated: `tests/lib/wardCouncilFlag.test.ts` → *"emits nothing for a ward with no executive
  secretary, and does not fall back"*.
- [ ] Filtering to an activity with no follow-ups shows *"Nothing from ⟨activity⟩ yet."* rather
      than an empty page.

## Walkthrough record

**2026-08-28 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every value below was read back with the SERVICE CLIENT. `now = 2026-08-28T18:56:59Z`; the three
events sat at −4.75d, −3.75d and −2.75d.

**Decision 1's boundary, with the setting OFF**, read from each account's own session:

| Reader | follow-ups visible | activities visible | events visible |
|---|---|---|---|
| `ym-president` (Young Men) | 2 — *Game against Roosevelt*, *Food bank morning* | **3** | 3 |
| `ward-council` (**no org**) | **1** — *Food bank morning* (their own, ward-wide) | **3** | **3** |
| `bishop` | 3 | 3 | 3 |
| `exec-secretary` | **refused** — "Not permitted" | — | — |

That contrast is the decision in one line: the ward council member sees **every activity and every
event, and one follow-up**. The ward-wide activity (`org_id` null) is the branch that proves the
policy's LEFT JOIN and its explicit `profile.org_id is null` arm — without either, that row would
have been invisible to everybody but the bishopric.

- **The filter follows the reader.** `ym-president`'s dropdown offered *Every activity / Stake
  service project / Varsity basketball* — **not** Concert choir. `ward-council` got **no dropdown
  at all**, correctly: one context, and `showFilter` needs two.
- **The flag table, all three rows**, verified in `activity_logs` and `notifications`:

  | Transition | `flag_sent_at` | notifications | audit |
  |---|---|---|---|
  | false→true, sent NULL | stamped 19:04:16.752+00 | **1** | `youth_activity_flagged`, `notified:true` |
  | true→true (re-flag) | unchanged | **still 1** | `youth_activity_followup_updated`, `notified:false` |
  | true→false (unflag) | **cleared to null** | still 1 | `youth_activity_unflagged` |
  | false→true again | re-stamped 19:04:43.236+00 | **2** | `youth_activity_flagged`, `notified:true` |

- **One recipient, and a pointer not a note.** Every notification went to `exec-secretary`
  (`executive_secretary`) and nobody else. Title *"Youth activity follow-up flagged for ward
  council"*; body *"Varsity basketball — Game against Roosevelt — requested for ward council
  discussion"* — no shared-note text, no youth's name.
- **The recipient cannot open what they were told about.** As `exec-secretary`: `/youth/feed`
  rendered "Not permitted"; `/api/youth/feed`, `/api/youth/logs` and
  `/api/youth/logs/{id}/private-note` all returned **403**. That is what makes the body rule
  structural rather than remembered.
- **Cross-org visibility, both directions.** ON → `ward-council` saw all 3 tiles, the dropdown
  appeared, and the sentence changed to *"Every organization's leaders can read every
  organization's activity follow-ups."* OFF → back to 1 tile and the original sentence.
- **Wider reads did not widen a write.** With the setting ON, `ward-council` PATCHed the Young
  Women's follow-up → **404**, and all three `shared_notes` were re-read unchanged.
- **`/visits/feed` survived the shared-helper move.** Checked against
  `visits/scenario-041-the-feed-and-read-state`: 12 tiles, dropdown first option **"Every
  organization"**, and `authorLabel: "Miguel Cortez"` **populated** — the seam working in both
  directions, since a youth tile's `authorLabel` is always null. Flagging a visit stamped
  `flag_sent_at` and sent nothing, correctly: that ward has no executive secretary, and the server
  logged `No active executive secretary to notify about a flagged record` with
  `triggerKey: 'visit_flagged_for_ward_council'`. That message comes only from the shared helper,
  and the key proves it is the caller's rather than hardcoded.

**Two defects found, not fixed** — see the review page:

1. **"Say how it went" is offered on another organization's event.** As `ym-president`, the control
   appears on *Winter concert* (a Young Women activity). Typing a note and saving is refused with
   *"That event belongs to another organization. You can record a follow-up on your own
   organization's activities, and on ward-wide ones."* — `activity_logs` stayed at 3 rows, so RLS
   held and nothing leaked. But the control should not have been offered: this is
   `youth-a-D1` / `visits-d` a third time, and the plan quotes it by name. The `canFlag` gate got
   the ownership mirror; the follow-up control itself did not.
2. **The harness's notification-trigger list had drifted.** The first flag stamped `flag_sent_at`,
   wrote `notified: true`, and delivered **nothing** — `testing/infrastructure/seedUtils.ts` keeps a
   THIRD hand-maintained copy of the trigger keys and had no row for
   `youth_activity_flagged_for_ward_council`. **Real wards were never affected** (migration 057d had
   inserted it for all 8). Fixed in the harness during the walk, because it made this scenario's
   central check unverifiable; the four `program_*` keys are **still missing** from that list and
   are left for the program slice to decide on.

Corrections made to this file during the walk:

1. **"The flag control is absent on a follow-up the reader could not write"** is structurally
   unreachable from `/youth` — the form only opens on the reader's own follow-up. Recorded as such
   rather than ticked; a check that cannot fail is decoration.
2. **"`/visits/feed` … still notifies"** cannot be observed in scenario 041's ward, which has no
   executive secretary. The line now names what *is* observable — the shared helper's warn-and-
   return log line and its trigger key — and says which scenario to seed for the visits half.

Not walked: every "needs a human eye" line — those are the review questions, with screenshots in
`walk-youth-d/`. Also not walked: `yw-president`'s own session, because the policy's mirror image
was already proven from `ym-president`'s and from the RLS suite; and 375px for this scenario, which
renders the same components 055 measured.

## Notes

- **There is no admin UI for cross-organization visibility on the youth side**, and there is not
  meant to be one in this slice. `/api/ward-settings/cross-org-visibility` exists and is gated on
  `visits.view`; step 8 changes the row directly because that is the honest instruction.
- **Merge the settings key, never replace the object.** `wards.settings` also holds `timezone` and
  may hold `role_access` and `home_venues`; overwriting it would delete them and produce failures
  a long way from their cause. `lib/ward/crossOrgVisibility.ts` states the same rule for the code
  path.
- **Why the executive secretary holds no youth permission.** It is what makes "the body carries no
  note text" structurally true rather than a rule somebody has to remember. If that role is ever
  given `youth_activities.view`, this scenario's assertions get weaker and the notification rule
  becomes a promise rather than a fact.
- **Phase 9 inherits the other half.** A flagged follow-up notifies the executive secretary today
  and lands on nothing — there is no ward council agenda screen yet. That is the same shape
  `visits-a` left, and it is not a gap this slice closes.
