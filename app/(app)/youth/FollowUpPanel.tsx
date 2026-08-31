"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FollowUpForm } from "@/app/(app)/youth/FollowUpForm";
import {
  YOUTH_ATTENDEES_QUERY_KEY,
  YOUTH_EVENTS_QUERY_KEY,
  YOUTH_FOLLOW_UP_QUERY_KEY,
  YOUTH_PROFILES_QUERY_KEY,
  fetchAttendees,
  fetchEvents,
  fetchOwnFollowUps,
  fetchProfiles,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { canWriteFollowUpOn } from "@/lib/youth/activityOwnership";
import type { ActivityAttendee } from "@/lib/youth/attendees";
import { followUpState, summariseFollowUp } from "@/lib/youth/followUp";
import type { ActivityEvent, ActivityLog, ActivityProfile } from "@/lib/youth/queries";
import type { SessionUser } from "@/types/domain";

// "Waiting on your follow-up" — how a leader finds out there is anything to write at all.
//
// ---------------------------------------------------------------------------
// IT LISTS ONLY `awaiting`, AND ONLY FOR THIS READER
// ---------------------------------------------------------------------------
// A past event, not cancelled, that the reader was down for and has written nothing about. Every
// other state renders nothing here: a logged follow-up is finished, a cancelled game is not a
// failure, and an event somebody was never down for is not waiting on them.
//
// The heading's COUNT and the rows beneath it come from ONE computation — summariseFollowUp() over
// the same states the list is built from. That is describeHouseholdForVisits()'s lesson from
// visits-f, where a picker and a denominator drifted because two places answered one question.
//
// ---------------------------------------------------------------------------
// IT NAMES THE EVENTS RATHER THAN COUNTING THEM
// ---------------------------------------------------------------------------
// youth-c walked the uncovered banner on /youth/calendar and found it CORRECT AND UNFINDABLE: the
// reader saw a number and then had to read six cards to work out which one it meant. The fix there
// was to name the events, and the same fix is built in here from the start — every waiting event
// is a row with its own control, not a count with a hunt attached.
//
// ---------------------------------------------------------------------------
// EVERY VIEW IS ITS OWN CACHE KEY, AND THIS ONE IS ALWAYS THE PAST VIEW
// ---------------------------------------------------------------------------
// A follow-up is only ever due on an event that has already happened, so this panel reads the
// `includePast: true` entry of the three shared queries — which is a DIFFERENT cache entry from
// the one EventList reads while it is showing upcoming events only. That is deliberate: visits-c
// found a row made under one filter invisible under another until a reload, because two views
// shared one entry.

const PAST = true;

export type FollowUpPanelProps = {
  // The reader's own follow-ups keyed by event id, rendered on the server so the panel is right on
  // first paint rather than empty-then-correct. It SEEDS the shared query rather than standing in
  // for it — a Server Component prop never refetches, which was defect youth-a-D2.
  initialFollowUps: Record<string, ActivityLog>;
  initialPastEvents: ActivityEvent[];
  initialPastAttendees: Record<string, ActivityAttendee[]>;
  // SEEDS the shared profiles query — the same key EventList seeds on this page, so the two
  // components cannot disagree about which organization owns a profile, and a profile added
  // while the page is open does not go on reading "An activity that is no longer listed"
  // (youth-a-D2).
  profiles: ActivityProfile[];
  currentUserId: string;
  // For canWriteFollowUpOn(), which mirrors migration 057c's INSERT policy. Both resolved once
  // on the server; a client component never re-derives a session value.
  currentUserRole: SessionUser["role"];
  currentUserOrgId: string | null;
  // ONE INSTANT FOR THE WHOLE RENDER, resolved on the server and handed down, so every row is
  // judged against the same moment rather than against a clock that moves down the list
  // (lib/youth/followUp.ts). An ISO string because a Date does not survive the server-to-client
  // boundary as itself.
  asOf: string;
  canLog: boolean;
  crossOrgVisibility: boolean;
};

export function FollowUpPanel({
  initialFollowUps,
  initialPastEvents,
  initialPastAttendees,
  profiles,
  currentUserId,
  currentUserRole,
  currentUserOrgId,
  asOf,
  canLog,
  crossOrgVisibility,
}: FollowUpPanelProps) {
  const [openEventId, setOpenEventId] = useState<string | null>(null);

  // Parsed ONCE, outside the row loop, for the reason the server resolved it once: a `new Date()`
  // per row would judge the bottom of a long list against a later instant than the top.
  const asOfInstant = new Date(asOf);

  const eventsQuery = useQuery({
    queryKey: [YOUTH_EVENTS_QUERY_KEY, PAST],
    queryFn: () => fetchEvents(PAST),
    initialData: initialPastEvents,
  });

  const attendeesQuery = useQuery({
    queryKey: [YOUTH_ATTENDEES_QUERY_KEY, PAST],
    queryFn: () => fetchAttendees(PAST),
    initialData: initialPastAttendees,
  });

  const profilesQuery = useQuery({
    queryKey: [YOUTH_PROFILES_QUERY_KEY],
    queryFn: fetchProfiles,
    initialData: profiles,
  });

  const followUpsQuery = useQuery({
    queryKey: [YOUTH_FOLLOW_UP_QUERY_KEY, PAST],
    queryFn: () => fetchOwnFollowUps(PAST),
    initialData: initialFollowUps,
  });

  const events = eventsQuery.data ?? [];
  const attendeesByEvent = attendeesQuery.data ?? {};
  const followUpsByEvent = followUpsQuery.data ?? {};

  // The VALUE is an object rather than a string because the row needs the owning organization
  // as well as the label — the gate below mirrors a policy that resolves through the profile.
  const profilesById = new Map(
    (profilesQuery.data ?? []).map((profile) => [
      profile.id,
      { label: `${profile.memberName} · ${profile.activityName}`, orgId: profile.orgId },
    ]),
  );

  // ONE PASS. `rows` and `summary` are two renderings of this single array, so the number in the
  // heading cannot disagree with what is beneath it.
  const judged = events.map((event) => {
    const attendees = attendeesByEvent[event.id] ?? [];
    const own = attendees.find((attendee) => attendee.userId === currentUserId) ?? null;
    const log = followUpsByEvent[event.id] ?? null;

    // Resolved ONCE per row, so the label and the ownership gate below cannot look the profile
    // up differently. `undefined` covers both "the event has no profile" and "the profile is
    // not in this reader's list".
    const profile = event.profileId === null ? undefined : profilesById.get(event.profileId);

    return {
      event,
      log,
      profile,
      // RESOLVED ONCE PER ROW, and it feeds BOTH the count and the control — see the split
      // below. canLog is the permission; this is the organization (migration 057c's INSERT).
      writable:
        canLog &&
        canWriteFollowUpOn(
          { role: currentUserRole, orgId: currentUserOrgId },
          profile ?? null,
        ),
      attendee: own,
      state: followUpState(
        {
          eventDate: event.eventDate,
          status: event.status,
          isAttendee: own !== null,
          hasLog: log !== null,
          confirmedAttendance: own?.confirmedAttendance ?? null,
          // Migration 061. A marked game leaves this panel AUTOMATICALLY — it resolves to
          // `not_due`, and the heading count and the two lists still come out of the ONE split
          // below. Nobody is chased about a game the young person was never at.
          //
          // A follow-up ALREADY WRITTEN still reads `logged`, so the record survives the mark.
          youthAttended: event.youthAttended,
        },
        asOfInstant,
      ),
    };
  });

  // ---------------------------------------------------------------------------
  // THE COUNT COUNTS WHAT THE READER CAN ACT ON. NOTHING ELSE.
  // ---------------------------------------------------------------------------
  // followUpState() answers "has this been played, were you down for it, have you written
  // anything" — it knows nothing about WHO OWNS the event, and it should not: it is a pure
  // function of the clock and the reader's own rows.
  //
  // So `awaiting` alone is not the same question as "waiting on YOU". A leader who signed
  // themselves up for another organization's game gets an awaiting row they may not write, and
  // a heading reading "(2)" above one usable control is a promise the screen cannot keep.
  // Found walking scenario 056 on 2026-08-29; the ITER-021 gate had removed the BUTTON without
  // touching the COUNT, which made the mismatch visible for the first time.
  //
  // The split happens ONCE, here, and both the heading and the two lists read from it — which
  // is the property this panel already had and must not lose (describeHouseholdForVisits,
  // visits-f: a picker and a denominator drifted because two places answered one question).
  const awaiting = judged.filter((row) => row.state === "awaiting");
  const waiting = awaiting.filter((row) => row.writable);
  const recordedByOthers = awaiting.filter((row) => !row.writable);

  const summary = summariseFollowUp(waiting.map((row) => row.state));

  const errorMessage = eventsQuery.isError
    ? (eventsQuery.error as Error).message
    : attendeesQuery.isError
      ? (attendeesQuery.error as Error).message
      : followUpsQuery.isError
        ? (followUpsQuery.error as Error).message
        : undefined;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">
        {/* The COUNT comes from summariseFollowUp over the WRITABLE rows, not from
            `waiting.length`, even though the two are equal — one computation with two readers
            cannot drift, and two cannot be stopped from drifting by anything but care. */}
        Waiting on your follow-up
        {summary.awaiting === 0 ? "" : ` (${summary.awaiting})`}
      </h2>

      <FormError message={errorMessage} />

      {waiting.length === 0 ? (
        <Card>
          {/* A SENTENCE, not a blank card. youth-c found that an empty state which renders nothing
              reads as something that failed to load rather than as good news.

              It says "nothing is waiting on YOU" and that stays true when the list below it is
              not empty: the rows in that second group are waiting on another organization. */}
          <p className="text-sm text-muted">
            Nothing is waiting on you. When a game or a concert you were down for has been played,
            it appears here for you to say how it went.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {waiting.map(({ event, attendee, profile }) => (
            <li key={event.id}>
              <Card className="border-l-4 border-l-warning">
                <p className="text-sm font-medium text-foreground">{event.title}</p>
                <p className="mt-1 text-sm text-muted">
                  {profile === undefined
                    ? "An activity that is no longer listed"
                    : profile.label}
                </p>

                {openEventId === event.id ? (
                  <FollowUpForm
                    eventId={event.id}
                    eventTitle={event.title}
                    existingLog={null}
                    isAttendee={attendee !== null}
                    confirmedAttendance={attendee?.confirmedAttendance ?? null}
                    // The reader is always the author of a follow-up they are creating, so the
                    // flag control's own gate is satisfied — but it does not render on a NEW
                    // follow-up anyway: there is nothing to flag until the row exists.
                    canFlag
                    crossOrgVisibility={crossOrgVisibility}
                    onClose={() => setOpenEventId(null)}
                  />
                ) : (
                  <div className="mt-3">
                    {/* Every row in THIS list is writable — the split above put the others in
                        their own group — so the control is unconditional here. The organization
                        check is not repeated: one answer, one place (see `writable` above). */}
                    <Button onClick={() => setOpenEventId(event.id)}>Say how it went</Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* ---------------------------------------------------------------
          PLAYED, AND SOMEBODY ELSE WRITES THEM UP
          ---------------------------------------------------------------
          Its own group, under its own heading, OUTSIDE the count. These are events the reader
          was down for and turned up to, on another organization's activity — real to them, and
          not theirs to record.

          SHOWN rather than hidden, because the reader put themselves on that list and silently
          dropping the row would read as the app forgetting. NOT COUNTED, because the heading
          above says "waiting on YOUR follow-up" and these are waiting on somebody else — a
          number that overstates what a person can do is a promise the screen cannot keep
          (found walking scenario 056, 2026-08-29).

          NO WARNING EDGE on these cards, unlike the group above: there is nothing here for this
          reader to act on, and an amber rail beside a row with no control is exactly the "correct
          and unfindable" shape youth-c warned about, pointing the other way. */}
      {recordedByOthers.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Played, and recorded by another organization
          </h3>
          <ul className="flex flex-col gap-3">
            {recordedByOthers.map(({ event, profile }) => (
              <li key={event.id}>
                <Card>
                  <p className="text-sm font-medium text-foreground">{event.title}</p>
                  <p className="mt-1 text-sm text-muted">
                    {profile === undefined
                      ? "An activity that is no longer listed"
                      : profile.label}
                  </p>
                  {/* The route's own 403 names the alternative; this is that message arriving
                      BEFORE the attempt rather than after it. Not the route's constant — that
                      string is written for somebody who has already pressed Save. */}
                  <p className="mt-2 text-sm text-muted">
                    {canLog
                      ? "They record what happened; you can still see that it was played."
                      : "Recording what happened is done by an organization presidency, the bishopric, or a ward council member."}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
