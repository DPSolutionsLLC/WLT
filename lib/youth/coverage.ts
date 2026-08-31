import {
  COVERAGE_STATES,
  coverageRank,
  type CoverageState,
  type EventStatus,
  type EventType,
} from "@/types/domain";

// Whether anybody is going to an event, computed.
//
// ---------------------------------------------------------------------------
// COMPUTED, NEVER STORED
// ---------------------------------------------------------------------------
// Migration 054c removed `covered` and `uncovered` from `activity_events.status` for exactly
// this, and named this file as the replacement. A stored coverage value goes stale the moment
// nobody refreshes it, and NOTHING IN THIS PROJECT REFRESHES ANYTHING: pg_cron is not enabled,
// supabase/functions/ does not exist, and vercel.json declares no crons. The same reasoning
// governs appointmentViewState() computing "missed" and householdVisitPriority() computing
// "overdue"; this is the third instance of one rule, not a new idea.
//
// ---------------------------------------------------------------------------
// CLIENT-IMPORTABLE — KEEP IT THAT WAY
// ---------------------------------------------------------------------------
// CoverageBadge renders this and ActivityCalendar sorts by it. ONE import of lib/youth/queries.ts
// would pull next/headers into the client bundle and break both. This file imports types and
// nothing else, which is the same standing instruction lib/visits/householdStatus.ts and
// lib/goals/goalStatus.ts carry.
//
// ---------------------------------------------------------------------------
// `asOf` IS A PARAMETER, NEVER A `new Date()` INSIDE
// ---------------------------------------------------------------------------
// That is what makes both boundaries testable, and it is what keeps every row of one render
// judged against the same instant instead of against a clock that moves down the list. /youth
// already resolves one `asOf` per render and hands it down; /youth/calendar does the same.

// Seven days. A leader who finds out on Thursday that nobody is going to Friday's game has been
// told too late to do anything about it, and one told four weeks out has been told about a
// problem that does not exist yet.
export const COVERAGE_NOTICE_DAYS = 7;

const MS_PER_DAY = 86_400_000;

export type EventCoverageInput = {
  eventType: EventType;
  eventDate: string;
  status: EventStatus;
  attendeeCount: number;
  // Migration 061. Whether the YOUNG PERSON this event belongs to is taking part. Null means
  // NOBODY HAS SAID — a third state, never a defaulted `true`, on the same reasoning
  // `confirmed_attendance` is nullable.
  //
  // NEVER INFERRED. Not from an empty attendee list, not from a cancelled sibling, not from a
  // missing follow-up. A person knows this and nothing else does — classifyLocation.ts's refusal
  // of near-miss matching, in a third place.
  //
  // REQUIRED, NOT OPTIONAL, AND THAT IS THE MECHANISM. ProfileNeedEvent is this type and
  // SupportEvent extends it, so every construction site is a compile error until it supplies the
  // field — which is CLAUDE.md rule 9 enforced by the type checker rather than by review.
  youthAttended: boolean | null;
};

export type EventCoverage = {
  state: CoverageState;
  // Null when the event is past or cancelled — there is nothing to count down to. FRACTIONAL, so
  // a card can say "tomorrow" rather than rounding twenty hours down to 0 days.
  daysUntil: number | null;
  attendeeCount: number;
};

export function eventCoverage(
  event: EventCoverageInput,
  asOf: Date,
  noticeDays: number = COVERAGE_NOTICE_DAYS,
): EventCoverage {
  const { eventType, status, attendeeCount } = event;

  // ---------------------------------------------------------------------------
  // 1. CANCELLED, BEFORE THE CLOCK IS CONSULTED. THE ORDER IS THE RULE.
  // ---------------------------------------------------------------------------
  // A cancelled game may be REINSTATED, so it stays in the schedule and inside the "upcoming"
  // count on /youth — that is a decision, not an oversight. What must be true is that it NEVER
  // registers as unattended, at any distance from the clock: a cancelled game three days out is
  // not uncovered, and a cancelled game three days PAST is not a failure anybody should be shown.
  //
  // Testing it first is what makes that true at every distance at once. Testing it after the
  // clock would give the right answer today and the wrong one for somebody reading the same row
  // next week.
  if (status === "cancelled") {
    return { state: "not_expected", daysUntil: null, attendeeCount };
  }

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

  const eventMs = new Date(event.eventDate).getTime();

  // An unreadable date is treated as past rather than as urgent. It cannot be acted on — nobody
  // can be asked to turn up at a time nothing can render — and shouting about it would put a
  // permanent warning on a screen whose warnings are supposed to mean something.
  if (!Number.isFinite(eventMs)) {
    return { state: "not_expected", daysUntil: null, attendeeCount };
  }

  const daysUntil = (eventMs - asOf.getTime()) / MS_PER_DAY;

  // ---------------------------------------------------------------------------
  // 2. PAST — AND "PAST" IS THE START INSTANT, NOT AN END
  // ---------------------------------------------------------------------------
  // This schema has no duration column, so a game that kicked off an hour ago reads
  // `not_expected` while it is still being played. That is CORRECT for the question this function
  // answers — "does somebody still need to be asked?" — and would be wrong for a question slice D
  // might ask, which is "did anybody go, and what happened". That one is answered by
  // `activity_logs`, not here. Naming the difference stops the next reader treating it as a bug.
  if (daysUntil < 0) {
    return { state: "not_expected", daysUntil: null, attendeeCount };
  }

  // 3. Away — no coverage expectation, by design (08-youth-activities.md §Step 4). An away game
  // with nobody going is the designed outcome, which is why `awareness` ranks below `covered`
  // rather than beside `uncovered`.
  if (eventType === "away") {
    return { state: "awareness", daysUntil, attendeeCount };
  }

  // 4. Nobody has said whether this is home or away, so nobody can even be asked. It blocks every
  // decision behind it, which is why it outranks `unassigned`.
  if (eventType === "tbd") {
    return { state: "needs_type", daysUntil, attendeeCount };
  }

  if (attendeeCount > 0) {
    return { state: "covered", daysUntil, attendeeCount };
  }

  // 6. Inside the notice window it is a problem; outside it, it is a schedule. The boundary is
  // inclusive — exactly `noticeDays` out reads `uncovered` — because a leader would rather be
  // told a day early than a day late.
  return {
    state: daysUntil <= noticeDays ? "uncovered" : "unassigned",
    daysUntil,
    attendeeCount,
  };
}

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

  // "This young person" beats a blank where the profile is not in the reader's list —
  // mapActivityProfileRow's rule for a name that did go missing.
  return `${memberName ?? "This young person"} is not taking part`;
}

// The count strip at the top of /youth/calendar.
//
// HERE RATHER THAN IN THE PAGE, so the number in the strip and the badges beneath it cannot
// disagree — they are two renderings of one computation. That is describeHouseholdForVisits()'s
// lesson from visits-f, where the picker and the denominator drifted because two places answered
// the same question.
//
// Every state is present in the result, including the zeroes, so a caller reading
// `summary.uncovered` never has to decide what `undefined` meant.
export function summariseCoverage(
  coverages: readonly EventCoverage[],
): Record<CoverageState, number> {
  const summary = Object.fromEntries(
    COVERAGE_STATES.map((state) => [state, 0]),
  ) as Record<CoverageState, number>;

  for (const coverage of coverages) {
    summary[coverage.state] += 1;
  }

  return summary;
}

// THE WORST STATE ACROSS AN OCCASION — every young person at the same game, reduced to the one
// badge that goes above them.
//
// ---------------------------------------------------------------------------
// IT RETURNS THE WHOLE EventCoverage, NEVER JUST ITS STATE
// ---------------------------------------------------------------------------
// This is youth-e written as a signature. That walk found every covered card reading
// `Covered · 0` above an event card reading `Covered · 1`, because the value being carried held
// the STATE and the DATE but not the COUNT of the event it described — and the existing check
// pinned the state, so the wrong number sailed through it. The badge, the count and the date the
// occasion renders all come off this ONE object, so there is nothing left for a second lookup to
// disagree with.
//
// Reduced by coverageRank(), where lower is more urgent. THAT IS THE SAME RULE
// ActivityCalendar applies to a day cell and profileNeed() applies across a profile, expressed
// over a different return type: the day cell reduces to a `CoverageState`, so switching it to
// call this is not a pure substitution and is deliberately not attempted here (CLAUDE.md §7).
//
// TIES BREAK ON THE SOONEST `daysUntil`, matching how profileNeed() resolves "the soonest event
// holding the worst state" — two games with nobody going are not equally urgent. A null
// `daysUntil` (a past or cancelled event) NEVER wins a tie against a real one: there is nothing
// left to act on.
//
// AN EMPTY LIST RETURNS null — NO SIGNAL, NOT "FINE". Returning a `covered` would say something
// nobody has established, which is visits-f's comparator lesson and the shape
// `ProfileNeed.worstUpcoming` already uses.
export function worstCoverage(
  coverages: readonly EventCoverage[],
): EventCoverage | null {
  let worst: EventCoverage | null = null;

  for (const coverage of coverages) {
    if (worst === null) {
      worst = coverage;
      continue;
    }

    const rank = coverageRank(coverage.state);
    const worstRank = coverageRank(worst.state);

    if (rank < worstRank) {
      worst = coverage;
      continue;
    }

    if (rank > worstRank) continue;

    // Same state. The sooner one wins, and a null never beats a number.
    if (coverage.daysUntil === null) continue;
    if (worst.daysUntil === null || coverage.daysUntil < worst.daysUntil) {
      worst = coverage;
    }
  }

  return worst;
}
