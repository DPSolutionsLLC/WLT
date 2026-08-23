---
name: Topic library and the AI candidate queue
scope: talks-c-prayers-topics
part: 3
tags: [talks, full, topics, ai-boundary]
prerequisites: none
---

## Purpose

Proves the accept/reject boundary is real **before Phase 5 can put anything through it** — the
cheapest moment to find out that a candidate can reach `topics` without an explicit accept.
Once Phase 5 exists, the same discovery costs a re-plan.

Also checks that `last_assigned_at` moves at the right moment, which is the one thing about this
feature a bishopric will notice being wrong. `tests/db/topic-last-assigned.test.ts` already
proves the stamp fires at `approve` and nowhere else against the real database; what it cannot
prove is that the resulting **order of the library on screen** is the order a bishopric wants —
that a topic they just approved has visibly moved down the list.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) — the only role that can reach this page |
| | `counselor1` (counselor, position 1, Peter Nakamura) — proves shared bishopric authority |
| | `counselor2` (counselor, position 2, Daniel Okafor) — needed for the 3-of-3 approval gate |
| | `secretary` (ward_secretary, Ruth Kaufman) — holds **no** topics permission |
| Topics | **8 across all five categories** |
| | 3 never assigned: "Bearing One Another's Burdens" (doctrinal), "The Book of Mormon" (scriptural), "Come, Follow Me" (conference_talk) |
| | 3 assigned 2–14 months ago: "Faith in Jesus Christ" (2 months), "The Sabbath Day" (7 months), "Temple Worship" (14 months) |
| | 2 archived: "Ward Budget Reminders" (custom), "Christmas Devotional" (seasonal) |
| Assignments | One at stage `review` on 2026-09-06, carrying **"Bearing One Another's Burdens"** — a never-assigned topic, ready to approve |
| | It already holds **all three approvals**, so a single press moves it |
| Topic candidates | **3 `pending` rows inserted directly**, standing in for Phase 5 |
| Sundays | September 2026: 09-06 (fast, 0 slots) and 09-13, 09-20, 09-27 (standard, 3 each) |

**Sign in with:** `bishop@`, `counselor1@`, `secretary@` — all
`@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-017-topic-library-and-queue`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open `/talks/topics` and read the whole list before touching anything.
   **Note the order.**
4. Set the Category filter to each of the five categories in turn, then back to "All categories".
5. Set "Showing" to **Archived**, read the list, then set it back to **In the library**.
6. Press **Add a topic**, fill it in with two suggested scriptures on separate lines, and save.
   Note where the new topic lands in the order.
7. Press **Edit** on any topic, change its description, and save.
8. Press **Archive** on a topic, then set "Showing" to Archived and press **Restore**.
9. Scroll to **Suggested topics** at the bottom and read the three candidates.
10. Press **Add to the library** on the first candidate.
11. Press **Not this one** on the second candidate.
12. Press **Add to the library** on the third candidate, then immediately press it again before
    the list refreshes, if you can.
13. With the queue now empty, read what the panel says.
14. Open `/assignments/<the 09-06 Sunday id>` — it is linked from `/assignments?month=2026-09`.
    Press **Approve plan** on the one assignment there.
15. Go back to `/talks/topics` and find "Bearing One Another's Burdens".
16. Return to the assignment. Press **Move to Requested**, choose **Declined**, and press
    **Record the decline and reopen this slot**. That is the one backward move the UI offers —
    it returns the assignment to Planning and clears the speaker.
17. Go back to `/talks/topics` and find that topic again.
18. Sign out. Sign in as `secretary` and open `/talks/topics`.
19. Sign out. Sign in as `counselor1` and open `/talks/topics`.
20. In the Supabase dashboard, read `topics` and `topic_candidates` for this ward.

## Verification Checklist

The library and its order

- [ ] The **three never-assigned topics sort first**, before every topic that has been used
- [ ] Below them, the least recently used comes before the most recently used
- [ ] The **two archived topics are hidden** until "Showing" is set to Archived
- [ ] Each topic shows its staleness **in words** — "Not used yet", "Used a while ago", "Used
      recently" — never a raw timestamp, and never a date the reader has to do arithmetic on
- [ ] Filtering by category narrows the list and leaves the order intact
- [ ] A category with nothing in it says so rather than rendering an empty panel

Adding and editing

- [ ] A newly added topic appears **at the top** with "Not used yet"
- [ ] Suggested scriptures entered **one per line** come back as separate entries, not one string
- [ ] Saving with an empty title is refused **before** the request, and the message says what to do
- [ ] Adding a topic with a title the ward already has (any casing) is refused with a sentence
      naming the clash — not "please try again", which retrying could never fix
- [ ] Editing a topic saves and the list reflects it without a manual reload
- [ ] **Archive is offered; Delete is not.** There is no delete control anywhere on the page
- [ ] An archived topic can be restored, and comes back with its stamp intact

The AI boundary — the point of this scenario

- [ ] The three candidates each show a title, category, description and suggestions
- [ ] Accept and reject are **two separate controls**, never one toggle
- [ ] There is **no "accept all"**, no checkbox column, and no way to review more than one
      candidate with one press. If you find one, that is a failure — say so
- [ ] Accepting one candidate adds **exactly one** topic to the library
- [ ] That topic shows **"Accepted from a suggestion"**, and `topics.source` reads
      `'ai_generated'` in the dashboard
- [ ] `topic_candidates.accepted_topic_id` links back to the new topic
- [ ] A **rejected** candidate leaves `topics` completely untouched — the count in the dashboard
      is unchanged
- [ ] Step 12: a second press on an already-accepted candidate does **not** create a second topic.
      It is refused with a sentence about reloading
- [ ] Every reviewed candidate carries `reviewed_by` and `reviewed_at` in the dashboard — an
      accept with no name attached to it is what the constraint exists to prevent
- [ ] **No topic exists in the library that nobody pressed a button for.** Compare the `topics`
      count before and after against the number of accepts

The empty state

- [ ] With the queue emptied, the panel **explains where suggestions come from** rather than
      rendering blank
- [ ] It says explicitly that nothing is added to the library on its own
- [ ] It does not read as an error or as something being broken

`last_assigned_at`

- [ ] Before step 14, "Bearing One Another's Burdens" reads **"Not used yet"** and sorts first
- [ ] Step 14 succeeds — the assignment moves to Approved
- [ ] Step 15: that topic now reads **"Used recently"** and has **moved down** the list. This is
      the check a bishopric would notice being wrong
- [ ] Step 16: the assignment goes back to Planning and the **speaker is cleared**, but the
      topic stays attached
- [ ] Step 17: the topic is **still stamped** and still reads "Used recently". Reverting the
      assignment must not un-stamp it — the topic genuinely was chosen

Permissions

- [ ] `secretary` gets a **"Not permitted"** page, not an empty library. `topics.view` is
      bishopric-only in both `lib/auth/permissions.ts` and migration 019, so an empty library
      would be a different and misleading claim
- [ ] `counselor1` sees **exactly** what the bishop sees, with every control the bishop has.
      CLAUDE.md §7: bishopric authority is shared, and any difference here is a bug

Mobile and theme

- [ ] Every screen works at **375px** in both themes
- [ ] The add and edit forms do not scroll horizontally at 375px
- [ ] Every tap target clears 44×44
- [ ] No raw uuid appears anywhere

## Failure Behavior

**Automated where it can be.** The stamp is covered against the real database by
`tests/db/topic-last-assigned.test.ts` — it fires at `review` → `approve`, at no other
transition, and survives a revert. Cross-ward and non-bishopric access to `topic_candidates` is
covered by `tests/rls/topic-candidates.test.ts`, including the review-pair constraint. Staleness
bucketing and ordering are covered by `tests/lib/topicRotation.test.ts`.

The queue's route behaviour is covered end to end by `tests/routes/topic-candidates.test.ts`,
which drives the real handler against the hosted project:

| Check | Test |
|---|---|
| An accept creates exactly one topic, with `source = 'ai_generated'` and a link back | "accepts one candidate and creates exactly one topic" |
| A rejection writes NOTHING to `topics` | "writes NOTHING to topics when a candidate is rejected" |
| A double accept is refused and creates no second topic | "refuses a second accept and does not create a second topic" |
| A duplicate title is a 409 and leaves the candidate pending | "answers 409 when the suggestion duplicates a topic the ward already has" |
| A secretary and a music coordinator are refused both verbs | "refuses a ward secretary and a music coordinator" |
| A counselor holds exactly what the bishop holds | "gives a counselor the same access as the bishop" |
| A reviewed candidate leaves the queue | "returns only pending candidates" |

What is left for a human is the boundary as a **product**: whether the queue makes accepting one
thing at a time feel natural rather than tedious, whether the empty state explains itself, and
whether the order of the library is the order somebody planning next month actually wants.

**The dashboard check worth doing by hand.** Before step 9, note
`select count(*) from topics where ward_id = '11111111-1111-4111-8111-111111111111'`. After step
12, it must have gone up by **exactly one** — one accept in step 10, one in step 12, minus the
rejection in step 11 which adds nothing… so **exactly two**. If it went up by three, the double
press in step 12 got through and the 409 guard is not working.

## Walkthrough record

**Walked 2026-08-22, driven through a real browser (Playwright MCP) against the hosted project.
Every check above passed.** What was observed:

- Library order on load: Bearing One Another's Burdens / Come, Follow Me / The Book of Mormon
  (all "Not used yet"), then Temple Worship and The Sabbath Day ("Used a while ago"), then Faith
  in Jesus Christ ("Used recently"). Both archived topics hidden.
- Accept of "Ministering with Real Intent": `topics` went 8 → 9, exactly one row, `source =
  'ai_generated'`, `accepted_topic_id` linked, `reviewed_by` and `reviewed_at` both set.
- Reject of "The Gathering of Israel": `topics` unchanged, no link, reviewer still recorded.
- Approving the waiting assignment stamped `last_assigned_at` at 23:40:42Z. After the decline
  revert the assignment sat at `plan` with the speaker cleared and **the stamp unchanged at
  23:40:42Z**. In the library the topic had moved from first to last.
- Empty state, secretary refusal, counselor parity, archive/restore, no Delete control anywhere,
  no horizontal overflow at 375px, every tap target ≥ 44×44, no raw uuid on screen.

**One correction made during the walkthrough.** Steps 16–17 originally said to "send it back to
Planning with a reason". There is no generic backward-move control in the UI — the only one
talks-b built is the decline path at `request`, which is what the steps now use. The generic
backward move exists in the pipeline and the route and is covered by
`tests/db/topic-last-assigned.test.ts`; it simply has no button.

## Notes

**Why the candidates are inserted directly.** Phase 5 is what will really write them. Seeding
them by hand is what makes it possible to prove the door works before anything is trying to walk
through it — which is the entire argument for building this queue in talks-c rather than in
Phase 5 alongside the thing that fills it.

**Why the assignment already holds all three approvals.** The approval gate is scenario 012's
subject, not this one's. Seeding it satisfied means step 14 is a single press and the scenario
stays about the stamp.

**Why "Bearing One Another's Burdens" specifically.** It is a **never-assigned** topic, so it
starts at the top of the list with "Not used yet". Approving it has to visibly move it — a topic
that was already stamped would move a little and prove much less.

**Steps 6 onwards change data.** `createTopic` and `createTopicCandidate` use stable ids, so
re-seeding restores the library — but a topic created through the UI in step 6 has a random id
and survives a re-seed. Run `npm run seed:clean` and re-seed for a clean run.
