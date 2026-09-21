# Youth Activity Support — Portable Module Spec

**Purpose:** this is a self-contained transfer of a youth-activity-support module that was
designed, built, walked in a browser and revised eleven times in a production Next.js +
Postgres app. It carries the data model, the decision rules, and the exact logic of every
computed value — plus the reason behind each, because the reasons are what stop a
reimplementation "improving" a rule back into the bug it was written to prevent.

**How to use it:** paste this whole document into your prototype session and say:

> Build the youth activity support module described below. Adapt the storage and framework
> to this prototype's stack, but implement every rule in §2 and every function in §4 exactly
> as specified — those are settled decisions with costs behind them, not preferences. Where a
> rule cannot be expressed in this stack, say so rather than silently dropping it. Before
> writing code, restate the data model back to me and list the files you will create.

Nothing below depends on Next.js, Supabase or Postgres except where it says so explicitly.
Every rule in §2 and every function in §4 is storage-agnostic.

---

## 1. What the module is for

A ward's young people play school sports, perform in concerts, compete in academic teams.
Ward leaders want to **turn up and support them** — and the module exists to answer four
questions nobody could otherwise answer:

1. **Is anybody going to Friday's game?** (coverage)
2. **Which young person is getting the least support?** (the ranking)
3. **Somebody went — what happened, and does anybody need to know?** (follow-up)
4. **Whose games are these, and when?** (the calendar)

It is **not** an attendance system for the young people, and it is not a scheduling tool.
It records leaders' support of youth, and a pastoral account of how it went.

### The single most important modelling fact

**A "profile" is a TEAM, not a young person.** The first version made it one young person's
copy of a schedule, and eight players on a twelve-game season meant eight profiles, eight
imports of the same file, and 96 rows for 12 real games. The correct model is:

> **Import one schedule once. Assign each young person to the team once. Everything after
> that is an exception.**

The table is still named `youth_activity_profiles` in the origin codebase for churn reasons.
**In a fresh prototype, name it `activity_teams` or `teams`.** The name below is written as
`team` throughout; map it however you like, but do not let it mean "one youth's season".

---

## 2. The non-negotiable rules

These are the module. Implement them exactly. Each has a one-line reason; the reason is the
part that matters when a future change looks like an improvement.

### 2.1 Computed on read, never stored

**Coverage, follow-up state, the support percentage, a closed season's final number, and
"is this young person expected at this game" are all pure functions. None is a column.**

*Why:* every one of them is decided partly by the clock. A stored value the clock decides
goes stale the moment nothing refreshes it — and in a prototype (as in the origin app)
**nothing refreshes anything**: no cron, no scheduled job, no background worker. A column
called `covered` is wrong by Tuesday and nothing says so.

A first version stored `covered` / `uncovered` / `completed` on the event. All three were
dropped. Do not add them back. `status` holds only facts **a person knows**.

### 2.2 `asOf` is always a parameter, never `new Date()` inside

Every function that consults the clock takes the instant as an argument. The page resolves
**one** `asOf` per render and passes it down.

*Why:* it makes both sides of every boundary testable, and it keeps every row of one screen
judged against the same instant rather than against a clock that moves down the list.

### 2.3 The order of branches *is* the rule

In `eventCoverage()` and `followUpState()`, `cancelled` and `not taking part` are tested
**before the clock is consulted**.

*Why:* a cancelled game must read "no expectation" at *every* distance from now — three days
out and three days past. Testing it after the date arithmetic gives the right answer today
and the wrong one for whoever reads the same row next week.

### 2.4 Absent means default. `null` is a third state, never a defaulted `false`

Five places, one idiom:

| Field | `null` / absent means | Never |
|---|---|---|
| `team.org_id` | ward-wide, everybody's | a sentinel "all orgs" row |
| `team.closed_at` | the season is still running | a boolean `is_closed` |
| `event.occasion_id` | this game is only this team's | a sentinel "alone" occasion |
| `attendee.confirmed_attendance` | nobody has said either way | `false` |
| no `participation` row | nobody has said whether they're taking part | assumed present |

*Why:* `NOT NULL DEFAULT false` asserts on every row a fact nobody stated. The distinction
between "somebody said no" and "nobody has said" is the whole basis of §2.5.

**And `null` is not `0`.** See §4.6 — this is the single most likely bug in the module.

### 2.5 Never infer. Absence of evidence is not evidence

Four separate places refuse near-miss matching, and every one of them will look like a
missed opportunity to a later reader:

- **An unmatched venue is `tbd`, never `away`.** "Lincoln HS Gymnasium" and "Lincoln High —
  auxiliary gym" both fail to match "lincoln high school", and both are home games. An
  `away` event carries **no coverage expectation by design**, so a wrong `away` guess
  silently removes the game from the model — nobody is asked, nobody notices, no badge
  anywhere says so. `tbd` is loud instead and asks a person. **`away` is always a human's word.**
- **A shared occasion is explicitly linked, never matched on title + date.** Two feeds write
  one fixture as "Game against Roosevelt" and "Game vs Roosevelt"; a matcher that caught
  that would also join two *different* games at the same school on one evening.
- **"Not taking part" is never inferred** — not from an empty attendee list, not from a
  cancelled sibling event, not from a missing follow-up, and not from an empty roster.
- **Matching is deliberately boring:** lower-case both sides, collapse whitespace,
  `includes()`. No fuzzy matching, no Levenshtein, no tokeniser. A near-miss a clever matcher
  would catch is exactly the case where a person should be asked — and a clever matcher that
  is wrong is worse than a dumb one that abstains, because the dumb one's failure is visible
  on the card and the clever one's is not.

### 2.6 An empty roster stays LOUD; a closed season goes quiet

Both produce "zero young people expected at this game", and they must **not** collapse into
one answer.

- **Season closed** → no expectation. Quiet. Nothing is asked of anybody.
- **Nobody assigned to the team yet** → **ordinary coverage**, so a freshly imported season
  reads "Nobody going" until somebody assigns the players.

*Why:* "import once, then assign" means every ward passes through the empty-roster state on
every schedule they import. Answering it "no expectation" would silently drop a whole fresh
season out of the model. **This is the branch a future tidy-up will invert** — guard it with
a test that says so in the test itself.

### 2.7 The prompt stops; the door stays open

When a young person is marked as not taking part, three things go away: the support number,
the coverage badge, and the **prompt** for a follow-up. The event stays **listed and marked**,
and a follow-up can still be **written**.

*Why:* a leader who turned up and found the young person absent is exactly the person whose
account is worth having. Hiding the button from them would be a workflow rule enforced in a
component, refusing something the data layer allows.

Same logic, opposite direction, for a **closed season**: closing ends the *ranking*, not the
*obligation*. A closed team's unwritten follow-ups keep appearing, or "Close" becomes a way
to dismiss work a leader committed to.

### 2.8 Refuse, and name the alternative

Destructive actions do not silently do something adjacent, and they do not just say no.

- **Remove a team** is offered **only when it has zero events.** The server refuses
  independently with a **409 and a sentence naming Close** when any follow-up exists.
- The refusal **discloses neither the count nor any content** — the person deleting may not
  be entitled to know whose follow-ups those are.
- **Close is the primary control; Remove is the exception.** Closing destroys nothing and is
  reversible by the same route.
- **Merging two occasions is refused**, with a sentence naming the alternative. Absorbing one
  into the other would move rows nobody named.

*Why:* the delete cascaded through a season, every sign-up, every follow-up and every private
note, behind a confirm dialog. **A dialog that can be clicked through is not protection.**

### 2.9 Reversible, and never a delete — except where nothing was written

- `closed_at` is **a timestamp, never a boolean**, and nullable so a mistake is reopenable.
- Pressing the active answer again on a three-state control clears it to `null`, rather than
  flipping to the opposite claim.
- **Clearing a participation row DELETES it**, and that breaks no rule — the row holds no
  text, no account and no author's words. "Never a delete" protects a record somebody *wrote*.

### 2.10 Every date formatter names its zone

**No `Intl.DateTimeFormat` or `toLocale*` call anywhere may omit an explicit `timeZone`.**

*Why, from production:* a client component is server-rendered before it is hydrated, so on
the server `undefined` resolves to the **server's** zone. A 7:30pm Friday game shipped as
"Sat, 2:30 AM" — wrong day, seven hours out. It was invisible in dev, where both sides shared
a zone, and **no assertion about a formatted string can catch it**, because a test process has
one zone. Enforce it by scanning the source in a test.

Which zone is a per-case decision, and the codebase needs both:

- A **turn-up-at time** (an event's start) renders in the **ward's own zone**. A ward is one
  geographic congregation, so it is nearly every reader's zone anyway — and the leader who is
  travelling wants "7:30pm", the hour the game starts and the hour you'd say aloud.
- A **date-only column** or a "when did this happen" stamp renders in **UTC**.
- **No zone marker is rendered beside the time.** The ward's clock is the assumption the whole
  rule rests on; labelling it would suggest the reader might be looking at some other zone.

Never `date.toISOString().slice(0, 10)` to get a day — that is UTC, and it puts a 7:30pm
Friday game on Saturday. A card must be **bucketed into a day in the same zone its own time
is printed in**.

### 2.11 Reads are ward-wide; writes are org-scoped. Follow-ups are the exception

- **The calendar, the teams, the rosters, the events and the sign-ups are readable by the
  whole ward.** Seeing across organizations is the entire reason a ward council exists.
- **Writing is scoped to the owning organization.** An Elders Quorum president entering an
  activity "for the Young Women" is not coordination; it is somebody believing they did
  something they did not.
- **A pastoral follow-up is org-scoped on the READ too**, deliberately opposite to everything
  else. A follow-up note is not coordination data.
- **A private note is private forever** — readable only by its author. Not by the bishop, not
  by an admin, not by a support query. Wider reads on shared work do not widen a private note
  by one row.

**The read used to compute a shared number must be uniformly evaluable.** The roster decides
a denominator and the attendee count decides a badge — so if one reader could see a row
another could not, the same game would read *covered* to one leader and *uncovered* to
another from the same data. Any table feeding a computed shared value gets a ward-wide read.

### 2.12 A UI gate must mirror the data gate exactly — both halves

If the data layer's rule for an update has a "may I touch this row" half **and** a "may the
result look like this" half, the UI check must mirror **both**. Mirroring only the first
leaves a shape where the row is admitted and the result refused — which surfaces as a 500,
not a clean refusal, because every other refusal in the system is quiet.

And the converse failure, which showed up **three separate times** in this module's history:
**never render Edit/Remove on work the viewer cannot change.** The data layer refused it
safely every time, but a leader was invited through a locked door. If the UI declines what
the API would allow, that is quiet and recoverable. The reverse is the bug.

### 2.13 One computation, one answer

A count in a heading and the rows beneath it must be **two renderings of one computation**,
never two computations that can disagree. Carry the whole object, not three fields off it.

*Why, from a walk:* every covered card read `Covered · 0` above an event card reading
`Covered · 1`, because the summary carried the *state* and the *date* but not the *count* of
the event it described — and the existing test pinned the state, so the wrong number passed.

Corollary: **a filtered view still reports unfiltered truth.** Filter the calendar to one
young person and the honest answer is still "+2 others at this game", not "+0".

---

## 3. The data model

Adapt the types to your stack. Every column's nullability is a decision — see §2.4.

```
team  (origin name: youth_activity_profiles)
  id
  ward_id            -- every table has it; every query filters on it
  activity_name      not null   -- "Varsity Soccer", "Concert Band"
  activity_type      not null   -- sport | performance | academic | community | other
  school_org         null       -- "Lincoln High School"
  season_schedule    null       -- FREE TEXT. Nothing computes against it.
  notes              null
  org_id             null       -- NULL MEANS WARD-WIDE (§2.4)
  closed_at          null       -- timestamp, never a boolean (§2.9)
  entered_by
  created_at

roster  (origin: activity_roster)                    unique (team_id, member_id)
  id, ward_id
  team_id            not null
  member_id          not null   -- a youth member of the ward
  started_on         null date  -- NULL = from the start of the schedule
  ended_on           null date  -- NULL = still on the team
  added_by, created_at

event  (origin: activity_events)
  id, ward_id
  team_id            null       -- null = a ward-wide event belonging to no team
  calendar_id        null       -- the import it came from, if any
  title              not null
  event_type         not null   -- home | away | tbd        (default 'tbd')
  event_date         not null   -- an INSTANT (timestamptz), not a date
  all_day            not null default false
  location           null
  status             not null default 'upcoming'  -- upcoming | cancelled  ONLY (§2.1)
  occasion_id        null       -- NULL = this game is only this team's
  source_uid         null       -- from the .ics
  source_recurrence_id null
  created_at

participation  (origin: activity_event_participation)   unique (event_id, member_id)
  id, ward_id
  event_id     not null
  member_id    not null
  taking_part  BOOLEAN NOT NULL        -- NO ROW AT ALL = nobody has said (§2.4)
  recorded_by, created_at

attendee  (origin: activity_attendees)                  unique (event_id, user_id)
  id, ward_id
  event_id             not null
  user_id              not null   -- a LEADER going to support, not a young person
  assigned_by          null       -- NULL MEANS THEY ADDED THEMSELVES
  confirmed_attendance boolean null -- null = nobody has said whether they went
  created_at

log  (origin: activity_logs)                            unique (event_id, logged_by)
  id, ward_id
  event_id                 not null
  logged_by                not null
  shared_notes             null
  flagged_for_ward_council not null default false
  flag_sent_at             null
  created_at, updated_at

private_note  (origin: activity_private_notes)     unique (log_id, user_id)
  id, ward_id
  log_id   not null
  user_id  not null      -- READABLE BY THIS USER AND NOBODY ELSE, EVER (§2.11)
  notes    not null
  created_at, updated_at

calendar  (origin: activity_calendars)
  id, ward_id
  team_id        not null
  source_type    not null   -- ics_upload | manual
  last_synced_at null       -- WHEN A PERSON LAST IMPORTED. Never a machine.
  created_at

occasion  (origin: activity_occasions)
  id, ward_id, created_by, created_at
  -- AND NOTHING ELSE. No name, no date, no place.
```

### Two model notes that carry weight

**An occasion is identity and nothing else.** It exists so two teams' rows can say "this is
the same evening" — a Young Men game and a Young Women concert, or two siblings at one
tournament. It has no name, date or place because **all three already live on the event
rows, and a second copy could disagree with the first.**

**`season_schedule` is free text and nothing computes against it.** The season boundary is
`closed_at`. Do not parse it.

### Uniqueness that matters

- `(team_id, member_id)` on the roster — one young person is on a team once, with one window.
- `(event_id, member_id)` on participation, `(event_id, user_id)` on attendee,
  `(event_id, logged_by)` on the log — one answer per person per event.
- **The import key:** `(ward_id, calendar_id, source_uid, source_recurrence_id)`, with
  **NULLs treated as equal** and a **partial condition excluding hand-entered rows**
  (`calendar_id is not null and source_uid is not null`). Without NULLs-equal, every one-off
  imported game duplicates on re-import. Without the partial condition, a ward could enter
  exactly one manual event ever. If your stack cannot express NULLs-equal, synthesise a
  sentinel string instead of leaving it null — but do it in one place.

---

## 4. The computed logic

Implement these as **pure functions in their own module, importing types only.** In the
origin app they are imported by both server and client code, so one stray import of a
data-access module breaks the browser bundle. Keep them dependency-free.

### 4.1 Coverage — is anybody going?

```ts
const COVERAGE_STATES = [
  "uncovered",    // home, upcoming, inside the notice window, nobody going
  "needs_type",   // still tbd — nobody can even be asked
  "unassigned",   // home, upcoming, beyond the window, nobody going yet
  "covered",      // home, upcoming, at least one leader going
  "awareness",    // away — no coverage expectation, by design
  "not_expected", // cancelled, past, or the youth isn't taking part
] as const;
// THE ORDER IS THE RANK. coverageRank(s) = COVERAGE_STATES.indexOf(s). Lower = more urgent,
// so a plain ascending sort puts the events somebody must act on first. Do not carry a
// second map of ranks that could disagree with this array.

const COVERAGE_NOTICE_DAYS = 7;
// A leader who finds out on Thursday that nobody is going to Friday's game has been told
// too late to act. One told four weeks out has been told about a problem that doesn't exist.

function eventCoverage(
  event: {
    eventType: "home" | "away" | "tbd";
    eventDate: string;
    status: "upcoming" | "cancelled";
    attendeeCount: number;
    youthAttended: boolean | null;  // null = nobody has said. NEVER INFERRED.
  },
  asOf: Date,
  noticeDays = COVERAGE_NOTICE_DAYS,
): { state: CoverageState; daysUntil: number | null; attendeeCount: number } {

  // 1. CANCELLED — BEFORE THE CLOCK. §2.3.
  if (event.status === "cancelled") return notExpected();

  // 1b. NOT TAKING PART — ALSO BEFORE THE CLOCK, same reason.
  //     `false` ONLY. `true` and `null` both fall through: "taking part" and "nobody has
  //     said" are the ordinary case, which is what the rest of the function is about.
  if (event.youthAttended === false) return notExpected();

  const eventMs = new Date(event.eventDate).getTime();
  // 1c. An unreadable date is treated as PAST, not as urgent. It cannot be acted on, and
  //     shouting about it would put a permanent warning on a screen whose warnings mean
  //     something. Every function here excludes an unreadable date rather than throwing.
  if (!Number.isFinite(eventMs)) return notExpected();

  const daysUntil = (eventMs - asOf.getTime()) / 86_400_000;  // FRACTIONAL, so a card can
                                                              // say "tomorrow" not "0 days"

  // 2. PAST — and "past" is the START instant, since there is no duration column. A game
  //    that kicked off an hour ago reads not_expected while still being played. That is
  //    CORRECT for "does somebody still need to be asked?" and wrong for "did anybody go" —
  //    which is the follow-up's question, not this one. Say so, or it reads as a bug.
  if (daysUntil < 0) return notExpected();

  // 3. AWAY — no coverage expectation by design. An away game with nobody going is the
  //    designed outcome, which is why `awareness` ranks BELOW `covered` rather than beside
  //    `uncovered`, and renders in a neutral tone. A warning tone here would train leaders
  //    to ignore the tone, which costs the badge its only job.
  if (event.eventType === "away") return { state: "awareness", daysUntil, ... };

  // 4. Nobody has said home or away, so nobody can even be asked. It blocks every decision
  //    behind it, which is why it outranks `unassigned`.
  if (event.eventType === "tbd") return { state: "needs_type", daysUntil, ... };

  if (event.attendeeCount > 0) return { state: "covered", daysUntil, ... };

  // 5. Inside the notice window it is a problem; outside it, it is a schedule. The boundary
  //    is INCLUSIVE — exactly noticeDays out reads `uncovered` — because a leader would
  //    rather be told a day early than a day late.
  return { state: daysUntil <= noticeDays ? "uncovered" : "unassigned", daysUntil, ... };
}
```

**Labels are sentences a leader would say, not field names.** `not_expected` is the **empty
string and renders no badge at all** — a chip reading "not expected" is noise on the one row
that already explains itself.

```
uncovered   → "Nobody going"            danger
needs_type  → "Home or away?"           warning
unassigned  → "Nobody yet"              warning, quieter
covered     → "Covered"                 success
awareness   → "Away — awareness only"   neutral
not_expected→ ""                        no badge
```

A label that failed a walkthrough: `tbd` was originally "Not yet known". Asked what it meant,
the reader couldn't tell — not yet known *whether anybody is going*? *whether it's home or
away*? **A chip carries no field label beside it, so it has to say what it is about.**

### 4.2 The roster window — one function, three inputs, one answer

This folds *"the youth joined late"*, *"the youth left"* and *"the season was closed"* into
**one rule at one scale**, so no screen can forget one of the three.

```ts
function memberIsExpectedAt(
  membership: { startedOn: string | null; endedOn: string | null },
  teamClosedAt: string | null,
  eventDate: string,
  wardTimeZone: string,
): boolean
```

- `startedOn` counts from the **start of that day in the WARD's zone**.
- `endedOn` counts to the **end** of that ward-day — a youth who left "on the 15th" **is
  counted for a game on the 15th**, because they were still on the team that day.
- Compute the exclusive end as **the next day's wall-clock midnight**, never `start +
  86_400_000`: a day is 23 hours on a spring-forward Sunday, and a fixed offset silently
  drops an hour twice a year.
- **Never** compare `eventDate.slice(0, 10)` to a date column. That is UTC, and it puts a
  7:30pm Friday game on Saturday.
- `teamClosedAt` is an **instant** and compares directly — closing a season is a moment
  somebody chose, not a day.
- An unreadable date on either side returns `false`.

### 4.3 Team attendance at one event — the loud/quiet split

```ts
type EventYouthAttendance =
  | { kind: "no_expectation"; reason: "season_closed" | "all_absent"; absent: RosterMember[] }
  | { kind: "expected"; expected: RosterMember[]; absent: RosterMember[] };
```

**A discriminated result, so "closed" and "empty roster" cannot be collapsed by accident.**
Branch order is the rule:

1. **Season closed and the event is after the closing instant** → `no_expectation`, quiet.
   *Closing it here rather than on the calendar is what makes every screen inherit the rule
   without knowing to ask.* (The origin app's calendar leaked for exactly this reason: it
   contained no reference to `closed_at` at all, so a closed team's future games raised
   "Nobody going" forever.)
2. Filter the roster to who was on the team **when this game happened** (§4.2).
3. Of those, who has a participation row saying `taking_part === false`.
4. **Every** young person in the window is marked absent → `no_expectation`, quiet.
   Guard the empty case explicitly, or it lands here vacuously.
5. **Otherwise `expected` — INCLUDING when the expected list is empty.** §2.6. This is the
   branch a future tidy-up will invert.

Two adapters, so no screen invents its own mapping:

- `youthAttendedForEvent(a)` → `no_expectation ? false : null`, feeding `eventCoverage()`.
- `rosterInWindow(a)` → expected **then** absent, both in roster order, so a name doesn't
  jump when somebody is marked. **A control must offer both**, or a young person marked
  absent by mistake could never be unmarked.

### 4.4 Venue classification

```ts
function classifyEventLocation(location: string | null, homeVenues: readonly string[]) {
  // returns "home" | "tbd". THERE IS NO BRANCH THAT CAN RETURN "away". §2.5
  if (!location?.trim()) return "tbd";
  const haystack = location.trim().toLowerCase().replace(/\s+/g, " ");
  for (const venue of homeVenues) {
    const needle = venue.trim().toLowerCase();
    if (needle === "") continue;   // "" would make includes() true for every location
    if (haystack.includes(needle)) return "home";
  }
  return "tbd";  // An empty venue list reaches here with NO special case — the loop just
                 // doesn't run. "Configured nothing" and "matched nothing" deserve the same
                 // answer: ask a person.
}
```

Store the ward's home venues **as the ward typed them** and fold case **here**, at the
comparison — not on write. Lower-casing on write means a leader types "Lincoln High School"
and the settings panel reads their own words back to them rewritten.

### 4.5 Follow-up — does this reader owe an account of it?

```ts
const FOLLOW_UP_STATES = [
  "awaiting",        // past, not cancelled, reader was down for it, has written nothing
  "did_not_attend",  // a log exists and its author confirmed they did NOT go
  "logged",          // a log exists
  "not_due",         // upcoming, cancelled, or the reader was never down for it
] as const;
```

**Two exported functions, and the separation is the point:**

```ts
// Is this past and still a real event? THIS renders the CONTROL.
function isFollowUpWritable({ eventDate, status }, asOf): boolean {
  if (status === "cancelled") return false;      // before the clock, §2.3
  const ms = new Date(eventDate).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms <= asOf.getTime();
}
// NOTE: it deliberately does NOT read `youthAttended`. §2.7 — the prompt stops, the door
// stays open. A "consistency" edit adding it here is exactly what would break it.

// Is anybody waiting on THIS reader? THIS renders the PROMPT.
function followUpState(input, asOf): FollowUpState {
  if (!isFollowUpWritable(input, asOf)) return "not_due";

  // A log exists. `confirmedAttendance === false` is the EXCEPTION and the only one worth a
  // label — "went" is the ordinary case and a badge on every logged event is noise. `null`
  // reads as `logged`, because the account itself was what was being waited on.
  if (input.hasLog) {
    return input.confirmedAttendance === false ? "did_not_attend" : "logged";
  }

  // AFTER hasLog, AND THE ORDER IS THE RULE. A follow-up somebody ALREADY WROTE still reads
  // `logged`: demoting a written pastoral note behind a fact recorded afterwards would hide
  // the record. WHAT STOPS IS THE PROMPT, NOT THE RECORD.
  if (input.youthAttended === false) return "not_due";

  // Nobody is WAITING on somebody who never said they were going — but this does not stop
  // them filing one. The panel is a PROMPT, not a permission.
  if (!input.isAttendee) return "not_due";

  return "awaiting";
}
```

`isAttendee` is **whether the reader is down for it**, not whether anybody is — that is
coverage's question, and answering both behind one word loses one of them. `hasLog` is
**the reader's own** log; somebody else's answers nothing about what this reader owes.

Tones: `awaiting` is **warning, not danger** — a follow-up nobody has written is a thing to
do, not a failure. Reserving the loudest tone for *nobody is going to a game* is what keeps
that tone worth reading.

### 4.6 The support percentage — the heart of the ranking

**What it measures:** the share of a team's relevant home games where at least one leader
**actively said "I went"**. It measures **recorded** support, not support.

**Three narrowings, each with its own reason:**

- **Home games only.** An away game carries no coverage expectation by design, so counting
  one manufactures alarm about a rule working correctly.
- **Confirmed attendance only.** Being *down* for a game is a plan, not an attendance.
- **Only while the season is running.** A closed season leaves the computation entirely.

**THE HORIZON IS EVERY PAST HOME GAME PLUS THE NEXT ONE — not the whole season.**

*Why, and this was settled by the product owner after walking the screen:* the number is
*the history of support, plus the plan of support for the next event*. Counting the **whole
remaining season** would let an imported fixture list drag every percentage down for a
reason nobody did anything about. Counting **only the past** would make the number
**unmovable** — no action a leader could take today would change it.

So **the next event is judged on whether anybody is SIGNED UP**, not on confirmed
attendance — nobody can confirm a game not yet played. **One metric asks two different
questions of the same data on purpose**, and the sentence beside it names the two halves in
separate clauses rather than reporting one blended fraction.

```ts
function activitySupport(team, events: SupportEvent[], asOf: Date): ActivitySupport {
  const played = events.filter(e => isExpectedPast(e, asOf));   // past, home, not cancelled,
                                                                // youth was taking part
  const attendedCount = played.filter(e => e.confirmedAttendeeCount > 0).length;

  const next = soonest(events.filter(e => isExpectedNext(e, asOf)));  // ONE event, the soonest
  const nextEvent = next && { eventDate: next.eventDate, planned: next.attendeeCount > 0 };

  const supportedCount = attendedCount + (nextEvent?.planned ? 1 : 0);
  const countedCount   = played.length + (nextEvent ? 1 : 0);

  return { ...,
    playedCount: played.length, attendedCount, nextEvent,
    supportedCount, countedCount,
    supportedFraction: countedCount === 0 ? null : supportedCount / countedCount,
  };
}
```

#### `null` IS NOT `0`, and this is the single most likely bug in the module

A young person with **no home games played and none coming up** has not been neglected —
there is nothing anybody could have turned up to and nothing anybody can be asked to.

- Rendered as **`0%`** it sorts **first** under "least supported", and the priority list is
  led by the one person nobody could possibly have supported.
- **Render an em dash. Never `0%`.**
- **A null percentage sorts LAST in BOTH directions.** Reversing the nulls with the direction
  makes a list feel scrambled — the reader changed one question and two answers moved.

**And note the trap:** a team with a home game **coming up** has a real percentage before its
season starts, and a next game with **nobody down for it is a genuine 0%** that sorts first.
Only *nothing played **and** nothing coming up* is the em dash.

> There is a sort elsewhere in this module where `null` sorts **first**, because there it
> means "nobody has *ever* been" — a real, strong signal. **The two rules look identical and
> are opposite.** Write both down, and assert both directions explicitly.

#### The sentence beside the number

Carry the **counts, not the percentage**, into the words. At small N a percentage misleads —
one game out of two is 50% and says almost nothing.

- `"Somebody went to 1 of 8 home games played, and nobody is down for the next one."`
- `"No home games played yet, and somebody is going to the next one."` (no "0 of 0" opening)
- Nothing counted at all → **no sentence**, and an em dash on the pill.

**It names both halves separately** because a leader can only act on one of them. "Somebody
went to 1 of 8" is history and cannot be changed; "nobody is down for the next one" is a
thing to fix this week. Collapsing them into "2 of 9" hides the half that is still open.

### 4.7 Ranking the ward's young people

```ts
function youthNeed(member, memberships, eventsByTeam, asOf): YouthNeed
```

**Every membership is handed in — running and closed — and the partition happens INSIDE.**

*Why:* filter closed teams out upstream and a young person whose every season has finished
produces no card and **vanishes from the ward**. That is the one thing this must not do. It
is also what keeps the number, the sentence and the sort **one value**.

The result carries, all out of **one pass**:

- `activities` — one entry per **running** team, in activity-name order.
- `closedActivities` — one entry per **finished** team, **carrying the NAMES**, same order.
- `hasRunning`
- `lowestSupport` — the lowest **non-null** fraction. A team with nothing played contributes
  nothing to it; **null when every team is null**, and no special case is needed for
  "everything closed" — `running` is empty, so this is null, and the comparator already
  sorts null last.
- `upcomingCount`, `worstUpcoming`, `worstUpcomingAttendees`, `soonestNeedOn` — the coverage
  half. **`worstUpcomingAttendees` comes from the same event `worstUpcoming` came from** —
  choose a whole object, not three fields off three different ones (§2.13).

#### The finished-season card, which a walk caught

A young person with every season closed was **the only card on the page with no pills at
all**, so beside its neighbours it read as **data that had failed to load** — and it never
even said which activity the young person does.

**A finished season is now a pill like any other**: dashed border, the word *Finished*, the
activity's **name**. The status line says *"No activity running just now."* with **no count
in it** — the pills name themselves, and a number beside a list it duplicates is noise.
**The finished pill carries no percentage**; that number lives on the history page and
nowhere else. The pill says the season happened, not how it went.

---

## 5. The screens

| Route | What it is |
|---|---|
| `/youth` | **One card per YOUNG PERSON**, ranked. One pill per activity with its support percentage. Two sorts (priority, name) plus a direction toggle. |
| `/youth/teams` | Managing teams: create, edit, **Close**, roster in/out, and the import entry point. |
| `/youth/calendar` | Month grid + list. One card **per team's game**, with coverage badge, who is expected, and sign-up in place. |
| `/youth/events/[id]` | One game: the roster, participation controls, attendees, the occasion link, the follow-up form. |
| `/youth/history/[member_id]` | One young person's finished seasons, each with its **frozen** final percentage. |
| `/youth/feed` | The return-and-report feed of shared follow-ups. |
| `/youth/import` | Upload an `.ics`, preview, confirm. |

### Things the screens must do

- **`/youth/calendar` MARKS, it does not COLLAPSE.** A shared occasion shows a quiet
  "+N others at this game" line linking to the event page. Collapsing would leave the page's
  filters without a single answer — an occasion spans young people, organizations and
  activity types. **The count comes from the unfiltered rows** (§2.13).
- **A closed season's final number is recomputed against `closed_at`, not stored.**
  `activitySupport(team, events, new Date(closedAt))`. The number is frozen because its
  **input** is frozen — §2.1 answered for the eighth time.
- **The horizon rule is unchanged on a closed season.** A finished season's frozen number
  still counts the game that was *next* at the closing instant, and the sentence says so.
  It is a faithful snapshot of the moment somebody said the season was over — and the clause
  is what explains the denominator. Drop it and the counts stop adding up.
- **The expanded card links to ALL teams, closed ones included.** The ranking excludes a
  closed season; the schedule is a record of what happened and must not develop a hole.
- **The feed states which visibility mode the ward is in, in words** — and with its own
  labels. A label about visit reports doesn't mention a calendar that stayed open.
- **Every screen at 375px, light and dark.** A `<select>` inside a flex row needs
  `min-width: 0` or it refuses to shrink and overflows the phone.

---

## 6. The ICS import

A school publishes a calendar feed. A leader uploads the file **against one team**, sees a
preview, and confirms. Re-importing next month adds only what is new.

### Time zones — the part that ships broken

- `DTSTART:20270115T193000` carries **no zone**: half past seven in no particular place.
  **Read it in the WARD's zone.** Refusing such files was considered and rejected — school
  feeds publish them routinely, and refusing leaves manual entry as the only path for exactly
  the wards this is for.
- **An all-day entry is ward midnight**, and it gets an explicit `all_day` flag. Without the
  flag every tournament weekend renders "12:00am", which on that screen is
  **indistinguishable from the off-by-N-hours bug this feature is most likely to produce** —
  the marker is what keeps a real bug legible.
- **The preview says, per event, that the file gave no zone**, so a leader reads "7:30pm"
  *before* confirming rather than after. An unresolvable `TZID` does the same and names the
  zone it asked for — silently treating it as UTC would be the wrong hour with no trace.
- **Never call your ICS library's "to JS Date" helper on a floating time.** It resolves
  against the **process's** zone — your laptop's locally, UTC in production. It is a bug that
  passes every test on the dev machine and ships wrong. Carry **a wall clock and a zone
  NAME** separately; convert in **one pure function**, and take **two offset-correction
  passes**, because one is wrong for an hour twice a year.
- **Refuse a bare offset** (`-07:00`) as a ward zone even though `Intl` accepts it: a fixed
  offset has no daylight saving, so every summer game lands an hour out with nothing saying why.

### Idempotence and the re-import guarantee

- **A `VEVENT` with no `UID` gets a deterministic synthesised one.** The spec's "match on UID
  where present, else title + date" is deliberately **not** implemented as two rules — one
  match key, one code path.
- **Recurrence is expanded about 12 months ahead**, and "absent from the file" is computed
  **within the window the file itself covers, never against all time.** Over all time, every
  past game the feed ever produced would qualify.
- **An event that vanishes from a re-imported file is LEFT ALONE.** The confirm performs
  **no deletes and no status changes, ever**, and the preview **names the absent events** so
  the guarantee is visible rather than theoretical. A feed that briefly publishes a short
  file must not be able to cancel a season.
- **On a row that matched, only `title`, `location`, `event_date` and `all_day` are written.**
  `status` and `event_type` are never touched, so a hand-cancelled game stays cancelled and a
  hand-corrected home/away survives every future import.
- **Participation lives on a different table the importer cannot reach**, so "this youth isn't
  taking part" survives re-import **by construction**, not by discipline.

### What is deliberately NOT built

- **No calendar-API sync** (OAuth + token refresh, for a one-way read). ICS upload is far
  simpler and does the job.
- **No server-side URL fetch** of a feed — that is request-forgery surface for no gain.
- **No scheduled re-sync.** `last_synced_at` records when a **person** last imported, never
  when a machine did. Automatic re-fetching puts a write path outside a human confirm.

---

## 7. The pitfalls, as a checklist

Every one of these was a real defect found by opening the app in a browser, with a green
test suite at the time.

- [ ] A stored `covered` column that goes stale — §2.1.
- [ ] `new Date()` inside a computation, so rows disagree down one page — §2.2.
- [ ] Testing `cancelled` **after** the clock: right today, wrong next week — §2.3.
- [ ] `NOT NULL DEFAULT false` where the third state is the whole point — §2.4.
- [ ] Classifying an unmatched venue as `away` and silently deleting the expectation — §2.5.
- [ ] A freshly imported season going quiet because nobody is on the roster yet — §2.6.
- [ ] Hiding the follow-up button from the leader who actually turned up — §2.7.
- [ ] A destructive delete behind a dialog that can be clicked through — §2.8.
- [ ] `toLocaleString()` with no `timeZone`, correct in dev, seven hours out in prod — §2.10.
- [ ] `date.toISOString().slice(0,10)` putting a Friday evening game on Saturday — §2.10.
- [ ] Rendering Edit/Remove on work the viewer cannot change — §2.12. **This one appeared
      three separate times**, including in the slice whose own plan quoted the earlier fix.
- [ ] `0%` where the honest answer is "nothing to measure" — §4.6.
- [ ] Nulls that reverse with the sort direction — §4.6.
- [ ] A heading count and its rows computed twice and disagreeing — §2.13.
- [ ] A filtered view reporting a filtered count where the truth is unfiltered — §2.13.
- [ ] A chip whose label doesn't say what it is **about** ("Not yet known" — of what?) — §4.1.
- [ ] Pluralisation: "1 events updated".
- [ ] `1/2/2027` rendered on the very screen whose job is unambiguous dates.
- [ ] A `<select>` overflowing at 375px because a flex item won't shrink below its content.

---

## 8. What to test, in priority order

1. **Access scoping.** A user in ward A cannot read or write ward B. A leader in org X cannot
   write org Y's team. A private note is readable by its author and nobody else. **Assert a
   refused write by RE-READING the row** — in most stacks a denied UPDATE or DELETE is a
   zero-row success, not an error.
2. **`eventCoverage()`** — every state, and **both sides of every boundary**: exactly
   `noticeDays` out, one second past the start, cancelled at three days out *and* three days
   past, `youthAttended === false` at both distances.
3. **`memberIsExpectedAt()`** — a youth who left "on the 15th" **is** counted for a game on
   the 15th; a 7:30pm game in a zone west of UTC (the case a `slice(0,10)` gets wrong); a
   spring-forward boundary.
4. **`eventYouthAttendance()`** — and name the empty-roster branch in the test itself,
   because it is the one a future tidy-up will invert.
5. **`activitySupport()`** — the em-dash case, the genuine-0% case, and the horizon (a past
   game and the next one, not the whole season).
6. **`compareYouth()`** — nulls last in **both** directions, asserted explicitly in both.
7. **The ICS round trip** — re-import the same file and assert nothing was created, nothing
   deleted, and `status` / `event_type` / participation untouched.
8. **A source scan** asserting no date formatter omits its zone. No assertion about a
   formatted string can catch that — the test process has one zone.

**Then open it in a browser.** Every defect in §7 was found by a person looking at a screen,
not by a test. The suite was green for all of them.
