"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AddYouthToOccasion } from "@/app/(app)/youth/events/[id]/AddYouthToOccasion";
import {
  JoinOccasionPicker,
  type JoinCandidate,
} from "@/app/(app)/youth/events/[id]/JoinOccasionPicker";
import {
  OCCASION_MUTATION_INVALIDATES,
  YOUTH_ATTENDEES_QUERY_KEY,
  YOUTH_OCCASION_QUERY_KEY,
  YOUTH_PROFILES_QUERY_KEY,
  errorFrom,
  fetchAttendees,
  fetchOccasionEvents,
  fetchProfiles,
  readJson,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { AttendeeControls } from "@/components/youth/AttendeeControls";
import { COVERAGE_EDGE_CLASSES, CoverageBadge } from "@/components/youth/CoverageBadge";
import type { ActivityAttendee } from "@/lib/youth/attendees";
import { eventCoverage, worstCoverage, type EventCoverage } from "@/lib/youth/coverage";
import type { ActivityEvent, ActivityProfile } from "@/lib/youth/queries";
import { EVENT_STATUS_LABELS, EVENT_TYPE_LABELS } from "@/types/domain";

// The occasion, rendered: one card per young person, and the two controls that build it.
//
// ---------------------------------------------------------------------------
// IT READS THE SHARED CACHE, SEEDED BY THE PAGE — IT DOES NOT RENDER A PROP
// ---------------------------------------------------------------------------
// A Server Component prop never refetches, so joining an occasion would succeed and change
// nothing at all on screen (youth-a-D2). Every control here is a mutation, so this is the single
// most likely bug in this slice, and the shape that prevents it is the same one ActivityCalendar
// and EventList use: `initialData` seeds, `useQuery` reads, the mutation invalidates.
//
// EVERY MUTATION INVALIDATES ALL THREE KEYS (OCCASION_MUTATION_INVALIDATES). The reasons are
// written down in youthQueries.ts rather than here, because this module has been bitten three
// times by somebody reasonably assuming the answer was one key.
//
// ---------------------------------------------------------------------------
// AttendeeControls IS RENDERED, NEVER FORKED
// ---------------------------------------------------------------------------
// visits-c proved the report feed could serve two modules by supplying a mapper rather than a
// second component, and youth-a-D1 is what a second copy of a permission gate costs. Both
// controls here carry the SAME gates the calendar's cards do, resolved once on the server.
//
// ---------------------------------------------------------------------------
// THE LINKING CONTROLS GATE ON `youth_activities.manage` AND NOTHING ELSE
// ---------------------------------------------------------------------------
// `activity_occasions` carries ward-wide policies on all four verbs (migration 059c), for the
// reason `activity_events` does — a cross-organization occasion is the point rather than an edge
// case. lib/youth/activityOwnership.ts says deliberately that there is no
// `canManageActivityEvent()`, because a helper there would either restate `true` or invent a rule
// the database does not enforce. Hiding a control the API allows is the mirror of youth-a-D1 and
// just as wrong; narrowing this needs a migration first.

export type EventDetailProps = {
  // The event whose URL this is. It is the row a join is recorded AGAINST and the row an added
  // young person is joined TO, so it is carried separately from the list — the list may grow.
  eventId: string;
  occasionId: string | null;
  initialOccasionEvents: ActivityEvent[];
  initialProfiles: ActivityProfile[];
  initialAttendees: Record<string, ActivityAttendee[]>;
  // The picker's candidates: every youth activity on this event's own day, in the WARD's zone.
  // A plain prop rather than a cache entry, because it is a bounded query nothing on this page
  // mutates — joining a game does not change what else is scheduled that evening.
  sameDayEvents: ActivityEvent[];
  // ONE INSTANT for the whole render, resolved on the server. An ISO string because a Date does
  // not survive the server-to-client boundary as itself.
  asOf: string;
  currentUserId: string;
  // Resolved ONCE on the server. AttendeeControls' header states the rule: a client component
  // never re-derives a permission.
  canManage: boolean;
  canAssign: boolean;
  assignableUsers: { id: string; label: string }[];
  // From lib/ward/wardTimezone.ts. The page already resolved it for wardDayBounds() — the
  // picker's candidates and the printed times are now the same zone, which they were not before.
  wardTimeZone: string;
};

type OccasionRow = {
  event: ActivityEvent;
  memberName: string | null;
  activityName: string | null;
  profileId: string | null;
  attendees: ActivityAttendee[];
  coverage: EventCoverage;
};

const CHIP_CLASSES =
  "rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted";

// THE WARD'S ZONE AND AN EXPLICIT LOCALE, the rule EventList.formatInstant states and states the
// reason for: a game is a time somebody has to turn up at, and the ward's zone is the one every
// reader of this page shares.
//
// This comment used to say the opposite — that the ward's zone decides what a floating IMPORTED
// time means and what day the picker's candidates are drawn from, but "does not decide what a
// rendered card says". REVERSED 2026-08-29: it could not decide what a rendered card said,
// because a "use client" component is server-rendered first and a server has no reader whose
// zone `undefined` could mean. It took the SERVER's zone, UTC on Vercel. So the ward's zone now
// answers all three questions rather than two.
function formatWhen(instant: string, allDay: boolean, timeZone: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "An unreadable date";

  const date = parsed.toLocaleDateString("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Never "12:00am" — an all-day entry is stored at ward midnight, and rendering it as a time is
  // indistinguishable from an off-by-N-hours bug (migration 055a).
  if (allDay) return `${date} · All day`;

  return `${date}, ${parsed.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function shortWhen(instant: string, allDay: boolean, timeZone: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "an unreadable time";
  if (allDay) return "All day";

  return parsed.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EventDetail({
  eventId,
  occasionId,
  initialOccasionEvents,
  initialProfiles,
  initialAttendees,
  sameDayEvents,
  asOf,
  currentUserId,
  canManage,
  canAssign,
  assignableUsers,
  wardTimeZone,
}: EventDetailProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const asOfInstant = useMemo(() => new Date(asOf), [asOf]);

  const [errorMessage, setErrorMessage] = useState<string>();

  const profilesQuery = useQuery({
    queryKey: [YOUTH_PROFILES_QUERY_KEY],
    queryFn: fetchProfiles,
    initialData: initialProfiles,
  });

  // KEYED ON THE OCCASION ID, so two occasions are two cache entries (visits-c). When the event
  // has no occasion there is nothing to fetch and the one row the server sent is the answer —
  // `enabled: false` rather than a fetch that would have to invent a query string.
  const occasionQuery = useQuery({
    queryKey: [YOUTH_OCCASION_QUERY_KEY, occasionId],
    queryFn: () => fetchOccasionEvents(occasionId as string),
    initialData: initialOccasionEvents,
    enabled: occasionId !== null,
  });

  // The WIDENED attendee entry, [.., true], because this page always reads past events. It is the
  // same entry /youth's overview seeds, so a sign-up here and a sign-up there cannot disagree.
  const attendeesQuery = useQuery({
    queryKey: [YOUTH_ATTENDEES_QUERY_KEY, true],
    queryFn: () => fetchAttendees(true),
    initialData: initialAttendees,
  });

  async function refresh(): Promise<void> {
    await Promise.all(
      OCCASION_MUTATION_INVALIDATES.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey: [...queryKey] }),
      ),
    );
  }

  const mutation = useMutation({
    mutationFn: async (request: { url: string; method: string; body?: unknown }) => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.body === undefined ? {} : { "content-type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });

      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorFrom(payload, "Could not change which game this is."));
      }
    },
    // BOTH HALVES, AND NEITHER IS ENOUGH ALONE. This is StewardshipPanel's rule, which
    // youthQueries.ts quotes in as many words.
    //
    //   invalidateQueries  moves the three cache entries the rows are composed from.
    //   router.refresh()   re-runs the Server Component, which is the only thing that can move
    //                      `occasionId` — it lives on the EVENT ROW this URL names, not in this
    //                      component's state, so a join that CREATED an occasion is invisible to
    //                      the cache alone. The query key carries the occasion id, so a changed
    //                      id is a changed key and the refreshed props seed it.
    onSuccess: async () => {
      setErrorMessage(undefined);
      await refresh();
      router.refresh();
    },
    onError: (error: Error) => setErrorMessage(error.message),
  });

  const profilesById = useMemo(
    () => new Map((profilesQuery.data ?? []).map((profile) => [profile.id, profile])),
    [profilesQuery.data],
  );

  const rows: OccasionRow[] = useMemo(() => {
    const events = occasionQuery.data ?? [];
    const attendeesByEvent = attendeesQuery.data ?? {};

    return events.map((event) => {
      const profile = event.profileId === null ? undefined : profilesById.get(event.profileId);
      const attendees = attendeesByEvent[event.id] ?? [];

      return {
        event,
        memberName: profile?.memberName ?? null,
        activityName: profile?.activityName ?? null,
        profileId: event.profileId,
        attendees,
        coverage: eventCoverage(
          {
            eventType: event.eventType,
            eventDate: event.eventDate,
            status: event.status,
            attendeeCount: attendees.length,
          },
          asOfInstant,
        ),
      };
    });
  }, [occasionQuery.data, attendeesQuery.data, profilesById, asOfInstant]);

  // THE WORST STATE ACROSS THE OCCASION, and it carries the WHOLE EventCoverage rather than just
  // its state. youth-e's walk found `Covered · 0` above `Covered · 1` because a value held the
  // state and the date but not the count — the badge, the count and the date below all come off
  // this one object (lib/youth/coverage.ts).
  const occasionCoverage = useMemo(
    () => worstCoverage(rows.map((row) => row.coverage)),
    [rows],
  );

  const occasionEventIds = useMemo(
    () => new Set(rows.map((row) => row.event.id)),
    [rows],
  );

  const occasionProfileIds = useMemo(
    () =>
      new Set(
        rows
          .map((row) => row.profileId)
          .filter((value): value is string => value !== null),
      ),
    [rows],
  );

  // EXCLUDES THIS EVENT AND EVERY ROW ALREADY ON THIS OCCASION — offering either would be a
  // control whose only outcome is one of the route's two 409s.
  const candidates: JoinCandidate[] = useMemo(
    () =>
      sameDayEvents
        .filter((event) => !occasionEventIds.has(event.id))
        .map((event) => {
          const profile =
            event.profileId === null ? undefined : profilesById.get(event.profileId);

          return {
            eventId: event.id,
            // TIME · YOUNG PERSON · ACTIVITY · TITLE — all four, and the TITLE IS THE ONE THE WALK
            // ADDED.
            //
            // The rule was "never the title ALONE", because two feeds write one fixture as "Game
            // against Roosevelt" and "Game vs Roosevelt" and a title cannot tell them apart. That
            // is still true. But dropping it entirely went a step too far, and walking scenario 059
            // found why: an option read "4:00 PM · Ethan Brooks · Varsity basketball" for an event
            // actually called "Track time trial". The activity is the PROFILE — the season, the
            // team — and one young person's profile can hold several events on one day, so without
            // the title those options differ only by a time.
            //
            // Both facts earn their place: the activity says whose season this belongs to, the
            // title says which event. Neither is sufficient alone.
            label: `${shortWhen(event.eventDate, event.allDay, wardTimeZone)} · ${
              profile?.memberName ?? "An activity that is no longer listed"
            } · ${profile?.activityName ?? "Activity not listed"} · ${event.title}`,
          };
        }),
    [sameDayEvents, occasionEventIds, profilesById, wardTimeZone],
  );

  const addableProfiles = useMemo(
    () => (profilesQuery.data ?? []).filter((profile) => !occasionProfileIds.has(profile.id)),
    [profilesQuery.data, occasionProfileIds],
  );

  // The row this URL names, which is what an added young person's event copies its title, date
  // and location from. Falls back to the first row only if the named one has somehow gone.
  const sourceRow = rows.find((row) => row.event.id === eventId) ?? rows[0];

  const queryError = profilesQuery.isError
    ? (profilesQuery.error as Error).message
    : occasionQuery.isError
      ? (occasionQuery.error as Error).message
      : attendeesQuery.isError
        ? (attendeesQuery.error as Error).message
        : undefined;

  return (
    <div className="flex flex-col gap-4">
      <FormError message={errorMessage ?? queryError} />

      {/* THE OCCASION'S OWN BADGE, ABOVE THE ROWS. Worst-of across every young person on it,
          reduced with coverageRank() — the same rule ActivityCalendar applies to a day cell,
          reused rather than invented. The sentence beside it is what a leader acts on: an
          occasion where ONE young person has nobody going reads as an alert even when the others
          are covered, which is the whole point of computing it across the rows.

          ONE ROW IS NOT AN OCCASION, AND THE WHOLE PANEL GOES WHEN THERE IS ONLY ONE.
          Found by walking scenario 059: a solo event rendered "One of these young people has
          nobody going" — plural, about a group of one — directly above a card already carrying the
          identical "Nobody going" badge. Both halves were wrong for that case: the sentence lied
          about the number and the badge said the same thing twice.
          Guarding the SENTENCE alone would have left the duplicate badge, so the guard is on the
          panel. A single-row page is just the young person's card, which is the honest rendering —
          there is no evening-wide fact to summarise until a second row exists. */}
      {occasionCoverage === null || rows.length < 2 ? null : (
        <div
          className={`flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 ${
            COVERAGE_EDGE_CLASSES[occasionCoverage.state]
          }`}
        >
          <span className="text-sm font-medium text-foreground">
            {`${rows.length} young people at this`}
          </span>
          <CoverageBadge coverage={occasionCoverage} />
          {occasionCoverage.state === "uncovered" ? (
            <span className="text-sm font-semibold text-danger">
              One of these young people has nobody going.
            </span>
          ) : null}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.event.id}>
            <Card className={COVERAGE_EDGE_CLASSES[row.coverage.state]}>
              <div className="flex flex-wrap items-center gap-2">
                {/* THE YOUNG PERSON IS THE HEADING HERE, not the title — one occasion is one
                    evening with one name at the top of the page, and what distinguishes the rows
                    beneath it is whose commitment each one is. */}
                <span className="text-sm font-medium text-foreground">
                  {row.memberName === null || row.profileId === null ? (
                    "An activity that is no longer listed"
                  ) : (
                    <Link
                      href={`/youth?youth=${row.profileId}`}
                      className="text-primary underline underline-offset-4"
                    >
                      {row.memberName}
                    </Link>
                  )}
                </span>
                {row.activityName === null ? null : (
                  <span className="text-sm text-muted">{row.activityName}</span>
                )}
                <span className={CHIP_CLASSES}>{EVENT_TYPE_LABELS[row.event.eventType]}</span>
                <CoverageBadge coverage={row.coverage} />
                {row.event.status === "cancelled" ? (
                  <span className="rounded-full border border-warning px-2 py-0.5 text-xs font-medium text-warning">
                    {EVENT_STATUS_LABELS.cancelled}
                  </span>
                ) : null}
                {/* Same condition EventList uses — an imported row can be edited by hand, but the
                    next import of the same file overwrites the name, the time and the place. */}
                {row.event.sourceUid === null ? null : (
                  <span className={CHIP_CLASSES}>From a schedule feed</span>
                )}
              </div>

              <p className="mt-1 text-sm text-foreground">
                {row.event.title}
              </p>
              <p className="text-sm text-muted">
                {formatWhen(row.event.eventDate, row.event.allDay, wardTimeZone)}
              </p>
              {row.event.location === null ? null : (
                <p className="text-sm text-muted">{row.event.location}</p>
              )}

              <AttendeeControls
                eventId={row.event.id}
                attendees={row.attendees}
                currentUserId={currentUserId}
                canAssign={canAssign}
                assignableUsers={assignableUsers}
              />

              {/* ONLY WHERE THERE IS SOMETHING TO LEAVE. A single-row occasion has no link to
                  break, and offering "Not the same game" there would be a control whose only
                  outcome is the route's 409. */}
              {canManage && rows.length > 1 ? (
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        url: `/api/youth/events/${row.event.id}/occasion`,
                        method: "DELETE",
                      })
                    }
                  >
                    Not the same game
                  </Button>
                </div>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>

      {canManage ? (
        <Card>
          <div className="flex flex-col gap-4">
            <JoinOccasionPicker
              candidates={candidates}
              disabled={mutation.isPending}
              onJoin={(otherEventId) =>
                mutation.mutate({
                  url: `/api/youth/events/${eventId}/occasion`,
                  method: "POST",
                  body: { otherEventId },
                })
              }
            />

            <AddYouthToOccasion
              profiles={addableProfiles}
              disabled={mutation.isPending || sourceRow === undefined}
              onAdd={(profileId) => {
                if (sourceRow === undefined) return;

                mutation.mutate({
                  url: "/api/youth/events",
                  method: "POST",
                  body: {
                    profileId,
                    title: sourceRow.event.title,
                    eventDate: sourceRow.event.eventDate,
                    location: sourceRow.event.location,
                    // NO `eventType`. Absent means "classify from the location", so the new row
                    // is judged on its own venue rather than inheriting a hand correction
                    // somebody made to a different young person's row (youth-c).
                    occasionWithEventId: eventId,
                  },
                });
              }}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
