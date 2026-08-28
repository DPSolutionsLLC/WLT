"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ActivityMonthGrid, type ActivityMonthGridDay } from "@/components/youth/ActivityMonthGrid";
import { COVERAGE_EDGE_CLASSES, CoverageBadge } from "@/components/youth/CoverageBadge";
import type { DateOnly } from "@/lib/calendar/dates";
import { monthOf } from "@/lib/calendar/dates";
import { eventCoverage, summariseCoverage, type EventCoverage } from "@/lib/youth/coverage";
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
// Every card is bucketed into a day using the READER'S OWN ZONE, in the client, so the day a card
// sits under always matches the time printed on it.
//
// Do NOT bucket by the ward's zone. EventList.formatInstant already renders in the reader's zone,
// and mixing the two puts an 11pm game under the wrong date on the grid while its own card says
// otherwise — a bug that appears for a few hours a day and only for some readers, which is the
// worst kind to find.
//
// lib/ward/wardTimezone.ts decides what a FLOATING IMPORTED TIME MEANS. It does not decide what
// day a rendered card belongs to. Those are two different questions and the ward's zone is the
// answer to only the first.

export type CalendarEvent = {
  id: string;
  title: string;
  eventType: EventType;
  eventDate: string;
  location: string | null;
  allDay: boolean;
  status: "upcoming" | "cancelled";
  profileId: string | null;
  memberName: string | null;
  activityName: string | null;
  activityType: ActivityType | null;
  orgId: string | null;
  attendeeNames: string[];
  attendeeCount: number;
};

export type ActivityCalendarProps = {
  events: CalendarEvent[];
  organizations: { id: string; label: string }[];
  youth: { id: string; label: string }[];
  // ONE INSTANT for the whole render, resolved on the server. An ISO string because a Date does
  // not survive the server-to-client boundary as itself.
  asOf: string;
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

const ANY = "";

// THE READER'S OWN ZONE AND LOCALE — `undefined` locale rather than "en-US", the rule
// lib/visits/visitDates.ts states for a timestamptz and EventList.tsx follows: a game is a time
// somebody has to turn up at. The YEAR is carried so a 2099 row does not render identically to a
// 2026 one.
function formatWhen(instant: string, allDay: boolean): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "An unreadable date";

  if (allDay) {
    // Never "12:00am" — an all-day entry is stored at ward midnight and rendering it as a time is
    // indistinguishable from an off-by-N-hours bug (migration 055a).
    return `${parsed.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    })} · All day`;
  }

  return parsed.toLocaleString(undefined, {
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
// formatWhen: the reader's own.
function formatShortWhen(instant: string, allDay: boolean): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "an unreadable date";

  const day = parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  if (allDay) return `${day}, all day`;

  return `${day}, ${parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

// THE READER'S ZONE, expressed as a YYYY-MM-DD key. Built from the locale-independent `en-CA`
// short date rather than from `toISOString()`, which would be UTC and put a 6pm game on the wrong
// day for every reader west of Greenwich.
const DAY_KEY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dayKey(instant: string): DateOnly | null {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return null;
  return DAY_KEY_FORMAT.format(parsed);
}

export function ActivityCalendar({
  events,
  organizations,
  youth,
  asOf,
}: ActivityCalendarProps) {
  const asOfInstant = useMemo(() => new Date(asOf), [asOf]);

  const [profileId, setProfileId] = useState(ANY);
  const [orgId, setOrgId] = useState(ANY);
  const [activityType, setActivityType] = useState<ActivityType | "">(ANY);
  const [eventType, setEventType] = useState<EventType | "">(ANY);

  const rows = useMemo(() => {
    return events
      .filter((event) => (profileId === ANY ? true : event.profileId === profileId))
      .filter((event) => (orgId === ANY ? true : event.orgId === orgId))
      .filter((event) =>
        activityType === ANY ? true : event.activityType === activityType,
      )
      .filter((event) => (eventType === ANY ? true : event.eventType === eventType))
      .map((event) => ({
        event,
        coverage: eventCoverage(
          {
            eventType: event.eventType,
            eventDate: event.eventDate,
            status: event.status,
            attendeeCount: event.attendeeCount,
          },
          asOfInstant,
        ),
      }));
  }, [events, profileId, orgId, activityType, eventType, asOfInstant]);

  // Computed from the ROWS ON SCREEN, so the strip and the badges beneath it cannot disagree —
  // summariseCoverage lives in lib/youth/coverage.ts beside eventCoverage for exactly that reason
  // (the describeHouseholdForVisits lesson from visits-f).
  const summary = useMemo(
    () => summariseCoverage(rows.map((row) => row.coverage)),
    [rows],
  );

  // NAMED, UP TO THREE. Beyond that the names stop being a list somebody reads and become a
  // paragraph they skip, so the rest are counted instead. The events are already in date order,
  // so the three named are the three soonest — which are the ones there is least time to fix.
  const uncoveredSentence = useMemo(() => {
    const uncovered = rows.filter((row) => row.coverage.state === "uncovered");
    if (uncovered.length === 0) return null;

    const named = uncovered.slice(0, MAX_NAMED_UNCOVERED);
    const rest = uncovered.length - named.length;

    const names = named
      .map((row) => `${row.event.title}, ${formatShortWhen(row.event.eventDate, row.event.allDay)}`)
      .join("; ");

    const lead =
      uncovered.length === 1
        ? "1 home event in the next week with nobody going:"
        : `${uncovered.length} home events in the next week with nobody going:`;

    return rest === 0 ? `${lead} ${names}.` : `${lead} ${names}; and ${rest} more.`;
  }, [rows]);

  const today = useMemo(() => dayKey(asOf), [asOf]);

  // One grid per month present in the filtered rows, so a season spanning November to February
  // renders four months rather than one arbitrary one.
  const months = useMemo(() => {
    const byMonth = new Map<string, Map<DateOnly, ActivityMonthGridDay>>();

    for (const { event, coverage } of rows) {
      const date = dayKey(event.eventDate);
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
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
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
          <label htmlFor="filter-youth" className="text-sm font-medium text-foreground">
            Young person
          </label>
          <select
            id="filter-youth"
            className={SELECT_CLASSES}
            value={profileId}
            onChange={(input) => setProfileId(input.target.value)}
          >
            <option value={ANY}>Everybody</option>
            {youth.map((option) => (
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
          {rows.map(({ event, coverage }) => (
            <li key={event.id}>
              <EventCard event={event} coverage={coverage} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventCard({
  event,
  coverage,
}: {
  event: CalendarEvent;
  coverage: EventCoverage;
}) {
  // The same rule EventList follows: where the coverage badge already says a card is unclassified,
  // the type chip would be a second, vaguer copy of it. Kept when the badge is absent — a past or
  // cancelled event — because then the chip is the only thing carrying the fact.
  const showTypeChip = !(event.eventType === "tbd" && coverage.state === "needs_type");

  return (
    <Card className={COVERAGE_EDGE_CLASSES[coverage.state]}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{event.title}</span>
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
      </div>

      <p className="mt-1 text-sm text-foreground">
        {formatWhen(event.eventDate, event.allDay)}
      </p>

      <p className="mt-1 text-sm text-muted">
        {event.memberName === null || event.activityName === null
          ? "An activity that is no longer listed"
          : `${event.memberName} · ${event.activityName}`}
      </p>

      {event.location === null ? null : (
        <p className="text-sm text-muted">{event.location}</p>
      )}

      {/* WHO IS GOING, WITHOUT THE CONTROLS. This page is the ward-wide overview; changing who is
          going happens on /youth, where the event's own card carries the buttons. Showing a
          control here would mean a second copy of two permission gates, which is exactly how
          youth-a-D1 happened. */}
      <p className="mt-1 text-sm text-muted">
        {event.attendeeNames.length === 0
          ? "Nobody is down for this yet."
          : `Going: ${event.attendeeNames.join(", ")}`}
      </p>
    </Card>
  );
}
