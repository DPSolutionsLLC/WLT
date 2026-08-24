---
name: Drafting a message that nobody sent
scope: ai-c-feature-routes
part: 2
tags: [ai, talks, full]
prerequisites: none
---

## Purpose

The message routes write nothing, and the value of that is only legible in a browser: generate a
draft, walk away, come back, and see that nothing was kept. `tests/routes/ai-message.test.ts`
re-reads `notify_message` and `thank_you_message` after every call and proves both stay null — but
a passing assertion is not the same as a counselor watching their edit disappear on a refresh and
understanding that this is *correct*.

It also walks the connection this plan exists to make: **the thank-you draws on the assignment's
comment thread**. `buildThankYouMessage` has taken a `comments` parameter since talks-b and
`ContactStagePanel` passed `[]` hard-coded, so every thank-you in this app has been generic for
want of an input nobody had wired. That is new behaviour, and it cannot be seeded into existence
any other way than by reading a draft and recognising the comments in it.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Peter Nakamura) — the account that drives this |
| | `music` (music_coordinator, Elena Marsh) — holds `talks.view` and **neither** `talks.plan` **nor** `talks.confirm` |
| AI settings | 1 version. Tone: **"Warm and brief, never formal. Short sentences."** Thank-you preference asks for something specific, never a form letter |
| Sunday | **2026-09-13**, standard, 4 speaking slots, conducted by `counselor1` |
| Slot 1 | **Sarah Whitfield**, stage `confirm`, topic "Bearing One Another's Burdens", 12 minutes, 2 suggested scriptures |
| Slot 2 | **Daniel Okonkwo**, stage `appreciate`, **3 assignment comments** from two different bishopric members |
| Slot 3 | **Maria Reyes**, stage `appreciate`, **no comments at all** |
| Slot 4 | **President Thomas Bridger**, external speaker, **contact waived** on 1 September by the bishop |

The three comments on slot 2, which you will be looking for in the draft:

1. *"He talked about carrying his neighbour's groceries up three flights for a year and never
   mentioning it. The room went completely quiet."*
2. *"The bit about his grandmother's letters landed with the youth — I watched them stop looking
   at their phones."*
3. *"Ran about four minutes long and nobody minded in the slightest."*

**Sign in with:** `counselor1@`, `music@` — both `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

**`ANTHROPIC_API_KEY` must be set.** This scenario makes real calls.

## Steps

1. `npm run seed -- ai/scenario-025-drafting-a-message-nobody-sent`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `counselor1`. Open `/assignments`, find **13 September 2026**, and open the Sunday.
4. On **slot 1**, read the confirmation textarea *before* pressing anything — that is the
   template's version.
5. Press **Draft the confirmation with AI**. Read what replaces it.
6. Edit the draft by hand — add a sentence of your own.
7. Press **Draft the confirmation with AI** again. Watch what it asks you, and cancel.
    Then press **Back to the plain version** and watch what it asks you that time.
8. Navigate away to `/assignments` and come straight back to the Sunday. Read the textarea.
9. Now press the AI button, then press **Approve this message**. Navigate away and come back
   again.
10. On **slot 2**, read the thank-you textarea before pressing anything, then press **Draft the
    thank-you with AI**. Read it against the three seeded comments above.
11. On **slot 3**, which has no comments, read what the Appreciation stage offers instead.
    There should be no textarea and no AI button.
12. Scroll to **slot 4** and read what it says. Look for a draft button.
13. Unset `ANTHROPIC_API_KEY`, restart the dev server, type something into a thank-you textarea,
    and press the AI button.
14. Sign out. Sign in as `music` and open the same Sunday.

## Verification Checklist

### Machine-checkable

- [ ] After step 5, the textarea contents **changed** — the AI draft replaced the template
- [ ] After step 7, a confirmation dialog appears **before** the edited text is replaced
- [ ] Cancelling that dialog leaves the edited text **exactly as it was**
- [ ] After step 8, the textarea has gone back to the **template default** — nothing was saved
- [ ] After step 9, the textarea holds the **approved** message on return — approving is what saves
- [ ] Slot 4 shows **"Not applicable — invited outside the ward"** with the bishop's name and
      **1 September 2026**
- [ ] Slot 4 has **no draft button at all** — not a greyed-out one, not a disabled one
- [ ] Slot 2's thank-you area carries the line *"Anything the bishopric wrote in the comments on
      this assignment is used here."*
- [ ] **Back to the plain version** appears only *after* the textarea has moved away from the
      template &mdash; it is absent on first load
- [ ] Pressing it restores the written template exactly
- [ ] Pressing it over a hand-edit asks first, and cancelling keeps the edit
- [ ] **Slot 3 offers no textarea and no AI button at all.** It says there is nothing specific to
      write and that an in-person thank-you is probably enough
- [ ] Slot 3 still offers **Mark the thank-you as sent** &mdash; the stage can still be completed
- [ ] Slot 3 says what would change that: add a comment on the assignment
- [ ] The comment thread with all three comments is visible further down the same card
- [x] Signed in as `music`, the Sunday page opens (not "Not permitted") and there are **no draft
      buttons** anywhere. **Corrected 2026-08-24:** this item used to say "no draft buttons *on any
      slot*", which describes a state the app cannot reach — a music coordinator sees **no slots at
      all**. `assignments` is bishopric-only in RLS (migration 019) while `talks.view` is granted to
      `music_coordinator`, so `listAssignments` returns zero rows and the page falls through to its
      generic empty state. See the defect note in Notes
- [ ] With the key unset, the *not configured* message naming the API key appears **beside the
      textarea**, the typed text is **still there**, and the button is pressable again
- [ ] The button reads **"Drafting…"** while running and cannot be pressed twice
- [ ] No horizontal scrolling at 375px on any of the four cards
- [ ] Both themes: the disclaimer line under each button is readable and clearly secondary

### Needs a human eye

- [ ] Does the confirmation draft sound **warm and brief, never formal** — noticeably, not
      subtly? Compare it with the template version you read at step 4. If they sound the same,
      the tone setting is not reaching the prompt in any useful way.
- [ ] Does it read like a **text message** or like an email? Four paragraphs is a failure.
- [ ] Does slot 2's thank-you visibly use **all three** comments, or only the first one? Name
      which ones you can find in it.
- [ ] Does it use them in the bishopric's own terms, or has it abstracted them into
      "your heartfelt message"? The specifics are the whole point.
- [ ] Slot 3 offers **no message at all**. Read what it says instead: does it land as a
      deliberate decision, or as a feature that failed to load?
- [ ] Would you rather have had a generic draft there to edit? The product decision on
      2026-08-24 was no &mdash; by this stage the speaker has usually been thanked in person, and a
      form letter afterwards subtracts from that. Say if walking it changes your mind.
- [ ] With the AI draft and the plain template both one press apart, which do you reach for? If
      it is consistently the template, the drafting is not earning its call.
- [ ] Read the line about where comments come from. Is it **true** as written, and does it make
      somebody more likely to write a comment before drafting?
- [ ] Does the disclaimer — *"A starting point. Read it, change it, and approve it when it says
      what you mean."* — actually change how you treat the draft?
- [ ] At step 8, was losing the draft **surprising or reassuring**? If it read as a bug, the
      surrounding wording is not doing its job.
- [ ] At 375px, one-handed: can you read a draft and decide on it without pinching?

## Failure Behavior

- [ ] An unset `ANTHROPIC_API_KEY` produces the *not configured* sentence naming the key —
      not a spinner that never resolves and not an empty textarea
- [ ] The error appears **beside the textarea**, not at the top of the page
- [ ] Whatever was typed before the failure is **still there** afterwards
- [ ] A waived assignment refuses with *"This speaker was invited outside the ward and is not
      being contacted."* — unreachable through the UI, which offers no button there;
      `tests/routes/ai-message.test.ts` covers the 409
- [ ] A draft that comes back empty shows *"The AI returned an empty draft. Try again."* rather
      than silently blanking the textarea

## Walkthrough record

**Walked 2026-08-24 by Claude driving a real browser (Playwright), with screenshots for the
human-eye items.** Every machine-checkable item below was performed and verified against the
hosted database with the service-role client, never from the screen alone.

**Observed values**

- Baseline, read from `assignments` before anything: all four rows `notify_message = null`,
  `thank_you_message = null`; slot 4 `contact_waived_at = 2026-09-01T16:00:00+00:00`.
- Slot 1 template, before any AI: *"Hello Sarah, / Thank you for agreeing to speak in sacrament
  meeting on Sunday, September 13. / Your topic is "Bearing One Another's Burdens". / Please plan
  for about 12 minutes. / You may find these helpful as you prepare: Mosiah 18:8-10 and
  Galatians 6:2. ..."*
- Slot 1 first AI draft: *"Hi Sarah! You're set to speak Sept 13 in sacrament meeting, about 12
  minutes. Topic: "Bearing One Another's Burdens" — such a good one. / A starting point if
  helpful: Mosiah 18:8-10 and Galatians 6:2. / Thanks for saying yes! Let us know if you need
  anything. 😊"* — 260 characters, three short paragraphs, one emoji.
- Button during a call: label `Drafting…`, `disabled = true`.
- After a hand edit and a second press: `confirm` dialog *"This will replace what you have
  written. Continue?"*. Cancelled → textarea still held the edit byte-for-byte.
- After navigating to `/assignments` and back: textarea had reverted to the **template**
  (`hasMyEdit false`, `hasAiDraft false`, `isTemplate true`), and `notify_message` was still null.
- After pressing **Approve this message**: `notify_message` held the draft, and **only slot 1's**;
  slots 2–4 all still null. Persisted across a reload.
- Slot 2 AI thank-you: *"Daniel, that story about carrying your neighbour's groceries up three
  flights for a year, never mentioning it, hit hard. The room went completely silent. And your
  grandmother's letters actually got the youth to put their phones down — that's saying something.
  Ran long and nobody minded one bit. Thank you."* — **all three seeded comments used**, and all
  three converted from the bishopric's third person into second person.
- Slot 3 AI thank-you (no comments): *"Hey Maria! Thank you so much for speaking on Sunday, you did
  such a great job. Really appreciated you sharing your thoughts with all of us 🙏"* — invents no
  subject, names no topic.
- After all four drafts: every `thank_you_message` still null, every `pipeline_stage` unchanged,
  4 × `ai_message_drafted` audit rows, none carrying message text.
- Slot 4 card: buttons were exactly `Edit`, `Move to Notified`, `Post comment`. **No AI button, no
  disabled button anywhere**, 1 textarea (the comment box).
- 375px: `scrollWidth 360`, horizontal overflow **0px**, **zero** tap targets under 44px. Checked
  in both light and dark (`documentElement.classList` contains `dark`, body background
  `rgb(10, 10, 10)`).
- Key-off run (dev server restarted with `ANTHROPIC_API_KEY=`): the page showed exactly one
  `[role=alert]` — *"AI is not set up yet. An administrator needs to add the Anthropic API key
  before this will work."* The hand-typed text survived byte-for-byte and the button returned to
  `Draft the thank-you with AI`, `disabled = false`.

**Checklist corrections**

- The `music` check was rewritten. It asked for "no draft buttons **on any slot**", which the app
  cannot reach: a music coordinator sees **no slots at all**. See the defect in Notes.

**Defects found — none introduced by `ai-c`, both pre-existing**

1. **The plain template mangles real comments.** Now that the thread actually reaches
   `buildThankYouMessage`, `listPhrase()` joins three full sentences into
   *"…completely quiet.**,** The bit about…phones. **and** Ran about four minutes long…"* — a comma
   splice with doubled punctuation — and leaves them in the bishopric's **third person** inside a
   message addressed to Daniel (*"Hello Daniel, … **He** talked about … **his** neighbour's"*).
   `listPhrase` was written for short items like scripture references. The AI path fixes both
   problems; the template path does not. Reproduce: seed 025, open slot 2, read the textarea
   before pressing anything.
2. **`talks.view` is granted to three roles that RLS refuses.** `assignments` is bishopric-only in
   migration 019's loop, but `ward_secretary`, `executive_secretary` and `music_coordinator` all
   hold `talks.view`. Opening a Sunday as any of them renders *"4 speaking slots"* directly above
   *"Nothing is planned for this Sunday yet. Plan a slot from the month view."* — two contradictory
   statements, the second of them false. Same shape as ITER-007, which is already in the backlog.
   Reproduce: seed 025, sign in as `music`, open the Sunday.

**Not walked**

- Nothing. All 14 steps were completed.

---

### Follow-up changes, 2026-08-24 (after the walk, from the review)

Two behaviour changes came out of reading the walk, both decided by the user and both landing in
files this scenario covers. **The checklist above has been updated to match; the observed values
recorded here are from BEFORE these changes**, so a re-walk will legitimately see something
different at slot 3.

1. **No comments now means no message is offered.** Slot 3 previously showed a generic template and
   an AI button. The user's judgement was that they would not send anything generic at that point
   — an in-person thank-you has usually already happened — so the textarea, the AI button and the
   SMS handoff are all absent, replaced by a sentence saying so. `POST /api/assignments/[id]/ai-message`
   now returns **409** for a `thank_you` with no comments, so the refusal holds even if the button
   is bypassed, and no vendor call is spent. Covered by
   `tests/components/assignments/ContactStagePanel.test.tsx` and `tests/routes/ai-message.test.ts`.
2. **The plain template is reachable again after an AI draft.** A second control, *"Back to the
   plain version"*, appears once the textarea no longer matches the template. Before this, the only
   route back was navigating away and returning — which also discarded the AI draft. Both
   directions share the one confirm guard, and both live inside `AiDraftButton` so its record of
   which values nobody typed stays authoritative. Covered by
   `tests/components/assignments/AiDraftButton.test.tsx`.

**Both changes WERE re-walked in a browser on 2026-08-24, after the follow-up landed.** Observed:

- **Slot 3, Appreciation** renders: *"Nobody recorded anything about this talk, so there is nothing
  specific to write. An in-person thank-you is probably enough."* &rarr; **Mark the thank-you as
  sent** &rarr; *"Add a comment on this assignment if you would like a message drafted from it."*
  Its buttons were exactly `Edit`, `Mark the thank-you as sent`, `Move to Complete`, `Post comment`
  &mdash; no AI button. Its one textarea is the comment box.
- **Slot 2 on first load showed no restore control**, correctly: the textarea still held the
  template, so the button would have done nothing.
- After an AI draft (*"Daniel, that story about carrying your neighbour's groceries up three
  flights for a year &mdash; never even mentioning it &mdash; hit hard&hellip;"*) the pair read
  `Draft the thank-you with AI` and `Back to the plain version`.
- Pressing restore returned the textarea to `Hello Daniel,&hellip;` exactly, and the restore
  control **disappeared again** &mdash; it would now do nothing.
- Through the whole round trip, all four rows kept `notify_message null`, `thank_you_message null`
  and their original `pipeline_stage`.
- At 375px the two controls stack vertically, both 44px tall, horizontal overflow **0px**, no tap
  target under 44.

## Notes

**Step 13 needs a server restart.** `ANTHROPIC_API_KEY` is read once and the client is cached, so
changing the env file without restarting will not produce the failure you are looking for.

**Slot 1 is the only slot at `confirm`, and slots 2 and 3 are the only ones at `appreciate`.**
That is deliberate: `ContactStagePanel` only renders a textarea for the stage the assignment is
actually at, so a slot at the wrong stage would show no button and read as a defect.

**This scenario spends money** — six or seven calls at `effort: "medium"`, which is the cheap end.
Repeating step 5 a dozen times to compare wordings is fine.
