"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  YOUTH_ATTENDEES_QUERY_KEY,
  YOUTH_EVENTS_QUERY_KEY,
  YOUTH_PARTICIPATION_QUERY_KEY,
  YOUTH_PROFILES_QUERY_KEY,
  fetchAttendees,
  fetchEvents,
  fetchParticipation,
  fetchProfiles,
} from "@/app/(app)/youth/youthQueries";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { ActivityMonthGrid, type ActivityMonthGridDay } from "@/components/youth/ActivityMonthGrid";
import { AttendeeControls } from "@/components/youth/AttendeeControls";
import { COVERAGE_EDGE_CLASSES, CoverageBadge } from "@/components/youth/CoverageBadge";
import { YouthAbsenceChip } from "@/components/youth/YouthAbsenceChip";
import {
  eventYouthAttendance,
  expectedNames,
  youthAttendedForEvent,
  type EventYouthAttendance,
} from "@/lib/youth/roster";
import type { DateOnly } from "@/lib/calendar/dates";
import { monthOf } from "@/lib/calendar/dates";
import type { ActivityAttendee } from "@/lib/youth/attendees";
import { eventCoverage, summariseCoverage, type EventCoverage } from "@/lib/youth/coverage";
import type { ActivityEvent, ActivityProfile } from "@/lib/youth/queries";
import type { EventParticipation } from "@/lib/youth/roster";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  coverageRank,
  type ActivityType,
  type EventType,
} from "@/types/domain";

// The ward's whole youth calendar, filtered.
//
// ---------------------------------------------------------------------------
// IT COMPOSES ITS ROWS FROM THE SHARED CACHE, NOT FROM A SERVER-BUILT LIST
// ---------------------------------------------------------------------------
// `CalendarEvent` used to be an exported type the page built and handed down. It is now an
// internal derived row: an ActivityEvent joined to its profile and its attendees in a useMemo,
// exactly as EventList does it.
//
// THAT CHANGE IS WHAT MAKES THE ATTENDANCE CONTROLS WORK. AttendeeControls invalidates
// YOUTH_ATTENDEES_QUERY_KEY and YOUTH_EVENTS_QUERY_KEY, and a Server Component prop never
// refetches — so on the old shape "I'll go" would have succeeded, invalidated two keys this page
// did not read, and changed nothing at all on screen. That is defect youth-a-D2, and it is the
// single most likely bug in this area.
//
// The NARROW entries, [.., false], because this page shows upcoming events only. /youth reads the
// widened pair. Every view is its own cache key (visits-c).
//
// ---------------------------------------------------------------------------
// EVERY FILTER IS APPLIED CLIENT-SIDE OVER THE ONE FETCHED LIST
// ---------------------------------------------------------------------------
// Two reasons, and both are recorded failures rather than preferences.
//
// A filter parameter the route's schema does not carry is SILENTLY IGNORED with no error
// (plans/retros/roster-b-picker-and-orgs.md) — so adding `?youth=` to a route that does not parse
// it produces a page that looks filtered and is not.
//
// And a list narrowed in the client while a count beside it answers a different question is the
// same defect from the other side. One list, one count, filtered together: the strip below is
// computed from exactly the rows on screen.
//
// ---------------------------------------------------------------------------
// THE ZONE TRAP — READ THIS BEFORE CHANGING HOW A CARD IS BUCKETED INTO A DAY
// ---------------------------------------------------------------------------
// Every card is bucketed into a day in the SAME ZONE its own time is printed in, so the day a
// card sits under always matches the time on it. That invariant is the whole of this warning and
// it has not moved: mixing the two puts an 11pm game under the wrong date on the grid while its
// own card says otherwise — a bug that appears for a few hours a day and only for some readers,
// which is the worst kind to find.
//
// WHAT DID MOVE, 2026-08-29: the shared zone is the WARD'S, not the reader's. Both halves changed
// together, which is what keeps the invariant true.
//
// The reader's zone was unreachable, not merely unwise. This component is server-rendered before
// it is hydrated and is seeded with real rows through `initialData`, so the server formats and
// buckets every event first — and on a server there is no reader. `undefined` took the SERVER's
// zone, UTC on Vercel, and production served a 7:30pm Friday game as "Sat, Jan 16, 2027, 2:30 AM"
// before hydration rewrote it: a React #418 mismatch, a visible flash, and a wrong day in the
// grid. EventList.formatInstant carries the full reasoning.
//
// So lib/ward/wardTimezone.ts now answers BOTH questions — what a floating imported time means,
// and what day a rendered card belongs to. It used to answer only the first.

// An ActivityEvent with its profile and its attendees resolved. Derived here rather than on the
// server, so it moves when the cache does.
type CalendarRow = {
  event: ActivityEvent;
  // WHO IS EXPECTED AT THIS GAME, derived from the team's ROSTER through each member's own window
  // — and WHOLE RosterMember objects, never names, because the chips need the name and youth-e is
  // what carrying a subset costs.
  //
  // It is also what closes the ITER-033 LEAK, and it does so WITHOUT THIS FILE EVER MENTIONING
  // `closedAt`. `eventYouthAttendance()` folds "the youth left", "the youth joined late" and "the
  // season was closed out" into one rule, so a closed team's future games become
  // `no_expectation` here for the first time — this page has never contained a reference to
  // `closedAt` and still does not, which is the design rather than an omission.
  attendance: EventYouthAttendance | null;
  activityName: string | null;
  schoolOrg: string | null;
  activityType: ActivityType | null;
  // An event inherits its organization THROUGH ITS PROFILE — `activity_events` has no org_id and
  // migration 054d says why: a second copy of the answer could disagree with the first.
  orgId: string | null;
  attendees: ActivityAttendee[];
  coverage: EventCoverage;
};

export type ActivityCalendarProps = {
  // The three SHARED cache entries, seeded by the server so first paint is right. Not standing
  // answers — see the header.
  initialProfiles: ActivityProfile[];
  initialEvents: ActivityEvent[];
  initialAttendees: Record<string, ActivityAttendee[]>;
  // Keyed by event id; an event nobody has answered for is simply ABSENT (migration 062d's third
  // state, arriving as a missing key).
  initialParticipation: Record<string, EventParticipation[]>;
  // From lib/ward/wardTimezone.ts, resolved once by the page. Both the printed time and the day
  // a card is bucketed into are computed from it — see the zone trap above.
  //
  // IT IS NOW ALSO WHAT RECONCILES A ROSTER DATE WITH AN EVENT INSTANT. `started_on` and
  // `ended_on` are days and `event_date` is an instant, and lib/youth/roster.ts compares them in
  // THIS zone — so the same value that decides what a card says decides which cards a young
  // person is counted for.
  wardTimeZone: string;
  organizations: { id: string; label: string }[];
  // ONE INSTANT for the whole render, resolved on the server. An ISO string because a Date does
  // not survive the server-to-client boundary as itself.
  asOf: string;
  currentUserId: string;
  // Resolved ONCE on the server. AttendeeControls' header states the rule: a client component
  // never re-derives a permission.
  canAssign: boolean;
  assignableUsers: { id: string; label: string }[];
};

const UPCOMING_ONLY = false;

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

const ANY = "";

// THE WARD'S ZONE AND AN EXPLICIT LOCALE — see the zone trap above and EventList.formatInstant.
// A game is a time somebody has to turn up at, and the ward's zone is the one every reader of
// this page shares. The YEAR is carried so a 2099 row does not render identically to a 2026 one.
function formatWhen(instant: string, allDay: boolean, timeZone: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "An unreadable date";

  if (allDay) {
    // Never "12:00am" — an all-day entry is stored at ward midnight and rendering it as a time is
    // indistinguishable from an off-by-N-hours bug (migration 055a).
    return `${parsed.toLocaleDateString("en-US", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    })} · All day`;
  }

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

// Three names is a sentence; six is a paragraph nobody reads.
const MAX_NAMED_UNCOVERED = 3;

// SHORTER THAN THE CARD'S OWN LINE, because this one appears inside a sentence listing several
// events and the year is already obvious from the cards below. Same zone and locale rule as
// formatWhen: the ward's.
function formatShortWhen(instant: string, allDay: boolean, timeZone: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "an unreadable date";

  const day = parsed.toLocaleDateString("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  if (allDay) return `${day}, all day`;

  return `${day}, ${parsed.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

// THE WARD'S ZONE, expressed as a YYYY-MM-DD key — the same zone formatWhen prints, which is the
// invariant the zone trap above exists to protect. Built from the locale-independent `en-CA`
// short date rather than from `toISOString()`, which would be UTC and put a 6pm game on the wrong
// day for every ward west of Greenwich.
//
// Cached per zone, following lib/youth/occasionDay.ts: a render resolves one zone and constructing
// the formatter is the expensive half.
const DAY_KEY_FORMATS = new Map<string, Intl.DateTimeFormat>();

function dayKeyFormatFor(timeZone: string): Intl.DateTimeFormat {
  const existing = DAY_KEY_FORMATS.get(timeZone);
  if (existing !== undefined) return existing;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  DAY_KEY_FORMATS.set(timeZone, formatter);
  return formatter;
}

function dayKey(instant: string, timeZone: string): DateOnly | null {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return null;
  return dayKeyFormatFor(timeZone).format(parsed);
}

export function ActivityCalendar({
  initialProfiles,
  initialEvents,
  initialAttendees,
  initialParticipation,
  organizations,
  asOf,
  currentUserId,
  canAssign,
  assignableUsers,
  wardTimeZone,
}: ActivityCalendarProps) {
  const asOfInstant = useMemo(() => new Date(asOf), [asOf]);

  const [profileId, setProfileId] = useState(ANY);
  const [orgId, setOrgId] = useState(ANY);
  const [activityType, setActivityType] = useState<ActivityType | "">(ANY);
  const [eventType, setEventType] = useState<EventType | "">(ANY);

  const profilesQuery = useQuery({
    queryKey: [YOUTH_PROFILES_QUERY_KEY],
    queryFn: fetchProfiles,
    initialData: initialProfiles,
  });

  const eventsQuery = useQuery({
    queryKey: [YOUTH_EVENTS_QUERY_KEY, UPCOMING_ONLY],
    queryFn: () => fetchEvents(UPCOMING_ONLY),
    initialData: initialEvents,
  });

  const attendeesQuery = useQuery({
    queryKey: [YOUTH_ATTENDEES_QUERY_KEY, UPCOMING_ONLY],
    queryFn: () => fetchAttendees(UPCOMING_ONLY),
    initialData: initialAttendees,
  });

  const participationQuery = useQuery({
    queryKey: [YOUTH_PARTICIPATION_QUERY_KEY, UPCOMING_ONLY],
    queryFn: () => fetchParticipation(UPCOMING_ONLY),
    initialData: initialParticipation,
  });

  // The `?? []` fallbacks live INSIDE each callback rather than above them. A `??` in a dependency
  // list allocates a fresh empty array on every render, which would defeat the memo entirely.
  const profilesById = useMemo(
    () => new Map((profilesQuery.data ?? []).map((profile) => [profile.id, profile])),
    [profilesQuery.data],
  );

  // THE FILTER IS BY ACTIVITY NOW, NOT BY YOUNG PERSON, and its label says so.
  //
  // It filtered on `profileId`, which used to name one young person's copy of a team and now names
  // the TEAM. So "Young person / Everybody" became a filter that could not do what it said: it
  // selects a team, and a team has several young people on it. Leaving the old label would be a
  // control lying about what it does, which is worse than a control that is merely coarse.
  //
  // NARROWING TO ONE YOUNG PERSON IS NOT OFFERED HERE, and that is a deliberate limit rather than
  // an oversight: an event row belongs to a team, so filtering to Ethan would either show his
  // team's whole schedule (what this already does) or require splitting one card per player,
  // which is the duplication youth-j removed. /youth is where a single young person is the unit.
  //
  // The school keeps two similarly-named teams apart, which is the job the member name used to do.
  const activityOptions = useMemo(
    () =>
      (profilesQuery.data ?? []).map((profile) => ({
        id: profile.id,
        label:
          profile.schoolOrg === null
            ? profile.activityName
            : `${profile.activityName} — ${profile.schoolOrg}`,
      })),
    [profilesQuery.data],
  );

  // ---------------------------------------------------------------------------
  // COUNTED FROM THE UNFILTERED LIST, AND THAT IS THE WHOLE POINT
  // ---------------------------------------------------------------------------
  // Filter the calendar to Ethan and Josh's row disappears — but the honest answer to "who else
  // is at this game" is still two. A count computed AFTER the filter answers a different question
  // from the one the words beside it claim, which is roster-b, restated by visits-b and visits-f.
  //
  // So this is built from `eventsQuery.data` directly, BEFORE the four client-side filters below
  // are applied, and it must stay that way.
  //
  // NO EXTRA REQUEST, and no N+1 is needed later either: siblings share an instant and this
  // page's fetch is date-bounded, so every sibling of a fetched event is in the same fetch.
  const occasionCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const event of eventsQuery.data ?? []) {
      if (event.occasionId === null) continue;
      counts.set(event.occasionId, (counts.get(event.occasionId) ?? 0) + 1);
    }

    return counts;
  }, [eventsQuery.data]);

  const rows: CalendarRow[] = useMemo(() => {
    const events = eventsQuery.data ?? [];
    const attendeesByEvent = attendeesQuery.data ?? {};
    const participationByEvent = participationQuery.data ?? {};

    return events
      .map((event) => {
        const profile = event.profileId === null ? undefined : profilesById.get(event.profileId);
        const attendees = attendeesByEvent[event.id] ?? [];

        // ONE CALL, AND IT IS WHERE THE ITER-033 LEAK IS CLOSED. A closed team's future games now
        // resolve to `no_expectation` / `season_closed` and raise nothing — and this file still
        // contains no reference to `closedAt`, because the window function owns that rule.
        //
        // A TEAM WITH NOBODY ON ITS ROSTER YET LANDS ON `expected` WITH AN EMPTY LIST, so its
        // games keep their ordinary coverage badge and stay LOUD. That is the branch a tidy-up
        // will want to invert; lib/youth/roster.ts argues it at length.
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
          attendance,
          activityName: profile?.activityName ?? null,
          schoolOrg: profile?.schoolOrg ?? null,
          activityType: profile?.activityType ?? null,
          orgId: profile?.orgId ?? null,
          attendees,
          coverage: eventCoverage(
            {
              eventType: event.eventType,
              eventDate: event.eventDate,
              status: event.status,
              attendeeCount: attendees.length,
              // Resolves to `not_expected` at every distance from the clock, so a game with no
              // expectation drops out of the count strip above and raises no badge below — from
              // the SAME computation, which is what stops the strip and the cards disagreeing.
              youthAttended: attendance === null ? null : youthAttendedForEvent(attendance),
            },
            asOfInstant,
          ),
        };
      })
      .filter((row) => (profileId === ANY ? true : row.event.profileId === profileId))
      .filter((row) => (orgId === ANY ? true : row.orgId === orgId))
      .filter((row) => (activityType === ANY ? true : row.activityType === activityType))
      .filter((row) => (eventType === ANY ? true : row.event.eventType === eventType));
  }, [
    eventsQuery.data,
    attendeesQuery.data,
    participationQuery.data,
    profilesById,
    profileId,
    orgId,
    activityType,
    eventType,
    asOfInstant,
    wardTimeZone,
  ]);

  // Computed from the ROWS ON SCREEN, so the strip and the badges beneath it cannot disagree —
  // summariseCoverage lives in lib/youth/coverage.ts beside eventCoverage for exactly that reason
  // (the describeHouseholdForVisits lesson from visits-f).
  const summary = useMemo(
    () => summariseCoverage(rows.map((row) => row.coverage)),
    [rows],
  );

  // ---------------------------------------------------------------------------
  // THERE IS NO SORT CONTROL ON THIS PAGE, AND THAT IS A DECISION.
  // ---------------------------------------------------------------------------
  // One shipped briefly, offering "Needs attention first" beside the four filters. It was removed
  // on 2026-08-29 after the walk: a calendar has ONE order, and a reader who has just been handed
  // a date grid does not then want the list beneath it in a different sequence. It also read as a
  // fifth filter rather than as a different kind of control.
  //
  // The uncovered events are not lost with it — the banner above NAMES them, which is the thing a
  // leader actually acts on and is why youth-c replaced a count with a sentence in the first
  // place. Ranking the whole list to surface one or two events was solving a problem the banner
  // had already solved.
  //
  // Rows stay in the fetch's date order, which is what the month grids are built from too.

  // NAMED, UP TO THREE. Beyond that the names stop being a list somebody reads and become a
  // paragraph they skip, so the rest are counted instead. `rows` is in the fetch's date order, so
  // the three named are the three soonest — the ones there is least time to fix.
  const uncoveredSentence = useMemo(() => {
    const uncovered = rows.filter((row) => row.coverage.state === "uncovered");
    if (uncovered.length === 0) return null;

    const named = uncovered.slice(0, MAX_NAMED_UNCOVERED);
    const rest = uncovered.length - named.length;

    const names = named
      .map(
        (row) =>
          `${row.event.title}, ${formatShortWhen(
            row.event.eventDate,
            row.event.allDay,
            wardTimeZone,
          )}`,
      )
      .join("; ");

    const lead =
      uncovered.length === 1
        ? "1 home event in the next week with nobody going:"
        : `${uncovered.length} home events in the next week with nobody going:`;

    return rest === 0 ? `${lead} ${names}.` : `${lead} ${names}; and ${rest} more.`;
  }, [rows, wardTimeZone]);

  const today = useMemo(() => dayKey(asOf, wardTimeZone), [asOf, wardTimeZone]);

  // One grid per month present in the filtered rows, so a season spanning November to February
  // renders four months rather than one arbitrary one.
  const months = useMemo(() => {
    const byMonth = new Map<string, Map<DateOnly, ActivityMonthGridDay>>();

    for (const { event, coverage } of rows) {
      const date = dayKey(event.eventDate, wardTimeZone);
      if (date === null) continue;

      const month = monthOf(date);
      const days = byMonth.get(month) ?? new Map<DateOnly, ActivityMonthGridDay>();
      const existing = days.get(date);

      // The WORST state on that day wins the cell, reduced with coverageRank() rather than with a
      // second ordering that could disagree with COVERAGE_STATES.
      const worstState =
        existing?.worstState === undefined || existing.worstState === null
          ? coverage.state
          : coverageRank(coverage.state) < coverageRank(existing.worstState)
            ? coverage.state
            : existing.worstState;

      days.set(date, {
        date,
        count: (existing?.count ?? 0) + 1,
        worstState,
      });
      byMonth.set(month, days);
    }

    return [...byMonth.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, days]) => ({
        month: `${month}-01` as DateOnly,
        days: [...days.values()].sort((left, right) => left.date.localeCompare(right.date)),
      }));
  }, [rows, wardTimeZone]);

  const errorMessage = profilesQuery.isError
    ? (profilesQuery.error as Error).message
    : eventsQuery.isError
      ? (eventsQuery.error as Error).message
      : attendeesQuery.isError
        ? (attendeesQuery.error as Error).message
        : undefined;

  return (
    <div className="flex flex-col gap-4">
      <FormError message={errorMessage} />

      {/* A SENTENCE, NOT A NUMBER IN A CHIP. The uncovered count is the reason this page exists,
          and "3" beside a coloured dot is something a leader skims past.

          AND IT NAMES THEM. Found by walking scenario 053 on 2026-08-28: a reader saw this banner,
          then had to read all six cards closely to work out which one it meant. A count says
          something is wrong without saying where.

          NAMES RATHER THAN "look for the red one". A pointer to a colour is no pointer at all to
          somebody who cannot see it, and the name is what a leader needs anyway — it is the thing
          they will go and do something about.

          ZERO RENDERS NOTHING AT ALL rather than "0 uncovered": a zero state that announces itself
          every week trains people to skim past the banner, which costs the sentence its only job
          on the week it is not zero. */}
      {summary.uncovered === 0 ? null : (
        <p className="rounded-md border border-danger bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">
          {uncoveredSentence}
        </p>
      )}

      {summary.needs_type === 0 ? null : (
        <p className="text-sm text-warning">
          {summary.needs_type === 1
            ? "1 event still needs somebody to say whether it is home or away."
            : `${summary.needs_type} events still need somebody to say whether they are home or away.`}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-activity-name" className="text-sm font-medium text-foreground">
            Activity
          </label>
          <select
            id="filter-activity-name"
            className={SELECT_CLASSES}
            value={profileId}
            onChange={(input) => setProfileId(input.target.value)}
          >
            <option value={ANY}>Every activity</option>
            {activityOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-org" className="text-sm font-medium text-foreground">
            Organization
          </label>
          <select
            id="filter-org"
            className={SELECT_CLASSES}
            value={orgId}
            onChange={(input) => setOrgId(input.target.value)}
          >
            <option value={ANY}>Every organization</option>
            {organizations.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-activity" className="text-sm font-medium text-foreground">
            Kind of activity
          </label>
          <select
            id="filter-activity"
            className={SELECT_CLASSES}
            value={activityType}
            onChange={(input) => setActivityType(input.target.value as ActivityType | "")}
          >
            <option value={ANY}>Every kind</option>
            {ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {ACTIVITY_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-home-away" className="text-sm font-medium text-foreground">
            Home or away
          </label>
          <select
            id="filter-home-away"
            className={SELECT_CLASSES}
            value={eventType}
            onChange={(input) => setEventType(input.target.value as EventType | "")}
          >
            <option value={ANY}>Both</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EVENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

      </div>

      <p className="text-sm text-muted">
        {rows.length === 1 ? "1 event" : `${rows.length} events`} coming up.
      </p>

      {months.map((grid) => (
        <ActivityMonthGrid
          key={grid.month}
          month={grid.month}
          days={grid.days}
          today={today}
        />
      ))}

      {/* THE CARD LIST IS THE PRIMARY FORM and is always rendered — the grid above is `md:` and up
          only. A leader reads this on a phone (08-youth-activities.md §Step 7). */}
      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Nothing matches those filters. Widen one, or check that the activities have events
            entered.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.event.id}>
              <EventCard
                row={row}
                currentUserId={currentUserId}
                canAssign={canAssign}
                assignableUsers={assignableUsers}
                wardTimeZone={wardTimeZone}
                // MINUS ONE — the count is of the OTHERS, and this row is in the map too.
                siblingCount={
                  row.event.occasionId === null
                    ? 0
                    : (occasionCounts.get(row.event.occasionId) ?? 1) - 1
                }
                // Only when the profile is actually in the list. The card already reads "An
                // activity that is no longer listed" there, and a link to a card that will not
                // open is worse than none.
                youthHref={
                  row.event.profileId !== null && row.activityName !== null
                    ? `/youth?youth=${row.event.profileId}`
                    : null
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventCard({
  row,
  currentUserId,
  canAssign,
  assignableUsers,
  youthHref,
  siblingCount,
  wardTimeZone,
}: {
  row: CalendarRow;
  currentUserId: string;
  canAssign: boolean;
  assignableUsers: { id: string; label: string }[];
  youthHref: string | null;
  wardTimeZone: string;
  // How many OTHER young people are at this same game. Computed from the UNFILTERED list by the
  // caller — see the comment on `occasionCounts`.
  siblingCount: number;
}) {
  const { event, coverage, attendance, activityName, schoolOrg, attendees } = row;

  // Every young person somebody has said is not taking part, in `memberships` order. An event
  // serves a whole TEAM now, so a card can carry several chips — one naming each — and
  // describeYouthAbsence() words all of them so three chips cannot be worded three ways.
  const absentMembers = attendance === null ? [] : attendance.absent;

  // WHO IS EXPECTED, BY NAME. Empty for a team nobody is on yet AND for one whose season has
  // closed; the difference between those two is carried by the coverage badge, which is loud for
  // the first and silent for the second.
  const expected = attendance === null ? [] : expectedNames(attendance);

  // The same rule EventList follows: where the coverage badge already says a card is unclassified,
  // the type chip would be a second, vaguer copy of it. Kept when the badge is absent — a past or
  // cancelled event — because then the chip is the only thing carrying the fact.
  const showTypeChip = !(event.eventType === "tbd" && coverage.state === "needs_type");

  return (
    <Card className={COVERAGE_EDGE_CLASSES[coverage.state]}>
      <div className="flex flex-wrap items-center gap-2">
        {/* THE TITLE IS THE WAY IN TO THE EVENT ITSELF, which is where the occasion — every young
            person at this same game — is read and built. ITER-020 asked for exactly this
            crossing: any card → the event → the occasion's young people → a young person's
            card. */}
        <Link
          href={`/youth/events/${event.id}`}
          className="text-sm font-medium text-primary underline underline-offset-4"
        >
          {event.title}
        </Link>
        {showTypeChip ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted">
            {EVENT_TYPE_LABELS[event.eventType]}
          </span>
        ) : null}
        <CoverageBadge coverage={coverage} />
        {event.status === "cancelled" ? (
          <span className="rounded-full border border-warning px-2 py-0.5 text-xs font-medium text-warning">
            Cancelled
          </span>
        ) : null}
        {/* MARKED, NOT REMOVED. A game a young person is not taking part in stays on the
            calendar carrying its chip, exactly as a cancelled one does — the record that it was
            scheduled is what somebody asking "why did nobody go?" needs. ONE CHIP PER ABSENT
            YOUNG PERSON, because an event serves a whole team now; a card with none is a game
            everybody on the roster is at (migration 062d).

            THE CONTROL IS NOT HERE, deliberately. It lives in EventList and nowhere else: a
            second entry point would be a second meaning of the same word, which is the ground
            youth-h refused a second "unlink" on. */}
        {absentMembers.map((member) => (
          <YouthAbsenceChip
            key={member.memberId}
            youthAttended={false}
            memberName={member.memberName}
          />
        ))}
      </div>

      <p className="mt-1 text-sm text-foreground">
        {formatWhen(event.eventDate, event.allDay, wardTimeZone)}
      </p>

      {/* THE ACTIVITY IS A LINK TO THE YOUNG PEOPLE ON IT. The calendar answers "what is
          happening"; the overview answers "how are these people doing", and a leader reading one
          wants the other.

          THE LINK NOW NAMES A TEAM RATHER THAN A PERSON, and /youth resolves `?youth=` to the
          FIRST young person on that team's roster. That is a stated limitation rather than an
          oversight — a card here is a whole team's game and singles nobody out, so there is no
          better answer to give the link than "open this activity". /youth/page.tsx records the
          same thing from the other side. An id naming nothing, or a team with an empty roster,
          resolves to no expansion rather than to a card that never opens. */}
      {activityName === null ? (
        <p className="mt-1 text-sm text-muted">An activity that is no longer listed</p>
      ) : youthHref === null ? (
        <p className="mt-1 text-sm text-muted">
          {schoolOrg === null ? activityName : `${activityName} · ${schoolOrg}`}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">
          <Link href={youthHref} className="text-primary underline underline-offset-4">
            {activityName}
          </Link>
          {schoolOrg === null ? null : ` · ${schoolOrg}`}
        </p>
      )}

      {/* WHO IS EXPECTED, BY NAME — what a card gained in exchange for the single member name it
          lost. One game now says who is playing in it rather than whose game it is.

          NOTHING AT ALL WHEN THE LIST IS EMPTY. A team nobody is on yet keeps its ordinary
          uncovered badge, which is the loud signal; the sentence explaining it belongs beside the
          control that fixes it, on /youth/profiles, not repeated on twelve cards. */}
      {expected.length === 0 ? null : (
        <p className="text-sm text-muted">{expected.join(", ")}</p>
      )}

      {event.location === null ? null : (
        <p className="text-sm text-muted">{event.location}</p>
      )}

      {/* NOTHING AT ALL AT ZERO, which is nearly every card. "+0 others at this game" is noise on
          the ordinary row — talks-c's render-nothing-rather-than-"Never" rule.

          SINGULAR AND PLURAL BOTH WRITTEN OUT. youth-b's walk found "1 events updated" shipped
          past a green suite, because a plural bug is invisible to every test that does not read
          the sentence. */}
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

      {/* ---------------------------------------------------------------
          WHO IS GOING, WITH THE CONTROLS — AND THERE IS NO SECOND COPY OF ANY GATE
          ---------------------------------------------------------------
          This card used to render a read-only "Going:" line, with a comment saying that showing a
          control here would mean a second copy of two permission gates and that this is exactly
          how youth-a-D1 happened. The concern was right; what resolved it is that AttendeeControls
          is ONE COMPONENT rendered by both screens, so there is no second copy to disagree.

          The gates it carries: "I'll go" needs `youth_activities.view`, which everybody reading
          this page holds, and the route writes the CALLER'S OWN id and can write no other. "Ask
          someone to go" is bishopric-only, resolved once on the server and passed down as
          `canAssign` — absent for everybody else rather than present-and-refusing.

          It renders the "Going:" line itself, which is why that paragraph is gone rather than
          duplicated above it.

          This only works because the page composes its rows from the shared cache: the mutation
          invalidates ATTENDEE_MUTATION_INVALIDATES, and both of those keys are read here. */}
      <AttendeeControls
        eventId={event.id}
        attendees={attendees}
        currentUserId={currentUserId}
        canAssign={canAssign}
        assignableUsers={assignableUsers}
      />
    </Card>
  );
}
