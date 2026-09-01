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
  YOUTH_PARTICIPATION_QUERY_KEY,
  YOUTH_PROFILES_QUERY_KEY,
  errorFrom,
  fetchAttendees,
  fetchOccasionEvents,
  fetchParticipation,
  fetchProfiles,
  readJson,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { AttendeeControls } from "@/components/youth/AttendeeControls";
import { COVERAGE_EDGE_CLASSES, CoverageBadge } from "@/components/youth/CoverageBadge";
import { YouthAbsenceChip } from "@/components/youth/YouthAbsenceChip";
import type { ActivityAttendee } from "@/lib/youth/attendees";
import { eventCoverage, worstCoverage, type EventCoverage } from "@/lib/youth/coverage";
import type { ActivityEvent, ActivityProfile } from "@/lib/youth/queries";
import {
  eventYouthAttendance,
  rosterInWindow,
  youthAttendedForEvent,
  type EventParticipation,
  type RosterMember,
} from "@/lib/youth/roster";
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
  // Keyed by event id. The WIDENED entry, [.., true], matching the attendee seed beside it: this
  // page always reads past events, because the whole point of it is that it works on a game that
  // is over.
  initialParticipation: Record<string, EventParticipation[]>;
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

// ---------------------------------------------------------------------------
// A ROW IS ONE EVENT, AND IT NOW CARRIES THE YOUNG PEOPLE ON IT — ROSTER FIRST, OCCASION SECOND
// ---------------------------------------------------------------------------
// This page has TWO sources of young people and they compose:
//
//   THE ROSTER (derived)    — everybody on this event's own team, in their window. A single game
//                             with four players names four young people WITH NO OCCASION AT ALL,
//                             which is what makes the occasion unnecessary for the ordinary case
//                             rather than merely optional.
//   THE OCCASION (explicit) — other EVENTS on the same evening, from other activities: a Young
//                             Men basketball game and a Young Women concert. That is the one
//                             thing a roster cannot express, and it is why migration 059 survives
//                             youth-j untouched.
//
// ---------------------------------------------------------------------------
// A CARD IS STILL AN EVENT, AND THE YOUNG PEOPLE ARE INSIDE IT
// ---------------------------------------------------------------------------
// The obvious reading of "one row per (young person, event)" is one CARD per pair, and it is
// wrong: `AttendeeControls`, the coverage badge and "Not the same game" are all facts about the
// GAME, so a team of four would render four copies of each — four identical "I'll go" buttons
// writing the same attendee row, and a "Not the same game" offering to unlink an occasion that
// does not exist. Coverage would be four answers to one question.
//
// So the pair is expressed in the LIST INSIDE the card. Each young person gets their name and
// their own absence chip — which is genuinely per person, one team-mate being ill saying nothing
// about the other — while everything about the game is rendered once.
//
// `members` IS EMPTY for a ward-wide event, for a team nobody is on yet, and for one whose season
// closed before this game. THE CARD STILL RENDERS, with a sentence saying which: a page that
// shows nothing for the event named in its own URL is worse than one that says nobody is
// assigned, and "no roster" and "season over" are different problems with different fixes.
type OccasionRow = {
  event: ActivityEvent;
  members: RosterMember[];
  absentMemberIds: Set<string>;
  seasonClosed: boolean;
  activityName: string | null;
  schoolOrg: string | null;
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
  initialParticipation,
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

  const participationQuery = useQuery({
    queryKey: [YOUTH_PARTICIPATION_QUERY_KEY, true],
    queryFn: () => fetchParticipation(true),
    initialData: initialParticipation,
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
    const participationByEvent = participationQuery.data ?? {};

    return events.map((event) => {
      const profile = event.profileId === null ? undefined : profilesById.get(event.profileId);
      const attendees = attendeesByEvent[event.id] ?? [];

      const attendance =
        profile === undefined
          ? null
          : eventYouthAttendance(
              event,
              profile.roster,
              participationByEvent[event.id] ?? [],
              profile.closedAt,
              wardTimeZone,
            );

      return {
        event,
        members: attendance === null ? [] : rosterInWindow(attendance),
        absentMemberIds: new Set(
          (attendance?.absent ?? []).map((member) => member.memberId),
        ),
        seasonClosed:
          attendance !== null &&
          attendance.kind === "no_expectation" &&
          attendance.reason === "season_closed",
        activityName: profile?.activityName ?? null,
        schoolOrg: profile?.schoolOrg ?? null,
        profileId: event.profileId,
        attendees,
        coverage: eventCoverage(
          {
            eventType: event.eventType,
            eventDate: event.eventDate,
            status: event.status,
            attendeeCount: attendees.length,
            // ONE ANSWER PER GAME, from the SAME function every other screen uses, so the badge
            // here and the badge on the calendar cannot disagree about the same row.
            youthAttended: attendance === null ? null : youthAttendedForEvent(attendance),
          },
          asOfInstant,
        ),
      };
    });
  }, [
    occasionQuery.data,
    attendeesQuery.data,
    participationQuery.data,
    profilesById,
    asOfInstant,
    wardTimeZone,
  ]);

  // THE WORST STATE ACROSS THE OCCASION, and it carries the WHOLE EventCoverage rather than just
  // its state. youth-e's walk found `Covered · 0` above `Covered · 1` because a value held the
  // state and the date but not the count — the badge, the count and the date below all come off
  // this one object (lib/youth/coverage.ts).
  //
  // ONE COVERAGE PER EVENT, so this reduces over the games rather than over the people at them —
  // which is what it has always done, and what keeps a team of four from weighting its own game
  // four times against a single-player one.
  const occasionCoverage = useMemo(
    () => worstCoverage(rows.map((row) => row.coverage)),
    [rows],
  );

  const occasionEventIds = useMemo(
    () => new Set(rows.map((row) => row.event.id)),
    [rows],
  );

  // HOW MANY YOUNG PEOPLE ARE ACTUALLY AT THIS, counted from the rows that name one. A row with a
  // null member is a team nobody is on or a closed season — it is worth rendering and it is not a
  // young person, so counting it would put a number on the panel that the list below contradicts
  // (the count-beside-a-list rule, ITER-022).
  const youthAtThis = useMemo(
    () =>
      new Set(rows.flatMap((row) => row.members.map((member) => member.memberId))).size,
    [rows],
  );

  // DEDUPLICATED BY THE Set, which matters now that one event produces one row per young person
  // on it: four rows from one team must not offer that team four times to exclude.
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
            // TIME · ACTIVITY · TITLE. The YOUNG PERSON is gone from this label, because a
            // profile is a TEAM now (migration 062) and there is no single young person to name —
            // the activity IS the team, which is what the option is choosing.
            //
            // THE TITLE IS THE ONE THE WALK ADDED.
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
              profile?.activityName ?? "An activity that is no longer listed"
            } · ${event.title}`,
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

          ONE YOUNG PERSON IS NOT AN OCCASION, AND THE WHOLE PANEL GOES WHEN THERE IS ONLY ONE.
          COUNTED IN YOUNG PEOPLE RATHER THAN IN ROWS since youth-j, because one event now
          produces one row per player — four rows from a single game are still one game, and
          summarising "across the occasion" there would be summarising a group of one.
          Found by walking scenario 059: a solo event rendered "One of these young people has
          nobody going" — plural, about a group of one — directly above a card already carrying the
          identical "Nobody going" badge. Both halves were wrong for that case: the sentence lied
          about the number and the badge said the same thing twice.
          Guarding the SENTENCE alone would have left the duplicate badge, so the guard is on the
          panel. A single-row page is just the young person's card, which is the honest rendering —
          there is no evening-wide fact to summarise until a second row exists. */}
      {occasionCoverage === null || youthAtThis < 2 ? null : (
        <div
          className={`flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-2 ${
            COVERAGE_EDGE_CLASSES[occasionCoverage.state]
          }`}
        >
          <span className="text-sm font-medium text-foreground">
            {`${youthAtThis} young people at this`}
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
                {/* THE ACTIVITY IS THE HEADING NOW. It used to be the young person, which was
                    the same thing while an event belonged to exactly one of them — a card is one
                    TEAM'S game, and the young people on it are listed beneath. */}
                <span className="text-sm font-medium text-foreground">
                  {row.activityName === null ? (
                    "An activity that is no longer listed"
                  ) : row.profileId === null ? (
                    row.activityName
                  ) : (
                    <Link
                      href={`/youth?youth=${row.profileId}`}
                      className="text-primary underline underline-offset-4"
                    >
                      {row.activityName}
                    </Link>
                  )}
                </span>
                {row.schoolOrg === null ? null : (
                  <span className="text-sm text-muted">{row.schoolOrg}</span>
                )}
                <span className={CHIP_CLASSES}>{EVENT_TYPE_LABELS[row.event.eventType]}</span>
                <CoverageBadge coverage={row.coverage} />
                {row.event.status === "cancelled" ? (
                  <span className="rounded-full border border-warning px-2 py-0.5 text-xs font-medium text-warning">
                    {EVENT_STATUS_LABELS.cancelled}
                  </span>
                ) : null}
                {/* ON EVERY ROW, INCLUDING THIS EVENT'S OWN — the URL-named event is one of these
                    rows, so the event's block and its occasion siblings are one rendering rather
                    than two that could word it differently. PER YOUNG PERSON: one team-mate being
                    ill says nothing about the other, and each row carries its own answer
                    (migration 061).

                    THE CONTROL IS NOT HERE. It lives in EventList and nowhere else — a second
                    entry point would be a second meaning of the same word (youth-h's ground for
                    refusing a second "unlink"). This page is the closest call, and the omission is
                    recorded rather than left looking like an oversight: if a leader reaches for it
                    here, adding it is one prop, not a redesign. */}
                {row.members
                  .filter((member) => row.absentMemberIds.has(member.memberId))
                  .map((member) => (
                    <YouthAbsenceChip
                      key={member.memberId}
                      youthAttended={false}
                      memberName={member.memberName}
                    />
                  ))}
                {/* Same condition EventList uses — an imported row can be edited by hand, but the
                    next import of the same file overwrites the name, the time and the place. */}
                {row.event.sourceUid === null ? null : (
                  <span className={CHIP_CLASSES}>From a schedule feed</span>
                )}
              </div>

              <p className="mt-1 text-sm text-foreground">
                {row.event.title}
              </p>

              {/* ---------------------------------------------------------------
                  WHO IS AT IT, BY NAME — the (young person, event) half of this page
                  ---------------------------------------------------------------
                  Each name links to their own card, which is the crossing ITER-020 asked for:
                  any card → the event → the young people at it → a young person's card. It used
                  to be the row's heading and there could only ever be one; now a team of four
                  names four.

                  THREE DIFFERENT EMPTY CASES, AND THEY ARE NOT ONE SENTENCE. "Nobody has been put
                  on this team yet" is something the reader can fix in a minute; "the season was
                  closed out" is a deliberate state; a ward-wide event has no team at all. Saying
                  "nobody" for all three would be true and useless — the youth-c rule that an
                  empty state which says nothing reads as something that failed to load, and the
                  visits-f rule that collapsing distinct reasons loses what a presidency needs. */}
              {row.members.length > 0 ? (
                <p className="text-sm text-muted">
                  {row.members.map((member, index) => (
                    <span key={member.memberId}>
                      {index === 0 ? null : ", "}
                      <Link
                        href={`/youth/history/${member.memberId}`}
                        className="text-primary underline underline-offset-4"
                      >
                        {member.memberName}
                      </Link>
                    </span>
                  ))}
                </p>
              ) : row.profileId === null ? (
                <p className="text-sm text-muted">A ward-wide event, not on anybody&rsquo;s team.</p>
              ) : row.seasonClosed ? (
                <p className="text-sm text-muted">
                  This season was closed out before this event.
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Nobody is on this activity yet.
                </p>
              )}
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

              {/* ONLY WHERE THERE IS SOMETHING TO LEAVE, and the count is of EVENTS rather than
                  of rows. An occasion links EVENT rows; a team of four at one game is four rows
                  and ONE event, with no link to break — offering "Not the same game" there would
                  be a control whose only outcome is the route's 409, and it would appear on
                  exactly the ordinary case youth-j made common. */}
              {canManage && occasionEventIds.size > 1 ? (
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
