import { FOLLOW_UP_STATES, type EventStatus, type FollowUpState } from "@/types/domain";

// Whether a game that has already happened is waiting on THIS reader's account of it.
//
// ---------------------------------------------------------------------------
// COMPUTED, NEVER STORED, AND EMITTED NOWHERE
// ---------------------------------------------------------------------------
// SPEC.md carries a `youth_followup_prompt` trigger key and supabase/seed/notification_triggers.sql
// seeds it. NOTHING EMITS IT, on purpose. It fires from the clock — "after an event passes" — and
// nothing in this project fires from a clock: pg_cron is not enabled, supabase/functions/ does
// not exist, and vercel.json declares no crons. The alternative would be emitting a notification
// from a GET, which puts a write path outside a human confirm (CLAUDE.md rule 3).
//
// So the prompt is computed by whoever is reading the screen, at the moment they read it. This is
// the third instance of that rule in this module alone — lib/youth/coverage.ts computes "nobody
// going", appointmentViewState() computes "missed", householdVisitPriority() computes "overdue" —
// and CLAUDE.md §9 now counts SIX things waiting on Phase 11's single decision about a mechanism.
// youth-c deliberately added no sixth; this one does, and says so.
//
// ---------------------------------------------------------------------------
// CLIENT-IMPORTABLE — KEEP IT THAT WAY
// ---------------------------------------------------------------------------
// FollowUpPanel renders this and EventList badges with it. ONE import of lib/youth/queries.ts or
// lib/youth/activityLogs.ts would pull next/headers into the client bundle and break both. This
// file imports TYPES ONLY, which is the same standing instruction lib/youth/coverage.ts,
// lib/visits/householdStatus.ts and lib/goals/goalStatus.ts all carry.
//
// ---------------------------------------------------------------------------
// `asOf` IS A PARAMETER, NEVER A `new Date()` INSIDE
// ---------------------------------------------------------------------------
// That is what makes the past/future boundary testable, and it is what keeps every row of one
// render judged against the same instant instead of against a clock that moves down the list.
// /youth already resolves one `asOf` per render and hands it down.

export type FollowUpInput = {
  eventDate: string;
  status: EventStatus;
  // Whether the READER is recorded as an attendee. NOT whether anybody is — that question is
  // lib/youth/coverage.ts's, and answering it here would put "did anybody go" and "are you the
  // one who owes an account of it" behind one word.
  isAttendee: boolean;
  // Whether the reader has written their OWN log for this event. Somebody else's follow-up
  // answers nothing about what this reader owes.
  hasLog: boolean;
  // From the reader's own attendee row. Null means they never said either way.
  confirmedAttendance: boolean | null;
};

// ---------------------------------------------------------------------------
// WHETHER A FOLLOW-UP CAN BE WRITTEN AT ALL — AND IT IS NOT THE SAME QUESTION AS `awaiting`
// ---------------------------------------------------------------------------
// EXPORTED SEPARATELY, AND THE SEPARATION IS THE POINT. `followUpState` answers "is anybody
// waiting on THIS READER", and it says `not_due` for a past game the reader was never down for —
// nobody is waiting on somebody who never said they were going.
//
// That is the wrong predicate for rendering the CONTROL. Any `youth_activities.log` holder may
// file their own account of any event their organization owns, and a leader who turned up without
// putting themselves down beforehand is exactly the person whose account is worth having
// (app/api/youth/logs/route.ts, decision 5). Gating the button on `state !== "not_due"` would hide
// it from precisely that person — a workflow rule enforced in a component, refusing something the
// API allows, which is the mirror of youth-a-D1 and just as wrong.
//
// So there is ONE place that decides what "past and still a real event" means, and both callers
// read it.
//
// THE TWO BRANCHES BELOW ARE ORDERED, exactly as eventCoverage()'s are:
//
// 1. CANCELLED, BEFORE THE CLOCK IS CONSULTED. A cancelled game may be REINSTATED, and it must
//    never ask for a follow-up AT ANY DISTANCE FROM THE CLOCK — not three days out and not three
//    days past. Testing it before the arithmetic is what makes that true at every distance at
//    once; testing it after would give the right answer today and the wrong one for somebody
//    reading the same row next week.
//
// 2. An unreadable date cannot be acted on — nobody can write an account of a game at a time
//    nothing can render — and a permanent prompt on a screen whose prompts are supposed to mean
//    something is worse than silence. coverage.ts treats the same input the same way.
//
// 3. "PAST" IS THE START INSTANT, NOT AN END. This schema has no duration column, so a game that
//    kicked off an hour ago is already past here and a leader may be asked for a follow-up while
//    it is still being played. That is the mirror of the limitation lib/youth/coverage.ts names
//    from the other side, where the same instant makes a game in progress read `not_expected`.
//    Saying so in both files is what stops the next reader treating either as a bug.
export function isFollowUpWritable(
  input: Pick<FollowUpInput, "eventDate" | "status">,
  asOf: Date,
): boolean {
  if (input.status === "cancelled") return false;

  const eventMs = new Date(input.eventDate).getTime();
  if (!Number.isFinite(eventMs)) return false;

  return eventMs <= asOf.getTime();
}

export function followUpState(input: FollowUpInput, asOf: Date): FollowUpState {
  const { isAttendee, hasLog, confirmedAttendance } = input;

  // Cancelled, unreadable, or still to come — all three answered in one place, above.
  if (!isFollowUpWritable(input, asOf)) return "not_due";

  // 4. Something is written. `confirmedAttendance === false` is the EXCEPTION and the only one
  // worth a label: "went" is the ordinary case, and a badge on every logged event saying so is
  // noise. Null — never answered — reads as `logged`, because the account itself is what was
  // being waited on.
  if (hasLog) return confirmedAttendance === false ? "did_not_attend" : "logged";

  // 5. Nobody is WAITING on somebody who never said they were going.
  //
  // This does NOT stop them filing one. Any `youth_activities.log` holder may write a follow-up
  // on any event their organization owns — a leader who turned up without putting themselves down
  // is exactly the person whose account is worth having, and refusing it would be a workflow rule
  // enforced in a route pretending to be a boundary (CLAUDE.md rule 2). The panel is a PROMPT,
  // not a permission.
  if (!isAttendee) return "not_due";

  return "awaiting";
}

// The count in the panel's heading.
//
// HERE RATHER THAN IN THE COMPONENT, for the reason summariseCoverage() exists: the number in the
// heading and the rows beneath it must be two renderings of ONE computation, not two computations
// that can disagree. That is describeHouseholdForVisits()'s lesson from visits-f, where the
// picker and the denominator drifted because two places answered the same question.
//
// Every state is present in the result, including the zeroes, so a caller reading
// `summary.awaiting` never has to decide what `undefined` meant.
export function summariseFollowUp(
  states: readonly FollowUpState[],
): Record<FollowUpState, number> {
  const summary = Object.fromEntries(
    FOLLOW_UP_STATES.map((state) => [state, 0]),
  ) as Record<FollowUpState, number>;

  for (const state of states) summary[state] += 1;

  return summary;
}
