# Visit Tracking & Return-and-Report — Portable Module Spec

**Purpose:** a self-contained transfer of a ward visit-tracking module that was designed, built,
walked in a browser and revised six times in a production Next.js + Postgres app. It carries the
data model, the decision rules, and the exact logic of every computed value — plus the reason
behind each, because the reasons are what stop a reimplementation "improving" a rule back into
the bug it was written to prevent.

**Companion document:** this module is the foundation the youth-activity module was built on.
`addCadence`, `householdVisitPriority()` and the stewardship scope were all deliberately written
**without visit vocabulary** so youth coverage could import them rather than write a second
meaning of "overdue". If you are porting both, port this one first.

**How to use it:** paste this whole document into your prototype session and say:

> Build the visit tracking module described below. Adapt the storage and framework to this
> prototype's stack, but implement every rule in §2 and every function in §4 exactly as
> specified — those are settled decisions with costs behind them, not preferences. Where a rule
> cannot be expressed in this stack, say so rather than silently dropping it. Before writing
> code, restate the data model back to me and list the files you will create.

---

## 1. What the module is for

A ward is divided into organizations — Elders Quorum, Relief Society, and so on. Each is
responsible for visiting a set of households. The module answers four questions:

1. **Which family should we go to next?** (the priority scale)
2. **How are we doing?** (the progress dashboard)
3. **What happened, and does anybody need to know?** (the return-and-report feed)
4. **Whose are they to visit at all?** (stewardship)

### The single most important modelling fact

**A visit goal is a rolling CADENCE, not a dated PERIOD.**

The first version measured progress between two dates — a period with a start and an end. It
produced a screen where a household row read **"✓ Visited"** directly above a banner counting
that same household as **unvisited**. Both numbers were correct. They disagreed because they
answered different questions, and they disagreed **at the start of every period**, for every
ward, forever.

The fix was not to reconcile the two numbers. It was to delete the period:

> A goal is *"visit every household once every X"*, where X is an **amount plus a unit**
> (`day` / `week` / `month` / `year`), and progress is measured from **each household's own last
> completed visit**.

There is no `goal_period_start` and no `goal_period_end`. There is one notion of progress and
nothing for it to disagree with. **Do not re-propose a period.**

---

## 2. The non-negotiable rules

### 2.1 No period. Progress is measured per household, from its own last visit

See above. The optional `deadline` on a goal is **presentation only** and drives no arithmetic
whatsoever — it renders as a date a ward set itself, and nothing computes against it.

### 2.2 Computed on read, never stored

**The priority band, the elapsed fraction, and whether an appointment was missed are all pure
functions. None is a column.**

*Why:* each is decided partly by the clock. A stored value the clock decides goes stale the
moment nothing refreshes it — and nothing here refreshes anything: no cron, no triggers, no
background worker. An appointment becomes *missed* because time passed, not because anybody
wrote a row.

So `appointment.status` holds only **what a human did**: `scheduled`, `kept`, `cancelled`.

### 2.3 `asOf` is always a parameter, never `new Date()` inside

The page resolves **one** `asOf` per render and passes it down.

*Why:* it makes both sides of every boundary testable — a test cannot pin a clock it does not
pass in — and it keeps every row of one screen judged against the same instant rather than
against a clock that moves down the list.

### 2.4 Absent means default

| Absent thing | Means | Never |
|---|---|---|
| no `household_stewardships` rows for an org | **every** visitable household is theirs | narrowed to nothing |
| no `household_visit_cadences` row | use the goal's cadence | a per-household column |
| `lastCompletedOn === null` | never visited — its own band | a zero fraction |
| `priority === null` | no goal, or do-not-contact | sorts first |

*Why the stewardship case matters most:* zero rows meaning "the whole ward" is what made the
feature ship **without moving a single ward's numbers on the day it deployed.** An organization
that never opens the control is measured exactly as it was before.

### 2.5 Three distinct reasons a household is not counted — and they must stay distinct

This is the rule most likely to be collapsed by a later tidy-up, and collapsing any two of them
loses something a presidency needs:

| Reason | On the dashboard | In the denominator |
|---|---|---|
| **No active members** (moved out, all inactive) | **absent** from the page | no |
| **Do-not-contact household** | **shown, and marked** | **no** |
| **Outside this org's stewardship** | **absent** from that org's page | no |

**`do_not_contact` is a separate axis from member status.** Member status answers *"may we call
this person"*; the household flag answers *"may we call on this family at all"*. A do-not-contact
household **stays on the roster, stays visible, stays marked, and is counted in nothing.**

**Do not fold it into the "is this household visitable" predicate** — that would make the
household *vanish*, which is exactly what the decision refused. The record of what happened
before the flag was set is what the next presidency needs.

### 2.6 An attempt counts towards nothing, and is still visible

A visit has an `outcome`: `completed` or `attempted`. **Every progress number filters on
`completed`.** Folding an attempt into it would tell a ward it had reached a family it never got
past the door of.

But attempts are not dropped, and — critically — **an attempt is not a BAND.**

An earlier version had a fifth status, `attempted_never_reached`. That was **a reason occupying
a position**. A household somebody has knocked on four times is a different *kind* of problem
from one nobody has been to, **at every level of urgency**, so it must not displace the urgency.
It is now a **mark beside the band**, expressible alongside any of them.

`attemptsSinceLastVisit` counts attempts since the last completed visit — every attempt ever,
when there has been no visit. **Deliberately not a period count:** a household knocked on twice
in December and twice in January has been failed to reach four times running, and a period
boundary is not a fact about that household.

### 2.7 The picker is a SUPERSET of the denominator, and it marks the difference

One function decides both what the household picker offers and what the denominator counts.
**They used to be two functions kept in step by comments, and they drifted.**

The picker deliberately offers **more** than the denominator counts, with a label saying why:

```
"The Nielsen family"                            → offered, counted
"The Nielsen family (do not contact)"           → offered, NOT counted
"The Nielsen family (not in your stewardship)"  → offered, NOT counted
(no active members)                             → not offered at all
```

*Why:* a leader who visited a family anyway must be able to record it. Refusing the record would
lose a real visit to enforce a bookkeeping rule.

### 2.8 Private notes are private forever

`visit_private_notes` is readable **only by its author**. Not by the bishop, not by an admin, not
by a support query. One note per author per visit.

**Widening a shared read never widens a private note by one row.** When cross-org visibility was
turned on (§2.10) it touched four SELECT policies and `visit_private_notes` was not one of them.

The progress module **never selects from the private-notes table and never imports the module
that does.** A progress row is a count and a date.

### 2.9 Refuse the empty bulk replace, and name the alternative

With one stewardship table, *"narrowed to nothing"* and *"not narrowed"* are **the same zero
rows.** So an empty bulk replace is **refused at the boundary**, with a sentence naming the
alternative — silently choosing the second meaning would widen an organization back to the whole
ward without anybody asking for it.

If a ward ever genuinely needs an empty stewardship, the fix is an org-level flag column, **not**
a workaround here.

### 2.10 Reads widen together, or the number is visible and wrong

A ward can switch on **cross-organization visibility**. When it does, that check appears in
**four** SELECT rules: visit logs, stewardships, **goals**, and **household cadence overrides**.

It originally appeared in only the first two, and the contrast was itself the decision — *"facts
are shared, judgements are not."* That was **reversed** after walking the screen: an org leader
saw other organizations' chips but no **bands**, and the page had to explain per chip that the
number was being withheld. A ward turning the setting on is asking for that number.

**The cadence had to follow the goal.** A band prefers the per-household override, so widening
the goal alone would render a pill computed from the wrong interval. **A number that is visible
and wrong is worse than one withheld.**

**What did not move: every WRITE rule, and the private notes.**

### 2.11 An organization claims a household only if it has a goal — and that must be uniformly evaluable

The all-organizations view needs to surface the household in **nobody's** stewardship. That
requires knowing who claims whom.

A first version hardcoded *"every organization except the Bishopric claims"*. But a ward has
seven organizations, and absent-means-everything (§2.4) meant Young Men, Young Women **and**
Sunday School each claimed **every** household — so "unclaimed" was permanently false and the
view could not do its only job.

The rule is now: **an organization claims households only if it has a visit goal.**

**This rule is only safe because it is uniformly evaluable.** Every reader of that page can read
every goal (§2.10). If that widening were ever reversed, two people would compute **different
unclaimed counts from the same data**, and the rule would have to be reconsidered with it.

> **General principle, and it recurs:** any value computed from a read and then *shared* must be
> computed from a read that every viewer of it can perform. Otherwise the same row reads two ways
> to two people.

### 2.12 Null sorts last, and the rank is the array order

- **`priorityRank` reads the index in the band array.** No second map of ranks — that is the bug
  the old standalone `STATUS_ORDER` constant was one edit away from at all times.
- **A null priority sorts last**, covering both "this org has no goal" and "do-not-contact". The
  dashboard opens on what a president must act on; a list that opens on what is settled is a list
  nobody scrolls.
- **Within a band, the most-overdue leads**, then family name as a stable tie-break.

*A comparator trap found in a walk:* an inherited name tie-break sorted never-visited **below**
recently-visited. Check your tie-breaks against a real fixture, not against intuition.

### 2.13 The cadence comparison takes no clock reading

Comparing two cadences ("is the warning window shorter than the cadence?") **projects both
forward from a fixed anchor date** and compares the resulting date strings.

*Why:* `new Date()` here makes validation non-deterministic. "Is 2 months longer than 60 days?"
genuinely answers differently in February than in July — so a goal a ward saved in one month
would be refused in another.

**The particular anchor is not arbitrary, and this is the subtle part.** See §4.1.

### 2.14 Reuse the feed, do not fork it

The return-and-report feed was built **generic from the first line** so a second module supplies
only a **mapper** and a **fetcher** — not a second copy of the component. When the youth module
landed, the visit route had **no diff at all**, which is how the reuse was *shown* to be safe
rather than claimed.

If one string in a shared component is not generic, **change it in place** behind a prop with the
old value as its default. Forking the component is the thing to refuse.

---

## 3. The data model

```
visit_goals
  id, ward_id
  org_id            null      -- null = ward-wide (but see the note below)
  title             null
  target_type       not null  -- all_households | specific_households | custom
  cadence_amount    int       -- "every 3 ___"        >= 1
  cadence_unit      text      -- day | week | month | year
  notice_amount     int       -- warn this far ahead  >= 1
  notice_unit       text      -- day | week | month | year
  deadline          null date -- PRESENTATION ONLY. Nothing computes against it.
  created_by, created_at
  CHECK (cadence_amount is null) = (cadence_unit is null)   -- half a cadence is unrepresentable
  CHECK (notice_amount  is null) = (notice_unit  is null)
  -- NO goal_period_start. NO goal_period_end. NO cadence enum. See §2.1.

visit_logs
  id, ward_id
  org_id            null
  household_id      null
  visit_date        not null date      -- a DAY, not an instant
  visit_type        not null  -- in_home
  outcome           not null  -- completed | attempted       (default completed)
  arrangement       not null  -- appointment | drop_in       (default drop_in)
  recorded_by       null      -- WHO TYPED IT. Not who went — see visit_participants.
  shared_notes      null
  flagged_for_ward_council  not null default false
  flag_sent_at      null
  created_at

visit_participants                     -- WHO ACTUALLY WENT
  id, ward_id
  org_id            null      -- DENORMALIZED from the parent, see note below
  visit_log_id      not null
  user_id           null      -- a leader with an account
  member_id         null      -- a ward member without one
  label             null      -- a free-typed name
  CHECK exactly ONE of (user_id, member_id, non-blank label) is present
  unique (visit_log_id, user_id)   where user_id  is not null
  unique (visit_log_id, member_id) where member_id is not null

visit_appointments
  id, ward_id
  org_id            null
  household_id      null
  scheduled_for     not null TIMESTAMPTZ   -- an EVENT with a time. "Tuesday at seven" is
                                           -- the whole point of arranging one.
  status            not null  -- scheduled | kept | cancelled  ONLY (§2.2)
  visit_log_id      null      -- ON DELETE SET NULL, never cascade
  made_by, notes, created_at

visit_private_notes                    unique (visit_log_id, user_id)
  id, ward_id
  visit_log_id  not null
  user_id       not null   -- READABLE BY THIS USER AND NOBODY ELSE, EVER (§2.8)
  notes         not null
  created_at, updated_at

household_visit_cadences               unique (household_id, org_id)
  id, ward_id
  household_id     not null
  org_id           NOT NULL            -- see note below
  cadence_amount   not null >= 1
  cadence_unit     not null
  created_by, created_at, updated_at

household_stewardships                 unique (household_id, org_id)
  id, ward_id
  household_id  not null
  org_id        not null
  created_by, created_at
  -- NO PAYLOAD. Membership is presence or absence, which is why a bulk replace can
  -- insert with ON CONFLICT DO NOTHING and needs no read-then-write.

households
  ... plus:
  do_not_contact  not null default false    -- §2.5
```

### Six model notes that carry weight

**A household's cadence override is a join table, not a column — decided after a reversal.** The
same family can be on a 3-month cadence for the Elders Quorum and a 12-month one for the Relief
Society *at the same time*. A `households.cadence` column could not express that: the second
organization would silently overwrite the first.

**`household_visit_cadences.org_id` is `NOT NULL`, unlike `visit_goals.org_id`.** A null-org row
would be **invisible to its own author** under an `org_id = current_org()` read.

**`visit_participants.org_id` is denormalized from the parent visit, deliberately**, so the
access rule can be the *same shape* as the visit's rather than a subquery evaluated per row. It
is safe **only because a visit's `org_id` is not patchable** — the update route accepts no org
change, by design. If you allow that change, this denormalization becomes a bug.

**`visit_appointments.visit_log_id` is `ON DELETE SET NULL`, never cascade.** Deleting a visit
must not delete the record that an appointment was *made*.

**Watch the composite-key trap on `SET NULL`.** An earlier migration made visits **completely
undeletable** with a composite `on delete set null` whose key included the not-null `ward_id` —
the database cannot null part of a key it needs. Caught by the access-rule test suite, not by
review. Prefer `cascade` where the child is meaningless without the parent (it removes the row
rather than trying to null part of a key), and where you do need `set null`, name the single
column explicitly.

**`recorded_by` is who typed it; `visit_participants` is who went.** These were once one column,
and merging them meant the app could not record a visit somebody else reported. **Never stamp an
author id onto a participant row** — a self-added participant has a null "assigned by", and
treating null as "nobody" there is a recurring bug in this codebase, sighted four times.

---

## 4. The computed logic

Implement these as **pure functions in their own module, importing types and date helpers only.**
Client components render and sort by all of them, so a single import of a data-access module
breaks the browser bundle.

### 4.1 Cadence arithmetic

```ts
type Cadence = { amount: number; unit: "day" | "week" | "month" | "year" };
// AN AMOUNT AND A UNIT TOGETHER, never two loose values passed side by side.
// Half a cadence — an amount with no unit — is unrepresentable in this type, and the
// database CHECK enforces the same thing.

function addCadence(from: DateOnly, c: Cadence): DateOnly {
  // day  → +n days
  // week → +n*7 days
  // month→ +n months   (CALENDAR months, with clamping)
  // year → +n*12 MONTHS, not 365 days
}
```

**A year is twelve months, not 365 days**, so "every year" from 29 February behaves the way a
month-clamping calendar already decided: `2024-02-29 + 1 year = 2025-02-28`.

**`subtractCadence` is `addCadence` with the amount negated** — one implementation, so there is
no second one to drift. It is **not an exact inverse at every date**, and cannot be: month
addition clamps, so `2026-01-31 + 1 month = 2026-02-28`, and `2026-02-28 − 1 month = 2026-01-28`.
Assert the asymmetric cases explicitly rather than leaving them assumed.

#### The comparison anchor — read this before changing it

```ts
const CADENCE_COMPARISON_ANCHOR = "2000-07-01";

function compareCadences(left, right) {
  // Project BOTH forward from the anchor; compare the resulting YYYY-MM-DD strings.
  // Exact: never converts a month to an approximate number of days.
  //   "2 months" vs "60 days"  → different  (they are)
  //   "1 year"   vs "12 months"→ equal      (they are)
}
```

**`2000-01-01` is specifically WRONG as the anchor.** January plus a leap February is
`31 + 29 = exactly 60 days`, so "every 2 months" and "every 60 days" compare **equal** there — and
a 2-month warning window on a 60-day cadence would be accepted, which must be refused.

**`2000-07-01` opens the year's longest run of 31-day months** (July, August), so an interval
expressed in months is measured at its **most generous**. That is the conservative direction for
the one question being asked — *"is the warning window shorter than the cadence?"* — because a
borderline pair is **refused** rather than accepted. A refused goal is a message somebody can act
on; an accepted one is a dashboard that has quietly stopped saying anything.

It is not conservative in every direction — a 61-day window against a 2-month cadence passes here
and would swallow the interval in February. **That residual case is caught by the clamp in §4.2**,
at render time, against the household's real dates.

#### Two phrasings, and they are not interchangeable

```ts
describeCadence({amount: 1, unit: "month"})  → "Every month"
describeCadence({amount: 6, unit: "month"})  → "Every 6 months"

describeDuration({amount: 1, unit: "month"}) → "a month"      ← the ARTICLE, not the digit
describeDuration({amount: 6, unit: "month"}) → "6 months"
```

**How often ≠ how long.** A banner once assembled its warning window by stripping `"Every "` off
the first form. That survives only while the amount is above one: `"Every 6 months"` → `"6 months"`,
but `"Every month"` → a bare `"month"`, and the banner rendered **"Warning month ahead."** for
every goal with a one-unit window. A two-unit window read correctly, which is why it survived from
the redesign until a fixture happened to use 1.

An amount of one takes **"a month"** because that is what somebody would *say*; "1 month" is what
a form would say.

### 4.2 The priority band — where one household stands

```ts
const VISIT_PRIORITY_BANDS = [
  "never_visited",  // no anchor to measure from at all
  "overdue",        // due date has passed
  "approaching",    // inside the warning window
  "on_track",
] as const;
// THE ARRAY ORDER IS THE RANK. priorityRank() reads the index. No second map.

type VisitPriority = {
  band: VisitPriorityBand;
  elapsedFraction: number | null;   // null for never_visited
  dueOn: DateOnly | null;
  cadence: Cadence;
  cadenceSource: "household" | "goal";   // a row saying "Overdue" under a goal that alone
                                         // would say "On track" must explain itself
};

function householdVisitPriority({
  lastCompletedOn, cadence, cadenceSource, notice, asOf
}): VisitPriority {

  // THE CLAMP, computed first.
  // If the notice window is as long as the cadence or longer it swallows the whole interval
  // and EVERY household reads `approaching` — a dashboard that has stopped saying anything.
  // In that case the window is IGNORED ENTIRELY: nothing reads `approaching`, everything is
  // on_track or overdue. That is the SAFE direction — a dashboard that under-warns is
  // recoverable by reading the due dates, which are all still there; one that flags
  // everything tells a president nothing about where to go first.
  // Report this ONCE, at goal level, never per row. One name for one fact.
  const noticeIgnored = compareCadences(notice, cadence) >= 0;

  // 1. NEVER VISITED — FIRST, AND UNCONDITIONALLY.
  //    It outranks `overdue`: a family nobody has EVER been to is a different problem from
  //    one visited thirteen months ago, and it has no anchor to measure a fraction from.
  //    Computing one would mean INVENTING an anchor — which is exactly what the old
  //    goal_period_start did, and what this whole model replaced.
  if (lastCompletedOn === null) {
    return { band: "never_visited", elapsedFraction: null, dueOn: null, ... };
  }

  const dueOn = addCadence(lastCompletedOn, cadence);
  const interval = ms(dueOn) - ms(lastCompletedOn);

  // 2. A zero or negative interval cannot divide. Validation and a DB CHECK both refuse to
  //    store one, so this is reachable only from a row written outside the app — and
  //    "overdue" is the honest reading of an interval that has already elapsed.
  if (interval <= 0) return { band: "overdue", elapsedFraction: 1, dueOn, ... };

  // FLOORED AT 0, NOT CLAMPED ABOVE 1.
  //   1.4 means 40% past due, and the SORT READS IT so the most-overdue household leads
  //   its band. Clamping to 1 would flatten that ordering.
  //   Floored at 0 because a lastCompletedOn in the future is clock skew, and "0% elapsed"
  //   is the honest reading of it — never a negative.
  const elapsedFraction = Math.max(0, (ms(today) - ms(lastCompletedOn)) / interval);

  // Date-only string comparison, safe because both are YYYY-MM-DD.
  if (today >= dueOn) return { band: "overdue", elapsedFraction, dueOn, ... };

  if (!noticeIgnored && today >= subtractCadence(dueOn, notice)) {
    return { band: "approaching", elapsedFraction, dueOn, ... };
  }

  return { band: "on_track", elapsedFraction, dueOn, ... };
}
```

**`elapsedFraction` is the point of the whole redesign.** A household at 95% of its interval and
one at 10% no longer read the same. The badge shows it; the sort uses it.

> **A product note, settled by the user in review:** the badge does **not** show the percentage.
> The pill is a **fill gauge** reading a duration **in words**. A percentage on a pastoral screen
> invites precision that the underlying dates do not support.

**Sorting:** rank ascending → `elapsedFraction` **descending** within a band → family name.

### 4.3 Is this household counted, offered, or neither?

```ts
function describeHouseholdForVisits(household, scope): Disposition | null {
  if (!hasActiveMembers(household))  return null;                        // not offered at all
  if (household.doNotContact)        return { inDenominator: false,
                                              pickerLabel: `${name} (do not contact)` };
  if (!isInScope(scope, household.id)) return { inDenominator: false,
                                              pickerLabel: `${name} (not in your stewardship)` };
  return { inDenominator: true, pickerLabel: name };
}
```

**ONE function deciding both the picker and the denominator.** They were two, kept in step by
comments, and they drifted. `null` means "not offered at all" — the one case with no label.

**The denominator is not `households.length`.** That counts houses this organization cannot visit
and holds them against it forever.

### 4.4 Stewardship scope

```ts
type StewardshipScope = {
  hasNarrowed: boolean;              // FALSE = narrowed nothing = EVERYTHING is in scope
  subjectIds: ReadonlySet<string>;
};

function isInScope(scope, subjectId) {
  if (!scope.hasNarrowed) return true;   // ← the entire ship-day no-change guarantee
  return scope.subjectIds.has(subjectId);
}
```

**`hasNarrowed: false` is NOT the same as an empty `subjectIds`**, which would mean "narrowed to
nothing". The only way an empty set arises is alongside `hasNarrowed: false` — which is why the
empty bulk replace is refused (§2.9).

**Name the parameter `subjectId`, never `householdId`.** The youth module asks the identical
question about young people. Do not "tidy" these names to be visit-specific.

### 4.5 Was the appointment missed?

```ts
function appointmentViewState(appointment, asOf): "scheduled" | "kept" | "cancelled" | "missed" {
  // A kept or cancelled appointment in the past is NOT missed. Somebody answered the
  // question already, and TIME DOES NOT UN-ANSWER IT.
  if (appointment.status !== "scheduled") return appointment.status;
  return Date.parse(appointment.scheduledFor) < asOf.getTime() ? "missed" : "scheduled";
}
```

### 4.6 Who claims which household (the all-organizations view)

```
claimingOrganizations = organizations that have a usable visit goal    // §2.11
claimants(household)  = claiming orgs whose stewardship covers it      // absent = all
unclaimed(household)  = claimants.length === 0
```

That view exists **specifically to surface the household in nobody's stewardship** — the one that
§2.5's third rule makes invisible everywhere else.

---

## 5. The screens

| Route | What it is |
|---|---|
| `/visits` | The progress dashboard: the banner, the household table sorted by priority, and four panels **collapsed under it** rather than stacked. |
| `/visits/all-organizations` | Every organization's chips per household, plus the unclaimed count. |
| `/visits/feed` | The return-and-report feed of shared visit notes. |

### Things the screens must do

- **"Recent visits" is KEPT** even though the dashboard supersedes most of it — it is the only
  place ward-council flagging renders.
- **The banner counts visits in the window**, and says plainly when the notice window was ignored
  (§4.2's clamp), once, at goal level.
- **A bishopric member landing on the dashboard needs an organization to look at.** The Bishopric
  itself never has visit goals, so defaulting a bishop to their own org shows them an empty page.
- **The feed's filter is per-organization, with coloured chips** — and **each filter is its own
  cache key**, which is a staleness trap: a bookmark made under one filter was invisible under
  another until reload.
- **The dashboard must refresh after the most common action on the page.** It went stale after
  logging a visit — the single most likely thing anybody does there.
- **Tap targets:** a control measured 176×16 px on the one thing the slice added. Check them.

### The shared report feed

A tile carries: a context (the organization), an occurred-on date, a preview of the shared notes,
an **`authorLabel`**, and a read/unread mark.

**`authorLabel` is WHO WENT, not who typed it.** When the youth module reused this feed, its
tiles pass `null` there — because youth follow-ups have no participants table at all, and mapping
"who typed it" onto a label meaning "who went" would put two different facts under one word on
two kinds of tile.

**Ordering:** the visit feed orders by visit date. A module whose log's date lives on a *related*
row may have to order by the log's own creation time instead — if so, the pagination cursor must
carry **the log's** date, never the displayed one.

---

## 6. Cross-organization visibility

A ward-level setting. When **off**, an organization sees its own work. When **on**, every
organization's leaders see every organization's visit reports, goals, cadences and stewardships —
but **never** another leader's private notes, and **never** the ability to write.

Implementation notes that cost real time:

- **The setting lives in a JSON settings blob, and a partial merge is the silent bug there.** A
  naive write replaces sibling keys. Test it with another key already present.
- **Never gate readability on a role check in application code.** Express it in the data layer's
  rules, or the two will disagree.
- **`null = null` is NULL in SQL and `true` in JavaScript.** A comparison meant to match "same
  organization" needs an explicit null guard, or two null-org rows match in the app and not in the
  database. This produced a live defect: the app offered "Flag for ward council" on other
  organizations' visits the moment visibility went on. The data layer refused them safely — but
  **a leader was invited through a locked door.**

---

## 7. The pitfalls, as a checklist

Every one of these was a real defect, most found by opening the app in a browser with a green
test suite at the time.

- [ ] A period-based goal producing "✓ Visited" above a banner counting it unvisited — §2.1.
- [ ] A stored `missed` or a stored band going stale — §2.2.
- [ ] `new Date()` inside the comparison, so a goal valid in July is refused in February — §2.13.
- [ ] Anchoring the cadence comparison at `2000-01-01`, where 2 months == 60 days — §4.1.
- [ ] `"Warning month ahead."` — stripping `"Every "` off the wrong phrasing — §4.1.
- [ ] A notice window ≥ the cadence flagging every household — §4.2's clamp.
- [ ] Clamping `elapsedFraction` to 1 and flattening the within-band ordering — §4.2.
- [ ] `never_visited` computed with an invented anchor instead of its own band — §4.2.
- [ ] The picker and the denominator as two functions that drift — §4.3.
- [ ] `households.length` as the denominator — §4.3.
- [ ] Folding `do_not_contact` into "is visitable", making the household vanish — §2.5.
- [ ] An attempt counted as a visit, or occupying a band — §2.6.
- [ ] Empty stewardship rows read as "narrowed to nothing" — §2.9, §4.4.
- [ ] Widening the goal read without the cadence read — a pill computed from the wrong interval — §2.10.
- [ ] A composite `ON DELETE SET NULL` including a not-null key column, making rows undeletable — §3.
- [ ] A child scope rule that a patchable parent column would invalidate — §3.
- [ ] `null = null` in SQL vs JavaScript, offering an action the data layer will refuse — §6.
- [ ] A JSON settings merge that silently drops sibling keys — §6.
- [ ] A comparator whose inherited tie-break sorts never-visited below recently-visited — §2.12.
- [ ] A filter that is its own cache key, so a change under one is invisible under another — §5.
- [ ] The dashboard going stale after the most common action on its own page — §5.
- [ ] A chip tooltip that is true in one of three states.

---

## 8. What to test, in priority order

1. **Access scoping.** Ward A cannot read or write ward B. Org X cannot write org Y's goal. A
   private note is readable by its author and nobody else — **and assert this at the route layer,
   not only at the data layer**, because the data rule passed for months and would have kept
   passing through a widened select. **Assert a refused write by RE-READING the row**; a denied
   UPDATE or DELETE is typically a zero-row success, not an error.
2. **Cross-org visibility on BOTH sides of the setting**, for all four widened reads plus the two
   that must not widen. Write the reversal as an **inversion** of the existing assertions rather
   than a rewrite, so it reads as a decision.
3. **`householdVisitPriority()`** — every band, both sides of each boundary, the clamp, the
   negative interval, the future `lastCompletedOn`, and a fraction above 1.
4. **`compareCadences()`** — "2 months" vs "60 days" (different), "1 year" vs "12 months" (equal),
   and the pair that the wrong anchor would call equal.
5. **`addCadence` / `subtractCadence`** — the month-clamp asymmetry, and 29 February + 1 year.
6. **`describeHouseholdForVisits()`** — all four dispositions, and that the picker is a strict
   superset of the denominator.
7. **`appointmentViewState()`** — a kept appointment in the past is not missed.
8. **Build boundary dates from the arithmetic, not by hand.** A plan's own stated boundary dates
   were a day out, and a test that hardcoded them would have enshrined the error.

**Then open it in a browser.** The reversal that replaced the entire goal model came from a
person looking at a screen and noticing two correct numbers disagreeing. No test was going to
find that.
