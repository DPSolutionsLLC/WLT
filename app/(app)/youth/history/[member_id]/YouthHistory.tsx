import { Card } from "@/components/ui/Card";
import { describeActivitySupport, type ActivitySupport } from "@/lib/youth/profileNeed";
import {
  ACTIVITY_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  type ActivityType,
  type EventType,
} from "@/types/domain";

// One young person's finished seasons, and how well each of them was supported.
//
// ---------------------------------------------------------------------------
// NOT A CLIENT COMPONENT, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------
// There is no state, no effect and no handler here: this is a record of what happened, and nothing
// on it can be changed. CLAUDE.md §6 is "Server Components by default", and a `"use client"`
// directive would drag `initialData` seeding and three shared cache keys onto a screen with no
// mutation on it — machinery YouthOverview needs because every control there writes.
//
// ---------------------------------------------------------------------------
// THE NUMBERS ARE RECOMPUTED AGAINST `closedAt`, NEVER STORED
// ---------------------------------------------------------------------------
// The page hands each row an ActivitySupport computed with `new Date(profile.closedAt)` as the
// clock. That is the stored-versus-computed argument this module has now had several times —
// `covered`/`uncovered` off the status column (054c), coverage on read (056), the follow-up prompt
// (youth-d), the support percentage itself — answered the same way each time. A stored final
// percentage would be a number the clock decided, and NOTHING IN THIS PROJECT REFRESHES ANYTHING:
// pg_cron is not enabled, supabase/functions/ does not exist, vercel.json declares no crons.
// Recomputing means the number is frozen because its INPUT is frozen, which needs no machinery.
//
// ---------------------------------------------------------------------------
// EVERY FORMATTER NAMES ITS ZONE, AND IT IS THE WARD'S
// ---------------------------------------------------------------------------
// tests/lib/explicitTimeZone.test.ts reads the source and fails on any formatter that omits one,
// including in a brand-new file. WHICH zone is a per-case decision (CLAUDE.md §9): a game is a
// turn-up-at instant and takes the WARD's, exactly as EventList does.
//
// `closedAt` takes the ward's too, and that is a decision rather than a copy. It is a stamp — the
// shape VersionHistory renders in UTC — but it stamps an act a leader in this ward performed, and
// it sits three lines above a list of that ward's games. A season closed at 6pm on a Thursday in
// Denver must not read as Friday, and one page showing two zones is worse than either choice.

export type ClosedSeasonEvent = {
  id: string;
  title: string;
  eventDate: string;
  eventType: EventType;
  allDay: boolean;
};

export type ClosedSeason = {
  profileId: string;
  activityName: string;
  activityType: ActivityType;
  schoolOrg: string | null;
  seasonSchedule: string | null;
  closedAt: string;
  // Carried WHOLE rather than as a percentage and a sentence, so the two cannot describe different
  // seasons — youth-f's rule, which this module now states in six places.
  support: ActivitySupport;
  events: ClosedSeasonEvent[];
};

export type YouthHistoryProps = {
  seasons: ClosedSeason[];
  wardTimeZone: string;
};

// The four lines EventList carries, and NOT imported from it: that module is a "use client"
// component, and importing a helper out of one into a Server Component drags the directive with
// it. The RULE is shared and cited; four lines are not worth coupling the two files over.
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

function formatDay(instant: string, timeZone: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) return "an unreadable date";

  return parsed.toLocaleDateString("en-US", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// AN ALL-DAY EVENT NEVER RENDERS "12:00am" — migration 055a's whole justification, restated here
// because a finished season is exactly where a schedule feed's tournament weekends end up.
function formatEventWhen(instant: string, allDay: boolean, timeZone: string): string {
  return allDay ? `${formatDay(instant, timeZone)} · All day` : formatInstant(instant, timeZone);
}

// THE EM DASH RATHER THAN "0%", which is supportPill()'s rule on /youth and is here for the reason
// it gives there: 0% is a judgement, and a season where no home game was ever played has nothing
// to judge. It reads differently on a finished season — "this season had no home games" — and it
// is still not a score.
function supportPercentage(support: ActivitySupport): string {
  if (support.supportedFraction === null) return "—";

  return `${Math.round(support.supportedFraction * 100)}%`;
}

function eventCount(count: number): string {
  return count === 1 ? "1 event" : `${count} events`;
}

export function YouthHistory({ seasons, wardTimeZone }: YouthHistoryProps) {
  if (seasons.length === 0) {
    return (
      <Card>
        {/* A SENTENCE, NOT A BLANK PANEL. An empty state that renders nothing reads as a page that
            failed to load (youth-c). This one is reachable only from a card that has at least one
            closed season, so arriving here empty means something moved underneath the reader —
            saying what would put a season here is the useful half. */}
        <p className="text-sm text-muted">
          No finished seasons yet. When a season is closed on the activities page it appears here,
          with the games that were played and how often somebody was there.
        </p>
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {seasons.map((season) => (
        <li key={season.profileId}>
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">{season.activityName}</h2>
              <span className="text-xs text-muted">
                {ACTIVITY_TYPE_LABELS[season.activityType]}
              </span>
            </div>

            {season.schoolOrg === null ? null : (
              <p className="mt-1 text-sm text-muted">{season.schoolOrg}</p>
            )}
            {season.seasonSchedule === null ? null : (
              <p className="text-sm text-muted">{season.seasonSchedule}</p>
            )}

            <p className="mt-3 text-2xl font-semibold text-foreground">
              {supportPercentage(season.support)}
            </p>

            {/* THE COUNTS BESIDE THE PERCENTAGE, never the percentage twice. At small N a
                percentage misleads — one game of two is 50% and says almost nothing — so the
                auditable form sits under it and a leader can check the number rather than trust
                it. Both come out of the same ActivitySupport. */}
            <p className="text-sm text-muted">
              {describeActivitySupport(season.support) ??
                "No home games were played on this season."}
            </p>

            <p className="mt-2 text-xs text-muted">
              Closed on {formatDay(season.closedAt, wardTimeZone)} ·{" "}
              {eventCount(season.events.length)}
            </p>

            {season.events.length === 0 ? null : (
              <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
                {season.events.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="text-foreground">{event.title}</span>
                    <span className="text-muted">
                      {formatEventWhen(event.eventDate, event.allDay, wardTimeZone)}
                    </span>
                    <span className="text-xs text-muted">
                      {EVENT_TYPE_LABELS[event.eventType]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}
