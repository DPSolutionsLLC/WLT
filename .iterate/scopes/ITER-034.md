# ITER-034: Youth Support — the module the user actually wants

**Type:** Architecture / Product direction
**Status:** PARKED 2026-08-31, captured in full
**Parked because:** the user chose to finish the remaining phases first and refine each tool
afterwards, from inside a working app — *"i will work on each tool to bring them into my vision."*
Phase 8 stays exactly as built. Nothing here is cancelled; it is deferred until the build is done.
**Plan:** none yet
**Created:** 2026-08-31
**Raised by:** the user, 2026-08-31, after walking scenarios 062 and 063 — *"i feel like this is
getting so messy… little gains, but not much for as much time as we are spending here. let me try
to more fully explain what i want as specifically as possible."*

## Why this exists

**This is the destination. Everything Phase 8 has built so far is a partial, and some of it is
aimed slightly wrong.** The user set it out in one go and it should be read as a whole before any
of it is built. It was captured mid-explanation — **the message was interrupted, so the section on
navigation and filters is the last thing recorded and there may be more the user had not yet
said.** Ask before assuming this is complete.

**Do not plan this as a slice.** It is bigger than `youth-a` … `youth-j` put together, and the
user's own instruction is to stop building against a spec and start iterating inside a working
app. Read it, then agree with them where to cut the first genuinely useful piece.

---

## 1. The name, and the reason for it

**The module is "Youth Support", not "Youth Activities".** In the user's words, the distinction is
deliberate: ward and youth *church* activities are a given — a leader will be there as a matter of
course. This module is about the activities **outside** church.

**The goal, stated plainly:** make sure a leader from church is present at **every home game at
least**, and that while they are there they are **making contact with the individual youth** — so
the young person is receiving church support outside of church.

That sentence is the whole product. Every screen should be answerable against it.

---

## 2. Building the calendar of events — MANUAL ENTRY IS THE PRIMARY PATH

**The user has effectively cut automatic school-calendar linking:** *"i almost feel that it will be
overly difficult to create a means to automatically link school calendars and what not."* This does
not delete `youth-b`'s ICS import, but it demotes it: the path to design for is **a form inside the
app, filled in by a person.**

### The activity hierarchy — A PARENT WITH SUB-CATEGORIES

This is a real model change. Today `youth_activity_profiles` is flat.

- A **parent activity** — e.g. *Basketball* — holds the shared facts: **the season**,
  **girls/boys**, and similar category-level information.
- **Sub-categories beneath it** — e.g. *Varsity*, *JV*, *Freshmen*.
- Leaders decide how far to break it down, and *"the most logical way is to break it down as much
  as possible to be able to tie an individual youth to that activity."*

`youth-j`'s roster sits underneath this: a sub-category is what has a schedule and a roster.

### A PHOTO OF A SCHEDULE, READ BY AI, CONFIRMED BY A PERSON

*"it would be great to build in a feature for a user to be able to upload a picture of a schedule
and have ai create a filled out form for submission once it is confirmed to be correct by the
user."*

This is squarely inside CLAUDE.md rule 3 — the AI fills in a **draft form**, and a human confirms
it before anything is written. It is the same preview-then-confirm shape `youth-b`'s ICS import
already uses, with a different input. **The existing import wizard is the pattern to reuse, not
replace.**

---

## 3. Editing a schedule — LOCKED ONCE PEOPLE HAVE COMMITTED

A rule with a clear line in it:

- An event is **editable** while it has no commitments and no follow-ups against it.
- **Once there have been commitments and follow-ups made on an event, it is locked in.**

This is close to what `youth-h` already reasoned about for `Remove` (a pastoral record must not be
destroyed), and the same instinct should govern editing.

### RE-UPLOADING THE REST OF A SEASON

The case the user named: a basketball season has *"numerous changes to the schedule for the second
half of the season."* The flow they want:

1. The user uploads a picture of **the remaining season**.
2. AI builds it out into the same form.
3. On approval, the app shows **a summary of the changes**.
4. **Where an existing event had commitments and is changing, the committed leaders are
   notified.**

That notification is the first genuinely *event-driven* notification in this module — it fires from
a human action, not from a clock, so it does **not** join Phase 11's six clock-driven items.

---

## 4. Seasons recur — REMEMBER, DO NOT PRE-CREATE

*"have the app track once a season is entered for an activity, it is assumed that it will need to
be created every year after that. so maybe if it planned out 1yr in advance? not to enter next
years schedule in advance, but to just make sure to remember to enter it the next year."*

The distinction matters and is easy to get wrong: **the app remembers that a schedule will be
needed again; it does not invent next year's events.** A reminder, not a projection.

---

## 5. Navigation — THE LAST THING SAID BEFORE THE MESSAGE WAS INTERRUPTED

- **Filters are definitely needed:** year, season, girls/boys, parent activity, *"and whatever
  other categorical filter could be useful."*
- **It needs to be easy to see an overview of the current activities.**
- **Past activities are hidden shortly after the season ends by default**, with the ability to
  look at them still.

That last point overlaps `youth-h`'s `closed_at` and `/youth/history/[member_id]`, but is broader:
the user is describing an automatic fade based on the season ending, where today closing is a
manual act.

---

## What already exists and should be reused

- **Preview-then-confirm**, end to end (`youth-b`): a wizard that writes nothing until a person
  approves, and names what will change.
- **The roster and the window function** (`youth-j`): `activity_roster`,
  `activity_event_participation`, `memberIsExpectedAt()`.
- **Coverage computed on read** (`youth-c`): badges, the strip, `home`/`away`/`tbd`.
- **The follow-up half** (`youth-d`): `activity_logs`, private notes, the report feed — this is
  where *"making contact with the individual youth"* is already recorded.

## What is aimed wrong and will need revisiting

- **The flat activity model.** No parent/sub-category exists; `youth_activity_profiles` is one
  level, and the parent's shared facts (season, girls/boys) have nowhere to live.
- **ICS import as the primary path.** It stays, but manual entry and photo-to-form become the
  routes that matter.
- **Editing is currently unrestricted** on any event, regardless of commitments.
- **`/youth` is organised around the young person.** The user's overview is organised around
  **current activities**, with the youth reachable through them.

## Open questions to settle WITH the user before planning

1. Does the parent/sub-category split replace `youth_activity_profiles`, or sit above it?
2. Is "girls/boys" a property of the parent activity, or derived from the roster?
3. What exactly locks an event — any commitment, or a written follow-up?
4. How long is "shortly after the season ends"?
5. Which model reads the schedule photo, and what happens when it reads it wrong?
