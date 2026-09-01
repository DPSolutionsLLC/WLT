"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FollowUpForm } from "@/app/(app)/youth/FollowUpForm";
import {
  PARTICIPATION_MUTATION_INVALIDATES,
  YOUTH_ATTENDEES_QUERY_KEY,
  YOUTH_EVENTS_QUERY_KEY,
  YOUTH_FOLLOW_UP_QUERY_KEY,
  YOUTH_PARTICIPATION_QUERY_KEY,
  YOUTH_PROFILES_QUERY_KEY,
  errorFrom,
  fetchAttendees,
  fetchEvents,
  fetchOwnFollowUps,
  fetchParticipation,
  fetchProfiles,
  readJson,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { AttendeeControls } from "@/components/youth/AttendeeControls";
import { COVERAGE_EDGE_CLASSES, CoverageBadge } from "@/components/youth/CoverageBadge";
import { FollowUpBadge } from "@/components/youth/FollowUpBadge";
import { YouthParticipationControl } from "@/components/youth/YouthParticipationControl";
import { canManageActivityLog, canWriteFollowUpOn } from "@/lib/youth/activityOwnership";
import type { ActivityAttendee } from "@/lib/youth/attendees";
import { eventCoverage } from "@/lib/youth/coverage";
import { toLocalInputValue, toOffsetBearingInstant } from "@/lib/youth/eventInstant";
import { followUpState, isFollowUpWritable } from "@/lib/youth/followUp";
import type { ActivityEvent, ActivityLog, ActivityProfile } from "@/lib/youth/queries";
import {
  eventYouthAttendance,
  expectedNames,
  memberIsExpectedAt,
  rosterInWindow,
  youthAttendedForEvent,
  type EventParticipation,
} from "@/lib/youth/roster";
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  type EventType,
  type SessionUser,
} from "@/types/domain";

// The games, concerts and meets themselves. Cards rather than a table, because at 375px a table
// with five columns is a horizontal scroll and nothing else.
//
// EVERY VIEW IS ITS OWN CACHE KEY. `includePast` is part of the key rather than a filter applied
// to one shared cache entry — visits-c found a bookmark made under one filter invisible under
// another until a reload, and the cause was two views sharing an entry.

export type EventListProps = {
  initialEvents: ActivityEvent[];
  // Seeds the SHARED profiles query, which is where the "whose activity is this" labels come from.
  //
  // This was a flat `profileLabels` record built once on the server. That is stale the moment an
  // activity is added, so an event created against a brand-new activity rendered as "An activity
  // that is no longer listed" until a reload (part of youth-a-D2). Reading the same key
  // ActivityProfileList reads costs no extra fetch — it is the same cache entry.
  initialProfiles: ActivityProfile[];
  // Seeds the SHARED attendee query, exactly as initialProfiles seeds the profiles one. Keyed by
  // event id; an event with nobody down for it is simply absent.
  initialAttendees: Record<string, ActivityAttendee[]>;
  // Seeds the SHARED follow-up query, exactly as initialAttendees seeds the attendee one. Keyed by
  // event id; an event this reader has written nothing about is simply absent. The server rendered
  // the UPCOMING view, where a follow-up is never due — so this is empty on first paint by
  // construction and the widened view is where it fills in.
  initialFollowUps: Record<string, ActivityLog>;
  // Seeds the SHARED participation query, keyed by event id. An event nobody has answered for is
  // simply ABSENT — migration 062d's third state arriving as a missing key.
  initialParticipation: Record<string, EventParticipation[]>;
  canManage: boolean;
  // `youth_activities.log`, resolved ONCE on the server. A client component never re-derives a
  // permission (AttendeeControls' header states the rule).
  canLog: boolean;
  // The ward's cross-organization visibility setting, for the sentence on the shared-note field.
  crossOrgVisibility: boolean;
  // ONE INSTANT FOR THE WHOLE RENDER, resolved on the server and handed down, so every row is
  // judged against the same moment rather than against a clock that moves down the list
  // (lib/youth/coverage.ts). An ISO string rather than a Date because a Date does not survive the
  // server-to-client boundary as itself.
  asOf: string;
  currentUserId: string;
  // For canManageActivityLog(), which mirrors migration 057c's UPDATE policy. The role rather than
  // a boolean, because the mirror lives in lib/youth/activityOwnership.ts beside the profile's and
  // must be the same function the rest of the module calls.
  currentUserRole: SessionUser["role"];
  // For canWriteFollowUpOn(), which mirrors migration 057c's INSERT policy. Resolved once on the
  // server; a client component never re-derives a session value.
  currentUserOrgId: string | null;
  // Bishopric only, resolved once on the server. See AttendeeControls' header: a client component
  // never re-derives a permission.
  canAssign: boolean;
  assignableUsers: { id: string; label: string }[];
  // When set, only these profiles' events are RENDERED. A LIST where youth-e had a single id:
  // one card on /youth is now one YOUNG PERSON, who may be in several activities at once —
  // `youth_activity_profiles` holds one row per (member, activity) with no uniqueness on the
  // member.
  //
  // The three cache entries this component seeds and reads stay WHOLE: `initialEvents` is a seed
  // shared with FollowUpPanel and YouthOverview, and seeding it PRE-FILTERED would poison that
  // entry for every other reader on the page. Filter on the way OUT, never on the way in.
  profileIds?: readonly string[];
  // ---------------------------------------------------------------------------
  // WHOSE SCHEDULE THIS IS — AND WHY A TEAM FILTER WAS NOT ENOUGH (defect 062-D1)
  // ---------------------------------------------------------------------------
  // `profileIds` narrows to a young person's ACTIVITIES. It cannot narrow to the games they were
  // actually on the team for, because a team's schedule is one set of rows serving a whole roster
  // (youth-j). So an expanded card for a youth who left mid-season listed the games played after
  // they left, under a heading bearing their name — while the pill beside it, which DOES apply
  // the window, read "0 events coming up". One card, two numbers: the ITER-022 count-and-list
  // defect, found walking scenario 062.
  //
  // Set this and the list narrows to the window as well as to the team. The window rule is NOT
  // restated here — `memberIsExpectedAt()` is called, the same function the percentage is built
  // from, so the count and the list cannot drift apart again (visits-b, visits-f, ITER-022).
  //
  // ABSENT ON /youth/profiles, DELIBERATELY. There the unit is the TEAM, and its whole schedule
  // is the right answer — including the games a youth who has left did not play. Setting this
  // there would hide a team's own season from the page that manages it.
  //
  // The window needs the profile's `roster` and `closedAt`, both of which are already on the
  // profile this component fetches, so this stays one scalar prop and adds no request.
  memberId?: string;
  // "Schedule" on /youth/profiles; the young person's name inside an expanded overview card.
  heading?: string;
  // From lib/ward/wardTimezone.ts, resolved once by the page. See formatInstant's header: this
  // component is server-rendered before it is hydrated, and on a server there is no reader whose
  // zone "the reader's zone" could mean.
  wardTimeZone: string;
};

const CHIP_CLASSES =
  "rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted";

// THE HOUR IS THE POINT. 08-youth-activities.md: "A game showing at the wrong hour makes the
// whole feature useless."
//
// ---------------------------------------------------------------------------
// THE WARD'S ZONE, NOT THE READER'S — REVERSED 2026-08-29, AND WHY
// ---------------------------------------------------------------------------
// This passed `undefined` for both locale and zone, so a game showed in the reader's own zone —
// the rule lib/visits/visitDates.ts states for a timestamptz, and the intent was right. The
// mechanism could not deliver it, and THIS IS THE LINE THAT SHIPPED THE BUG.
//
// A "use client" component is still SERVER-RENDERED on the first request, and this one is seeded
// with real rows through `initialData`, so the server formats every date before the browser ever
// sees it. On a server there is no reader: `undefined` resolves to the SERVER's zone, which is
// UTC on Vercel. Production served "Sat, Jan 16, 2027, 2:30 AM" over a 7:30pm Friday game, then
// hydration rewrote it — a React #418 mismatch and a visible flash of the wrong day. It was
// invisible in dev, where both sides are America/Denver: CLAUDE.md §9's "passes every test on the
// dev machine and ships wrong", arriving through the render path rather than through an ICS file.
//
// The ward's zone is deterministic, so server and browser agree by construction. It is also the
// better answer: a ward is one geographic congregation, so for very nearly every reader it IS
// their zone — and the leader who is travelling wants "7:30pm", the hour the game starts and the
// hour you would say aloud, not 9:30pm in their hotel. "en-US" rather than undefined for the same
// reason: a locale the server does not share with the browser is the identical bug in a second
// dimension.
//
// The YEAR is carried for the reason visitDates.ts records: without it a 2099 row renders
// identically to a 2026 one.
//
// Not imported from that module, because it is visit-specific by name and the two would have to
// move together. The RULE is shared and cited; the four lines are not worth coupling the modules
// over.
function formatInstant(instant: string, timeZone: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "An unreadable date";

  return parsed.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// AN ALL-DAY EVENT NEVER RENDERS "12:00am", AND THAT IS THE WHOLE JUSTIFICATION FOR THE COLUMN.
//
// An ICS all-day entry carries a date and no time at all, so it is stored at ward midnight —
// `event_date` is a timestamptz and there is nowhere else to put it. Rendered as a time, midnight
// on this screen is INDISTINGUISHABLE from a 7:30pm game that got converted through the wrong
// zone, which is the exact bug the whole ICS slice is arranged to prevent. Making a tournament
// weekend read "All day" is what keeps a real off-by-N-hours bug legible when one happens
// (migration 055a).
function formatEventWhen(instant: string, allDay: boolean, timeZone: string): string {
  if (!allDay) return formatInstant(instant, timeZone);

  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "An unreadable date";

  const date = parsed.toLocaleDateString("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return `${date} · All day`;
}

// A CANCELLED EVENT STAYS INSIDE THIS COUNT, and that was DECIDED rather than overlooked (the
// youth-a retro left it open by name). A cancelled game can be reinstated, so it is still part of
// the schedule a leader is looking at. What must be true is that it never registers as
// UNATTENDED, and that rule lives in lib/youth/coverage.ts, which tests `cancelled` before it
// consults the clock.
function eventCount(count: number, includePast: boolean): string {
  const noun = count === 1 ? "event" : "events";
  return includePast ? `${count} ${noun}` : `${count} upcoming ${noun}`;
}

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

type EventEdit = {
  id: string;
  localDate: string;
  title: string;
  location: string;
  eventType: EventType;
};

export function EventList({
  initialEvents,
  initialProfiles,
  initialAttendees,
  initialFollowUps,
  initialParticipation,
  canManage,
  canLog,
  crossOrgVisibility,
  asOf,
  currentUserId,
  currentUserRole,
  currentUserOrgId,
  canAssign,
  assignableUsers,
  profileIds,
  memberId,
  wardTimeZone,
  heading,
}: EventListProps) {
  const queryClient = useQueryClient();

  // Parsed ONCE, outside the row loop, for the reason the server resolved it once: a `new Date()`
  // per row would judge the bottom of a long list against a later instant than the top.
  const asOfInstant = new Date(asOf);

  const profilesQuery = useQuery({
    queryKey: [YOUTH_PROFILES_QUERY_KEY],
    queryFn: fetchProfiles,
    initialData: initialProfiles,
  });

  // THE WHOLE PROFILE, not three fields off it. A card now needs the activity's name, its owning
  // organization, its ROSTER and its `closedAt` — and youth-e is what carrying a subset costs:
  // a value held the state and the date but not the count, and every covered card read
  // "Covered · 0" above an event card reading "Covered · 1".
  const profilesById = new Map(
    (profilesQuery.data ?? []).map((profile) => [profile.id, profile]),
  );

  const [includePast, setIncludePast] = useState(false);
  const [editing, setEditing] = useState<EventEdit | null>(null);
  const [followingUp, setFollowingUp] = useState<string | null>(null);
  const [listError, setListError] = useState<string | undefined>(undefined);

  // The SAME `includePast` the events query uses, so the two describe one screen. The route
  // resolves its event set through the same query for the same reason.
  const attendeesQuery = useQuery({
    queryKey: [YOUTH_ATTENDEES_QUERY_KEY, includePast],
    queryFn: () => fetchAttendees(includePast),
    // The server rendered the UPCOMING view only, so the widened view starts empty rather than
    // seeded — the same guard the events query below carries, and for the same reason.
    initialData: includePast ? undefined : initialAttendees,
  });

  // The SAME `includePast` the events query uses, for the reason the attendee query takes it: the
  // route resolves its event set through the same query, so the three describe one screen rather
  // than three.
  const followUpsQuery = useQuery({
    queryKey: [YOUTH_FOLLOW_UP_QUERY_KEY, includePast],
    queryFn: () => fetchOwnFollowUps(includePast),
    initialData: includePast ? undefined : initialFollowUps,
  });

  const participationQuery = useQuery({
    queryKey: [YOUTH_PARTICIPATION_QUERY_KEY, includePast],
    queryFn: () => fetchParticipation(includePast),
    // The server rendered the UPCOMING view only, so the widened view starts empty rather than
    // seeded — the same guard every other query on this component carries.
    initialData: includePast ? undefined : initialParticipation,
  });

  const eventsQuery = useQuery({
    queryKey: [YOUTH_EVENTS_QUERY_KEY, includePast],
    queryFn: () => fetchEvents(includePast),
    // The server rendered the UPCOMING view only. Seeding the widened view with it would show a
    // list missing every past event for a moment and call it complete — the same initialData
    // guard VisitProgressTable and StewardshipPanel both carry.
    initialData: includePast ? undefined : initialEvents,
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: [YOUTH_EVENTS_QUERY_KEY] });
  }

  const patchMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const response = await fetch(`/api/youth/events/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorFrom(payload, "Could not save that event."));
    },
    onSuccess: async () => {
      setEditing(null);
      setListError(undefined);
      await refresh();
    },
    onError: (error: Error) => setListError(error.message),
  });

  // RECORDING THAT ONE YOUNG PERSON IS NOT TAKING PART. Its OWN mutation rather than a body on
  // patchMutation, because it is a write to a different table on a different route with a
  // different invalidation set — youthQueries.ts names them and says why the events key is in it.
  const participationMutation = useMutation({
    mutationFn: async ({
      eventId,
      memberId,
      takingPart,
    }: {
      eventId: string;
      memberId: string;
      takingPart: boolean | null;
    }) => {
      const response = await fetch(`/api/youth/events/${eventId}/participation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId, takingPart }),
      });

      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorFrom(payload, "Could not record that."));
    },
    onSuccess: async () => {
      setListError(undefined);
      await Promise.all(
        PARTICIPATION_MUTATION_INVALIDATES.map((queryKey) =>
          queryClient.invalidateQueries({ queryKey: [...queryKey] }),
        ),
      );
    },
    onError: (error: Error) => setListError(error.message),
  });

  function saveEdit(edit: EventEdit): void {
    // Converted through the SHARED helper, which keeps the wall clock the person typed and
    // appends the offset in force at that moment. Never `new Date(value).toISOString()`: filling
    // the field back in from a UTC string and saving again converts a second time, and 7:30pm
    // walks by the offset on every save. That bug only ever appears on the SECOND write
    // (lib/youth/eventInstant.ts).
    const eventDate = toOffsetBearingInstant(edit.localDate);

    if (eventDate === null) {
      setListError("Give the date and time of the event.");
      return;
    }

    patchMutation.mutate({
      id: edit.id,
      body: {
        title: edit.title.trim(),
        eventDate,
        location: edit.location.trim() === "" ? null : edit.location.trim(),
        eventType: edit.eventType,
      },
    });
  }

  // FILTERED ON THE WAY OUT. The query above still holds — and still seeds — the WHOLE ward's
  // list, which is the entry FollowUpPanel and YouthOverview read from the same keys. Narrowing
  // the seed instead would leave those two rendering one young person's events and calling it the
  // ward's.
  //
  // `eventCount()` reads `events.length`, so the heading's number follows this filter
  // automatically. That is the property to preserve rather than a convenience: a count beside a
  // list that answers a different question is the ITER-022 defect.
  const events = (eventsQuery.data ?? []).filter((event) => {
    if (
      profileIds !== undefined &&
      (event.profileId === null || !profileIds.includes(event.profileId))
    ) {
      return false;
    }

    // NARROWED TO THE TEAM ABOVE, TO THE PERSON'S OWN WINDOW HERE. Two filters because a team's
    // schedule is one set of rows serving a whole roster: the first answers "is this one of their
    // activities", the second "were they on the team when it was played" (defect 062-D1).
    if (memberId === undefined) return true;

    // A ward-wide event belongs to no team, so no roster row can place anybody at it.
    if (event.profileId === null) return false;

    const profile = profilesById.get(event.profileId);

    // FAIL CLOSED on a profile or a membership this component cannot see, matching
    // memberIsExpectedAt()'s own answer to an unreadable date: a row nothing can read is not a
    // row to render under somebody's name. Neither is reachable in practice — `profilesById` is
    // seeded from the server on first paint, and the caller derives `profileIds` from this young
    // person's own memberships — so an empty list here means the data changed under the page,
    // which is the case where showing another youth's season is the worse failure.
    if (profile === undefined) return false;

    const membership = profile.roster.find((entry) => entry.memberId === memberId);
    if (membership === undefined) return false;

    return memberIsExpectedAt(membership, profile.closedAt, event.eventDate, wardTimeZone);
  });

  // ---------------------------------------------------------------------------
  // COUNTED FROM THE UNFILTERED LIST, ABOVE — NOT FROM `events`
  // ---------------------------------------------------------------------------
  // `events` is narrowed to one young person inside an expanded card on /youth, and their
  // team-mate's row is exactly what the narrowing removes. The honest answer to "who else is at
  // this game" is still two, so the count is built from the query's whole list. A count computed
  // after the filter answers a different question from the one the words beside it claim, which
  // is roster-b, restated by visits-b and visits-f.
  //
  // NO EXTRA REQUEST: siblings share an instant, and this list is date-bounded by `includePast`
  // rather than by profile, so every sibling of a fetched event is already in the same fetch.
  const occasionCounts = new Map<string, number>();
  for (const event of eventsQuery.data ?? []) {
    if (event.occasionId === null) continue;
    occasionCounts.set(event.occasionId, (occasionCounts.get(event.occasionId) ?? 0) + 1);
  }

  const attendeesByEvent = attendeesQuery.data ?? {};
  const followUpsByEvent = followUpsQuery.data ?? {};
  const participationByEvent = participationQuery.data ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          {heading ?? "Schedule"} ({eventCount(events.length, includePast)})
        </h2>
        <Button variant="secondary" onClick={() => setIncludePast((current) => !current)}>
          {includePast ? "Upcoming only" : "Show past events"}
        </Button>
      </div>

      <FormError
        message={
          listError ??
          (eventsQuery.isError
            ? (eventsQuery.error as Error).message
            : attendeesQuery.isError
              ? (attendeesQuery.error as Error).message
              : followUpsQuery.isError
                ? (followUpsQuery.error as Error).message
                : undefined)
        }
      />

      {events.length === 0 ? (
        <Card>
          {/* FOUR SENTENCES, BECAUSE THE FILTER CHANGES WHAT IS TRUE. "No events have been
              entered for any activity yet" is false inside a card for one young person who has
              none, and "add one below" is false on a page with no form beneath it. A label can be
              correct in one place and nonsense in another, and no type can tell the difference
              (youth-c).

              THE FILTERED PAIR SAYS "YOUNG PERSON", NOT "ACTIVITY", and that changed with the
              prop. `profileIds` is set by exactly one caller — an expanded card on /youth, which
              is now a PERSON and may cover several activities at once. "No events for this
              activity" inside Ethan's card was true of neither one activity nor all of them
              (Task 7's copy pass). */}
          <p className="text-sm text-muted">
            {profileIds === undefined
              ? includePast
                ? "No events have been entered for any activity yet."
                : "Nothing coming up. Add a game or a concert below, or show past events."
              : includePast
                ? "No events have been entered for this young person yet."
                : "Nothing coming up for this young person. Show past events, or add one from the activities page."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event) => {
            const profile =
              event.profileId === null ? undefined : profilesById.get(event.profileId);

            const participation = participationByEvent[event.id] ?? [];

            // ---------------------------------------------------------------
            // WHO IS EXPECTED AT THIS GAME, AND WHO IS MARKED ABSENT
            // ---------------------------------------------------------------
            // ONE call, and it answers the loud/quiet split as well: a team with nobody on its
            // roster yet lands on `expected` with an EMPTY list, so its games read as ordinary
            // uncovered coverage rather than silently leaving the model. lib/youth/roster.ts's
            // branch 5 argues that at length and this is the screen it is about.
            //
            // IT HONOURS `closedAt` WITHOUT THIS FILE MENTIONING IT — the window function folds
            // "the youth left", "the youth joined late" and "the season was closed out" into one
            // rule, which is the design.
            const attendance =
              profile === undefined
                ? null
                : eventYouthAttendance(
                    event,
                    profile.roster,
                    participation,
                    profile.closedAt,
                    wardTimeZone,
                  );

            const attendees = attendeesByEvent[event.id] ?? [];
            const ownAttendee =
              attendees.find((attendee) => attendee.userId === currentUserId) ?? null;
            const ownLog = followUpsByEvent[event.id] ?? null;

            // Computed from the event, the reader's attendee row AND their own log, which is why
            // a follow-up mutation invalidates all three keys
            // (FOLLOW_UP_MUTATION_INVALIDATES). Judged against the same `asOfInstant` every
            // coverage badge on this page is, so one card cannot say "past" while the next says
            // "upcoming".
            const followUp = followUpState(
              {
                eventDate: event.eventDate,
                status: event.status,
                isAttendee: ownAttendee !== null,
                hasLog: ownLog !== null,
                confirmedAttendance: ownAttendee?.confirmedAttendance ?? null,
                // A game NOBODY on the team is taking part in asks nobody for an account of it —
                // but a follow-up ALREADY WRITTEN still reads `logged`, and isFollowUpWritable()
                // below is deliberately untouched, so the button stays.
                //
                // ONE ABSENT PLAYER OUT OF FOUR DOES NOT STOP THE PROMPT, and that is the
                // event-level reading being the right one here: somebody still went to that game,
                // and their account is still worth having. youthAttendedForEvent() is where that
                // judgement lives, so this screen and the calendar cannot word it differently.
                youthAttended: attendance === null ? null : youthAttendedForEvent(attendance),
              },
              asOfInstant,
            );

            // A DIFFERENT QUESTION FROM THE BADGE'S, and gating the control on
            // `followUp !== "not_due"` would be the bug that question exists to prevent: a past
            // game the reader was never down for reads `not_due`, and that person may still file
            // a follow-up. lib/youth/followUp.ts argues it in full.
            const canWriteFollowUp = isFollowUpWritable(
              { eventDate: event.eventDate, status: event.status },
              asOfInstant,
            );

            // WHICH POLICY APPLIES DEPENDS ON WHICH ACTION IS OFFERED.
            //
            // Creating a follow-up is an INSERT (057c): the bishopric, or the organization that
            // owns the event through its profile. Changing one is an UPDATE (058): the author, or
            // the bishopric — with NO organization arm at all.
            //
            // Collapsing these into one check would break in both directions. Using the INSERT
            // rule on an existing log would hide "Change what you wrote" from a leader who has
            // since moved organizations but may still edit what they wrote — the mirror mistake,
            // hiding what the API allows. Using the UPDATE rule on a new one would offer the
            // create button on every organization's events, which is the bug this exists to close.
            //
            // `profile` is `undefined` both when the event has no profile and when the profile is
            // not in this reader's list; both resolve to ward-wide, which is what the policy's
            // LEFT JOIN does.
            const canWriteFollowUpHere =
              ownLog === null
                ? canWriteFollowUpOn(
                    { role: currentUserRole, orgId: currentUserOrgId },
                    profile ?? null,
                  )
                : canManageActivityLog(
                    { id: currentUserId, role: currentUserRole },
                    { loggedBy: ownLog.loggedBy },
                  );

            // Computed from the event AND the attendee count, which is why an attendance
            // mutation invalidates both keys (ATTENDEE_MUTATION_INVALIDATES).
            const coverage = eventCoverage(
              {
                eventType: event.eventType,
                eventDate: event.eventDate,
                status: event.status,
                attendeeCount: attendees.length,
                // Resolves to `not_expected` at EVERY distance from the clock, so a game with no
                // expectation raises no badge three days out and no failure three days past.
                youthAttended: attendance === null ? null : youthAttendedForEvent(attendance),
              },
              asOfInstant,
            );

            // THE SAME FACT MUST NOT APPEAR TWICE ON ONE CARD. An unclassified event used to show
            // BOTH a type chip and a coverage badge saying the same thing — and the chip was the
            // vaguer of the two. Where the badge already says it, the chip goes.
            //
            // It is kept when the badge is ABSENT, which is a past or cancelled event: there the
            // chip is the only thing carrying the fact, and losing it would lose the record.
            const showTypeChip = !(
              event.eventType === "tbd" && coverage.state === "needs_type"
            );

            // MINUS ONE — the count is of the OTHERS, and this row is in the map too.
            const siblingCount =
              event.occasionId === null
                ? 0
                : (occasionCounts.get(event.occasionId) ?? 1) - 1;

            return (
              <li key={event.id}>
                <Card className={COVERAGE_EDGE_CLASSES[coverage.state]}>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* THE TITLE IS THE WAY IN TO THE EVENT ITSELF, where the occasion — every
                        young person at this same game — is read and built. ITER-020 asked for
                        exactly this crossing: any card → the event → the occasion's young people
                        → a young person's card. */}
                    <Link
                      href={`/youth/events/${event.id}`}
                      className="text-sm font-medium text-primary underline underline-offset-4"
                    >
                      {event.title}
                    </Link>
                    {showTypeChip ? (
                      <span className={CHIP_CLASSES}>{EVENT_TYPE_LABELS[event.eventType]}</span>
                    ) : null}
                    {/* Renders NOTHING for a cancelled or past event — CoverageBadge returns null
                        for `not_expected`, so the "Cancelled" chip beside it is not doubled by a
                        badge saying the same thing less clearly. */}
                    <CoverageBadge coverage={coverage} />
                    {/* Renders NOTHING for `not_due`, which is every upcoming event and every
                        cancelled one — so this badge and the coverage badge above it are never
                        both present, and a card carries at most one thing to do. */}
                    <FollowUpBadge state={followUp} />
                    {/* A CANCELLED EVENT STAYS VISIBLE AND IS MARKED, rather than disappearing.
                        Removing it would lose the record that it was ever scheduled, which is
                        exactly what somebody asking "why did nobody go?" needs (migration
                        054c). */}
                    {event.status === "cancelled" ? (
                      <span className="rounded-full border border-warning px-2 py-0.5 text-xs font-medium text-warning">
                        {EVENT_STATUS_LABELS.cancelled}
                      </span>
                    ) : null}
                    {/* THE ABSENCE CHIPS ARE NOT HERE ANY MORE — they live inside
                        YouthParticipationControl at the foot of the card, one per absent young
                        person. An event serves a whole TEAM now (migration 062), so a game can
                        carry several, and a row of them wedged between the coverage badge and the
                        "From a schedule feed" marker would crowd out the two facts that describe
                        the EVENT rather than the people at it.

                        They are still ALWAYS VISIBLE, outside the control's disclosure: a
                        recorded absence is a fact about the game and must not need a click. */}
                    {/* A LABEL, NOT A CONTROL. An imported row can be edited by hand exactly like
                        any other — but the next import of the same file will overwrite the name,
                        the time, the place and the all-day flag (lib/youth/ics/applyImport.ts,
                        Decision 6). Saying where the row came from is what lets somebody decide
                        whether to fix it here or in the school's calendar. Home/away and cancelled
                        are never overwritten, so those edits are safe and the marker is not a
                        warning. */}
                    {event.sourceUid === null ? null : (
                      <span className={CHIP_CLASSES}>From a schedule feed</span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-foreground">
                    {formatEventWhen(event.eventDate, event.allDay, wardTimeZone)}
                  </p>

                  {/* THE ACTIVITY AND ITS SCHOOL. A profile is a TEAM now, so there is no single
                      young person to name here — who is expected is answered beneath, by name,
                      from the roster. */}
                  <p className="mt-1 text-sm text-muted">
                    {profile === undefined
                      ? "An activity that is no longer listed"
                      : profile.schoolOrg === null
                        ? profile.activityName
                        : `${profile.activityName} · ${profile.schoolOrg}`}
                  </p>

                  {/* WHO IS EXPECTED, BY NAME. This is what replaced the member name in the label
                      above, and it is strictly more information: a card used to say whose game it
                      was, and now says who is playing in it.

                      NOTHING AT ALL WHEN THE LIST IS EMPTY, which is a team nobody has been
                      assigned to yet. The sentence a leader needs there is on /youth/profiles,
                      beside the control that fixes it; repeating it on every one of a season's
                      twelve cards would be noise. The GAMES are what stay loud here — they keep
                      their ordinary uncovered badge (lib/youth/roster.ts's branch 5). */}
                  {attendance === null || expectedNames(attendance).length === 0 ? null : (
                    <p className="text-sm text-muted">{expectedNames(attendance).join(", ")}</p>
                  )}

                  {event.location === null ? null : (
                    <p className="text-sm text-muted">{event.location}</p>
                  )}

                  {/* NOTHING AT ALL AT ZERO, which is nearly every card. "+0 others at this game"
                      is noise on the ordinary row — talks-c's render-nothing-rather-than-"Never"
                      rule.

                      SINGULAR AND PLURAL BOTH WRITTEN OUT. youth-b's walk found "1 events
                      updated" shipped past a green suite, because a plural bug is invisible to
                      every test that does not read the sentence. */}
                  {siblingCount === 0 ? null : (
                    <p className="mt-1 text-sm">
                      <Link
                        href={`/youth/events/${event.id}`}
                        className="text-primary underline underline-offset-4"
                      >
                        {siblingCount === 1
                          ? "+1 other at this game"
                          : `+${siblingCount} others at this game`}
                      </Link>
                    </p>
                  )}

                  {/* SHOWN ON EVERY EVENT, INCLUDING CANCELLED AND PAST ONES. The gate is
                      `youth_activities.view`, which everybody reading this page holds, so hiding
                      the control anywhere would be hiding something the API allows — the mirror
                      of youth-a-D1. A person may legitimately want to come off a cancelled game's
                      list, and somebody who went to a past one is a record worth keeping. */}
                  <AttendeeControls
                    eventId={event.id}
                    attendees={attendees}
                    currentUserId={currentUserId}
                    canAssign={canAssign}
                    assignableUsers={assignableUsers}
                  />

                  {/* ---------------------------------------------------------------
                      THE FOLLOW-UP, ON A PAST EVENT ONLY
                      ---------------------------------------------------------------
                      `not_due` covers everything upcoming and everything cancelled, so this
                      control appears exactly where a follow-up is a thing a person could write:
                      after the game, on an event that was not called off.

                      It is offered whether or not the reader was DOWN for the event — any
                      `youth_activities.log` holder may file their own account, and a leader who
                      turned up without putting themselves down beforehand is exactly the person
                      whose account is worth having (app/api/youth/logs/route.ts, decision 5). What
                      attendance decides is only whether the form asks "did you go?".

                      ABSENT rather than present-and-refusing for somebody without the permission,
                      which is the mirror of youth-a-D1.

                      The gate is isFollowUpWritable(), NOT `followUp !== "not_due"`. Those look
                      interchangeable and are not: a past game the reader was never down for reads
                      `not_due`, and hiding the button from that person is exactly the workflow-rule
                      -in-a-component mistake decision 5 refuses.

                      AND THE ORGANIZATION IS A SEPARATE QUESTION AGAIN. `canLog` is the
                      permission — `youth_activities.log` — and it says nothing about WHICH events.
                      canWriteFollowUpOn() is the organization half, mirroring migration 057c's
                      INSERT policy, and canManageActivityLog() is the different rule that applies
                      once a follow-up exists (migration 058's UPDATE, which has no organization
                      arm). Without the first of those, "Say how it went" appeared on every
                      organization's past events and the API answered 403 — visits-d and
                      youth-a-D1 a THIRD time, found walking scenario 056. ITER-021. */}
                  {canLog && canWriteFollowUp && canWriteFollowUpHere ? (
                    followingUp === event.id ? (
                      <FollowUpForm
                        eventId={event.id}
                        eventTitle={event.title}
                        existingLog={ownLog}
                        isAttendee={ownAttendee !== null}
                        confirmedAttendance={ownAttendee?.confirmedAttendance ?? null}
                        // The mirror of migration 057c's UPDATE policy. It is true for the
                        // reader's own follow-up and for the bishopric, and false is unreachable
                        // from this page today — which is the point: the gate exists so that a
                        // later screen showing somebody else's follow-up cannot forget it.
                        canFlag={
                          ownLog === null ||
                          canManageActivityLog(
                            { id: currentUserId, role: currentUserRole },
                            { loggedBy: ownLog.loggedBy },
                          )
                        }
                        crossOrgVisibility={crossOrgVisibility}
                        onClose={() => setFollowingUp(null)}
                      />
                    ) : (
                      <div className="mt-3">
                        <Button
                          variant={followUp === "awaiting" ? "primary" : "secondary"}
                          onClick={() => setFollowingUp(event.id)}
                        >
                          {ownLog === null ? "Say how it went" : "Change what you wrote"}
                        </Button>
                      </div>
                    )
                  ) : null}

                  {/* Gated on the PERMISSION ALONE, and that is not the oversight it looks like
                      next to ActivityProfileList. `activity_events` keeps migration 019's
                      ward-wide write policies and has no org_id, so any holder of
                      `youth_activities.manage` in this ward may genuinely edit any event — an
                      event inherits its organization through its profile. Hiding a control the
                      API would allow is the mirror of youth-a-D1 and just as wrong
                      (lib/youth/activityOwnership.ts). Narrowing this needs a migration first. */}
                  {canManage && editing?.id !== event.id ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setEditing({
                            id: event.id,
                            localDate: toLocalInputValue(event.eventDate),
                            title: event.title,
                            location: event.location ?? "",
                            eventType: event.eventType,
                          })
                        }
                      >
                        Edit
                      </Button>
                      {/* CANCELLING IS AN UPDATE, NOT A DELETE, and un-cancelling is the same
                          control read backwards — a game called off and then back on is one row
                          throughout. */}
                      <Button
                        variant="secondary"
                        disabled={patchMutation.isPending}
                        onClick={() =>
                          patchMutation.mutate({
                            id: event.id,
                            body: {
                              status: event.status === "cancelled" ? "upcoming" : "cancelled",
                            },
                          })
                        }
                      >
                        {event.status === "cancelled" ? "Not cancelled after all" : "Cancel"}
                      </Button>
                    </div>
                  ) : null}

                  {/* ---------------------------------------------------------------
                      SOMEBODY WASN'T THERE?
                      ---------------------------------------------------------------
                      THIS REPLACES A STANDING FIELDSET, AND THE REPLACEMENT IS THE POINT OF THE
                      SLICE. youth-i rendered "Is Ethan taking part?" with an unselected Yes and an
                      unselected No on EVERY card. It was optional and it never blocked anything —
                      and it read as a question owed, which is what raised ITER-033. On a team of
                      eight it would have read as eight questions per game.

                      YouthParticipationControl renders NOTHING by default: one quiet link, plus
                      the chips of anybody already marked. Its header argues it in full, and
                      tests/components/youth/YouthParticipationControl.test.tsx asserts the
                      default is silent, because that is the only place a test rather than a walk
                      can catch it regressing.

                      PAST AND FUTURE BOTH, because an absence known in advance has to take the
                      game out BEFORE it drags the number down: the support metric's horizon is
                      every past home game plus the NEXT one, so a future answer matters
                      immediately.

                      IT RENDERS NOTHING WHERE THERE IS NOBODY TO ASK ABOUT — a ward-wide event
                      with no team, or a team with nobody on its roster yet. The component decides
                      that from the list rather than this file deciding it twice. */}
                  {attendance === null ? null : (
                    <YouthParticipationControl
                      eventId={event.id}
                      expectedMembers={rosterInWindow(attendance)}
                      participation={participation}
                      canManage={canManage}
                      pending={participationMutation.isPending}
                      onSet={(memberId, takingPart) =>
                        participationMutation.mutate({
                          eventId: event.id,
                          memberId,
                          takingPart,
                        })
                      }
                    />
                  )}

                  {editing?.id === event.id ? (
                    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                      <Input
                        id={`event-title-${event.id}`}
                        label="Event"
                        value={editing.title}
                        disabled={patchMutation.isPending}
                        onChange={(input) =>
                          setEditing({ ...editing, title: input.target.value })
                        }
                      />
                      <Input
                        id={`event-date-${event.id}`}
                        type="datetime-local"
                        label="Date and time"
                        value={editing.localDate}
                        disabled={patchMutation.isPending}
                        onChange={(input) =>
                          setEditing({ ...editing, localDate: input.target.value })
                        }
                      />
                      <Input
                        id={`event-location-${event.id}`}
                        label="Where"
                        value={editing.location}
                        disabled={patchMutation.isPending}
                        onChange={(input) =>
                          setEditing({ ...editing, location: input.target.value })
                        }
                      />
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor={`event-type-${event.id}`}
                          className="text-sm font-medium text-foreground"
                        >
                          Home or away
                        </label>
                        <select
                          id={`event-type-${event.id}`}
                          className={SELECT_CLASSES}
                          value={editing.eventType}
                          disabled={patchMutation.isPending}
                          onChange={(input) =>
                            setEditing({
                              ...editing,
                              eventType: input.target.value as EventType,
                            })
                          }
                        >
                          {EVENT_TYPES.map((eventType) => (
                            <option key={eventType} value={eventType}>
                              {EVENT_TYPE_LABELS[eventType]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={patchMutation.isPending}
                          onClick={() => saveEdit(editing)}
                        >
                          {patchMutation.isPending ? "Saving…" : "Save event"}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={patchMutation.isPending}
                          onClick={() => setEditing(null)}
                        >
                          Cancel editing
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
