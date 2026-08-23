---
id: talks-c-prayers-topics-walked
status: confirmed
commit: 429f5f3
date: 2026-08-22
area: talks-prayers-topics
related_retros: [talks-c-prayers-topics, talks-a-pipeline-core, talks-b-month-planner, roster-b-picker-and-orgs]
supersedes: null
---

## What was tested

**Scenarios 016 and 017 walked end to end against the hosted project**, then reviewed by the user
from five annotated screenshots covering the checks no test reaches.

Worth stating plainly, because a confirmed record is a baseline others will trust: **the browser
walkthrough was driven by Claude via Playwright, not by the user.** The user's own testing was a
review of the resulting screenshots and the database evidence behind them — and that review caught
a real gap in the evidence (see below). The deployed Vercel build has **not** been opened for this
area; everything here was verified against `localhost:3000` talking to the linked hosted database.

Both scenarios were seeded fresh, walked as `bishop`, and re-checked as `secretary` and
`counselor1`. Every assertion below was confirmed by re-reading rows with the service client
rather than by trusting the UI or the route's own JSON.

## Result

**Confirmed working. No code defects found in either walkthrough.**

### Scenario 016 — prayer rotation

| Check | Result |
|---|---|
| Four members with history read "Last prayed &lt;Month Year&gt;" | ✅ |
| Six with no history show **nothing** — not "Never", not a dash | ✅ |
| **Two stuck at `ask` also show nothing** — asked is not prayed | ✅ |
| 06-07 (`fast_sunday`, `speaking_slots = 0`) accepts **both** prayers | ✅ |
| Assigning does not move the stage on its own | ✅ |
| Four stages walk one press at a time; control names its target | ✅ |
| At `done` the "Move to" control disappears | ✅ |
| Replacing a member leaves **one** row, same id, stage untouched | ✅ |
| An untouched slot shows only "Choose someone" — no stage control | ✅ |
| A cleared slot shows the control disabled with its reason | ✅ |
| `secretary` sees the month with no picker and no stage control | ✅ |
| 8 `prayer_assigned` + 3 `prayer_stage_changed` audit rows | ✅ |
| **No audit row contains a member's name** | ✅ |
| 375px: no horizontal overflow, tap targets ≥ 44×44, no raw uuid | ✅ |

The fast-Sunday evidence, read from the database after the walk:

```
June 7: type=fast_sunday speaking_slots=0
  invocation:  Tomas Ruiz     (assign)
  benediction: Claire Bennett (assign)
  => 2 prayer rows on a Sunday with 0 speaking slots
```

### Scenario 017 — topic library and the AI queue

| Check | Result |
|---|---|
| Three never-used topics sort first, then oldest → most recent | ✅ |
| Two archived topics hidden until asked for; Restore works | ✅ |
| Staleness reads in words, never a raw date | ✅ |
| **No accept-all, no checkbox column, no Delete control anywhere** | ✅ |
| Accept → `topics` 8→9, exactly one row, `source = 'ai_generated'` | ✅ |
| `accepted_topic_id` links back; `reviewed_by` and `reviewed_at` set | ✅ |
| **Reject writes NOTHING to `topics`** | ✅ |
| A second accept is refused rather than duplicating | ✅ |
| Empty state explains where suggestions come from | ✅ |
| Approve stamps `last_assigned_at`; topic moves first → last in the list | ✅ |
| **A revert leaves the stamp unchanged** (same timestamp, re-read) | ✅ |
| `secretary` gets "Not permitted", not an empty library | ✅ |
| `counselor1` has full parity with the bishop | ✅ |

The stamp evidence: approving stamped `2026-08-22T23:40:42.292Z`; after the decline revert the
assignment sat at `plan` with the speaker cleared and the stamp **still** `23:40:42.292Z`.

Automated evidence at this commit: **1161 tests across 82 files**, 43 of them new. `lint`,
`typecheck`, `harness:typecheck` and a production `build` all clean. Migration 028 applied to the
linked hosted project.

**This is the baseline.** If the last-prayed nudge, the four-stage prayer machine, the topic
ordering, the `approve`-only stamp, or the AI accept/reject boundary regress later, this commit and
these two scenarios are the known-good reference.

## What the review caught that the walkthrough did not

**One item, and it was in the evidence rather than the code.** The fast-Sunday screenshot was
captioned "two prayers" while showing only the invocation filled in, because the walkthrough had
skipped the second half of scenario 016's step 8. The user queried the discrepancy directly. The
app was never wrong — both prayers assign fine on a Sunday with zero speaking slots — but the
screenshot did not prove the claim its heading made. Re-walked, re-shot, and both slots verified in
the database.

The general lesson is worth keeping: **a walkthrough can tick every check and still leave a claim
unevidenced.** Ticking the box and demonstrating the behaviour are not the same act.

## What the walkthrough caught that the tests did not

Two checklist items describing states the UI **cannot reach**, both written from the plan and the
code rather than from the running app:

1. **Scenario 016 step 9** assumed an untouched prayer slot shows a disabled "Move to Asked". It
   shows no stage control at all — there is no row to move. The disabled-with-reason state is
   reached by assigning somebody and then removing them.
2. **Scenario 017 step 16** assumed a generic "send back a stage" button. There is none; the only
   backward move talks-b built is the decline path at `request`. Both scenarios corrected.

Separately, and found by reading `018_indexes.sql` rather than by walking: **migration 018 has a
UNIQUE index on `topics (ward_id, lower(title))`** that nothing in this slice was written against.
A duplicate title returned a 500 saying "please try again" for something retrying can never fix.
All three write paths now answer 409 naming the clash, and an accept that duplicates an existing
topic leaves the candidate `pending`. Covered by `tests/routes/topic-candidates.test.ts`.

## Still open — none of it blocks this confirmation

- **`prayer_assignments` keeps migration 019's ward-scoped select policy**, not the bishopric-only
  shape `topics` and `assignments` have. Any authenticated member of the ward can read, insert,
  update and delete prayer rows **at the database level**; the route's `talks.plan` check is the
  only write boundary. Raised rather than tightened as a side effect of this slice, per the plan.
  **Worth settling before Phase 6 puts prayer names on a public program page.**
- **No generic backward-move control exists in the UI.** `canTransition` allows any backward move
  for the bishopric with a reason and the route implements it, but the only button is the decline
  path. An approved plan cannot be sent back to review from the screen. Pre-existing from talks-b.
- **ITER-008** — the picker shows the last-prayed date but still orders by household and name, so
  finding who is overdue means reading every row. Raised by the user during this review.
- **The prayer and topic routes have no route tests.** `/api/topic-candidates` has a full suite
  because it is the route rule 3 rests on; `/api/prayers`, `/api/prayers/[id]`, `/api/topics` and
  `/api/topics/[id]` do not. The pure layer beneath them is exhaustive and the helper makes
  backfilling cheap.
- **The deployed build has not been opened for this area.** The same item remains open on the
  `talks-planner` record, which covers a different surface.
- **Neither scenario has been walked by a human on a real device.** The 375px checks were made in a
  resized desktop browser, which is not the same as a phone in a chapel foyer.
