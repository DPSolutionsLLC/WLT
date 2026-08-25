---
name: Choosing hymns for a Sunday with topics
scope: program-e-music-and-hymns
part: 1
tags: [music, ai, full]
prerequisites: none
---

## Purpose

The music coordinator's whole loop, and the ITER-016-shaped risk in the one place a person can
catch it.

ITER-016 recorded two confirmed-wrong AI conference talk citations out of fifteen, and the note
that matters is that the MIXTURE is the problem: an all-wrong batch gets noticed, a mostly-right
one teaches people to trust the rest. A hymn number is that failure with a congregation singing
the result on Sunday morning.

The mitigation is built and unit-tested — the candidate list goes into the prompt so the model
ranks rather than recalls, and every number that comes back is checked against the hymns table
before it reaches the screen (`tests/lib/hymnValidation.test.ts`, `tests/routes/hymn-suggest.test.ts`).
What a test cannot do is open a physical hymnbook. **That is the reason this scenario is walked
by a person rather than automated**: somebody has to look up three of the suggested numbers in a
real book and confirm the titles match.

The second thing it proves is a boundary rather than a behaviour: the coordinator sees what the
Sunday is ABOUT and nothing about who is speaking. `lib/music/sundayTopics.ts` makes that
structural rather than careful, and this is where somebody checks the screen agrees.

> **⚠️ THE HYMNBOOK IS ONLY PARTLY VERIFIED.** 42 of the 341 rows carry
> `source = 'authoritative'`; the other 299 are placeholders titled `[Placeholder] Hymn 43`
> (migration 042). AI suggestions are drawn only from the 42, so a suggestion is always a real
> hymn — but a SEARCH will surface placeholders, and they are marked "Not a real hymn". That is
> the design, not a bug.

## Seed Data

What `seed.ts` creates. Keep this in step with the script — it is what the tester reads to know
whether the screen is showing the right thing.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `music@harness.wardleadershiptools.test` (music_coordinator), `bishop@harness.wardleadershiptools.test` (bishop) |
| Members | 2 adults, in one household |
| Sunday A | 2026-11-01, standard, **two assigned topics**, opening hymn already chosen |
| Sunday B | 2026-11-08, standard, **no topics at all**, no hymns chosen |
| Assignments | Sunday A slot 1 — Sarah Whitfield, topic "Gratitude in Every Season"; slot 2 — David Brooks, topic "Bearing One Another's Burdens" |

Sunday A's opening hymn is seeded so the card has BOTH states on screen at once — one slot filled,
two empty. A card showing three empty slots proves nothing about whether the filled state renders.

Two topics rather than one, deliberately: the card and the AI prompt both pluralise, and `ai-b`'s
"all 1 of its passages" bug is what a one-item fixture hides. Sunday B, with none, is the
one-and-none side of the same check.

**Sign in with:** `music@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- music/scenario-036-choosing-hymns-for-a-sunday-with-topics`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the music coordinator.
4. Open **Music** from the sidebar.
5. On **Sunday, November 1**, read the topics listed under "Talks that Sunday".
6. Press **Suggest hymns**. Wait for the shortlist.
7. **Open a physical hymnbook** and look up three of the suggested numbers.
8. Accept one suggestion into a slot — press "Use as sacrament", say.
9. Fill the remaining slot with **Choose** → search by title or subject.
10. Search for `43` in the picker and look at what comes back.
11. Navigate to **Calendar** and back to **Music** without accepting the rest of the shortlist.
12. Scroll to **Sunday, November 8** — the one with no topics — and choose a hymn there by search.

## Verification Checklist

### Machine-checkable

- [ ] The Music link appears in the sidebar for the music coordinator
- [ ] Six Sundays or fewer are listed, and every one of them holds a sacrament meeting
- [ ] Sunday A's card shows the opening hymn as `19 — We Thank Thee, O God, for a Prophet` and the other two slots as "Not chosen yet"
- [ ] Sunday A's card counts only the EMPTY slots — two, not three. With two empty it reads
  "2 hymns still to choose"; with one empty, "One hymn still to choose"; with none,
  "All three hymns are chosen." (Digits for a plural, the word for the singular, matching
  the program list page. Corrected during the 2026-08-25 walk — this item previously
  demanded "Two hymns", which the app has never said and which contradicts that convention.)
- [ ] Sunday A lists exactly two topics: "Gratitude in Every Season" and "Bearing One Another's Burdens"
- [ ] **No speaker name appears anywhere on the Music screen** — not "Sarah Whitfield", not "David Brooks"
- [ ] No pipeline stage, contact state, or approval count appears anywhere on the Music screen
- [ ] Every suggestion carries a number and a title, and the title matches the app's own hymn table for that number
- [ ] Generating suggestions creates NO row: `select count(*) from hymn_selections where sunday_id = <Sunday A>` is unchanged from before step 6
- [ ] After step 11 (navigating away and back), the shortlist is GONE — no suggestions are shown
- [ ] The accepted hymn's row has `ai_suggested = true`; the one chosen by search has `ai_suggested = false`
- [ ] The accepted hymn's row has `selected_by` set to the music coordinator's user id
- [ ] Searching `43` returns hymn 43 titled `[Placeholder] Hymn 43`, marked **Not a real hymn**
- [ ] Sunday B, with no topics, still lets a hymn be chosen by search
- [ ] An audit row exists with action `hymn_suggestions_generated` and module `music`, whose detail names `candidateCount`, `kept` and `droppedNumbers`
- [ ] An audit row exists with action `hymn_selected` for each hymn saved
- [ ] No horizontal overflow at 375px on any card
- [ ] Every button on the card is at least 44×44

### Needs a human eye

- [ ] **Three suggested numbers, checked against a physical hymnbook, name the hymn the app says they do.** This is the check the whole scenario exists for — if one is wrong, stop and report the number
- [ ] Each suggestion's one-line reason genuinely connects that hymn to a topic on that Sunday, rather than being a generic sentence that would fit any hymn
- [ ] "Nothing here is saved" is believable where it sits — a coordinator reading the shortlist understands they have not chosen anything yet
- [ ] The three "Use as opening / sacrament / closing" buttons read as a choice of slot, not as three ways of saying yes
- [ ] "Not chosen yet" reads as work remaining, not as an error or a missing value
- [ ] On Sunday B, "No topics yet." reads as an ordinary state rather than as something the coordinator needs to fix
- [ ] The **Not a real hymn** badge is impossible to miss beside a placeholder, in both light and dark
- [ ] The screen is legible and usable one-handed at 375px, in both themes

## Failure Behavior

- [ ] With `ANTHROPIC_API_KEY` unset, **Suggest hymns** shows "AI is not set up yet…" rather than an empty shortlist. (`tests/routes/hymn-suggest.test.ts` covers all six error kinds and their statuses — do not paste `fetch` calls into a console for this; check only that the sentence reaches the screen.)
- [ ] A failed generation leaves the Sunday's hymns exactly as they were
- [ ] Signing in as `bishop@harness…` shows the same screen with the same controls — bishopric admin authority is shared, and a counselor must never be able to do less than the bishop
- [ ] A search that matches nothing says the hymnbook has not all been loaded and suggests trying the number — it must NEVER say a hymn does not exist

## Walkthrough record

**Walked 2026-08-25 by Claude, driven through a real browser (Playwright MCP) against the hosted
project, with every write read back through the service-role client. The five judgement items were
then reviewed by the user against screenshots, and all five passed — including the one this
scenario exists for.**

**THE HYMNBOOK CHECK PASSED.** The user looked up 241, 29 and 193 in a physical hymnbook and
confirmed all three name the hymn the app says they do. That is the ITER-016 check, and it is the
first time in this codebase an AI-produced citation has been verified against a source outside the
app's own data. The user also accepted the suggestion rationales, the "Not a real hymn" badge, the
"Suggested by AI" badge, and the 375px rendering in both themes.

**Observed:**

- Hymnbook: `select source, count(*) from hymns` returned **42 authoritative, 299 placeholder, 341
  total**. Hymn 2 is `The Spirit of God` / authoritative; hymn 43 is `[Placeholder] Hymn 43` /
  placeholder.
- The coordinator's sidebar held exactly five links — Dashboard, Calendar, Talks, Prayers, Music.
  No Roster, no Program. The bishop's held eighteen.
- Sunday A listed both topics and **neither speaker**. A scan of the whole rendered page for
  "Sarah", "Whitfield", "David", "Brooks", "stage", "Slot 1" returned nothing, with the
  assignments present in the data throughout. No raw uuid appeared on screen.
- Two generations were run. Both returned the same three hymns — **241 Count Your Blessings,
  29 A Poor Wayfaring Man of Grief, 193 I Stand All Amazed** — with freshly worded reasons. All
  three are `authoritative` rows and the titles on screen matched the table exactly. Repetition
  is expected with 42 candidates.
- Each audit row for a generation recorded `candidateCount: 42`, `returned: 3`, `kept: 3`,
  **`droppedNumbers: []`** — the model returned no number outside the candidate list in either run.
- **Generating wrote nothing.** `hymn_selections` held 1 row before step 6 and 1 row after it.
  Navigating to Dashboard and back left no suggestion on screen.
- Accepting 193 into the sacrament slot wrote `ai_suggested = true`; 152 and 2, both chosen by
  search, wrote `false`. All four rows carried `selected_by` = the music coordinator's id.
- Re-choosing the opening hymn **upserted in place** — the row kept its original `created_at`
  (19:50:01) rather than inserting a second opening row.
- The status line moved 2 → "One hymn still to choose." → "All three hymns are chosen." as slots
  filled. The singular is spelled as a word; see the corrected checklist item above.
- Searching `prophet's voice` found `21 — Come, Listen to a Prophet's Voice`. The apostrophe case
  holds. Searching `2` ranked `2 — The Spirit of God` above 12, 20, 22, 23 (exact number first,
  25 results shown). Searching `sacrament` returned 14 real hymns and **no placeholders** — they
  carry no tags, which is the point.
- Searching `43` returned 43, 143 and 243, each badged **Not a real hymn**, exact match first.
- A no-match search said: *"Nothing in the hymnbook matches that. Not every hymn has been loaded
  yet, so a number you know is real may not be found by its title — try the number itself."* It
  never claims a hymn does not exist.
- Sunday B, with no topics, showed "No topics yet." and still accepted a hymn by search (169).
  Its Suggest button carried "No topics yet, so these will suit a sacrament meeting generally."
- Musical number saved as free text — performer "The Primary children", no member record involved.
- Audit rows written: 2 × `hymn_suggestions_generated`, 4 × `hymn_selected` (each naming
  `hymnType`, `hymnNumber`, `aiSuggested`), 1 × `musical_number_logged`. **No hymn title, no
  performer name and no member name appeared in any audit detail.**
- Signed in as the bishop, the same screen rendered with the same controls — 2 Suggest buttons,
  6 Change/Choose buttons, nothing refused.
- 375px: no horizontal overflow (scrollWidth 360 = clientWidth 360), every button ≥ 44×44.
  Rendered in light and dark. **Zero console errors across the whole walk.**

**One checklist item corrected.** The plural check demanded "Two hymns still to choose". The app
says "2 hymns" and reserves the spelled-out word for the singular, which is the convention the
program list page already follows. The item was rewritten to describe all three states.

**One finding, not caused by this scenario.** `writeAuditLog`'s redaction regex matches the
substring `token`, so `outputTokens` is stored as `"[redacted]"`; the same regex matches `note`,
so the boolean `hasNotes` is redacted too. Both are counts/booleans, not secrets, and the
redaction destroys the cost signal the field exists for. This predates program-e —
`topic_candidates_generated` has logged a redacted `outputTokens` since `ai-c`. Left unfixed and
reported rather than patched mid-walk.

**Raised by the walk, not built here.** Confirming three hymns by hand made the point that this is
the ONLY way a placeholder becomes trustworthy, and that the app gives a person no way to record
having done it. `source` moves from `placeholder` to `authoritative` only through
`npm run hymns:import`, which needs a whole authoritative file nobody has. A per-hymn "I checked
this one" path would let a ward fill its hymnbook in its own time, one verified row at a time, and
would have captured the three verified during this walk instead of losing them. Logged as a
follow-up.

**Not walked:** the `ANTHROPIC_API_KEY` unset path, which needs the dev server restarted without
the key. `tests/routes/hymn-suggest.test.ts` covers all six error kinds and their statuses.

## Notes

- **The AI call costs money.** Each press of Suggest hymns is one Claude request at `effort: "high"`.
- With only 42 verified hymns, the candidate list handed to the model is all 42 rather than the 40–60 the code allows for. Suggestions will repeat across runs more than they will once a real hymnbook is loaded. That is expected.
- Asking for suggestions with no slot named returns general options; the sacrament slot is the only one that narrows the pool (to hymns tagged `sacrament`), and that narrowing is unit-tested in `tests/lib/hymnCandidates.test.ts`.
