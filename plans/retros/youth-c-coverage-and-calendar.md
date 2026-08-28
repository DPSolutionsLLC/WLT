---
id: youth-c-coverage-and-calendar
type: feature
iter: null
commits: ["57fff1c"]
date: 2026-08-28
files:
  - supabase/migrations/056_activity_attendees_and_status.sql
  - types/domain.ts
  - lib/ward/homeVenues.ts
  - lib/youth/classifyLocation.ts
  - lib/youth/coverage.ts
  - lib/youth/attendees.ts
  - lib/youth/queries.ts
  - lib/validation/youth.ts
  - lib/validation/visit.ts
  - lib/youth/ics/buildImportPreview.ts
  - lib/youth/ics/applyImport.ts
  - app/api/ward-settings/home-venues/route.ts
  - app/api/youth/events/[id]/attend/route.ts
  - app/api/youth/events/[id]/assign/route.ts
  - app/api/youth/attendees/route.ts
  - app/api/youth/events/route.ts
  - app/api/youth/calendars/import/route.ts
  - app/api/youth/calendars/import/preview/route.ts
  - app/(app)/youth/calendar/page.tsx
  - app/(app)/youth/calendar/ActivityCalendar.tsx
  - app/(app)/youth/HomeVenuePanel.tsx
  - app/(app)/youth/EventList.tsx
  - app/(app)/youth/ManualEventForm.tsx
  - app/(app)/youth/page.tsx
  - app/(app)/youth/youthQueries.ts
  - app/(app)/youth/import/IcsPreviewStep.tsx
  - components/youth/CoverageBadge.tsx
  - components/youth/AttendeeControls.tsx
  - components/youth/ActivityMonthGrid.tsx
  - testing/infrastructure/seedUtils.ts
related:
  - youth-a-profiles-and-events
  - youth-b-ics-import
  - visits-f-stewardship-and-all-orgs
  - visits-e-cadence-and-priority
  - visits-d-attempts-appointments-and-participants
  - talks-d-reliability-goals
  - roster-b-picker-and-orgs
  - calendar-a-rules-and-api
---

## What was done

Phase 8 slice C of four, and the one that closes the hole slices A and B both left: **an event sat
on a list and nobody was going to it.** Three things, plus the screen they exist for.

Home/away classification from a ward-configured venue list, applied on the way in — to a
hand-entered event and to every occurrence an ICS import creates. Attendees: anyone with
`youth_activities.view` puts themselves down, the bishopric asks somebody else, and
`activity_attendees` holds its first row since Foundation B created it. Coverage computed on read
as a pure function of `(event_type, event_date, status, attendee count, asOf)` — exactly what
migration 054c promised when it removed `covered`/`uncovered` from the status column. And
`/youth/calendar`, the ward-wide calendar those three exist to make readable.

Migration 056 drops `completed` from `activity_events.status`, closing the question 054c addressed
to this slice by name, and narrows the three `activity_attendees` write policies while leaving its
SELECT untouched.

## Key decisions

- **An unmatched location is `tbd`, never `away`, and `classifyEventLocation` has no branch that
  can return it.** Absence of a match is not evidence of an away game: "Lincoln HS Gymnasium",
  "Lincoln High — auxiliary gym" and a plain typo all fail to match "lincoln high school" and are
  all home games. An `away` event carries **no coverage expectation by design**, so a wrong `away`
  guess silently removes the event from the model — nobody is asked, nobody notices, no badge says
  so. `tbd` is loud instead. Matching is deliberately boring (lower-case, collapse whitespace,
  `includes()`) because a near-miss a clever matcher would catch is exactly the case where a person
  should be asked. Recorded in CLAUDE.md §9, because it is the kind of rule a later reader
  "improves".
- **`activity_attendees_ward_select` is left exactly as migration 019 wrote it, and that is
  load-bearing rather than convenient.** Coverage is computed from an attendee COUNT, so if one
  reader could see rows another could not, the same event would read *covered* to one leader and
  *uncovered* to another **from the same data at the same instant**. That is the trap CLAUDE.md
  records under `visits-f`'s unclaimed rule: a rule that is not uniformly evaluable is not a rule.
  Same read-wide/write-narrow shape as 054, with the read half carrying weight this time.
- **The write policies compare `user_id`, never `assigned_by`.** `assigned_by` is null on a
  self-add, so a policy reading it would be the `talks-d` hole in a third place — a person could
  not remove their own row. It is a record of how the row came to exist, written by the route and
  read by no policy. UPDATE was narrowed now even though nothing writes it, because slice D sets
  `confirmed_attendance` and a ward-wide UPDATE would let anybody confirm somebody else's
  attendance.
- **`createActivityEventSchema.eventType` lost its `.default("tbd")`, and that one word was the
  whole feature.** With a default, "the leader left the field alone" and "the leader chose Not yet
  known" arrive identically, so classifying anything would mean overriding an explicit human
  choice. Absent means *decide from the location*; present means *a person decided*, including when
  they decided `tbd`. The audit row records which, so "why is this marked home?" is answerable.
- **`cancelled` is tested before the clock, not after.** A cancelled game may be reinstated, so it
  stays in the schedule and inside the "upcoming" count — but it must never register as unattended
  **at any distance from the clock**. Branch order is what makes that true at every distance at
  once; checking the clock first gives the right answer today and the wrong one next week. Asserted
  in both directions, three days out and three days past.
- **`needs_type` outranks `unassigned`, and `awareness` ranks below `covered`.** An event nobody has
  classified blocks every decision behind it — the reasoning that put `never_visited` above
  `overdue`. An away game with nobody going is the *designed* outcome, so rendering it in a warning
  tone would train leaders to ignore the tone.
- **The venue editor shipped in this slice, unlike `wardTimezone`'s.** A timezone has a defensible
  fallback; a venue list does not. With no editor the fallback is empty in every real ward,
  classification never fires, and `home_venues` is a column nobody fills in.
- **`/youth/calendar` filters client-side over one fetched list.** A filter parameter the route's
  schema does not carry is silently ignored (`roster-b`), and a list narrowed in the client beside
  a count answering a different question is the same defect from the other side.
- **Cards are bucketed into days in the READER's zone.** `wardTimezone` decides what a floating
  *imported* time means; it does not decide what day a rendered card belongs to. Mixing them puts
  an 11pm game under the wrong date while its own card says otherwise — visible for a few hours a
  day, to some readers.
- **No sixth scheduled thing.** `youth_event_uncovered` is emitted nowhere. It stays Phase 11's one
  decision about a mechanism, alongside `visit_overdue`, `refresh_goal_status()`, the Monday digest
  and ICS re-sync.

## What the build caught that nothing else did

**`npm run build` failed while lint, typecheck and 2982 tests all passed.** `MAX_HOME_VENUES` was
declared in the server-only `lib/ward/homeVenues.ts` and imported by `lib/validation/visit.ts`,
which client components import — dragging `next/headers` into the browser bundle. The constants
moved to the validation module and the server module reads them back, matching where every other
limit in this codebase lives. `youth-b` measured the cost of the same hazard at ~505KB with no
failure at all; here it was a hard build error. Both files now carry the reason the dependency
points the way it does.

## What walking it found

**Four defects, none of them correctness, all of them about whether a person can read the screen.**
The suite was green for every one.

1. **The uncovered event was not findable.** The banner was noticed first, then locating which of
   six cards it meant took close reading — the "Nobody going" badge was there and did not carry.
   The banner now **names** the events (up to three) rather than counting them, and the card takes a
   danger left edge, the marker `ReportTile` already uses for an unread report. A pointer to a
   colour is no pointer at all to somebody who cannot see it, which is why it names rather than
   describes.
2. **"Not yet known" did not say what was not known** — going? home or away? Asked directly, the
   reviewer could not tell. It is now "Home or away not set". Worse, a `tbd` card was showing **two**
   chips for one fact and the type chip was the vaguer; it is now suppressed where the coverage
   badge already says it, and kept where the badge is absent.
3. **The lower-cased venue read as a bug.** A bishopric member typed "Lincoln High School" and the
   panel read back "lincoln high school". The fold moved from the write path into
   `classifyEventLocation`, which now lower-cases both sides — still exactly one place deciding what
   "the same venue" means, and now the place where the comparison actually happens.
4. **"Home or away is left as it is" did not say *instead of what*,** so youth-b's guarantee read as
   filler rather than as a promise being kept. The preview holds both values, so it now states the
   comparison as fact. It deliberately does **not** claim a person set it: nothing records that, and
   inferring it from a disagreement would be a weaker second meaning for a column that does not
   exist.

**Fixing (4) introduced a fifth, and re-walking it caught that.** The first version interpolated the
type label on both sides and rendered *"this file would have set it to Home or away not set"*. It
typechecked and broke no test.

**Three checklist items described states the app cannot reach** and would have been ticked without
being looked at: "open the notification bell" (an inert Phase 11 placeholder), "the count strip
changes at the same time" (the step attended an event twenty days out, which was never in the
uncovered count), and "a second import classifies the new games as Home" (an identical re-import
creates nothing). All three corrected in place with the date and the reason.

**The walk also closed a gap the automated tests had left.** They covered `org_president` and
`org_secretary` but not `ward_council_member` — the widest role, which *holds*
`youth_activities.manage`, so the permission check alone would admit it and only the bishopric check
refuses. Verified live: 403 on assign POST/DELETE and venues PUT, with nothing changed.

**One defect found and deliberately left alone:** `listActivityEvents` orders only by `event_date`
with no tiebreaker, so events sharing an instant reshuffle whenever any one is edited. Reproduced
with a no-op UPDATE. Pre-existing from slice A; `lib/youth/attendees.ts` and
`lib/visits/participants.ts` both guard against exactly this with a secondary `.order("id")`.
Reviewed and judged not worth the churn.

## Pattern

**A label can be correct in one place and nonsense in another, and no type can tell the
difference.** "Home or away not set" is right on a chip standing alone and unreadable inside a
clause. When that happens the sentence gets rewritten around the label, not the label bent to fit —
the standalone chip is the harder constraint, so it wins. `tests/components/youth/IcsPreviewNote.test.tsx`
now asserts the composition over **every** combination rather than the three worth spelling out,
which is the only version of that test that would have caught the bug I actually wrote.

**And the second half of the same lesson:** `youth-b` recorded three copy defects invisible to a
green suite; this slice found four more, plus one it introduced while fixing them. Every one was
reachable only by reading the real screen. The suite proves the data is right, and says nothing
about whether the sentence on top of it can be understood.
