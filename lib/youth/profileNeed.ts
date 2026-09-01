import { eventCoverage, type EventCoverageInput } from "@/lib/youth/coverage";
import {
  memberIsExpectedAt,
  type EventParticipation,
  type RosterMember,
} from "@/lib/youth/roster";
import {
  coverageRank,
  type CoverageState,
  type EventStatus,
  type EventType,
} from "@/types/domain";

// One young person's standing, computed from their events.
//
// ---------------------------------------------------------------------------
// TWO QUESTIONS, NOT ONE, AND THEY HAVE DIFFERENT ANSWERS
// ---------------------------------------------------------------------------
// "Has a game coming up with nobody going" is a question about the FUTURE and it is answered by
// lib/youth/coverage.ts. "Nobody has been to one of Ethan's games all season" is a question about
// the PAST, and no coverage state expresses it: every past event reads `not_expected`, which is
// correct for the first question and silent about the second.
//
// So this module computes both halves in one pass and the screen renders both from that single
// value. A card that sorts first because of a number it does not display is the ITER-022 defect
// wearing a new hat — the summariseCoverage / summariseFollowUp / describeHouseholdForVisits rule,
// which this module now states in a fourth file.
//
// ---------------------------------------------------------------------------
// CLIENT-IMPORTABLE — KEEP IT THAT WAY
// ---------------------------------------------------------------------------
// YouthOverview renders this in the browser. ONE import of lib/youth/queries.ts would pull
// next/headers into the client bundle and break the page — youth-c recorded that `npm run build`
// caught exactly that where lint, typecheck and 2982 tests did not. This file imports TYPES and
// lib/youth/coverage.ts, which carries the same standing instruction, and nothing else.
//
// ---------------------------------------------------------------------------
// `asOf` IS A PARAMETER, NEVER A `new Date()` INSIDE
// ---------------------------------------------------------------------------
// The rule lib/youth/coverage.ts and lib/youth/followUp.ts both carry: it is what makes the
// boundaries testable, and what keeps every row of one render judged against the same instant
// rather than against a clock that moves down the list.

export type ProfileNeedEvent = EventCoverageInput;

export type ProfileNeed = {
  upcomingCount: number;
  // The worst coverage state among UPCOMING events. Null when there are none — which is "NO
  // SIGNAL", not "fine". The comparator sorts it last for that reason: visits-f shipped a
  // comparator whose inherited tie-break sorted never-visited below recently-visited, and the
  // lesson is that the absence of a signal must never read as a good score.
  worstUpcoming: CoverageState | null;
  // The date of the SOONEST upcoming event holding that worst state — not the soonest event
  // overall. It is the tie-break and it is the date the card's sentence points at, so those two
  // cannot mean different events.
  soonestNeedOn: string | null;
  // How many people are down for THAT event — the one `worstUpcoming` and `soonestNeedOn` both
  // describe. Zero when there is no upcoming event at all.
  //
  // IT IS HERE BECAUSE A BADGE RENDERS IT. CoverageBadge appends " · N" for the `covered` state,
  // and the walk on 2026-08-29 found every covered card reading "Covered · 0" above an event card
  // reading "Covered · 1" — because YouthOverview had no real number to pass and filled a literal
  // zero. A card must never display a number that is not part of the value it sorted on
  // (summariseCoverage, summariseFollowUp, describeHouseholdForVisits — the same rule a fourth
  // time).
  worstUpcomingAttendees: number;

  // How many past events carried a coverage expectation. See isExpectedPast() below.
  expectedPastCount: number;
  // The most recent expected past event somebody actually went to. Null means nobody ever has,
  // which is the STRONGEST signal rather than a missing one — the comparator inverts for it.
  lastAttendedOn: string | null;
  // How many expected past events in a row, counting back from the most recent, had nobody at
  // all. Zero when the most recent one was attended: a young person somebody went to see last
  // week has no story here, however thin the autumn before it was.
  unattendedRun: number;
};

// ---------------------------------------------------------------------------
// WHICH PAST EVENTS CARRY A COVERAGE EXPECTATION — THE ONE THING TO GET RIGHT
// ---------------------------------------------------------------------------
// An `away` event, a `tbd` event and an event the young person is not taking part in are ALL
// excluded, and the reasons are different, which is why they are separate conditions rather than
// one and why the test asserts them separately.
//
//   AWAY   — an away game with nobody at it is the DESIGNED outcome. 08-youth-activities.md
//            §Step 4 gives an away event no coverage expectation at all, which is why
//            eventCoverage() returns `awareness` rather than `uncovered` for one. Counting it as
//            neglect manufactures alarm about a rule working correctly.
//
//   TBD    — nobody has classified it, so nobody could have been asked to go. Blaming a leader
//            for a classification nobody made is the mirror of youth-c's "an unmatched location
//            is `tbd`, never `away`" — and `tbd` is already loud where it belongs, as
//            `needs_type` on the calendar and on every card.
//
//   ABSENT — the young person is not taking part, so this game could not have been a chance to
//            support them. That is the SAME SENTENCE the other three exclusions are; ITER-030
//            found it missing from the list rather than proposing a new idea. It is a fact a
//            person stated (migration 061) and never one this code inferred.
//
// A CANCELLED event is excluded for the reason lib/youth/coverage.ts tests `cancelled` before it
// consults the clock: a game called off is not a game nobody went to, at any distance.
//
// An UNREADABLE date is excluded from both halves, exactly as eventCoverage() and
// isFollowUpWritable() both exclude one.
//
// ---------------------------------------------------------------------------
// HOW THIS COMPOSES WITH `closed_at` — TWO EXCLUSIONS AT TWO SCALES, AND THEY DO NOT INTERACT
// ---------------------------------------------------------------------------
// Migration 060a's `closed_at` removes a WHOLE PROFILE from the ranking; this removes ONE EVENT
// from a profile's arithmetic. A closed season's frozen number, recomputed against `closedAt` on
// /youth/history/[member_id], therefore excludes its absences too — and that is correct: the
// snapshot should say what was true at the closing instant, absences included.
//
// THE FOUR EXCLUSIONS, IN ONE PLACE, so the past half and the upcoming half cannot drift apart.
// Both `isExpectedPast` and `isExpectedNext` are this predicate plus a side of the clock — the
// support percentage counts a past game and the next one by the same rule, and a second copy of
// "which events carry an expectation" is exactly what would let somebody retune one of them.
//
// ---------------------------------------------------------------------------
// NOT MODIFIED BY youth-j, AND THAT IS THE SINGLE MOST IMPORTANT "DO NOT TOUCH" IN THAT SLICE
// ---------------------------------------------------------------------------
// The four exclusions are exactly the ones youth-i left here, unchanged. What moved is only the
// SOURCE of the `youthAttended` field: it used to be a column on the event
// (`activity_events.youth_attended`, migration 061) and it is now a PARTICIPATION ROW for this
// (young person, event) pair (`activity_event_participation`, migration 062d), resolved by
// buildSupportEvents() below.
//
// That is what makes the slice a move rather than a rewrite: an event serves a whole roster now,
// so one team-mate being ill says nothing about the other — but the question this function asks
// of a single young person, and every answer it gives, is identical.
function carriesCoverageExpectation(event: ProfileNeedEvent): boolean {
  if (event.status === "cancelled") return false;
  if (event.youthAttended === false) return false;
  if (event.eventType !== "home") return false;
  return Number.isFinite(new Date(event.eventDate).getTime());
}

function isExpectedPast(event: ProfileNeedEvent, asOfMs: number): boolean {
  if (!carriesCoverageExpectation(event)) return false;

  // STRICTLY BEFORE, matching eventCoverage()'s `daysUntil < 0`. The upcoming half below is `>=`
  // on the same instant, so an event landing exactly on `asOf` is counted once rather than in
  // both halves.
  return new Date(event.eventDate).getTime() < asOfMs;
}

// THE NEXT ONE ONLY — never the whole future. See the support block below for why the horizon
// stops at one event.
function isExpectedNext(event: ProfileNeedEvent, asOfMs: number): boolean {
  if (!carriesCoverageExpectation(event)) return false;
  return new Date(event.eventDate).getTime() >= asOfMs;
}

function isUpcoming(event: ProfileNeedEvent, asOfMs: number): boolean {
  const eventMs = new Date(event.eventDate).getTime();
  if (!Number.isFinite(eventMs)) return false;
  return eventMs >= asOfMs;
}

function instantOf(eventDate: string): number {
  return new Date(eventDate).getTime();
}

export function profileNeed(
  events: readonly ProfileNeedEvent[],
  asOf: Date,
): ProfileNeed {
  const asOfMs = asOf.getTime();

  const upcoming = events.filter((event) => isUpcoming(event, asOfMs));

  // Reduced with coverageRank() — lower is worse — exactly as ActivityCalendar reduces a day
  // cell. A second ordering here could disagree with COVERAGE_STATES, and the two would drift on
  // the day somebody retunes one of them.
  //
  // A CANCELLED upcoming event stays in this set and resolves to `not_expected`, which ranks
  // last. So a profile holding nothing but cancelled games is QUIET rather than urgent —
  // CoverageBadge renders nothing at all for that state — while the game still appears in the
  // count, which is the decision EventList's eventCount() records.
  // THE WHOLE EVENT IS CARRIED, not just its state and its date. Everything a card renders about
  // the worst upcoming event — the badge's state, the badge's count, the tie-break date — is read
  // off this one row, so the three can never describe different events.
  let worst: { state: CoverageState; event: ProfileNeedEvent } | null = null;

  for (const event of upcoming) {
    const state = eventCoverage(event, asOf).state;

    if (worst === null || coverageRank(state) < coverageRank(worst.state)) {
      worst = { state, event };
      continue;
    }

    // THE SOONEST EVENT HOLDING THE WORST STATE, not the soonest event overall. A leader reading
    // that nobody is going to a game on the 3rd wants the date of the game nobody is going to.
    if (
      state === worst.state &&
      instantOf(event.eventDate) < instantOf(worst.event.eventDate)
    ) {
      worst = { state, event };
    }
  }

  // MOST RECENT FIRST, so the run below counts backwards through the season from today.
  const expectedPast = events
    .filter((event) => isExpectedPast(event, asOfMs))
    .sort((left, right) => instantOf(right.eventDate) - instantOf(left.eventDate));

  const attended = expectedPast.find((event) => event.attendeeCount > 0) ?? null;

  let unattendedRun = 0;
  for (const event of expectedPast) {
    // STOPS AT THE FIRST ATTENDED ONE. A young person somebody went to see last week has a run of
    // zero even if the whole autumn before it was empty — the question is whether anybody has
    // been LATELY, and a run counted over the whole season would keep answering an old one.
    if (event.attendeeCount > 0) break;
    unattendedRun += 1;
  }

  return {
    upcomingCount: upcoming.length,
    worstUpcoming: worst?.state ?? null,
    soonestNeedOn: worst?.event.eventDate ?? null,
    worstUpcomingAttendees: worst?.event.attendeeCount ?? 0,
    expectedPastCount: expectedPast.length,
    lastAttendedOn: attended?.eventDate ?? null,
    unattendedRun,
  };
}

// THE SENTENCE, BESIDE THE COMPUTATION THAT DECIDES IT. The words on a card and the number it
// sorts on are two renderings of one value, which is summariseCoverage()'s and
// describeHouseholdForVisits()'s rule and the reason ITER-022 happened where it did.
//
// NULL MEANS NOTHING TO SAY, and the card renders nothing rather than "0 games". A profile with
// no expected past events has not been neglected — nothing has been played. talks-c's last-prayed
// nudge renders nothing rather than "Never" for the same reason.
export function describeSeasonNeed(need: ProfileNeed): string | null {
  if (need.expectedPastCount === 0) return null;

  // Somebody went to the most recent one. There is no story here, and a sentence about an older
  // gap would be a complaint about a problem that has already been solved.
  if (need.unattendedRun === 0) return null;

  if (need.lastAttendedOn === null) {
    return need.expectedPastCount === 1
      ? "Nobody has been to the one home game played so far."
      : `Nobody has been to any of the ${need.expectedPastCount} home games played so far.`;
  }

  return need.unattendedRun === 1
    ? "Nobody has been to the last home game."
    : `Nobody has been to the last ${need.unattendedRun} home games.`;
}

// ===========================================================================
// THE SUPPORT PERCENTAGE — HOW OFTEN SOMEBODY ACTUALLY TURNED UP
// ===========================================================================
// The pastoral half above answers "has anybody been LATELY". This answers "how often has anybody
// been AT ALL", which is the number a leader compares two young people on. They are computed from
// the same events and they are not the same question: a run of three counts back from today, and
// a fraction does not.
//
// FOUR DECISIONS, SETTLED 2026-08-29, AND EACH OF THEM NARROWS THE NUMBER:
//
//   HOME GAMES ONLY      — the SAME rule isExpectedPast() already applies, reused rather than
//                          restated. An away game carries no coverage expectation by design
//                          (08-youth-activities.md §Step 4), so counting one manufactures alarm
//                          about a rule working correctly.
//
//   CONFIRMED ONLY       — a leader who actively said "I went". Being DOWN for a game is a plan,
//                          not an attendance, and `confirmed_attendance` is NULL until somebody
//                          answers. Three meanings live in that one column and only one of them
//                          is support.
//
//   EVERY PAST GAME,     — the HORIZON, and it is deliberately not the whole season. Decided
//   PLUS THE NEXT ONE      2026-08-29 after walking scenario 057: the number should be "the
//                          history of support plus the plan of support for the next event".
//
//                          Counting the whole remaining season would make the denominator grow
//                          every time a fixture list is imported and drag every percentage down
//                          for a reason nobody did anything about. Counting only the past would
//                          make the number unactionable: a leader could not move it by signing up
//                          for anything, only by waiting for a game to be played.
//
//                          The next event is therefore judged on whether anybody is DOWN for it,
//                          not on confirmed attendance — nobody can confirm a game not yet played.
//                          That is one metric asking two different questions of the same column,
//                          on purpose, and describeActivitySupport() names the two halves
//                          separately rather than reporting one blended fraction.
//
//                          THE SEASON BOUNDARY IS NOW `closed_at`, AND IT IS THE PROFILE'S, NOT
//                          THE EVENT'S. `season_schedule` is still free text ("November to
//                          February") and nothing can compute against it — so a CLOSED profile
//                          leaves the ranking WHOLE rather than a date filtering its events.
//                          "Past" still means past on this profile; what changed (migration 060,
//                          ITER-028) is that a profile can now stop being one of the profiles the
//                          ranking reads. youthNeed() does that partition, once, below.
//
//   NULL IS NOT ZERO     — see supportedFraction. This is the whole trap in this slice.
//
// THE NUMBER MEASURES RECORDED SUPPORT, NOT SUPPORT. It is only ever as true as the reporting,
// which is why app/api/youth/logs/route.ts now creates the attendee row for a leader who turned
// up without signing up first: without that, the metric reports neglect that did not happen.

export type SupportEvent = ProfileNeedEvent & {
  // TRUE ONLY WHERE A LEADER ACTIVELY SAID "I WENT". A signed-up leader who never answered does
  // NOT count, and one who said "I did not go" certainly does not — `confirmed_attendance` is
  // `boolean | null` and its null means NOBODY HAS SAID EITHER WAY, which is a third state rather
  // than a defaulted false (lib/youth/attendees.ts states it on the column).
  //
  // Separate from `attendeeCount` rather than replacing it: that one is how many people are DOWN,
  // which is what the coverage badge counts and what the upcoming half is about. Collapsing the
  // two would make a game nobody has answered for read as a game nobody went to.
  confirmedAttendeeCount: number;
};

// The shapes buildSupportEvents() reads, declared STRUCTURALLY rather than imported from
// lib/youth/queries.ts or lib/youth/attendees.ts. Both of those are SERVER-ONLY — they import
// next/headers — and this module renders in the browser. youth-c recorded that `npm run build`
// catches exactly that import where lint, typecheck and 2982 tests do not.
export type SupportEventSource = {
  id: string;
  eventType: EventType;
  eventDate: string;
  status: EventStatus;
};

export type SupportAttendeeSource = {
  confirmedAttendance: boolean | null;
};

// ---------------------------------------------------------------------------
// THE ONE PLACE A `SupportEvent[]` IS BUILT. THREE SITES BECOMING ONE IS THE POINT.
// ---------------------------------------------------------------------------
// It was constructed in YouthOverview, in /youth/history/[member_id]/page.tsx, and implicitly a
// third time in the calendar — three copies of one mapping, each free to drift. youth-e is what
// that costs: a value carried the state and the date but not the COUNT, and every covered card
// read "Covered · 0" above an event card reading "Covered · 1". ITER-033 Q5 predicted this
// collapse by name.
//
// ---------------------------------------------------------------------------
// THE MEMBERSHIP WINDOW IS APPLIED HERE, AND IT IS WHAT MAKES TWO TEAM-MATES DIFFERENT
// ---------------------------------------------------------------------------
// One team, one schedule, one set of event rows — and two young people on it get two DIFFERENT
// `SupportEvent[]` out of them, because `memberIsExpectedAt()` filters to each one's own window.
// A youth who joined in January is not measured on December's games; one who left in February is
// not measured on March's, and the team's percentage for everybody else does not move. That is
// the headline behaviour of youth-j and it was unprovable before it.
//
// The window rule lives in lib/youth/roster.ts and is called from here rather than restated —
// one predicate, one place (visits-b, visits-f, ITER-022).
export function buildSupportEvents(
  membership: RosterMember,
  profileClosedAt: string | null,
  events: readonly SupportEventSource[],
  attendeesByEvent: ReadonlyMap<string, readonly SupportAttendeeSource[]>,
  participationByEvent: ReadonlyMap<string, readonly EventParticipation[]>,
  wardTimeZone: string,
): SupportEvent[] {
  return events
    .filter((event) =>
      memberIsExpectedAt(membership, profileClosedAt, event.eventDate, wardTimeZone),
    )
    .map((event) => {
      const attendees = attendeesByEvent.get(event.id) ?? [];

      // THIS YOUNG PERSON'S OWN ANSWER, and nobody else's. `undefined` — no row — is "nobody has
      // said", which is `null` here and the ordinary state of nearly every pair (migration 062d).
      const own = (participationByEvent.get(event.id) ?? []).find(
        (entry) => entry.memberId === membership.memberId,
      );

      return {
        eventType: event.eventType,
        eventDate: event.eventDate,
        status: event.status,
        // HOW MANY ARE DOWN — what the coverage badge counts and what the upcoming half is about.
        attendeeCount: attendees.length,
        // HOW MANY SAID THEY WENT. `=== true` EXPLICITLY, and that is the whole point of the
        // field: `confirmedAttendance` is `boolean | null`, and null means NOBODY HAS SAID EITHER
        // WAY. A truthiness check would still be correct here, but writing it out is what stops
        // somebody later reading null as "did not go" — which it is not, and which would make an
        // unanswered game read as a game somebody stayed away from.
        confirmedAttendeeCount: attendees.filter(
          (attendee) => attendee.confirmedAttendance === true,
        ).length,
        youthAttended: own === undefined ? null : own.takingPart,
      };
    });
}

export type ActivitySupport = {
  profileId: string;
  activityName: string;

  // ---------------------------------------------------------------------------
  // THE HISTORY HALF — past home events, and how many somebody CONFIRMED going to
  // ---------------------------------------------------------------------------
  playedCount: number;
  attendedCount: number;

  // ---------------------------------------------------------------------------
  // THE PLAN HALF — the NEXT home event, and whether anybody is down for it
  // ---------------------------------------------------------------------------
  // Null when nothing is coming up. `planned` is whether anybody has SIGNED UP, not whether
  // anybody CONFIRMED: nobody can confirm attendance at a game that has not been played, so the
  // two halves of this metric ask two different questions of the same column by necessity.
  //
  // It is the SOONEST such event, and only that one. See the horizon note above.
  nextEvent: { eventDate: string; planned: boolean } | null;

  // THE TWO NUMBERS THE PERCENTAGE IS, carried rather than recomputed, so the pill, the tooltip
  // and the sort read one value (Pitfall 3, the summariseCoverage rule).
  supportedCount: number;
  countedCount: number;

  // supportedCount / countedCount, or NULL when nothing is counted at all.
  //
  // ---------------------------------------------------------------------------
  // NULL IS NOT ZERO, AND THIS IS THE SINGLE MOST LIKELY BUG IN THIS MODULE
  // ---------------------------------------------------------------------------
  // A young person with no home games played AND none coming up has not been neglected — there is
  // nothing anybody could have turned up to and nothing anybody can be asked to. Rendered as 0% it
  // would sort FIRST under "least supported", and the priority list would be led by the one person
  // nobody could possibly have supported. visits-f shipped exactly that shape: every row
  // individually correct, the list useless.
  supportedFraction: number | null;
};

// AN EVENT COUNTS AS SUPPORTED WHEN SOMEBODY CONFIRMED THEY WENT. Nothing else — not a plan, not
// a signed-up leader who never answered, not a follow-up written by somebody who stayed home.
// This is the PAST half only; the next event is judged by isPlanned() below.
function isSupported(event: SupportEvent): boolean {
  return event.confirmedAttendeeCount > 0;
}

// AND THE NEXT ONE COUNTS WHEN SOMEBODY IS DOWN FOR IT. A plan is the only thing a future game can
// offer, and it is the thing a leader can act on today.
function isPlanned(event: SupportEvent): boolean {
  return event.attendeeCount > 0;
}

function instantOfEvent(event: SupportEvent): number {
  return new Date(event.eventDate).getTime();
}

export function activitySupport(
  profile: { id: string; activityName: string },
  events: readonly SupportEvent[],
  asOf: Date,
): ActivitySupport {
  const asOfMs = asOf.getTime();

  const played = events.filter((event) => isExpectedPast(event, asOfMs));
  const attendedCount = played.filter(isSupported).length;

  // THE SOONEST UPCOMING ONE, and only it. `reduce` rather than a sort because there is exactly
  // one answer and sorting a season to take its head is wasted work on every card of every render.
  const next = events
    .filter((event) => isExpectedNext(event, asOfMs))
    .reduce<SupportEvent | null>(
      (soonest, event) =>
        soonest === null || instantOfEvent(event) < instantOfEvent(soonest) ? event : soonest,
      null,
    );

  const nextEvent =
    next === null ? null : { eventDate: next.eventDate, planned: isPlanned(next) };

  const supportedCount = attendedCount + (nextEvent?.planned ? 1 : 0);
  const countedCount = played.length + (nextEvent === null ? 0 : 1);

  return {
    profileId: profile.id,
    activityName: profile.activityName,
    playedCount: played.length,
    attendedCount,
    nextEvent,
    supportedCount,
    countedCount,
    supportedFraction: countedCount === 0 ? null : supportedCount / countedCount,
  };
}

// THE SENTENCE, BESIDE THE COMPUTATION THAT DECIDES IT — describeSeasonNeed()'s rule, and the
// reason the pill's tooltip and the pill's percentage cannot disagree.
//
// NULL MEANS NOTHING TO SAY. The pill renders an em dash and this sentence is absent, rather than
// "0 of 0 home games", which reads as a failure nobody could have prevented.
//
// IT NAMES BOTH HALVES SEPARATELY, because they are two different facts and a leader can only act
// on one of them. "Somebody went to 1 of 8" is history and cannot be changed; "nobody is down for
// the next one" is a thing to fix this week. Collapsing them into "2 of 9" would hide the half
// that is still open.
//
// THE COUNTS, NOT THE PERCENTAGE. At small N a percentage misleads — one game out of two is 50%
// and says almost nothing — so the auditable form is the one in words.
export function describeActivitySupport(support: ActivitySupport): string | null {
  if (support.countedCount === 0) return null;

  const nextHalf =
    support.nextEvent === null
      ? null
      : support.nextEvent.planned
        ? "somebody is going to the next one"
        : "nobody is down for the next one";

  if (support.playedCount === 0) {
    // Nothing played yet, so there is only a plan to report. A "0 of 0" opening would be noise.
    return `No home games played yet, and ${nextHalf}.`;
  }

  const noun = support.playedCount === 1 ? "home game" : "home games";
  const history = `Somebody went to ${support.attendedCount} of ${support.playedCount} ${noun} played`;

  return nextHalf === null ? `${history}.` : `${history}, and ${nextHalf}.`;
}

// ===========================================================================
// ONE YOUNG PERSON, ACROSS EVERY ACTIVITY THEY ARE IN
// ===========================================================================
// `youth_activity_profiles` holds one row per (member, activity) with NO uniqueness on the
// member, so Ethan doing basketball and track is two rows — and /youth rendered him as two cards
// until 2026-08-29. A card is a PERSON now, and an activity is a pill on it.
//
// EVERYTHING A CARD RENDERS COMES OUT OF ONE OF THESE. The pills, the badge, the count and the
// sort all read this single value, which is what stops a card sorting first because of a number
// it does not display — summariseCoverage(), describeHouseholdForVisits() and ITER-022, the same
// rule for the fifth time in this codebase.

// A finished season, as a card renders it: a name and the profile it belongs to, and nothing else.
export type ClosedActivity = {
  profileId: string;
  activityName: string;
};

export type YouthNeed = {
  memberId: string;
  memberName: string;
  // One per RUNNING profile, in ACTIVITY-NAME ORDER so two renders of the same card never disagree
  // about which pill comes first. A closed season contributes no pill, because it contributes no
  // number — see the partition in youthNeed().
  activities: ActivitySupport[];
  // HOW MANY OF THIS YOUNG PERSON'S SEASONS ARE FINISHED, and whether any is still running.
  //
  // THEY COME OUT OF THE SAME PASS EVERYTHING ELSE DOES, which is this module's standing rule
  // (summariseCoverage, describeHouseholdForVisits, ITER-022). A card that reads "Nothing running"
  // while the sort ranked it on a season that finished in February is that defect a sixth time,
  // and it is exactly what a second filter somewhere in the page would produce.
  // ONE ENTRY PER FINISHED SEASON, in activity-name order — the same order the running pills use,
  // so a card's two rows of pills read as one list rather than two orderings.
  //
  // THE NAMES ARE CARRIED, NOT JUST A COUNT, AND THAT IS THE WHOLE POINT. Walking scenario 060 on
  // 2026-08-31 asked whether a fully-closed card reads as deliberate; the answer was NO. It was the
  // only card on the page with no pills at all, so beside its neighbours it read as data that had
  // failed to load — and it did not even say WHICH activity the young person does. A closed season
  // now renders as a pill like any other, marked finished, and the difference is carried by the
  // pill's treatment rather than by the absence of one.
  //
  // NO PERCENTAGE COMES WITH THEM, deliberately. Putting a closed season's number back on /youth is
  // precisely what ITER-028 removed; the number lives on /youth/history/[member_id] and nowhere
  // else. The pill says the season happened, not how it went.
  closedActivities: ClosedActivity[];
  hasRunning: boolean;
  // The LOWEST non-null fraction across their activities — what the priority sort reads.
  //
  // An activity with nothing played CONTRIBUTES NOTHING to it. It is not a zero dragging the
  // young person to the top of a list of the least supported: nothing has been played, so there
  // is nothing to have been supported at. Null when EVERY activity is null, and then the whole
  // young person sorts last (compareYouth).
  lowestSupport: number | null;

  // The coverage half, carried across every activity so the card keeps youth-e's badge.
  upcomingCount: number;
  worstUpcoming: CoverageState | null;
  // FROM THE SAME EVENT `worstUpcoming` CAME FROM. profileNeed() already keeps those three tied
  // together by carrying the whole row, and this reduction preserves the tie by choosing a WHOLE
  // ProfileNeed rather than three fields off three different ones. The walk on 2026-08-29 found
  // every covered card reading "Covered · 0" above an event card reading "Covered · 1" for
  // precisely the version of this that did not.
  worstUpcomingAttendees: number;
  soonestNeedOn: string | null;
};

// EVERY MEMBERSHIP IS HANDED IN, RUNNING AND CLOSED, AND THE PARTITION HAPPENS HERE.
//
// The caller must NOT pre-filter. YouthOverview groups its cards from the full list, because a
// young person whose every season is finished has to keep producing a card — filtering upstream
// would make them vanish from the ward, which is the one thing ITER-028 says must not happen.
// Doing the split here is also what keeps the number, the sentence and the sort ONE value.
//
// ---------------------------------------------------------------------------
// A MEMBERSHIP, NOT A PROFILE (youth-j)
// ---------------------------------------------------------------------------
// A profile is a TEAM now and several young people are on it, so "this young person's activities"
// is a list of ROSTER ROWS rather than of profiles. `activityName` and `closedAt` ride along from
// the team the membership points at, because both are facts about the team rather than about the
// person, and looking them up again here would be a second answer that could disagree.
//
// `eventsByProfile` IS THIS YOUNG PERSON'S OWN MAP, keyed by profile id. The caller builds it with
// buildSupportEvents() PER MEMBERSHIP, which is what applies each person's window — so two
// team-mates hand in two different maps drawn from one set of event rows. Handing in a shared map
// keyed by profile would give both of them the same numbers and silently undo the whole slice.
export function youthNeed(
  member: { id: string; name: string },
  memberships: readonly {
    membership: RosterMember;
    activityName: string;
    closedAt: string | null;
  }[],
  eventsByProfile: ReadonlyMap<string, readonly SupportEvent[]>,
  asOf: Date,
): YouthNeed {
  // Flattened to the shape the rest of this function has always read: an id, a name and a closing
  // instant. Everything below is youth-h's code unchanged, which is the point — the partition, the
  // null rules and the sort did not move.
  const profiles = memberships.map((entry) => ({
    id: entry.membership.profileId,
    activityName: entry.activityName,
    closedAt: entry.closedAt,
  }));

  // PARTITIONED ONCE. Everything below reads `running` and nothing else — the pills, the lowest
  // percentage, the upcoming count and the coverage badge. A second filter further down is how
  // the sort and the card would come to disagree.
  const running = profiles.filter((profile) => profile.closedAt === null);

  // SORTED BY NAME, exactly as `activities` is, so the running pills and the finished ones are one
  // list in one order rather than two lists in two.
  const closedActivities: ClosedActivity[] = profiles
    .filter((profile) => profile.closedAt !== null)
    .map((profile) => ({ profileId: profile.id, activityName: profile.activityName }))
    .sort((left, right) => left.activityName.localeCompare(right.activityName));

  const activities = running
    .map((profile) =>
      activitySupport(profile, eventsByProfile.get(profile.id) ?? [], asOf),
    )
    .sort((left, right) => left.activityName.localeCompare(right.activityName));

  const played = activities
    .map((activity) => activity.supportedFraction)
    .filter((fraction): fraction is number => fraction !== null);

  let upcomingCount = 0;
  // THE WHOLE ProfileNeed, not its pieces. See worstUpcomingAttendees above.
  let worst: ProfileNeed | null = null;

  for (const profile of running) {
    const need = profileNeed(eventsByProfile.get(profile.id) ?? [], asOf);
    upcomingCount += need.upcomingCount;

    // Null is NO SIGNAL rather than a good score, exactly as it is inside profileNeed(). A
    // profile with nothing coming up cannot be the worst of anything.
    if (need.worstUpcoming === null) continue;

    if (worst === null || worst.worstUpcoming === null) {
      worst = need;
      continue;
    }

    const byRank = coverageRank(need.worstUpcoming) - coverageRank(worst.worstUpcoming);
    if (byRank < 0) {
      worst = need;
      continue;
    }

    // THE SOONEST EVENT HOLDING THE WORST STATE, across activities exactly as profileNeed()
    // resolves it within one. A leader told that nobody is going to a game on the 3rd wants the
    // date of the game nobody is going to, whichever activity it belongs to.
    if (
      byRank === 0 &&
      need.soonestNeedOn !== null &&
      worst.soonestNeedOn !== null &&
      instantOf(need.soonestNeedOn) < instantOf(worst.soonestNeedOn)
    ) {
      worst = need;
    }
  }

  return {
    memberId: member.id,
    memberName: member.name,
    activities,
    closedActivities,
    hasRunning: running.length > 0,
    // ---------------------------------------------------------------------------
    // A YOUNG PERSON WITH EVERY SEASON CLOSED ALREADY LANDS ON NULL, AND THAT IS CORRECT
    // ---------------------------------------------------------------------------
    // No branch was added for it and none should be. `running` is empty, so `played` is empty, so
    // this is null — and compareYouth() already sorts null LAST in both directions, which is
    // exactly where somebody with nothing running belongs. Writing a special case would be a
    // second rule that could disagree with the first.
    lowestSupport: played.length === 0 ? null : Math.min(...played),
    upcomingCount,
    worstUpcoming: worst?.worstUpcoming ?? null,
    worstUpcomingAttendees: worst?.worstUpcomingAttendees ?? 0,
    soonestNeedOn: worst?.soonestNeedOn ?? null,
  };
}

// THE STATUS LINE ON A CARD WITH NOTHING RUNNING — the slot the upcoming-event count occupies on
// every other card, so the card keeps its shape and only its content changes.
//
// REWRITTEN AFTER THE WALK ON 2026-08-31, WHICH ANSWERED "does this read as deliberate?" WITH NO.
// It used to read "Nothing running. 2 closed seasons." on a card that had no pills at all — a
// negation, a count, and nothing naming the activity. Beside its neighbours it read as a young
// person the app had lost track of. THE COUNT IS GONE because the finished seasons are now pills
// that name themselves, and a number beside a list it duplicates is this codebase's oldest defect
// (summariseCoverage, describeHouseholdForVisits, ITER-022).
//
// NULL WHEN A SEASON IS STILL RUNNING: that card shows its upcoming-event count instead, and the
// finished pills sit beside the live ones needing no sentence at all.
export function describeNothingRunning(need: YouthNeed): string | null {
  if (need.hasRunning) return null;
  if (need.closedActivities.length === 0) return null;

  return "No activity running just now.";
}

// ---------------------------------------------------------------------------
// TWO SORTS AND A DIRECTION, AND `memberName` IS NEVER THE FIRST KEY IN EITHER
// ---------------------------------------------------------------------------
// That is exactly what visits-f got wrong: an inherited name tie-break promoted to the front of a
// comparator sorted never-visited households below recently-visited ones, and every row was
// individually correct.
//
// THREE SORTS BECAME TWO on 2026-08-29. "Nobody going yet" and "Nobody has been in a while" were
// two rankings answering questions a leader could not tell apart from their labels; one number
// with a direction says more and asks less.
export const YOUTH_SORTS = ["priority", "name"] as const;
export type YouthSort = (typeof YOUTH_SORTS)[number];

export const YOUTH_SORT_LABELS: Record<YouthSort, string> = {
  priority: "Priority",
  name: "Name",
};

// WHAT EACH DIRECTION MEANS, IN A LEADER'S WORDS. "Ascending" says nothing at all about a
// percentage, and a control that names its state rather than its mechanism is the same choice
// CoverageBadge and CrossOrgVisibilityToggle both make. Rendered ON the toggle.
export const YOUTH_SORT_DIRECTION_LABELS: Record<
  YouthSort,
  { asc: string; desc: string }
> = {
  priority: { asc: "Least supported first", desc: "Most supported first" },
  name: { asc: "A to Z", desc: "Z to A" },
};

// ALWAYS ASCENDING, NEVER REVERSED BY THE DIRECTION when it is a tie-break. A tie-break that
// flips with the direction makes a list feel scrambled for no information gained — the reader
// changed one question and two answers moved.
function byMemberName(left: YouthNeed, right: YouthNeed): number {
  return left.memberName.localeCompare(right.memberName);
}

export function compareYouth(
  sort: YouthSort,
  ascending: boolean,
  left: YouthNeed,
  right: YouthNeed,
): number {
  if (sort === "name") {
    const order = byMemberName(left, right);
    return ascending ? order : -order;
  }

  const leftSupport = left.lowestSupport;
  const rightSupport = right.lowestSupport;

  // ---------------------------------------------------------------------------
  // A MISSING PERCENTAGE SORTS LAST IN **BOTH** DIRECTIONS
  // ---------------------------------------------------------------------------
  // This is VisitProgressTable.compareNullable()'s rule, word for word: "a missing value always
  // sorts last, in both directions. Reversing the nulls with the direction is the behaviour that
  // makes a table feel scrambled."
  //
  // IT IS THE DELIBERATE OPPOSITE OF THE SORT IT REPLACED. `nobody_all_season` sorted
  // `lastAttendedOn === null` FIRST, because there null meant "nobody has EVER been" — a real and
  // strong signal. Here null means NO HOME GAMES HAVE BEEN PLAYED, which is no data at all. The
  // two rules look identical and are opposite, so both the comment and the test are written down.
  if (leftSupport === null && rightSupport === null) return byMemberName(left, right);
  if (leftSupport === null) return 1;
  if (rightSupport === null) return -1;

  const bySupport = leftSupport - rightSupport;
  if (bySupport !== 0) return ascending ? bySupport : -bySupport;

  return byMemberName(left, right);
}
