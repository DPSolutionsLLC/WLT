---
name: Topics finalize, and what un-finalizes it
scope: p4-sacrament-b
part: 2
tags: [talks, sacrament, music, full, finalize, permissions]
prerequisites: none
---

## Purpose

`sundays.topics_finalized_at` says a member of the bishopric decided what a Sunday's talks are
**about**. Two things about it are worth a human's attention and neither can be reached by a test.

**The auto-unfinalize rule is the sharpest edge in the slice**, and it is near-impossible to set
up by hand: it needs a Sunday that is *already* finalized, carrying speakers at several pipeline
stages, so that advancing one of them can be seen **not** to clear the stamp. Getting it backwards
is not a visible bug — it is a month of finalized topics quietly coming undone as speakers are
contacted, with nothing anywhere saying why.

**And the whole point of the flag is a screen somebody else is looking at.** The conductor presses
it on `/sacrament` or `/assignments/[id]`; the person it is *for* is the music coordinator, on
`/music`, who never presses anything. Whether that hand-off actually reads as intended — dimmed,
`Topics pending` instead of a completion count, and still clickable — is a judgement about the
page, not an assertion about a column.

The rule itself is already proved. `tests/lib/topicsFinalize.test.ts` covers every field of the
assignment patch in both directions, `tests/routes/topics-finalized.test.ts` drives the real
handlers against the hosted project, and `tests/rls/topics-finalized.test.ts` covers ward
isolation and the role refusal. What is left is what those cannot see.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Peter Nakamura) — shared bishopric authority |
| | `music` (music_coordinator, Hannah Restrepo) — holds `talks.view` and **not** `topics.view` |
| Members | Sarah Whitfield, Andre Bell, Claire Bennett |
| Topics | 6, all active, all never assigned |
| Sundays | **2027-11-07** — **FINALIZED** (stamped 2027-10-05), 3 topics, 3 speakers, all at `approve` |
| | **2027-11-14** — **FINALIZED** (same stamp), 3 topics, **nobody** in any slot |
| | **2027-11-21** — **not finalized**, 2 topics of 3 |
| Hymns | 2 of 3 on every Sunday, so `/music` has a real completion pill for `Topics pending` to replace |

**Sign in with:** `bishop@`, `counselor1@`, `music@` — all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-073-topics-finalize-and-unfinalize`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open `/sacrament?month=2027-11` and read the three cards before touching
   anything.
4. Look at the row of shortcuts under the heading. Press **Topics**.
5. On `/talks/topics`, read the **Recently used** panel at the top, then scroll to **Suggested
   topics** at the bottom and confirm the candidate queue is still there.
6. Go back to `/sacrament?month=2027-11`. On **11-21**, press the checkmark beside the Topics pill.
7. Open `/music?sunday=<the 11-21 id>` — or just `/music` and scroll to 21 November.
8. Go back to `/sacrament?month=2027-11` and press the checkmark on 11-21 again, turning it off.
9. Open `/assignments/<the 11-07 id>` — the Topics pill on that card goes there.
10. Read the **topics decided** panel near the top. Note the date it names.
11. Press **Move to Requested** on the first assignment, then work it forward one more stage.
12. Go back to `/sacrament?month=2027-11` and look at 11-07.
13. Return to `/assignments/<the 11-07 id>`. Press **Edit** on the second assignment, change its
    **topic** to a different one, and save.
14. Go back to `/sacrament?month=2027-11` and look at 11-07 again.
15. Open `/music` and find 7 November.
16. Open `/calendar/sunday/<the 11-14 id>` — reached from the conducting name on that card. Change
    **speaking slots** from 3 to 4 and save, confirming any warning.
17. Go back to `/sacrament?month=2027-11` and look at 11-14.
18. On 11-14, press the checkmark to finalize it again. Then open
    `/assignments/<the 11-14 id>` and read the panel.
19. Press the panel's own button to un-finalize, then go back to `/sacrament?month=2027-11`.
20. Sign out. Sign in as `counselor1`, open `/sacrament?month=2027-11`, and finalize 11-14 from the
    pill. Then open `/assignments/<the 11-14 id>`.
21. Sign out. Sign in as `music`. Open the dashboard and read the whole grid.
22. Open `/sacrament?month=2027-11` and read a card.
23. Open `/music` and read all three November Sundays. Press one of the dimmed cards.
24. Try `/talks/topics` directly in the address bar.
25. In the Supabase dashboard, read `topics_finalized_at` on the three Sundays, and read
    `audit_log` for this ward filtered to `sunday_topics_finalized` and `sunday_topics_unfinalized`.

## Verification Checklist

The shortcut row — b1

- [ ] `/sacrament` carries a row of module shortcuts **under the heading and above the calendar**
- [ ] It includes **Topics**, and each link shows the destination's own dashboard tile icon
- [ ] Step 4 lands on `/talks/topics` — it is not refused, and nothing 404s
- [ ] Step 5: the **AI candidate queue is still reachable** on that page. This is the CLAUDE.md
      rule 3 check and it is the one that must not be lost — if the queue is gone, stop and say so
- [ ] The **dashboard has no Topics tile** for the bishop. Check the grid, not just the row
- [ ] Every shortcut clears 44×44 and the row wraps rather than scrolling sideways at 375px

Finalizing, from the pill

- [ ] Before step 6, 11-21's Topics pill reads **2/3** with an **unfilled** checkmark beside it
- [ ] The checkmark is a **separate control from the pill**: pressing the pill opens
      `/assignments/[id]`, pressing the checkmark does not navigate at all
- [ ] After step 6 the checkmark is filled, and nothing else on the card moved
- [ ] Step 7: 11-21 on `/music` is **no longer dimmed** and shows its **completion pill**
- [ ] Step 8 turns it back off, and `/music` returns to `Topics pending`

`Topics pending` on `/music` — the hand-off this flag exists for

- [ ] An un-finalized Sunday's card is **dimmed**, and the completion pill is **REPLACED** by a
      single `Topics pending` — the two must not appear side by side
- [ ] A finalized Sunday's card is **not dimmed** and shows `2/3 chosen`
- [ ] Step 23: a dimmed card is **still clickable** and opens fully. Everything inside it works —
      a coordinator who wants to get ahead may. Dimmed, never disabled
- [ ] The dimming is legible in **both themes** — not so faint it reads as a rendering fault

⚠️ The auto-unfinalize rule — the sharpest check here

- [ ] Step 10: the panel names **5 October 2027**, the date it was actually finalized
- [ ] **Step 12: 11-07 is STILL FINALIZED after advancing a speaker.** The checkmark is still
      filled. If it cleared, that is the defect this scenario exists for — stop and say so
- [ ] Step 15: 11-07 on `/music` is still **not dimmed** after that speaker moved
- [ ] **Step 14: 11-07 is NO LONGER finalized after a topic changed.** The checkmark is empty
- [ ] Step 15 again after step 14: 11-07 on `/music` now reads `Topics pending`
- [ ] **Step 17: 11-14 is no longer finalized after the speaking slots changed**
- [ ] Nothing anywhere asked you to confirm the un-finalize, and no error appeared — it is a
      consequence of the edit, not a second decision

Finalize does not depend on speakers

- [ ] 11-14 starts **finalized with nobody speaking**: `Topics 3/3` filled, `Talks 0/3` empty
- [ ] That is presented as a normal state, not as a warning or a half-finished one
- [ ] Nothing anywhere refuses to finalize a Sunday because it has no speakers

One fact, two places

- [ ] Step 18: finalizing from the **pill** shows up on the **panel** at `/assignments/[id]`
- [ ] Step 19: un-finalizing from the **panel** shows up on the **pill** back at `/sacrament`
- [ ] The panel and the pill never disagree, even briefly, after a page loads
- [ ] Step 20: `counselor1` can do everything the bishop can, from both places

The music coordinator — the role this is all for

- [ ] Step 21: **no Topics tile** on their dashboard (there is none for anybody now)
- [ ] Step 22: they see the Sunday cards and the Topics pill, and **no checkmark anywhere**. It is
      **absent**, not greyed out and not disabled
- [ ] **No Topics shortcut** in the row under the heading — they hold `talks.view` and not
      `topics.view`, so the link must not be offered and then refused
- [ ] Step 23: they read `Topics pending` and the dimmed cards perfectly well
- [ ] Step 24: `/talks/topics` typed directly gives a **"Not permitted"** page, not an empty
      library — an empty library is a different and misleading claim

Recently used — b3

- [ ] The panel is at the **top** of `/talks/topics`, above the library
- [ ] Each row shows a **date, a topic and a speaker**
- [ ] A slot with a topic and nobody in it reads **"no speaker yet"**, never "None"
- [ ] ⚠️ **The NOVEMBER 2027 Sundays are deliberately NOT in this list.** The window is
      RECENT_MONTHS either side of TODAY, and they are far outside it. The list is fed by the four
      Sundays the seed places near today — this check was originally written the other way round
      and **could not pass at any time** (corrected 2026-09-23 by walking it)
- [ ] The **upcoming** near-today Sunday carries a **"Coming up"** mark, and the three past ones
      do not
- [ ] The count sentence is correctly pluralised. With one row it must read **"One talk…"**, a
      word and not "1 talk" — reachable by clearing the topic on all but one in-window assignment
- [ ] Dates are in order, most recent first, and do not jump around between reloads
- [ ] The panel does not repeat the library's own "Used recently" badge as though it were the same
      thing

The record

- [ ] Step 25: `topics_finalized_at` on the three Sundays matches what the screens said
- [ ] Every finalize and un-finalize you did wrote an audit row, and the **action names which way
      it went** — `sunday_topics_finalized` vs `sunday_topics_unfinalized`, never one row with a
      boolean in its detail
- [ ] ⚠️ **Idempotence is NOT reachable by pressing the control twice** — it is a TOGGLE, so the
      second press un-finalizes. Corrected 2026-09-23 by walking it. The guarantee is real and is
      asserted in `tests/routes/topics-finalized.test.ts` ("does not move the stamp when finalized
      twice"); it can only be exercised by hand by sending two `{ "finalized": true }` PATCHes.
      What IS checkable here: the **audit log shows a repeated finalize carrying one unchanged
      stamp**, which is the same guarantee read from the other side
- [ ] **No `topics_finalized_by` column exists.** Migration 069 is why, and the audit row is where
      "who" lives

Mobile and theme

- [ ] Every screen works at **375px** in both themes
- [ ] The Topics pill and its checkmark stay on one line together and do not overlap
- [ ] The `Topics pending` pill is legible against a dimmed card in both themes
- [ ] No raw uuid appears anywhere

## Failure Behavior

**Automated where it can be**, and that is most of the rule:

| Check | Test |
|---|---|
| Every field of the assignment patch, both directions, with every pipeline stage asserted non-triggering | `tests/lib/topicsFinalize.test.ts` |
| All three write paths actually call the helper — read out of the source | same file, "the three write paths all clear the stamp" |
| Advancing a speaker leaves a finalized Sunday finalized, against the real database | `tests/routes/topics-finalized.test.ts`, "SURVIVES a speaker being advanced" |
| A topic change, a topic clear, a new assignment and a slot-count change each clear it | same file, the four "CLEARS" cases |
| Finalizing twice does not move the stamp | same file, "does not move the stamp when finalized twice" |
| Ward isolation on the column; an org secretary and a music coordinator refused by the route | `tests/rls/topics-finalized.test.ts` |
| The checkmark is a sibling of the pill anchor, absent without `topics.manage` | `tests/components/sacrament/SundayCard.test.tsx` |
| Topics off the dashboard, present in the shortcut row, withheld from a music coordinator | `tests/lib/navigation.test.ts` |
| Ordering, the external-speaker fallback, the upcoming flag and the window | `tests/lib/recentTopicUsage.test.ts` |

What is left for a human is the part that is a **product judgement**: whether a dimmed card reads
as "somebody else is still deciding" rather than as "this failed to load"; whether the checkmark
beside a pill is discoverable at all without being told it is there; whether the panel's sentence
explains what finalizing is *for*; and whether the Recently used list is the thing a conductor
actually wanted when they asked for it.

## Walkthrough record

**Walked 2026-09-23, AGENT-DRIVEN** through a real browser (Playwright MCP) against the hosted
project, with every write read back through the service-role client. Screenshots in `.walk073/`
(git-excluded). **The human-judgement items were NOT confirmed by a person in this pass** — they
were captured and handed over; this record is agent evidence plus a screenshot review, not a
person using the app.

**Observed values:**

- Seed: 11-07 and 11-14 both stamped `2027-10-05T17:30:00+00:00`; 11-21 null. 8 assignments.
- Bishop's dashboard: **13 tiles, none `/talks/topics`.**
- Shortcut row on `/sacrament`: Roster, Topics, Music, Program — 4 links, each with its
  destination's own icon, each **44px** tall (101/102/98/115 × 44).
- Checkmark: exactly **one per card**, on the Topics pill only, **44×44**, `closest('a') === null`
  — the sibling rule holds.
- `/talks/topics` reached from the row; **candidate queue present** with its empty-state sentence.
- **Advancing a speaker `approve → request` on 11-07 left the stamp at
  `2027-10-05T17:30:00+00:00`.** The slice's sharpest check, passed.
- **Changing a topic on 11-07 cleared it to null**, and the panel, the hub pill and `/music` all
  moved together.
- **Changing speaking slots 3 → 4 on 11-14 cleared it to null.** (The save first raised the
  pre-existing "Fast Sunday is moving" 409 — this ward has no fast Sunday that month — and was
  confirmed.)
- Idempotence proven by two direct `{finalized:true}` PATCHes 1.2s apart: both **200**, both
  `2026-09-23T22:40:18.021+00:00`. Audit shows three `finalized` rows carrying **one** stamp.
- Counselor finalized 11-14 from the pill; audit row written. Bishopric parity holds.
- `music_coordinator`: **3 dashboard tiles**, shortcut row **`/music` only** (no Topics, no
  Roster, no Program), **no checkmark anywhere**, Topics pill still visible, `/talks/topics` →
  "Not permitted", `/music` → `Topics pending`.
- Dimmed card at `opacity-70` **opens fully**; every control inside works. (The one disabled
  control is `Suggest hymns`, because that Sunday has no topics — pre-existing.)
- 375px hub: **no horizontal overflow** (scrollWidth 360 = clientWidth), pill and checkmark share
  a line with a 4px gap and do not overlap.
- Recently used, once the seed was fixed: `4 talks in the 6 months either side of today.`, ordered
  Oct 11 (Coming up) / Sep 6 (no speaker yet) / Aug 9 (Brother Elias Hale) / Jul 12 (Sarah
  Whitfield). Singular branch proven: **"One talk in the 6 months either side of today."**
- No raw uuid on screen anywhere.

**Corrections made to this scenario during the walk:**

1. **The seed could not feed the Recently used panel at all.** The list reads a window of
   RECENT_MONTHS either side of TODAY; the fixed November 2027 Sundays are eight months past its
   forward edge, so the panel rendered its empty state and **four checklist items could not pass at
   any time**. The seed now also creates four Sundays computed **relative to today** (-10, -6, -2
   and +3 weeks) carrying one topic each — a member, an external speaker, nobody, and one
   upcoming. The fixed November trio is unchanged, because the finalize half depends on it.
2. **"The November Sundays carry a Coming up mark"** was the same error stated as a check, and was
   rewritten to say the opposite explicitly, so a later reader does not re-introduce it.
3. **"Press the checkmark again and compare the stamp"** described a state the app cannot reach —
   the control is a TOGGLE, so the second press un-finalizes. Rewritten to point at the route test
   and at the audit log, which shows the same guarantee from the other side.

**Defects found:**

- **073-D1 — the Recently used row was unusable at 375px. FIXED.** A fixed `w-36` (144px) date
  column squeezed the title to **17–41px**, and the text painted outside its box over the
  speaker's name ("Ministering as the Savior Did" rendered as `MinisBrothering Elias Hale`).
  The row now stacks below `sm:` — date, topic, speaker each on their own line — and holds three
  columns from `sm:` up. Re-measured after the fix: **nothing clipped on any row** (`scrollWidth`
  never exceeds `clientWidth` on any child), no page overflow, and the "Coming up" pill is 79px
  rather than full-bleed (a flex column stretches its children, so the stacked axis needed
  `items-start`). Before: `.walk073/07-recently-used-mobile-375.png`; after:
  `.walk073/10-recently-used-mobile-fixed.png`.
- **073-D2 — one page says a topic is both "used recently" and "Not used yet". LEFT AS IS, by the
  user's decision 2026-09-23.** The panel reads ASSIGNMENT ROWS; the library's staleness badge
  reads `topics.last_assigned_at`, which is stamped only at the `approve` transition. A topic
  PLANNED but not yet approved therefore appears in Recently used while the library three inches
  below calls it unused. Both statements are true of their own source, and they answer different
  questions — the panel is "have I already put this on a Sunday", the badge is about rotation.
  **Do not "fix" this by narrowing the panel to approved usage:** that removes the warning for
  next month's plan, which is most of what the panel is for.

**The screenshot review was answered by the user on 2026-09-23, and TWO THINGS CHANGED:**

- **The finalize checkmark is now ATTACHED to its pill.** It shipped as a free-standing 44px
  circle with a gap, in a row of four pills, and the user — who designed the control — could not
  tell which pill it belonged to: *"it may be confusing knowing … what pill that check mark
  controls"*. The prototype's own word is `FinalizablePill`, "wrapping the existing Pill with an
  **attached** checkmark", and attached was the part not implemented. Gap is now **0px**, the seam
  is the pill's own right border, the tab drops its left border, and the visible heights match
  exactly (both 22px, same top — measured, because a one-pixel disagreement shows as a step and
  that is worse than the gap). The BUTTON keeps a 44×44 box for the thumb while the visible tab is
  pill-height, with the dead width falling in the gap before the next pill rather than over it.
  See `.walk073/09-hub-attached-desktop-light.png`.
- **The panel's second line now names who is WAITING, not who benefits.** The user's reason: name
  the person the work sits with *"that way if it's not getting done they can reach out to them and
  say hey did you miss this"*. Un-finalized now reads "The music coordinator is waiting on this
  before they can choose hymns."

**Confirmed with no change:** a dimmed `/music` card reads as *somebody else is still deciding*
rather than as a load failure, and it still reads that way in dark.

**Not walked:** nothing outstanding.

## Notes

**Why the stamp is a fixed date in the seed.** `2027-10-05T17:30:00Z` rather than `new Date()`, so
a re-seeded run shows the same date on screen. That is what makes "the stamp did not move" a thing
a walker can see rather than infer.

**Why 11-14 has no speakers at all.** It is the product rule stated as data. The prototype's build
note is explicit that finalizing "never depends on speaker confirmation/acceptance, only on the
conductor's own explicit click", and this ward's workflow is to lay out a month of topics before
finding anybody to give them. A build that gated finalize on having speakers would look correct on
every other Sunday and fail only here.

**Why 11-21 is only part-planned.** It is the check that the flag is not DERIVED. A build that
inferred "finalized" from "every slot has a topic" would be indistinguishable from a correct one on
11-07 and 11-14, which both have 3/3 — the partial Sunday is the only card where the two come
apart. `decisions.md` §1.15 forbids the derivation explicitly.

**Steps 6 onwards change data.** Re-seed for a clean run; `npm run seed:clean` first if you edited
a topic through the UI, since a topic created in the browser has a random id and survives a
re-seed.

**One thing this scenario deliberately does not cover.** The prototype's workflow pill
(`Draft` / `Pending approval` / `Approved`) on the `/music` card is **not built** — it reports the
programme's state, not the topics', and belongs with the programme. Its absence is correct, not a
finding.
