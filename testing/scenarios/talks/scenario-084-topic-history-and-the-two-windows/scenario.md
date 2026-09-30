---
name: Topic history and the two windows
scope: sacrament-topics-screen-rebuild
part: 1
tags: [sacrament, topics, ai, full]
prerequisites: none
---

## Purpose

Topics rebuild `t2`, `t4` and `t5` (plans/sacrament-topics-screen-rebuild.md): the **Topic
history** page that replaced the topic library, the **speaker window**'s "who to ask next" order and
History, and the **topic window**'s "Used before" hint, Check topic and AI suggestions. All of these
depend on history measured from **today**, which cannot be typed in by hand, so it is seeded
relative to the run date (scenario 073's lesson).

**Already automated:**
- `tests/lib/topicHistory.test.ts` — similarity (prefix, common words ignored), dedupe, time-ago
  boundaries, search and every sort
- `tests/lib/speakerOrder.test.ts` — never spoken first, then longest since; only completed talks count
- `tests/components/sacrament/SpeakerWindow.test.tsx`, `TopicWindow.test.tsx` — the list, History in
  place, "as typed", the hint, Check topic, suggestions filling the box without saving
- `tests/routes/topic-suggestions.test.ts` — suggestions filtered against recent and upcoming topics,
  and no row written to `assignments`, `topics` or `topic_candidates` on success or failure

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver) |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura), `counselor2` (David Okafor), `music` (Hannah Price, music coordinator) |
| Topics given | *Faith in Jesus Christ* ~2 months ago (Maria Lopez); *Faith and works* ~8 months ago (Brother Visitor); *Gratitude* ~14 months ago (Sister Visitor); *Hope in Christ* ~3 years ago (Oliver Brooks) |
| Coming up | *Faith in Jesus Christ* ~5 weeks ahead, **President Hale** (outside speaker) |
| Cancelled | *Tithing blessings* ~6 weeks ago — must appear **nowhere** |
| Members | **Emma Clark** never spoken; **Oliver Brooks** last spoke ~3 years ago; **Maria Lopez** spoke ~2 months ago and declined twice (*Not available*, *Other*) |
| Sunday **B** | The first ordinary Sunday at least three weeks out: 3 open slots, `counselor1` conducting |

**Sign in with:** `counselor1@`, `music@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-084-topic-history-and-the-two-windows`, and note B's date.
2. `npm run dev`, open http://localhost:3000, and sign in as `counselor1`.
3. On the dashboard, open **Topic history**. Read the list. Then set **Show the last** to **48** months and press **Show**.
4. Search **grat**, clear it, then sort by **Speaker A–Z**. Reload the page.
5. Open **Sacrament**, go to B's month, and press B's **Topics** pill.
6. Tap talk 1's **topic** line. Type **fai** and read the box under it.
7. Clear the box, type **Service**, press **Check topic**.
8. Press **Suggest topics**, type *something for young families*, press **Get suggestions**.
   Tap one suggestion, then press **Cancel** without saving.
9. Tap talk 1's **speaker** line. Read the list.
10. Press **History** beside **Maria Lopez**, read it, then **← Back to the list**.
11. Type **Jane Porter**, press **Can't find them? Use "Jane Porter" as typed**, type **Sister** as the
    title, and **Save**.
12. Sign out, sign in as `music`, and try `/talks/topics`.

## Verification Checklist

### Machine-checkable

- [ ] Step 3: the dashboard has a **Topic history** tile, and the Sacrament hub's shortcut row links it too
- [ ] Step 3: by default (**6** months) the list holds only the upcoming *Faith in Jesus Christ* — marked **Coming up**, speaker **President Hale** — and July's *Faith in Jesus Christ*; after **48** it holds all five seeded topics, newest first; *Tithing blessings* never appears
- [ ] Step 4: *grat* leaves only *Gratitude*; **Speaker A–Z** reorders the list; after the reload the sort is still **Speaker A–Z** and the window still **48** (read back: `users.settings.page_views.topic_history`)
- [ ] Step 6: under the box, **Used before, most recent first** lists the upcoming *Faith in Jesus Christ* ("coming up …") once, then *Faith and works* — no topic twice
- [ ] Step 7: **No similar topic found in the ward's history.** Typing *grat* shows no "Used before" box either: *Gratitude* was 14 months ago, and the window looks back one year
- [ ] Step 8: ideas appear, none resembling *Faith…* or *Gratitude*; tapping one fills the box; after Cancel the talk still has no topic (read back); `audit_log` has one `topic_ideas_suggested` row with counts and no words
- [ ] Step 9: the list starts **Emma Clark** (*Never spoken*), then **Oliver Brooks** (*last spoke 3 years ago*), and ends with **Maria Lopez**; Oliver's flags never squeeze his name — at 375px they stack in a column
- [ ] Step 10: History shows *Faith in Jesus Christ* under **Speaking history — 1 talk**, then **Declined asks — 2, for pattern-spotting** with both reasons and notes; only one dialog is open
- [ ] Step 11: talk 1 reads **Sister Jane Porter**; read back `external_speaker_name = "Jane Porter"`, `external_speaker_title = "Sister"`, `member_id` null
- [ ] Step 12: `music` has no Topic history tile, and `/talks/topics` answers *Not permitted*
- [ ] 375px: no horizontal scroll on the history page or in either window

### Needs a human eye

- [ ] The history page reads as a useful record — easy to scan for "have we done this lately?"
- [ ] The Used before box and the suggestions read as help, not as a warning or an error
- [ ] Both windows fit a phone, in light and dark

## Walkthrough record

**2026-09-29, by the agent (Playwright driving local Chrome, dev server, 1280px and 375px, light and
dark), with a database read-back through the service client.** Sunday B was 2026-10-18. Step 8 made
one real Claude call. Evidence is in `.walk084/` (excluded from git).

Every machine-checkable line passed:
- Steps 3–4: the dashboard tile and the hub shortcut are both present. The history held the five
  seeded topics, newest first, with the November *Faith in Jesus Christ* marked **Coming up** and
  *Tithing blessings* absent. *grat* left only *Gratitude*. **Speaker A–Z** reordered the list, and
  after a reload the sort was still `speaker`; `users.settings.page_views.topic_history` was read back.
- Step 6: "Used before" listed *Faith in Jesus Christ — coming up Sunday, November 8, 2026*, then
  *Faith and works — 8 months ago*. Each topic appeared once: the July use of the same words was folded
  into its most recent use.
- Step 7: "No similar topic found in the ward's history."
- Step 8: in 11 s the call returned 5 ideas and kept 3, none resembling Faith or Gratitude. Tapping one
  filled the box. After Cancel, talk 1's topic was still null (read back). The audit row
  `topic_ideas_suggested` held `{returned: 5, kept: 3, filtered: 2, steered: true}` and no words.
- Step 9: Emma Clark (*Never spoken*), Oliver Brooks (*last spoke 3 years ago*), Maria Lopez (*last
  spoke 2 months ago*).
- Step 10: "Speaking history — 1 talk", then "Declined asks — 2, for pattern-spotting" with both reasons
  and notes, in one dialog. Back restored the list of 3.
- Step 11: read back `external_speaker_name = Jane Porter`, `external_speaker_title = Sister`,
  `member_id` null. The row read "Sister Jane Porter" once the page refreshed; a probe measured the
  dev server's refresh at about 4.6 s after the save.
- Step 12: `music` had no tile and got "Not permitted".
- 375px: no horizontal scroll on the history page or in either window.

**Found by the walk, not fixed yet (the /walk rule):**
- **D1:** the history names an outside speaker without their title: "Hale", not "President Hale".
  `listTopicHistory()` reads `external_speaker_name` only.
- **D2:** a suggestion's reason shows raw markdown asterisks (`*Matthew 11:28-30*`). The shared
  system prompt's `CITATION_INSTRUCTION` asks for italic citations, and the window prints text as-is.
- **D3:** in the speaker list, a member with reliability flags has their name squeezed into a narrow
  column ("Oliver / Brooks / last / spoke …"), even at 1280px (`04-speaker-list.png`).
- **D4 (internal):** the audit detail's `outputTokens` is written as `[redacted]`, because
  `writeAuditLog()` blanks any key containing "token".

**Walk-script note:** the first run failed on the script's own ambiguous "Topic" locator, and the
second timed out waiting only for ideas, most likely a "No new ideas" answer. The script now waits
for ideas or a message. Neither was an app defect.

**The user's review, 2026-09-29:** fix D1 (show "President Hale"); D2 is fine as it is (the
asterisks around citations read well to them), so it stays; fix D3 by stacking the flags in a column
on a phone rather than squeezing the name. Two additions: the Topic history gets a **"Show the last N
months"** window, 6 by default and adjustable; and the topic window's "Used before" hint and Check
topic look back **one year** (`HINT_LOOKBACK_MONTHS`, one constant to change later). The history
page, the hint and the suggestions were confirmed as reading well.

**Re-walked after the fixes, same day, fresh seed (`rewalk-log.json`, screenshots 21–24):**
- The default six months showed "Faith in Jesus Christ · Coming up · **President Hale**" and July's
  "Faith in Jesus Christ · Maria Lopez". With **48** months all five appeared, and after a reload the
  window still read 48.
- *grat* showed no "Used before" box, and Check topic said "No similar topic found": Gratitude was 14
  months ago. *fai* still listed the upcoming Faith and "Faith and works — 8 months ago".
- Speaker list: Oliver Brooks's name button kept its 144px minimum and two lines ("Oliver Brooks /
  last spoke 3 years ago") at both 1280px and 375px. At 375px his two flags stacked in a column. No
  horizontal scroll.
- D4 fixed: the audit detail no longer carries the blanked output size.

**Live confirmation, 2026-09-30, by the user:** after the push of `791e335`, Suggest topics worked on
the deployed site. Both AI keys are set in Vercel (plans/deployment.md).
