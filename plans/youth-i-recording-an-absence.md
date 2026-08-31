# Plan: Youth-I — Recording That the Young Person Was Not There

**Created:** 2026-08-31
**Type:** feature
**Scope refs:** ITER-030
**Phase:** 8, slice I (follows `youth-h`)

---

## Overview

The support percentage on `/youth` measures the share of a young person's past **home** games where
at least one leader confirmed they went. It assumes the young person was at the game. **Nothing in
the schema can say they were not.**

So a youth who breaks an ankle in December and misses six games is measured, all winter, on six
games **nobody could have attended them at**, and every one counts against them. The number reports
neglect that did not happen — the exact failure `youth-f` refused in the other direction when it
declined to render `0%` for a young person with no home games.

### Why this is a gap, not a new idea

`carriesCoverageExpectation()` already excludes three categories from the denominator, all for one
reason — *this game could not have been a chance to support them*:

| Excluded | Because |
|---|---|
| `away` | No coverage expectation by design (`08-youth-activities.md` §Step 4) |
| `cancelled` | It did not happen |
| `tbd` | Not known to be a home game, and a wrong `away` guess is worse than asking |

"The young person was not there" belongs in that table and is missing from it. **This feature is a
fourth line in that function**, plus the storage that feeds it and the places that render it.

### Key requirements

1. A nullable three-state column on `activity_events`. `null` = nobody has said, `true` = taking
   part, `false` = not taking part. **Never inferred** from an empty attendee list or anything else.
2. Recorded **on the event row, past and future**, so an absence known in advance takes the game out
   *before* it drags the number down. The metric's horizon is *every past home game plus the next
   one*, so a future absence matters immediately.
3. Gated on **`youth_activities.manage`, ward-wide** — the same gate and the same RLS as `Cancel` on
   that event today. **No policy migration.**
4. A `false` event leaves **three** things: the support percentage, the coverage badge, and the
   follow-up prompt. It stays **visible and marked** everywhere it renders, and a follow-up can
   **still be written**.
5. Reversible. Pressing the active answer again clears back to `null`.

### Success criteria

- A past home game marked `false` disappears from `playedCount` / `attendedCount`; the pill's
  percentage and its sentence both change, from one computed value.
- The **next** home game marked `false` is skipped by `isExpectedNext()`, so the horizon moves to the
  one after it — or to `null` if there is none.
- A profile whose only home games are all marked `false` reads **an em dash, never `0%`**.
- The marked event still appears in every list, carrying a chip, and `Say how it went` still works.
- An ICS re-import **never** clears a mark.
- Lint, typecheck, 3200+ tests and `npm run build` all pass.

---

## Decisions taken before planning

All three of the scope's live open questions were put to the user on 2026-08-31 and answered:

| Question | Answer |
|---|---|
| Where is it recorded? | **On the event row, past and future** — beside `Cancel` in `EventList` |
| Who may record it? | **Anyone with `youth_activities.manage`** — ward-wide, exactly as `Cancel` is |
| What else does it stop? | **The number, the coverage badge and the follow-up prompt** — but it stays listed, marked, and a follow-up stays writable |

The scope's own recommendations are adopted for the two it had already argued: a **separate nullable
column** rather than a fourth `status` value (a game the young person missed still *happened*, and
other youth may have been at it under `youth-g`), and **no inference of any kind**.

---

## Relevant Files

### Create

- `supabase/migrations/061_activity_event_youth_attendance.sql` — the column and its CHECK.
- `components/youth/YouthAbsenceChip.tsx` — the marker, one component, three renderers. Mirrors
  `CoverageBadge` / `FollowUpBadge`.
- `tests/components/youth/YouthAbsenceChip.test.tsx`
- `testing/scenarios/youth/scenario-061-the-young-person-who-was-not-there/` (`scenario.md`, `seed.ts`)

### Modify — the pure core

- `lib/youth/coverage.ts` — `EventCoverageInput` gains `youthAttended`; a branch in `eventCoverage()`
  **beside `cancelled`, before the clock**; `describeYouthAbsence()` exported beside it.
- `lib/youth/profileNeed.ts` — **one line** in `carriesCoverageExpectation()`. `ProfileNeedEvent =
  EventCoverageInput`, so the type flows for free.
- `lib/youth/followUp.ts` — `FollowUpInput` gains `youthAttended`; a branch in `followUpState()`
  **only** — `isFollowUpWritable()` is deliberately untouched.

### Modify — schema, data access, route

- `lib/validation/youth.ts` — `youthAttended` on `updateActivityEventSchema`.
- `lib/youth/queries.ts` — `ActivityEvent.youthAttended`, `ACTIVITY_EVENT_COLUMNS`,
  `ActivityEventRow`, `mapActivityEventRow()`, `updateActivityEvent()`'s patch.
- `app/api/youth/events/[id]/route.ts` — a 400 for a ward-wide event; the value in the audit detail.
- `types/database.ts` — regenerated, **not hand-edited**.

### Modify — renderers

- `app/(app)/youth/EventList.tsx` — the control **and** the chip.
- `app/(app)/youth/calendar/ActivityCalendar.tsx` — pass the field; chip only.
- `app/(app)/youth/events/[id]/EventDetail.tsx` — pass the field; chip only.
- `app/(app)/youth/FollowUpPanel.tsx` — pass the field into `followUpState()`.
- `app/(app)/youth/YouthOverview.tsx` — pass the field into `SupportEvent`.
- `app/(app)/youth/history/[member_id]/page.tsx` — pass the field into `SupportEvent`.

### Modify — docs

- `CLAUDE.md` §9 — a new decision entry.
- `plans/INDEX.md` — the Phase 8 slice table gains a `youth-i` row.
- `.iterate/scopes/ITER-030.md` and `.iterate/BACKLOG.md` — plan link (done by this command).

---

## Dependencies

- **No new libraries.** Nothing is added to `package.json`.
- **No new RLS policy.** `activity_events` keeps migration 019's ward-wide write policies, which is
  what makes the chosen gate free.
- Existing utilities reused unchanged: `eventCoverage()`, `carriesCoverageExpectation()`,
  `followUpState()`, `writeAuditLog()`, `assertCan()`, the `patchMutation` already in `EventList`.
- `npm run db:types` after the migration applies. **`types/database.ts` is generated — never edit it
  by hand** (CLAUDE.md §5).

---

## Known Pitfalls (from retro context)

- **`youth-h` — a mirror of a policy must copy every clause, and a WITH CHECK failure *raises*.**
  Not directly triggered here (no policy changes), but the general lesson binds: if you find
  yourself adding an ownership helper for this control, mirror the whole policy or add none. **Add
  none** — `activityOwnership.ts` says deliberately that there is no `canManageActivityEvent()`,
  and this control gates on the permission alone exactly as `Edit` and `Cancel` do.
- **`youth-f` — the number, the sentence on the card and the sort must be one computed value.**
  Fifth sighting in this module. `describeActivitySupport()` and `supportedFraction` must both fall
  out of the same `activitySupport()` pass; do not filter absent events anywhere but inside
  `carriesCoverageExpectation()`.
- **`youth-f` / `visits-f` — a null percentage is not zero.** A profile whose only home games are
  marked absent now lands on `countedCount === 0` → `supportedFraction === null` → em dash, sorting
  **last**. Rendering `0%` there would put the one person nobody could possibly have supported at
  the top of "least supported". Assert it.
- **`youth-c` — an unmatched location is `tbd`, never `away`; near-miss matching is refused.** Third
  sighting, and the scope names it: **never infer an absence.** No branch may derive `false` from an
  empty attendee list, a cancelled sibling, or a missing follow-up.
- **`youth-e` — carry the whole row, not two fields of it.** `EventCoverage` already returns
  `attendeeCount` alongside the state; do not strip it when adding the branch.
- **`youth-b` — an ICS re-import writes four columns and no others.** `ImportedEventPatch` must not
  grow. A hand-marked absence has to survive every future import, exactly as a hand-cancelled game
  and a hand-corrected `event_type` do. Test it rather than assume it.
- **`youth-c` / `youth-b` — a server-only import in a client-importable module breaks the build and
  nothing else.** `coverage.ts`, `followUp.ts` and `profileNeed.ts` all carry a standing
  CLIENT-IMPORTABLE instruction. They may import types and each other; **never**
  `lib/youth/queries.ts`. `npm run build` is the only thing that catches a violation.
- **`youth-a` / `visits-d` / ITER-021 — a control the policy refuses is still a bug.** Here the
  policy refuses nothing (ward-wide writes), so the mirror mistake is the *other* one: **do not hide
  the control from someone the API would allow.** Gate on `canManage` alone.
- **`roster-b` / `visits-f` — a count computed after a filter answers a different question.** The
  occasion's "+N others" count in `ActivityCalendar` is built from the **unfiltered** list. Absence
  must not enter that count in either direction — it is about who else is at the game, which an
  absence does not change.
- **ITER-022 — colour must never be the only signal.** The chip carries **words**, not just a tone.

---

## Tasks

### Task 1: Migration 061 — the column and its constraint

**File:** `supabase/migrations/061_activity_event_youth_attendance.sql` (create)

**Action:** Add a nullable three-state column to `activity_events`, plus a CHECK tying it to the
presence of a profile.

```sql
alter table activity_events add column youth_attended boolean;

alter table activity_events
  add constraint activity_events_youth_attended_needs_profile
    check (youth_attended is null or profile_id is not null);
```

**Details — the header must carry all of this, in the house style:**

- **APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS, and — like 060 — it needs no row count to say so.**
  The constraint cannot fail on any existing row, and the argument is exact rather than statistical:
  the column it constrains **does not exist until this statement creates it**, and it is created
  `null` on every row. There is no `HELD_BACK_UNTIL_DEPLOYED` entry in
  `tests/db/migrations.test.ts` and **none should be added** — that allowlist is for the contract
  half of an expand-and-contract pair, and an unnecessary entry *hides* a migration from the
  assertion that everything on disk has been applied.
- **A SEPARATE COLUMN, NOT A FOURTH `status` VALUE.** `status` answers *did this event happen*. A
  game the young person missed **still happened** — other youth may have been at it, and under
  migration 059 it may share an occasion with rows entirely unaffected. Collapsing "the game was
  called off" and "Ethan was ill" into one column destroys the record of which is which, which is
  precisely what a presidency needs.
- **THREE STATES, AND `null` MEANS NOBODY HAS SAID.** The same idiom as
  `activity_attendees.confirmed_attendance`, `youth_activity_profiles.closed_at`,
  `activity_events.occasion_id` and 054a's `org_id` — absent means default, with no sentinel value
  meaning "present". A `not null default false` column would assert on every row that the young
  person took part, which is a fact nobody stated; that is `youth-c`'s `.default("tbd")` removal
  argument arriving again.
- **`true` IS NOT A NO-OP even though it behaves like `null` in today's arithmetic.** It keeps
  "assumed present" distinguishable from "confirmed present", and it is what gives the control a way
  back that is not a delete.
- **THE CHECK IS WHY THIS IS A CONSTRAINT AND NOT A COMMENT.** `profile_id` is nullable — a ward-wide
  event belongs to no young person, so "did *they* go?" has no referent there. The constraint makes a
  meaningless row a database error rather than a review miss. The route refuses it with a sentence
  first (Task 6); this is the guarantee behind it.
- **NO NEW RLS POLICY, AND THE OMISSION IS DELIBERATE — do not "notice" it later and add one.**
  Writing this column is an ordinary UPDATE on `activity_events`, which keeps migration 019's
  ward-wide write policies. That is the same boundary `Cancel` already runs under, and the user
  settled on 2026-08-31 that it is the right one: a leader from another organization marking a young
  person as not taking part is the same trust level as calling off their game, which the app already
  permits. `lib/youth/activityOwnership.ts` states that narrowing `activity_events` needs a migration
  **first** and a helper after; this slice narrows nothing, so it adds no helper.
- **NO INDEX.** Every read of this column arrives through `ACTIVITY_EVENT_COLUMNS` on a query already
  narrowed by `(ward_id, profile_id)` or `(ward_id, event_date)`; nothing filters on it.

---

### Task 2: `EventCoverageInput` and the branch in `eventCoverage()`

**File:** `lib/youth/coverage.ts` (modify)

**Action:** Add the field to the input type, add one branch to `eventCoverage()`, and export the
sentence beside it.

**Details:**

1. `EventCoverageInput` gains:

```ts
  // Migration 061. Whether the YOUNG PERSON this event belongs to is taking part. Null means
  // NOBODY HAS SAID — a third state, never a defaulted `true`, on the same reasoning
  // `confirmed_attendance` is nullable.
  //
  // NEVER INFERRED. Not from an empty attendee list, not from a cancelled sibling, not from a
  // missing follow-up. A person knows this and nothing else does — classifyLocation.ts's refusal
  // of near-miss matching, in a third place.
  youthAttended: boolean | null;
```

2. The branch goes **immediately after the `cancelled` branch and before `new Date(...)` is called** —
   the order is the rule, and this comment must say so:

```ts
  // ---------------------------------------------------------------------------
  // 1b. NOT TAKING PART, ALSO BEFORE THE CLOCK. SAME PLACE AS `cancelled`, SAME REASON.
  // ---------------------------------------------------------------------------
  // A game the young person is not at cannot be a chance to support them, AT ANY DISTANCE FROM
  // THE CLOCK — not three days out and not three days past. Testing it here is what makes that
  // true at every distance at once; testing it after the arithmetic would give the right answer
  // today and the wrong one for somebody reading the same row next week.
  //
  // `false` ONLY. `true` and `null` both fall through, because "they are taking part" and "nobody
  // has said" are the ordinary case, and the ordinary case is what the rest of this function is
  // about.
  if (event.youthAttended === false) {
    return { state: "not_expected", daysUntil: null, attendeeCount };
  }
```

3. Export the sentence, beside the computation that decides it:

```ts
// THE SENTENCE, BESIDE THE COMPUTATION THAT DECIDES IT — describeSeasonNeed()'s rule, and the
// reason three renderers cannot word this differently.
//
// TENSE-FREE ON PURPOSE. This chip renders on past AND upcoming events, and "wasn't there" reads
// wrong on next Friday's game while "won't be there" reads wrong on last Friday's. A present-tense
// sentence about TAKING PART is true of both, and it needs no clock — so this stays a pure function
// of one field and a name.
//
// NULL AND TRUE BOTH RETURN null, and the chip is absent. Taking part is the ordinary case, and a
// chip on every card saying so is noise — the same argument followUpState() makes for not labelling
// `confirmedAttendance === true`.
export function describeYouthAbsence(
  youthAttended: boolean | null,
  memberName: string | null,
): string | null {
  if (youthAttended !== false) return null;

  // "Someone" beats a blank where the profile is not in the reader's list — mapAttendeeRow's rule.
  return `${memberName ?? "This young person"} is not taking part`;
}
```

**Do not** touch `summariseCoverage()` or `worstCoverage()` — both consume `EventCoverage` and are
correct unchanged. `not_expected` already ranks last in `COVERAGE_STATES`, and `CoverageBadge`
already renders nothing for it, so a marked event quietly stops raising an alarm without a second
rule anywhere.

**Keep this file client-importable.** Types and nothing else.

---

### Task 3: The fourth line in `carriesCoverageExpectation()`

**File:** `lib/youth/profileNeed.ts` (modify)

**Action:** One line in one function, plus the comment that explains why it belongs there.

```ts
function carriesCoverageExpectation(event: ProfileNeedEvent): boolean {
  if (event.status === "cancelled") return false;
  if (event.youthAttended === false) return false;
  if (event.eventType !== "home") return false;
  return Number.isFinite(new Date(event.eventDate).getTime());
}
```

**Details:**

- `ProfileNeedEvent = EventCoverageInput`, so Task 2's type edit reaches this file, `SupportEvent`
  and every construction site **with no further type change** — and every site that fails to supply
  the field becomes a compile error. That is the intended mechanism: a new field the frontend model
  does not know about is silently dropped (CLAUDE.md §9), and a required field cannot be.
- Extend the file's exclusion-table comment from three reasons to **four**, in the same voice:

```
//   ABSENT — the young person is not taking part, so this game could not have been a chance to
//            support them. That is the SAME SENTENCE the other three exclusions are; ITER-030
//            found it missing from the list rather than proposing a new idea. It is a fact a
//            person stated (migration 061) and never one this code inferred.
```

- **This is the only place the exclusion lives.** Both `isExpectedPast()` and `isExpectedNext()` are
  this predicate plus a side of the clock, so the past half and the plan half stay in step by
  construction — which is what the function's own header says a second copy would destroy.
- **Nothing else in this file changes.** `describeActivitySupport()`, `youthNeed()`,
  `describeNothingRunning()` and the comparator all read numbers that now already exclude absences.
- **State the ITER-028 interaction in the header**, since the scope asks: `closed_at` removes a
  **whole profile** from the ranking, and this removes **an event** from a profile's arithmetic. They
  compose without interacting — a closed season's frozen number, recomputed against `closedAt` on
  `/youth/history/[member_id]`, excludes its absences too, and that is correct: the snapshot should
  say what was true at the closing instant, absences included.

---

### Task 4: The follow-up prompt, and the control that must survive it

**File:** `lib/youth/followUp.ts` (modify)

**Action:** Add the field to `FollowUpInput` and **one branch to `followUpState()` only**.

```ts
export function followUpState(input: FollowUpInput, asOf: Date): FollowUpState {
  const { isAttendee, hasLog, confirmedAttendance, youthAttended } = input;

  if (!isFollowUpWritable(input, asOf)) return "not_due";

  // 4. Something is written — unchanged.
  if (hasLog) return confirmedAttendance === false ? "did_not_attend" : "logged";

  // 4b. NOBODY IS BEING ASKED ABOUT A GAME THE YOUNG PERSON WAS NOT AT (migration 061).
  //
  // AFTER `hasLog`, AND THE ORDER IS THE RULE. A follow-up somebody ALREADY WROTE still reads
  // `logged`: the account exists, it is a record of something that happened, and demoting it to
  // `not_due` would hide a written pastoral note behind a fact recorded afterwards. What stops is
  // the PROMPT, not the record.
  if (youthAttended === false) return "not_due";

  if (!isAttendee) return "not_due";

  return "awaiting";
}
```

**Details — three things that must NOT change, and the header must say so:**

- **`isFollowUpWritable()` IS DELIBERATELY UNTOUCHED.** It answers "is this past and still a real
  event", and it is what renders the *control*. A leader who turned up and found the young person
  absent is exactly the person whose account is worth having, and hiding the button from them would
  be a workflow rule enforced in a component — the mirror of `youth-a-D1`, which this file's own
  header argues at length. **The prompt stops; the door stays open.**
- **`FollowUpPanel` needs no logic change.** It filters on `state === "awaiting"`, so marked events
  leave the panel automatically, and the heading count and the two lists still come out of **one**
  split (`visits-f`'s picker/denominator lesson, which the panel already states).
- **THIS DOES NOT CONTRADICT `youth-h`**, and the contrast is worth writing down because it looks
  like it does. `youth-h` deliberately left `FollowUpPanel` alone so a **closed season's** unwritten
  follow-ups keep appearing — closing ends the *ranking*, not the *obligation*, or Close becomes a
  way to dismiss work a leader committed to. Here the obligation genuinely never existed: nobody was
  expected to go, so nobody is being chased. Same panel, opposite answers, different reasons.

---

### Task 5: Validation and data access

**Files:** `lib/validation/youth.ts`, `lib/youth/queries.ts` (modify)

**Action:**

1. `updateActivityEventSchema` gains:

```ts
    // `.nullable().optional()` — ABSENT means leave it alone, explicit `null` means clear it back
    // to "nobody has said". The same three-way shape `location` already uses on this schema, and
    // the reason the control is reversible without a delete.
    youthAttended: z.boolean().nullable().optional(),
```

   Leave the `superRefine` "Nothing was changed" guard exactly as it is — a body of
   `{ youthAttended: null }` has one key and passes it.

   **`createActivityEventSchema` is NOT changed.** A new event is created with `null`, which is what
   "nobody has said" means, and a create form asking whether the young person will attend a game
   nobody has scheduled yet is a question with no occasion.

2. `lib/youth/queries.ts`:
   - `ActivityEvent` gains `youthAttended: boolean | null;` with a short comment pointing at
     migration 061 and stating that null means nobody has said.
   - `ACTIVITY_EVENT_COLUMNS` gains `youth_attended`. **Keep it ONE string literal on ONE line** — a
     `+` concatenation widens the type to `string` and defeats supabase-js's literal parsing of the
     select list, degrading every row to something untyped (`calendar-a`).
   - `ActivityEventRow` gains `youth_attended: boolean | null;`.
   - `mapActivityEventRow()` maps it.
   - `updateActivityEvent()` gains, beside the others:
     `if (input.youthAttended !== undefined) patch.youth_attended = input.youthAttended;`
     — the `!== undefined` test is what makes explicit `null` a clear and absence a no-op.

3. **`ImportedEventPatch` and `updateImportedEvent()` MUST NOT GROW.** Its comment already reads
   "FOUR COLUMNS AND NO OTHERS"; `youth_attended` joins `status` and `event_type` in what a
   re-import never touches, for the identical reason — a fact a person recorded by hand must survive
   every future import. Add the column to that comment's list so the guarantee is stated rather than
   merely true, and assert it in Task 10.

---

### Task 6: The route

**File:** `app/api/youth/events/[id]/route.ts` (modify)

**Action:** No new route and no new gate — `PATCH` already `assertCan(user, "youth_activities.manage")`
and already runs under the caller's client. Two additions:

1. **Refuse a ward-wide event with a sentence, before the write:**

```ts
// A WARD-WIDE EVENT BELONGS TO NO YOUNG PERSON, so "are they taking part?" has no referent.
// Migration 061's CHECK is the guarantee; this is the sentence, because a constraint violation is
// not something anybody can act on. VALIDATION, NOT A PERMISSION — the caller may edit this event
// in every other way, and CLAUDE.md rule 2's boundary is untouched.
const NO_YOUNG_PERSON =
  "That event is not on a young person's activity, so there is nobody to record as taking part.";
```

   Return **400** when `input.youthAttended !== undefined && input.youthAttended !== null &&
   existing.profileId === null`. Clearing to `null` on such a row is a no-op and needs no refusal.

2. **The audit detail carries the value**, beside the existing `status`:

```ts
          status: event.status,
          youthAttended: event.youthAttended,
```

**Why this rides on the ordinary PATCH rather than getting its own route** — write this down, because
a reader will weigh it against `close` and `occasion`, which both got one:

> `Cancel` is the exact sibling — same table, same gate, same effect on the support number — and it
> is an ordinary `PATCH` with its value in the audit detail. `POST /api/youth/profiles/[id]/close`
> exists because closing is a *different verb on a different table*; the occasion routes exist
> because `occasionWithEventId` needs a **server-side** decision about which occasion a row joins,
> which no patch body can express. Neither reason applies here. `changed: Object.keys(input)` already
> names `youthAttended`, and the detail above records what it became — so "why did Ethan's number
> move?" is answerable from the audit log without a second action name.

`writeAuditLog()` runs `redactSensitive()` over `detail`; a boolean carries no text and no name, so
nothing here needs holding back.

---

### Task 7: The chip

**File:** `components/youth/YouthAbsenceChip.tsx` (create)

**Action:** One presentational component, three renderers — the `CoverageBadge` / `FollowUpBadge`
pattern.

```tsx
export type YouthAbsenceChipProps = {
  youthAttended: boolean | null;
  memberName: string | null;
};

export function YouthAbsenceChip({ youthAttended, memberName }: YouthAbsenceChipProps) {
  const label = describeYouthAbsence(youthAttended, memberName);
  if (label === null) return null;
  return <span className={...}>{label}</span>;
}
```

**Details:**

- **THE WORDS COME FROM `describeYouthAbsence()`, NOT FROM THIS FILE.** Three screens render this
  chip and they must not word it differently — the sentence lives beside the computation that
  decides it, which is `describeSeasonNeed()`'s and `describeActivitySupport()`'s rule.
- **RETURNS `null` FOR `true` AND FOR `null`.** Absence of a chip is the ordinary case.
- **WORDS, NOT COLOUR ALONE** (ITER-022). Style it like the existing `Cancelled` chip in
  `EventList` — a bordered pill — but pick a **different tone from `--warning`**, which `Cancelled`
  owns. A cancelled game and an absent young person are different facts and must not read as one.
  Use a neutral/muted treatment: this is information, not an alarm, and the whole point of the
  feature is that it *removes* alarm.
- Must render correctly in **both themes** and at **375px**. `--surface` inverts meaning between
  themes — the trap `youth-follow-up-controls` recorded — so verify against a token, not a guess.

---

### Task 8: The control

**File:** `app/(app)/youth/EventList.tsx` (modify)

**Action:** Add the chip beside the existing `Cancelled` chip, and the control inside the existing
`canManage` block beside `Cancel`.

**Details:**

1. **The chip**, in the header row next to `<CoverageBadge />`, `<FollowUpBadge />` and the
   `Cancelled` chip:

```tsx
<YouthAbsenceChip
  youthAttended={event.youthAttended}
  memberName={profile?.memberName ?? null}
/>
```

   The card already resolves `profile` once per row for the ownership gate — reuse it, do not look it
   up a second time.

2. **The control**, inside the existing `{canManage && editing?.id !== event.id ? (...)}` block,
   after `Cancel`. **Render it only when `event.profileId !== null`** — a ward-wide event has no
   young person, and the route would refuse it.

   Two buttons in a `fieldset` with a `legend`, mirroring `FollowUpForm`'s "Did you go?" exactly —
   `variant={... ? "primary" : "secondary"}` plus `aria-pressed`, so the answer is conveyed by more
   than colour (ITER-022):

```tsx
<fieldset ...>
  <legend>Is {profile?.memberName ?? "the young person"} taking part?</legend>
  <Button aria-pressed={event.youthAttended === true}  onClick={...}>Yes</Button>
  <Button aria-pressed={event.youthAttended === false} onClick={...}>No</Button>
</fieldset>
```

3. **PRESSING THE ACTIVE ANSWER AGAIN SENDS `null`.** This is a deliberate divergence from
   `FollowUpForm`, which offers no way back, and the comment must say why:

```
// A CONTROL THAT CAN SET A VALUE AND NOT UNSET IT IS A ONE-WAY DOOR ON A METRIC. Marking the
// wrong game — or the right game for the wrong young person — must be undoable, and it must be
// undoable to "nobody has said" rather than to "they were there", which is a different claim.
// That is migration 060's rule for `closed_at` (nullable so a mistake is reopenable, and never a
// delete) applied to a column with the same power to move a number.
```

   Both buttons reuse the existing `patchMutation` — no new mutation, no new error surface:

```ts
patchMutation.mutate({
  id: event.id,
  body: { youthAttended: event.youthAttended === answer ? null : answer },
});
```

4. **The tense-free wording is a walk question, not a settled fact.** *"Is Ethan taking part?"* and
   *"Ethan is not taking part"* were chosen to read correctly on both a past and an upcoming game.
   Copy in this module has produced defects on every slice that shipped it — three in `youth-b`, five
   in `youth-c` — so put the wording to the user during the walk rather than treating it as done.

5. **Pass `youthAttended` into `eventCoverage()` and `followUpState()`** at their existing call sites
   (lines ~415 and ~463). Both become compile errors until you do, which is the point.

6. `FOLLOW_UP_MUTATION_INVALIDATES` / the existing `refresh()` already invalidate the events key, and
   this write changes only the event row. **No new invalidation is needed** — but check: the support
   pills on `/youth` are computed in `YouthOverview` from the **events** query, so an expanded card's
   mark must move the pill without a reload. Verify in the walk.

---

### Task 9: The other renderers

**Files:** `app/(app)/youth/calendar/ActivityCalendar.tsx`, `app/(app)/youth/events/[id]/EventDetail.tsx`,
`app/(app)/youth/FollowUpPanel.tsx`, `app/(app)/youth/YouthOverview.tsx`,
`app/(app)/youth/history/[member_id]/page.tsx` (modify)

**Action:** Pass the new field through, and render the chip where a card renders.

| File | Change |
|---|---|
| `ActivityCalendar.tsx` | `eventCoverage({... youthAttended: event.youthAttended})` in the `rows` memo; `<YouthAbsenceChip>` on the card. `memberName` is already on the row. |
| `EventDetail.tsx` | `eventCoverage({... youthAttended: event.youthAttended})`; `<YouthAbsenceChip>` on the event's own block **and** on each occasion sibling's row, since each is a different young person with their own answer. |
| `FollowUpPanel.tsx` | `followUpState({... youthAttended: event.youthAttended})`. Nothing else. |
| `YouthOverview.tsx` | `youthAttended: event.youthAttended` in the `SupportEvent` literal. |
| `history/[member_id]/page.tsx` | the same line in its `SupportEvent` literal. |

**Details:**

- **The CONTROL goes in `EventList` and nowhere else**, deliberately. `youth-h` refused to add a
  second "unlink" entry point on the ground that *a second entry point would be a second meaning of
  the same word*, and the same applies. `/youth/events/[id]` is the closest call — it is that event's
  own page — so record the omission rather than leaving it looking like an oversight, and **ask about
  it in the walk**: if a leader reaches for it there, adding it is one prop, not a redesign.
- **`ActivityCalendar`'s occasion count must not change.** It is built from the **unfiltered** events
  list and answers "who else is at this game", which an absence does not alter. Touching it would be
  `roster-b` a fourth time.
- **`ActivityCalendar`'s ZONE TRAP is untouched** — a card is bucketed into a day in the same zone its
  own time is printed in. Nothing here reads or formats a date.
- **`history/[member_id]` is where ITER-028 and ITER-030 meet**, and they compose with no extra code:
  the closed season's number is recomputed against `closedAt`, and `carriesCoverageExpectation()` now
  excludes absences from that pass too. Assert it (Task 10) rather than assume it.

---

### Task 10: Docs

**Files:** `CLAUDE.md`, `plans/INDEX.md` (modify)

**Action:**

1. A new §9 entry, in the established voice, immediately after the `closed_at` entry. It must carry:
   - The rule: **a young person can be recorded as not taking part, and that removes the event from
     the support number, the coverage badge and the follow-up prompt while leaving it visible,
     marked, and open to a follow-up.**
   - That this is a **fourth line** in `carriesCoverageExpectation()`, joining `away`, `cancelled`
     and `tbd`, all four being one sentence.
   - **Three states, null means nobody has said**, and **never inferred** — the third sighting of
     `classifyLocation.ts`'s refusal.
   - **Ward-wide, on `youth_activities.manage`**, the same gate as `Cancel`, and that **no policy
     moved** — with the note that `activityOwnership.ts` still has no `canManageActivityEvent()` and
     narrowing `activity_events` would need a migration first.
   - The **`FollowUpPanel` contrast with `youth-h`**: a closed season keeps its obligation, an absent
     young person never created one.
   - That `isFollowUpWritable()` is untouched, so **the prompt stops and the door stays open**.
   - That an **ICS re-import never clears it**, joining `status` and `event_type`.
2. `plans/INDEX.md` — add a `youth-i` row to the Phase 8 slice table and update the phase line to nine
   slices. Note that ITER-030 is closed by it.

---

## Testing Strategy

Tests accompany the code (CLAUDE.md §8). The pure functions carry the weight here — this is a
metric change, and the arithmetic is where a mistake would be silent.

### `tests/lib/youthCoverage.test.ts` (extend)

- `youthAttended: false` → `not_expected` **at every distance**: 30 days out, 1 day out, exactly
  `asOf`, and 30 days past. This is the test that proves the branch sits before the clock.
- `false` **beats an otherwise-uncovered home game** — a home game inside the notice window with zero
  attendees reads `not_expected`, not `uncovered`.
- `true` and `null` behave **identically** to the pre-change behaviour across every existing case.
- `daysUntil` is `null` and `attendeeCount` is **preserved** on the absent branch (`youth-e`'s
  carry-the-whole-row lesson).
- `describeYouthAbsence()` — `false` with a name, `false` with `null` name → "This young person…",
  `true` → `null`, `null` → `null`.

### `tests/lib/youthProfileNeed.test.ts` (extend)

- A past home game marked `false` leaves `expectedPastCount`, `playedCount`, `attendedCount` and
  `unattendedRun`.
- **The horizon moves.** Given upcoming home games on the 5th and the 12th with the 5th marked
  `false`, `nextEvent.eventDate` is the **12th**. Given only the 5th, `nextEvent` is `null`.
- **A profile whose every home game is marked `false` has `supportedFraction === null`, not `0`** —
  and `describeActivitySupport()` returns `null` with it. Assert both, and assert it sorts **last**
  through `compareYouth` in **both** directions. This is the `visits-f` shape and the single most
  likely regression.
- An absent game does **not** change `worstUpcoming` in a way that outranks a real one — it resolves
  to `not_expected`, which ranks last.
- **Composition with `closed_at`:** a closed profile's `activitySupport(profile, events,
  new Date(closedAt))` excludes absences too.

### `tests/lib/youthFollowUp.test.ts` (extend)

- `false` + no log + attendee → `not_due` (was `awaiting`).
- `false` + **a log** → still `logged`, and still `did_not_attend` when
  `confirmedAttendance === false`. **The record survives the mark.**
- **`isFollowUpWritable()` is unchanged** for `false` — assert it explicitly, because this is the
  line that keeps the control reachable and a later "consistency" edit is exactly what would remove
  it.
- `true` and `null` unchanged across the existing table.

### `tests/lib/youthValidation.test.ts` (extend)

- `updateActivityEventSchema` accepts `true`, `false`, `null`, and absence.
- Rejects `"false"` and `0`.
- `{ youthAttended: null }` alone passes the "Nothing was changed" refinement.

### `tests/routes/youthEvents.test.ts` (extend — real RLS, real hosted DB)

Follow the harness in `tests/helpers/routeClient.ts`; `params` is a Promise.

- PATCH sets `false`; **read the row back with the service client** and assert the stored value.
- PATCH `null` clears it.
- PATCH `youthAttended` on an event whose `profile_id` is null → **400**, and the row is unchanged on
  re-read.
- The audit row for the write carries `youthAttended` in its detail and `youthAttended` in `changed`.
- A **cross-ward** PATCH → 404, with the row re-read to prove nothing was written. An RLS-denied
  UPDATE is a **zero-row success, not an error** — assert by re-reading, never by expecting a throw.
- An `org_president` from a **different organization** succeeds — this is the ward-wide gate, and a
  test asserting it is what stops somebody "tightening" it without a migration.

### `tests/routes/youthCalendarImport.test.ts` (extend)

- An event marked `false`, then matched by a re-import, **keeps the mark** — alongside the existing
  `status` and `event_type` assertions. `youth-b`'s guarantee, extended by one column.

### `tests/components/youth/YouthAbsenceChip.test.tsx` (create)

- Renders the sentence for `false`; renders **nothing** for `true` and `null`.
- Uses the member's name; falls back when the name is null.
- The label text comes from `describeYouthAbsence()` — assert the component and the function agree,
  so a second wording cannot appear.

### Not tested

No RLS suite is added. **No policy changed**, and `tests/rls/youth-activity-scope.test.ts` already
covers `activity_events` writes; adding a suite that asserts the ward-wide behaviour a second time
would be a copy that can drift.

---

## Test Scenarios (Harness)

### Scenario 061: The young person who was not there

**Directory:** `testing/scenarios/youth/scenario-061-the-young-person-who-was-not-there/`
**Tags:** `[youth, full, absence, support]`
**Part:** 11

**Purpose:** The support percentage cannot be judged from a screenshot — it is a fraction over a
season, and the thing to prove is that a number **moves in the right direction for the right
reason**. Seeding is what makes that observable: it needs a young person with a real percentage
already on the card, a run of past home games, and an upcoming one, so that marking a game changes a
number that was visible a moment before. Building that by hand is an afternoon of clicking and wrong
the moment the clock moves.

It also has to prove the three **absences** — the pill's number, the coverage badge, the follow-up
prompt — and the two **presences**: the event stays listed and marked, and the follow-up control
still works.

**Seed data summary:**

- **Ward** — Harness Test Ward, `home_venues: ["Lincoln High School"]`, `cross_org_visibility: false`
- **Users** — `bishop@…`, `ym-president@…` (**the account to sign in as**), `yw-president@…`,
  `ward-council@…` (no organization)
- **Members / households** — 3 households, 4 youth
- **Profiles** — Ethan · *Varsity basketball* (Young Men, running); Josh · *Track* (Young Men,
  running); one **closed** profile on Ethan, so the `closed_at` interaction is on screen
- **Events** on Ethan's basketball, all `home` at Lincoln High School:
  - **6 past games.** Two with a confirmed attendee → the card opens at a real, non-trivial
    percentage that a mark will visibly change
  - **1 upcoming game with nobody signed up** → the plan half reads *"nobody is down for the next
    one"*, and a second upcoming game behind it so the horizon has somewhere to move to
  - **1 past `away` game and 1 `cancelled` game** — already excluded, so the walk can check the new
    exclusion reads the same as the three that exist
- **A follow-up** written by `yw-president` on one of Ethan's past games, so *"the record survives the
  mark"* is checkable rather than theoretical
- **A ward-wide event** (`profile_id` null) so the refusal is reachable from the UI

**Tester action:** Sign in as `ym-president`. On `/youth`, note Ethan's pill percentage and its
sentence. Expand the card, mark three past games *No*, and watch the pill. Mark the **next** upcoming
game *No* and watch the plan half point at the game after it. Open `/youth/calendar` and confirm the
marked games carry the chip and no longer raise a coverage badge. Confirm *Waiting on your follow-up*
no longer lists them — and that *Say how it went* still opens on one. Press *No* again to clear it
back and confirm the number returns. Try the control on the ward-wide event.

**Verification checklist:**

- [ ] Ethan's pill percentage **changes** when a past home game is marked *No*, and its sentence
      changes with it — both from the same value
- [ ] Marking **every** past home game and the next one leaves the pill showing an **em dash**, never
      `0%`, and the card sorts **last** under *least supported* in **both** sort directions
- [ ] Marking the next upcoming game moves the plan half to the **following** game — read the date
      off the sentence, not off the schedule
- [ ] A marked game **still appears** in the event list and on the calendar, carrying the chip
- [ ] A marked game shows **no coverage badge**, at 30 days out and in the past — check one of each
- [ ] The marked game leaves *Waiting on your follow-up*, and the heading **count** drops with it
- [ ] *Say how it went* is **still offered** on a marked past game, and saving one works
- [ ] The follow-up `yw-president` already wrote **still shows** on its marked game with its badge
      intact
- [ ] Pressing the active answer again clears to *nobody has said* and the percentage returns to
      exactly its earlier value
- [ ] The control does **not** render on the ward-wide event; a direct `PATCH` against it answers
      **400** with a sentence, and the row is unchanged on re-read
- [ ] Every value is read back with the **service client**, never off the screen
- [ ] The chip is legible in **light and dark** and does not overflow at **375px**
- [ ] The chip is visibly **distinct from the `Cancelled` chip** — two different facts, two
      treatments
- [ ] Nothing on the closed season's card changed, and `/youth/history/[member_id]` still shows its
      frozen number
- [ ] **Judgement:** does *"Is Ethan taking part?"* / *"Ethan is not taking part"* read correctly on
      an upcoming game **and** on one played last month?
- [ ] **Judgement:** should this control also appear on `/youth/events/[id]`?
- [ ] **Judgement:** with the prompt gone, is there anything left telling a leader **why** they are
      no longer being asked about that game?

---

## Validation Commands

```bash
# Apply the migration to the hosted project, then regenerate types
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck

# Tests (hits the hosted project — RLS and route suites are real)
npm test

# Production build — REQUIRED, and not optional here
npm run build
```

**`npm run build` is not a formality in this module.** `youth-c` recorded that a server-only import
reaching a client component was caught by the build where lint, typecheck and 2982 tests all passed.
Tasks 2, 3 and 4 edit the three files carrying a standing CLIENT-IMPORTABLE instruction, so the build
is the only check that matters for that class of mistake.

---

## Integration Notes

- **Nothing moves on the day this ships.** Every existing row is `null`, `null` is the ordinary case,
  and no computation changes for it. This is the `household_stewardships` / `closed_at` idiom: absent
  means default, so no ward's `/youth` moves until somebody presses a button.
- **`types/database.ts` must be regenerated, not hand-edited**, and `ActivityEvent` in
  `types/domain.ts`-adjacent code (`lib/youth/queries.ts`) updated in the **same change** —
  CLAUDE.md rule 9. A column the frontend model does not know about is silently dropped with no
  runtime error.
- **The type change is the safety net.** `ProfileNeedEvent = EventCoverageInput` and
  `SupportEvent extends ProfileNeedEvent`, so adding one **required** field to `EventCoverageInput`
  makes every one of the five construction sites a compile error until it is supplied. Do **not**
  make it optional to avoid the errors — the errors are the mechanism.
- **No breaking API change.** `youthAttended` is optional on the PATCH body, so existing clients are
  unaffected.
- **Migration 051 is still pending a deploy** per `plans/INDEX.md`. It is unrelated to this work and
  must not be swept along with `db:push` unnoticed — check what `db:push` intends to apply before
  running it.
- **What this deliberately does not do:**
  - **No inference, anywhere.** Not from an empty attendee list, a cancelled sibling, or a missing
    follow-up.
  - **Not a register.** `activity_attendees` is leaders and stays leaders. This records an
    **exception** so a metric stays honest; it must not grow into youth attendance tracking.
  - **The horizon is not reopened.** `youth-f`'s "every past home game plus the next one" was set by
    the user and is untouched.
  - **No notification.** A mark fires nothing. Phase 11 already inherits six clock-driven things and
    this adds no seventh.
  - **No occasion interaction.** `activity_events.profile_id` is a single foreign key, so the column
    is unambiguously about **one** young person; team-mates sharing an occasion each carry their own
    answer, and the "+N others at this game" count is unaffected in either direction.
