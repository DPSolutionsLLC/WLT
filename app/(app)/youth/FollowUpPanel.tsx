"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FollowUpForm } from "@/app/(app)/youth/FollowUpForm";
import {
  YOUTH_ATTENDEES_QUERY_KEY,
  YOUTH_EVENTS_QUERY_KEY,
  YOUTH_FOLLOW_UP_QUERY_KEY,
  fetchAttendees,
  fetchEvents,
  fetchOwnFollowUps,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import type { ActivityAttendee } from "@/lib/youth/attendees";
import { followUpState, summariseFollowUp } from "@/lib/youth/followUp";
import type { ActivityEvent, ActivityLog, ActivityProfile } from "@/lib/youth/queries";

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
  // Seeds the shared profiles query's data through EventList; passed here only for the labels on
  // each row, so a leader can tell which youth's season a game belongs to.
  profiles: ActivityProfile[];
  currentUserId: string;
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

  const followUpsQuery = useQuery({
    queryKey: [YOUTH_FOLLOW_UP_QUERY_KEY, PAST],
    queryFn: () => fetchOwnFollowUps(PAST),
    initialData: initialFollowUps,
  });

  const events = eventsQuery.data ?? [];
  const attendeesByEvent = attendeesQuery.data ?? {};
  const followUpsByEvent = followUpsQuery.data ?? {};

  const profileLabels = new Map(
    profiles.map((profile) => [
      profile.id,
      `${profile.memberName} · ${profile.activityName}`,
    ]),
  );

  // ONE PASS. `rows` and `summary` are two renderings of this single array, so the number in the
  // heading cannot disagree with what is beneath it.
  const judged = events.map((event) => {
    const attendees = attendeesByEvent[event.id] ?? [];
    const own = attendees.find((attendee) => attendee.userId === currentUserId) ?? null;
    const log = followUpsByEvent[event.id] ?? null;

    return {
      event,
      log,
      attendee: own,
      state: followUpState(
        {
          eventDate: event.eventDate,
          status: event.status,
          isAttendee: own !== null,
          hasLog: log !== null,
          confirmedAttendance: own?.confirmedAttendance ?? null,
        },
        asOfInstant,
      ),
    };
  });

  const summary = summariseFollowUp(judged.map((row) => row.state));
  const waiting = judged.filter((row) => row.state === "awaiting");

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
        {/* The COUNT comes from summariseFollowUp, not from `waiting.length`, even though the two
            are equal — one computation with two readers cannot drift, and two cannot be stopped
            from drifting by anything but care. Pluralised at 1 and at many, which is a class of
            copy defect youth-b and youth-c between them shipped seven of. */}
        Waiting on your follow-up
        {summary.awaiting === 0 ? "" : ` (${summary.awaiting})`}
      </h2>

      <FormError message={errorMessage} />

      {waiting.length === 0 ? (
        <Card>
          {/* A SENTENCE, not a blank card. youth-c found that an empty state which renders nothing
              reads as something that failed to load rather than as good news. */}
          <p className="text-sm text-muted">
            Nothing is waiting on you. When a game or a concert you were down for has been played,
            it appears here for you to say how it went.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {waiting.map(({ event, attendee }) => (
            <li key={event.id}>
              <Card className="border-l-4 border-l-warning">
                <p className="text-sm font-medium text-foreground">{event.title}</p>
                <p className="mt-1 text-sm text-muted">
                  {event.profileId === null
                    ? "An activity that is no longer listed"
                    : (profileLabels.get(event.profileId) ??
                      "An activity that is no longer listed")}
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
                    {/* ABSENT rather than present-and-refusing for somebody without
                        `youth_activities.log`. A form that fails on submit is worse than no form
                        (ITER-007), and the sentence beside it says who may. */}
                    {canLog ? (
                      <Button onClick={() => setOpenEventId(event.id)}>
                        Say how it went
                      </Button>
                    ) : (
                      <p className="text-sm text-muted">
                        Recording what happened is done by an organization presidency, the
                        bishopric, or a ward council member.
                      </p>
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
