"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  YOUTH_ATTENDEES_QUERY_KEY,
  YOUTH_EVENTS_QUERY_KEY,
  YOUTH_PROFILES_QUERY_KEY,
  errorFrom,
  fetchAttendees,
  fetchEvents,
  fetchProfiles,
  readJson,
} from "@/app/(app)/youth/youthQueries";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { AttendeeControls } from "@/components/youth/AttendeeControls";
import { COVERAGE_EDGE_CLASSES, CoverageBadge } from "@/components/youth/CoverageBadge";
import type { ActivityAttendee } from "@/lib/youth/attendees";
import { eventCoverage } from "@/lib/youth/coverage";
import { toLocalInputValue, toOffsetBearingInstant } from "@/lib/youth/eventInstant";
import type { ActivityEvent, ActivityProfile } from "@/lib/youth/queries";
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  type EventType,
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
  canManage: boolean;
  // ONE INSTANT FOR THE WHOLE RENDER, resolved on the server and handed down, so every row is
  // judged against the same moment rather than against a clock that moves down the list
  // (lib/youth/coverage.ts). An ISO string rather than a Date because a Date does not survive the
  // server-to-client boundary as itself.
  asOf: string;
  currentUserId: string;
  // Bishopric only, resolved once on the server. See AttendeeControls' header: a client component
  // never re-derives a permission.
  canAssign: boolean;
  assignableUsers: { id: string; label: string }[];
};

const CHIP_CLASSES =
  "rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted";

// THE HOUR IS THE POINT. 08-youth-activities.md: "A game showing at the wrong hour makes the
// whole feature useless."
//
// THE READER'S OWN ZONE AND LOCALE, which is the rule lib/visits/visitDates.ts already states for
// a timestamptz and states the reason for: an appointment — or a game — is a time somebody has to
// turn up at. `undefined` locale rather than "en-US" for the same reason. The YEAR is carried for
// the reason recorded there too: without it a 2099 row renders identically to a 2026 one.
//
// Not imported from that module, because it is visit-specific by name and the two would have to
// move together. The RULE is shared and cited; the four lines are not worth coupling the modules
// over.
function formatInstant(instant: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "An unreadable date";

  return parsed.toLocaleString(undefined, {
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
function formatEventWhen(instant: string, allDay: boolean): string {
  if (!allDay) return formatInstant(instant);

  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "An unreadable date";

  const date = parsed.toLocaleDateString(undefined, {
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
  canManage,
  asOf,
  currentUserId,
  canAssign,
  assignableUsers,
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

  const profileLabels = new Map(
    (profilesQuery.data ?? []).map((profile) => [
      profile.id,
      { activityName: profile.activityName, memberName: profile.memberName },
    ]),
  );

  const [includePast, setIncludePast] = useState(false);
  const [editing, setEditing] = useState<EventEdit | null>(null);
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

  const events = eventsQuery.data ?? [];
  const attendeesByEvent = attendeesQuery.data ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          Schedule ({eventCount(events.length, includePast)})
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
              : undefined)
        }
      />

      {events.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            {includePast
              ? "No events have been entered for any activity yet."
              : "Nothing coming up. Add a game or a concert below, or show past events."}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {events.map((event) => {
            const profile =
              event.profileId === null ? undefined : profileLabels.get(event.profileId);

            const attendees = attendeesByEvent[event.id] ?? [];
            // Computed from the event AND the attendee count, which is why an attendance
            // mutation invalidates both keys (ATTENDEE_MUTATION_INVALIDATES).
            const coverage = eventCoverage(
              {
                eventType: event.eventType,
                eventDate: event.eventDate,
                status: event.status,
                attendeeCount: attendees.length,
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

            return (
              <li key={event.id}>
                <Card className={COVERAGE_EDGE_CLASSES[coverage.state]}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{event.title}</span>
                    {showTypeChip ? (
                      <span className={CHIP_CLASSES}>{EVENT_TYPE_LABELS[event.eventType]}</span>
                    ) : null}
                    {/* Renders NOTHING for a cancelled or past event — CoverageBadge returns null
                        for `not_expected`, so the "Cancelled" chip beside it is not doubled by a
                        badge saying the same thing less clearly. */}
                    <CoverageBadge coverage={coverage} />
                    {/* A CANCELLED EVENT STAYS VISIBLE AND IS MARKED, rather than disappearing.
                        Removing it would lose the record that it was ever scheduled, which is
                        exactly what somebody asking "why did nobody go?" needs (migration
                        054c). */}
                    {event.status === "cancelled" ? (
                      <span className="rounded-full border border-warning px-2 py-0.5 text-xs font-medium text-warning">
                        {EVENT_STATUS_LABELS.cancelled}
                      </span>
                    ) : null}
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
                    {formatEventWhen(event.eventDate, event.allDay)}
                  </p>

                  <p className="mt-1 text-sm text-muted">
                    {profile === undefined
                      ? "An activity that is no longer listed"
                      : `${profile.memberName} · ${profile.activityName}`}
                  </p>

                  {event.location === null ? null : (
                    <p className="text-sm text-muted">{event.location}</p>
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
